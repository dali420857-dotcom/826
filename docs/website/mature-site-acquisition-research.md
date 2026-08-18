# 網站取得、鏡像與 SPA 互動盤點：成熟做法研究

> 研究日期：2026-08-15（本次只查官方文件；沒有請求 `konk.cc`，沒有登入、讀取 Cookie/Token 或執行外部寫入。）
>
> 這份文件研究的是「怎麼安全取得已獲授權的網站證據，再重建本地前端」，不是授權直接複製任何第三方網站。

## 先講結論

沒有一個工具能可靠地把 Vue/SPA 從登入頁一路自動找出所有 route、modal、drawer、表單驗證、權限分支和錯誤狀態。成熟做法是分層：

1. **先做授權與範圍閘門**：確認網站所有權或書面授權、帳號範圍、允許的 host/path、請求方法、速率和保存期限。
2. **靜態層**用 Wget 或 HTTrack 做有限的 HTML/CSS/JS/圖片資產清單和可重現的下載紀錄；這不是 SPA 互動盤點器。
3. **瀏覽器層**用 Playwright（必要時搭配 WebScrapBook 或 SingleFile）在授權的測試帳號／staging 逐一操作 route 和每個可開啟的狀態，記錄畫面、DOM、URL、請求和回應摘要。
4. **證據層**用 WARC/pywb 保存請求—回應的封存與回放；用 HAR/JSON fixtures 給本地測試使用。兩者都要和產品原始碼分離。
5. **產品層**重新用 Vue Router、typed fixtures 和本地 mock API 建構 clean-room 前端；不把原站 bundle、Cookie、Token、私有 API 或真實個資放進 repo。
6. **驗證層**用 Playwright 測每一個「route × viewport × action × outcome」，並確認本地應用沒有外連。

Vue 官方說明 SPA 是由瀏覽器端 JavaScript 攔截導覽、動態取資料並更新視圖；Vue Router 的 HTML5 history 模式還要求伺服器把未知路徑 fallback 到 `index.html`。因此，**只下載入口 HTML 通常只得到 app shell，不能證明所有 SPA route 或互動狀態已取得**；這是根據官方路由說明做的工程推論（見「推論與未驗證事項」）。

## 工具分層與適用性

| 工具                           | 官方文件明確支援的能力                                                                                                                                                                                        | 最適合的層                                            | Vue/SPA、登入、modal/drawer 的判斷                                                                                                                  | 主要風險／維護性                                                                                                                              | 結論                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GNU Wget                       | 遞迴抓取 HTML/CSS、依連結建立本地樹、`--convert-links`、robots、等待、WARC 和 CDX 選項；官方明確警告遞迴抓取可能壓垮伺服器。                                                                                  | 靜態資產清單、有限的公開頁面鏡像、封存來源            | 不執行完整瀏覽器互動；不能自行找出被 click 才出現的 modal/drawer，也不應用 Cookie 去碰未授權登入內容。                                              | Cookie 檔和 debug log 可能含登入資訊；命令列密碼會暴露；無界遞迴會耗盡頻寬／磁碟。                                                            | **靜態 inventory/封存工具**，不是 UI clone 工具。                                           |
| HTTrack                        | 遞迴鏡像、重寫相對連結、resume/update、URL/MIME/大小/速率/併發限制、robots、WARC 1.1/WACZ 選項。官方 FAQ 明確說 intensive JavaScript、複雜 CGI 可能不完整。                                                   | 有明確 allowlist 的靜態鏡像與更新報告                 | 對傳統 HTML 比 Wget 方便；對 Vue runtime route、click 狀態與權限資料仍不完整。                                                                      | `--disable-security-limits` 是官方標示的危險選項；Cookie、proxy、User-Agent 和跨域設定擴大風險。重新散布下載內容仍需版權人授權。              | **靜態鏡像候選**；須嚴格 scope/rate，不能當 SPA 盤點主工具。                                |
| SingleFile CLI                 | 透過 headless Chromium/CDP 把已渲染頁面存成單一 HTML；可 crawl 內部 links、設定深度和 rewrite rule。AGPL 授權，商用需另行處理。                                                                               | 單頁視覺快照、已操作後的 rendered snapshot            | 比純 HTTP 工具能看到 runtime DOM，但一次輸出仍是某一個時間點／狀態；官方文件沒有提供「自動窮舉所有 route/modal」保證。                              | 單檔不適合長期維護產品；資源、互動邏輯、後端狀態仍可能外連；不能把原站 snapshot 當成可維護 Vue 原始碼。                                       | **快照輔助工具**，不作主要重建方法。                                                        |
| WebScrapBook                   | 瀏覽器擷取可在頁面完全載入後等待、捲動和互動；支援 Single HTML、Folder、HTZ、MAFF、linked-page depth、resource map、re-capture/merge-capture。                                                                | 人工監督的動態頁面證據、視覺和資源封存                | 很適合逐個保存「打開 modal/drawer 後」的畫面；官方也提醒動態內容可能要等待、捲動或操作後才載入。它不是 route/state 自動測試器。                     | 擷取內容可能原樣含個資；backend 要做 chroot/root 限制。Single HTML 對複雜內容有明確限制；大 archive 可能記憶體／效能不佳。                    | **人工證據／封存輔助**；用於視覺比對，不替代 Playwright state matrix。                      |
| pywb / Webrecorder             | 以 WARC/ARC、CDX 索引做高保真 replay；有 Warcserver、Recorder、Rewriter、client-side replay；可在本地 collection 重播。官方建議安全情境用 framed replay。                                                     | 可稽核封存、離線 replay、重現請求—回應                | 能保存 JS-heavy 網站的網路證據，但 WARC replay 不是 Vue 元件原始碼，也不會自動推導所有 UI 狀態。                                                    | recording 會寫入 WARC；要先核准 scope。封存可能含敏感 headers/body；需分離 archive 目錄和產品 fixtures。                                      | **證據層／回放層**，不直接當成產品實作。                                                    |
| Playwright codegen/network/HAR | codegen 可產生 locator/action，支援 viewport/device 和保存 authenticated storage；可監聽 request/response、等待 click 後 response、route/fulfill mock；HAR 可記錄、修改、以嚴格 URL/method/payload 規則回放。 | SPA route/state 盤點、互動測試、fixture 建立          | 目前最適合「逐路由、逐互動」盤點。可在授權測試帳號操作登入、modal、drawer、表單和錯誤分支；但仍需人工／腳本明確列出操作，不會神奇地發現不可達狀態。 | `--save-storage` 含 cookies、localStorage、IndexedDB；官方要求只在本地使用，加入 gitignore 或完成後刪除。HAR 也可能含 Cookie、headers、body。 | **主工具**：隔離 context、GET/唯讀優先、redact 後才保存 HAR/fixtures；永不提交 auth state。 |
| Firecrawl                      | Hosted API 的 Map/Crawl/Scrape、HTML/Markdown/JSON/screenshot；Interact/Browser 可點擊、填表和持續 session；API 需 Bearer key；Lockdown 模式可只讀 cache、不向目標發出 outbound request。                     | 獲授權的 URL map、內容/RAG ingest、必要時的遠端瀏覽器 | 可處理 JS 和登入流程，但輸出核心是資料擷取／內容結構化，不是完整 UI component/state clone；Browser persistent profile 會保存登入狀態。              | hosted API 會把 URL、內容和可能的敏感資訊放到外部服務；有費用、key、資料保留和跨境風險。反爬／proxy/雲端 session 需另行批准。                 | **只在明確批准 provider、資料處理和費用後考慮**；不作本專案預設路徑。                       |

## 使用者補充工具的逐項校正

以下分類依各專案自己的官方 README/API 文件，不使用星數、X 貼文或部落格作證據。

| 工具                                             | 官方定位／可驗證能力                                                                                                                                                                                                                                           | 分類                                                                               | 對本案的判斷                                                                                                                                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebClone**（此處指 `ruslanmv/webclone`）       | 官方 README 稱它是 async-first 的 website cloning/rendered capture，輸出 HTML、assets、structured content 和 render debug；支援 recursive、depth/page/worker/delay、JS rendering、selector wait/click、screenshot，並明確要求只處理 owned/authorized targets。 | **混合鏡像 + rendered capture + RAG**；不是純靜態鏡像。                            | 可作授權文件站的受控預掃描，但 structured output 面向 RAG，不能代替 Playwright 的完整 UI state matrix。其 cookie-based auth、MCP、Selenium session 會帶入登入憑證邊界；只可用隔離、短期、已授權 session。 |
| **Scrapy**                                       | 官方文件定位為 crawling/extraction framework，可做 data mining、API extraction、general crawler；輸出 JSON/CSV/XML 等 feed，並提供 delay、concurrency、AutoThrottle、robots、cookies/session 和 media pipeline。                                               | **資料爬取／結構化抽取**，不是網站鏡像格式。                                       | 適合 URL/API/資料清單，不適合直接取得 Vue rendered DOM、modal/drawer 或可重播 UI。要用瀏覽器時應另接瀏覽器工具並重新做授權與速率審查。                                                                    |
| **Crawlee**                                      | 官方文件支援 HTTP/HTML crawler 和 Playwright/Puppeteer browser crawler、RequestQueue、requestHandler、深度與頁數限制、concurrency/RPM；另有 session/cookie/proxy rotation 和「avoid getting blocked」指南。                                                    | **可擴展 crawler／browser data extraction**；可做 hybrid，但不是封存／產品 clone。 | 可以做大規模 URL 或 rendered data 抽取；不建議為了本案開 proxy rotation、session rotation 或反封鎖功能。這些功能會改變請求來源／行為，必須在授權和 provider 範圍內明確批准。                              |
| **md-crawler**（此處指 `SolarLiner/md-crawler`） | 官方 README 的定位是「爬本地目錄中的 Markdown，驗證／載入 frontmatter」。不是 HTTP website crawler。                                                                                                                                                           | **本地文件索引／frontmatter validator**。                                          | 不適合拿來扒網站；可在後續把已核准、已清理的研究 Markdown 建索引，但不應列入網站取得方案。若使用者指的是另一個同名套件，需先給出明確 repo/版本。                                                          |
| **Crawl4AI**                                     | 官方文件定位為 LLM-friendly crawler/scraper；Chromium headless、HTML→Markdown、CSS/XPath/LLM extraction、deep crawl、動態 JS/Load More；官方安全頁要求驗證 URL、注意 hooks 任意程式碼，並提供 scheme validation、rate limit 等安全設定。                       | **LLM/RAG 資料爬取 + 動態內容抽取**。                                              | 適合把授權網站變成 Markdown/structured data，不是取得完整 Vue UI。sessions、cookies、proxies、anti-bot/代理升級會增加登入、第三方網路和合規風險；本案預設不用這些繞過能力。                               |
| **Firecrawl**                                    | 見上表：Map/Crawl/Scrape/Interact/Browser，hosted API 需 key，也有 self-host/Lockdown 路線。                                                                                                                                                                   | **雲端／自架的內容與瀏覽器擷取服務**。                                             | 只在 data-processing、費用、帳號和目標授權都批准後使用；Lockdown 只能讀既有 cache，不等於能取得新的 target page。                                                                                         |

### 三個容易混淆的分類

- **靜態鏡像**：Wget、HTTrack；WebClone 在不開 browser render 時也可做一部分。輸出是檔案、連結重寫、cache/log，強項是資產與可離線瀏覽，不是互動狀態。
- **瀏覽器／封存**：Playwright、WebScrapBook、SingleFile、pywb。Playwright 最適合「操作並測試」；WebScrapBook/SingleFile 最適合「保存某個已呈現狀態」；pywb 最適合「保留 HTTP 證據並回放」。
- **資料／RAG**：Scrapy、Crawlee、Crawl4AI、Firecrawl、WebClone 的 structured-content 模式、`md-crawler` 的本地 Markdown 索引。它們能產生有用資料，但資料抽取成功不等於 UI、route、modal/drawer 或權限行為已重建。

## SPA、登入與所有彈窗／抽屜的實際盤點方法

### 1. 先做 route/state manifest，不先跑 crawler

先建立一份只含規格的 manifest：

```text
scope:
  allowed_hosts: []
  allowed_paths: []
  denied_paths: [/admin, /billing, ...]
  allowed_methods: [GET, HEAD]
  auth: none | approved-test-account
  max_pages: 0
  max_concurrency: 1
  min_delay_ms: 0

states:
  - route: /login
    viewport: desktop
    actions: [load, invalid-submit, empty-submit, show-password]
    expected_outcomes: [validation, error, unchanged]
  - route: /dashboard
    actions: [open-menu, open-drawer, open-modal, close-escape, close-backdrop]
    expected_outcomes: [visible, focus-trap, url-change, network-read]
```

manifest 的 route 來源應包含：公開 sitemap/links、授權測試帳號操作後看到的路由、Vue Router 的可觀察 URL、以及被按鈕／鍵盤／表格分頁觸發的狀態。**不要把 network log 裡出現的每個 URL 都自動當成可公開 route 或可重播 API。**這是安全和產品語意上的工程推論。

### 2. 靜態預掃描只做有限 inventory

對自有或已書面授權的 host：

- 先用 Wget/HTTrack `--spider`、URL list、最大頁數／深度／大小／速率，產出 URL manifest、status、content type、hash 和缺失清單。
- 開啟 robots/排除規則、同 host/path allowlist、低併發和固定 delay；不使用「無限遞迴」或停用安全限制的選項。
- 把 mirror/archive 目錄放在 repo 外的受控工作區；原始資產只作證據，不直接 import 到產品 bundle。

### 3. 用瀏覽器盤點可見狀態，而不是只抓 HTML

Playwright codegen 能記錄 locator/action，並可指定 viewport/device；network API 能監聽 request/response、等待某次 click 產生的 response、用 `route`/`fulfill` 阻擋或回填 API。建議每個 manifest action 都輸出：

- action id、前後 URL、viewport、可見文字／ARIA role 摘要；
- screenshot、DOM snapshot/hash、scroll position；
- request method、host、path、status、response schema 摘要；
- outcome：opened/closed/validation/error/loading/permission-denied；
- redacted HAR 或 typed JSON fixture（不含 Cookie、Authorization、個資）。

對 modal/drawer 特別測：按鈕開啟、關閉鈕、Escape、backdrop、瀏覽器 Back、焦點移動、滾動鎖定、重複開啟、表單錯誤、網路失敗、權限不足和小 viewport。這些是要建立的測試案例，不是任何工具自動保證的 coverage。

### 4. 登入和權限只用明確授權的測試邊界

Playwright 官方說 `--save-storage` 會保存 cookies、localStorage、IndexedDB，並明確提醒該檔案含敏感資訊，只能本地使用，完成後加入 `.gitignore` 或刪除。Wget 官方也說 Cookie 可以讓登入後鏡像成立，但其安全章節警告命令列密碼、basic auth 和 debug log 可能暴露密碼。

因此本案規則是：

- 沒有書面授權／專用 staging／測試帳號，就只做公開頁面觀察；不嘗試登入、不匯入瀏覽器 Cookie、不讀 token。
- 有授權時，使用一次性、最小權限、可撤銷的測試帳號和隔離 browser context；session state 放在 repo 外的短期秘密路徑，從 log、HAR、screenshots、fixtures 和 commit 全部排除。
- 只觀察 GET/HEAD 和被明確批准的唯讀操作；任何 POST/PUT/PATCH/DELETE、檔案上傳、付款、邀請、刪除或裝置控制立即停止並請求新的明確批准。
- 權限矩陣用 synthetic fixtures 重建：`anonymous`、`authenticated`、`forbidden`、`expired-session`、`server-error`。不把真實帳號資料或 API response 原樣當成產品資料。

## WARC、HAR、fixtures 三者如何分工

| 層                      | 用途                                | 保存什麼                                                | 不應做什麼                                                                |
| ----------------------- | ----------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| WARC/pywb archive       | 法證／稽核／離線 replay             | 受控的 HTTP request/response、時間、來源、CDX index     | 不把 WARC 當 Vue 元件或當成正式 API；不公開含敏感內容的 collection        |
| HAR                     | Playwright 測試的可重播網路 fixture | 測試所需的 URL/method/response headers/body（經過清理） | 不提交 Cookie、Authorization、真實 token、個資或未批准的 private endpoint |
| typed JSON fixtures     | 本地 clean-room app 的穩定資料契約  | 經人工設計的狀態、分頁、錯誤、權限、空資料              | 不把私有 API schema 當成已獲授權的產品合約；不要讓 runtime 直接外連原站   |
| screenshot/DOM snapshot | 視覺和互動證據                      | 某一 route/state/viewport 的呈現結果                    | 不等同完整 route coverage；不可從截圖推斷未見的權限或 API 行為            |

Playwright 官方文件說 HAR 可在測試旁保存、用 `routeFromHAR` 回放，且 URL/method、POST payload 和 headers 會影響 match；這就是為什麼 HAR 適合測試 fixture，但必須先 redact 並限制 URL pattern。pywb 官方文件則把 WARC/CDX 定位為 archive replay／recording 層。兩者應保持不同目錄和不同生命週期。

## 請求安全與授權閘門

### 執行前必過

- `target_ownership`: 自有、書面授權，或明確的 staging/測試環境。
- `scope`: exact host、path、帳號、viewport、資料類型和時間窗口。
- `methods`: 預設只允許 GET/HEAD；互動動作是否會觸發寫入要先驗證。
- `rate`: max pages、concurrency、RPM、delay、timeout、max bytes、retry 上限。
- `data`: 是否含個資、付款資料、Cookie、Token、Authorization、內部 URL；保存位置和 retention。
- `egress`: 僅允許目標 host 和必要的本地回放服務；Firecrawl 等雲端 provider 另需資料處理／費用批准。
- `stop`: 看到 CAPTCHA、Unexpected host、登入轉址、429/403、寫入方法、疑似 secrets 或 PII 就停。

### 工具上的安全設定

- Wget：保留 robots、設定 `--wait`／rate/深度/目錄界線；不以 `--load-cookies`、命令列密碼或 debug log 傳遞真實憑證。
- HTTrack：使用 filters、depth、max-rate、max-size、max-time 和同站限制；不使用官方標成 dangerous 的 `--disable-security-limits`。
- Crawlee/Crawl4AI：不把 proxy rotation、session rotation、anti-bot bypass 或 hooks 當預設能力；代理或 hook 會改變風險模型，必須另獲批准。
- Firecrawl：hosted API 需要 key 且會是外部資料處理者；優先 self-host 或 Lockdown（只讀既有 cache）時仍要驗證 cache 來源，不能把 Lockdown 當成新抓取。
- Playwright：用 context-level route deny-by-default；只把已核准 API 路徑 fulfill 成 fixture；auth storage、HAR、trace、screenshots 做 secret scan 和 redaction。

## 建議工作流（先研究，再決定是否取得）

```text
授權／範圍審查
        ↓
公開或 staging URL inventory（Wget/HTTrack，限速、限域、dry-run）
        ↓
Playwright state matrix（route × action × viewport × outcome）
        ├── WebScrapBook/SingleFile：人工視覺快照
        ├── HAR/JSON：清理後的本地測試 fixtures
        └── WARC/pywb：獨立的稽核／回放封存
        ↓
Vue Router + 本地 typed fixtures + deny-by-default mock API
        ↓
Playwright 逐狀態驗證、外連檢查、secret scan、baseline
        ↓
以 manifest/hash/diff 做增量維護
```

### 分階段建議

1. **Phase 0 — Gate**：沒有授權證據就只整理公開資訊和工具方案，不對目標發請求。
2. **Phase 1 — Inventory**：先以 `--spider`／Map／URL list 方式列清 route、資產、redirect、外部 host；先看數量與成本，再決定是否下載。
3. **Phase 2 — Dynamic coverage**：在受控瀏覽器逐個執行 manifest action；每個 modal/drawer/錯誤/權限分支都要有明確 outcome。
4. **Phase 3 — Evidence**：WARC 只存 archive；HAR/DOM/screenshot 只存證據或測試素材；全部做敏感資料清理。
5. **Phase 4 — Clean-room build**：只將已核准的行為契約、視覺觀察和 synthetic fixtures 轉成 Vue 元件與路由；不搬運原始 bundle。
6. **Phase 5 — Verification**：本地網路封鎖；測路由直接進入、Back/Forward、刷新、鍵盤、viewport、loading/error/forbidden；對每個 fixture 檢查來源和 redaction。
7. **Phase 6 — Maintenance**：只在授權仍有效時重跑；以 manifest、capture timestamp、hash、版本和差異報告判斷增量更新，不自動全站重抓。

## 工具選擇建議

- **如果目標只是公開靜態文件鏡像**：HTTrack 或 Wget 擇一即可；HTTrack 的 filter/update/report 較完整，Wget 的 CLI 和 WARC 支援簡單直接。
- **如果目標是單頁已呈現畫面**：SingleFile 或 WebScrapBook；保留它們作證據，不當成產品程式碼。
- **如果目標是 Vue/SPA 的所有互動層級**：Playwright 是主線，先寫 state manifest，再用 network/HAR/fixtures；不要期待純 crawler 覆蓋閉合的 modal/drawer。
- **如果需要可稽核回放**：pywb/WARC 放在獨立 archive pipeline；不要把封存資料直接暴露給本地 app。
- **如果是資料抽取／RAG**：Scrapy、Crawlee、Crawl4AI、Firecrawl、WebClone structured mode 才適合；它們的輸出不能當 UI clone 的完成證據。
- **如果有人只說 `md-crawler`**：先確認 repo/版本；`SolarLiner/md-crawler` 是本地 Markdown frontmatter 工具，不是網站 crawler。

本案在未取得額外授權前的預設選擇：**Playwright（互動盤點與測試）+ 清理後 JSON/HAR fixtures（本地 mock）+ 可選 pywb/WARC（證據）**；Wget/HTTrack 只做有界靜態 inventory，Firecrawl/Crawlee/Crawl4AI/WebClone 不自動啟用雲端、登入、proxy 或反爬功能。

## 推論與未驗證事項

下列不是工具文件直接承諾，而是根據文件能力和本案安全邊界做的推論：

- 純 HTML/遞迴鏡像無法證明 SPA 的 client-side route、點擊後 DOM 或隱藏權限分支已完整取得。
- 即使 headless browser 能看到某個 rendered DOM，仍不能由單次 snapshot 推導所有 modal/drawer/錯誤狀態；需要 state manifest 和逐狀態操作。
- WARC/HAR 是證據／請求回放格式，不是可維護的 Vue 元件設計；本地 clean-room app 仍需自己的 route/state/data contract。
- 將 network log 裡的 endpoint 當成可重播 API、把 query/body 原樣帶入本地，可能擴大授權與個資範圍；必須人工核准並清理。
- WebClone、Firecrawl、Crawl4AI 的 rendered/structured output 是否足以保留特定目標的每個互動細節，官方文件沒有提供通用完整性保證；需用 Playwright coverage 逐案驗證。
- `md-crawler` 若不是 `SolarLiner/md-crawler`，本文件對其分類不適用；使用前需要明確官方 URL 和版本。

## 官方來源（均於 2026-08-15 查閱）

### 靜態鏡像與封存

- [GNU Wget 1.25.0 Manual](https://www.gnu.org/software/wget/manual/wget.html)：遞迴、link conversion、Cookie/WARC、robots 和安全章節。
- [GNU Wget — Recursive Download](https://www.gnu.org/software/wget/manual/html_node/Recursive-Download.html)：深度、robots、等待與過量下載警告。
- [GNU Wget — Download Options](https://www.gnu.org/software/wget/manual/html_node/Download-Options)：`--wait`、`--waitretry` 與速率控制。
- [HTTrack documentation](https://www.httrack.com/html/index)：鏡像、更新、filter、限制和「copying a website requires responsibility」提示。
- [HTTrack command-line manual](https://www.httrack.com/html/httrack.man.html)：depth、rate、robots、WARC/WACZ、Cookie 與 dangerous option。
- [HTTrack — Using HTTrack responsibly](https://www.httrack.com/html/abuse.html)：頻寬、robots 和版權／複製責任。
- [HTTrack FAQ](https://www.httrack.com/html/faq.html)：JavaScript/CGI 不完整、robots、Cookie/auth 和重新散布授權提醒。
- [HTTrack filter syntax](https://www.httrack.com/html/filters.html)：URL/MIME/size filters 與避免產生無效請求。
- [SingleFile CLI repository](https://github.com/gildas-lormeau/single-file-cli)：headless browser/CDP、crawl options、輸出和 AGPL。
- [WebScrapBook repository](https://github.com/danny0838/webscrapbook)：瀏覽器擷取與 archive formats。
- [WebScrapBook Basic usage](https://github.com/danny0838/webscrapbook/wiki/Basic)：等待動態內容、capture formats、linked-page depth、resource map。
- [WebScrapBook Backend](https://github.com/danny0838/webscrapbook/wiki/Backend)：backend、chrooted root 與資料結構安全。
- [WebScrapBook Privacy](https://github.com/danny0838/webscrapbook/wiki/Privacy)：捕獲內容可能含個資、請求邊界和 cookies 權限。
- [pywb repository](https://github.com/webrecorder/pywb)：WARC replay/recording、Warcserver、Recorder、Rewriter。
- [pywb Warcserver manual](https://github.com/webrecorder/pywb/blob/main/docs/manual/warcserver.rst)：CDX index、WARC resource replay。
- [pywb configuring the web archive](https://github.com/webrecorder/pywb/blob/main/docs/manual/configuring.rst)：framed replay、client-side replay、recording、WARC collection 和 access control。

### SPA、瀏覽器、HAR 與測試 fixtures

- [Vue.js Routing](https://vuejs.org/guide/scaling-up/routing)：SPA client-side routing 與 Vue Router 建議。
- [Vue Router — Different History modes](https://router.vuejs.org/guide/essentials/history-mode)：HTML5 history、server fallback、hash/memory mode。
- [Vue Router — Getting Started](https://router.vuejs.org/guide/)：route-to-component mapping 和 URL 不必 full reload。
- [Playwright Test generator](https://playwright.dev/docs/codegen)：locator/action generation、viewport/device、authenticated storage。
- [Playwright Network](https://playwright.dev/docs/network)：request/response events、waitForResponse、route/fulfill。
- [Playwright Mock APIs](https://playwright.dev/docs/mock)：API mock、HAR recording、editing、strict replay 和 WebSocket mock。

### 補充工具

- [WebClone official repository](https://github.com/ruslanmv/webclone)：authorized cloning、rendered capture、RAG outputs、rate/size/scope/security defaults、cookie sessions。
- [Scrapy official overview](https://doc.scrapy.org/en/master/intro/overview.html)：crawling/extraction、feed exports、delay/concurrency/AutoThrottle、robots/cookies。
- [Scrapy settings](https://docs.scrapy.org/en/latest/topics/settings.html)：robots、concurrency、depth 等設定索引。
- [Scrapy AutoThrottle](https://docs.scrapy.org/en/latest/topics/autothrottle.html)：依回應自動調整延遲的官方說明。
- [Crawlee BrowserCrawler API](https://crawlee.dev/js/api/browser-crawler)：HTTP 與 browser crawler、RequestList/RequestQueue、JS execution、concurrency。
- [Crawlee first crawler](https://crawlee.dev/js/docs/introduction/first-crawler)：RequestQueue 和 requestHandler。
- [Crawlee scaling](https://crawlee.dev/js/docs/3.11/guides/scaling-crawlers)：max concurrency、requests per minute。
- [Crawlee session management](https://crawlee.dev/js/docs/guides/session-management)：cookies、session pool 和 proxy session 邊界。
- [Crawlee proxy management](https://crawlee.dev/js/docs/guides/proxy-management)：proxy rotation 和 anti-blocking 能力（本案不預設啟用）。
- [Crawlee RobotsFile API](https://crawlee.dev/js/api/3.13/utils/class/RobotsFile)：robots/sitemap 判斷。
- [SolarLiner/md-crawler](https://github.com/solarliner/md-crawler)：本地 Markdown/frontmatter validator 的官方 README。
- [Crawl4AI Quick Start](https://docs.crawl4ai.com/core/quickstart/)：headless Chromium、Markdown、CSS/LLM extraction、動態內容。
- [Crawl4AI official repository](https://github.com/unclecode/crawl4ai)：sessions/cookies/proxies/hooks、LLM/RAG 定位。
- [Crawl4AI security overview](https://github.com/unclecode/crawl4ai/security)：URL validation、hooks、SSRF/RCE 修復與 rate limit/security controls。
- [Firecrawl API introduction](https://docs.firecrawl.dev/api-reference/v2-introduction)：Map/Crawl/Scrape、API key、response/rate-limit model。
- [Firecrawl Browser](https://docs.firecrawl.dev/features/browser)：browser sessions、Interact、persistent profiles。
- [Firecrawl Lockdown mode](https://docs.firecrawl.dev/features/lockdown)：cache-only、無 outbound traffic 的合規模式。
