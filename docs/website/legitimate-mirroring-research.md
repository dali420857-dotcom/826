# 合法網站鏡像、SPA 觀察與前端復刻研究

> 研究日期：2026-08-15  
> 研究方式：只讀官方／第一方文件；沒有登入目標網站、讀取瀏覽器工作階段、重放 Cookie/token、執行目標站 POST/PUT/DELETE，亦沒有執行下列指令。  
> 適用範圍：只有自有網站或取得明確書面授權、且明確限定為公開 `GET` 的目標。

## 先說結論

沒有一條「一鍵複製」命令可以把 Vue／SPA 變成完整可維護的前端複製品。現成工具各自擅長不同層次：

- `HTTrack`、GNU `Wget`：抓取 HTML、CSS、圖片與可見連結的靜態鏡像；不會把 Vue runtime、後端 API、權限模型或每個互動狀態轉成新的原始碼。
- `SingleFile`、`WebScrapBook`：以瀏覽器當下已渲染的頁面為主，適合保留單頁外觀／快照；不是完整 SPA 專案產生器。
- `pywb`／Webrecorder：以 WARC 記錄並重播瀏覽器網路內容，對 JavaScript-heavy 頁面比靜態 crawler 更接近「可回放的封存」，但仍然是封存回放，不是可替代原後端的 Vue 專案。
- `Playwright`：最適合建立「互動盤點」與測試／mock 契約。它可以記錄點擊、監看或攔截網路、處理原生 dialog，但不會自動生成等價的業務元件與後端。

因此，本專案要達到「每個功能點擊後的彈窗／抽屜／確認／錯誤／權限狀態都能看」的目標，正確路線是：

1. 只在已授權的公開頁面做受控觀察。
2. 用瀏覽器工具建立路由、可見控制項、互動流程與 API 形狀的盤點。
3. 在本專案用自有 typed fixtures、MSW 與 local dry-run 手動重建 UI 狀態。
4. 用 Playwright 在本機逐一驗證每個互動；不把目標站的 token、私有資料或真實 mutating request 帶進來。

目前看到的本地版本與目標截圖差異，並不是「少下載幾個 CSS」而已：本地版是通用淺色 shell，目標畫面包含深色控制台、密集側欄、頂部工具列、狀態分頁、群組樹、表格、搜尋／篩選、批次操作與多種彈窗。因此單純下載靜態檔案不足以解決問題。

## 工具比較

| 工具                                                                                                                            | 官方定位／輸出                                                               | 對 Vue／SPA runtime                                                                         | 彈窗、抽屜、互動                                                                    | API、登入與資料                                                             | 是否等於完整前端複製                        | 適用本專案的用途                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| [HTTrack](https://www.httrack.com/html/httrack.man.html)                                                                        | 站點鏡像到本機目錄；支援 mirror、深度、速率、robots 等選項                   | 會抓到被 HTML/CSS/連結指向的 JS 檔，但不會執行 Vue runtime；這是依其 crawler 工作方式的推論 | 不會自動產生 runtime 後才出現的 DOM 狀態或 app-level modal                          | 不應使用 Cookie 檔；需要 API 或登入資料時會缺內容                           | 否，偏靜態檔案樹                            | 授權網站的公開靜態資產盤點                                    |
| [GNU Wget](https://www.gnu.org/software/wget/manual/wget.html)                                                                  | 遞迴抓取 HTML/CSS、頁面 requisites、轉換本地連結                             | 官方手冊說 HTTP 遞迴會解析 HTML/CSS；因此不會像瀏覽器一樣跑 SPA runtime（推論）             | 不會完整重現 JS 點擊後的 DOM／dialog                                                | 只適合公開、受範圍限制的 GET；遞迴可能造成大量請求                          | 否                                          | 小範圍靜態 mirror、缺檔盤點                                   |
| [SingleFile](https://github.com/gildas-lormeau/SingleFile)／[SingleFile CLI](https://github.com/gildas-lormeau/single-file-cli) | 在 headless Chromium 中保存當下頁面為單一 HTML；CLI 也可選擇爬內部連結       | 會先讓頁面在瀏覽器中渲染，故比 Wget 更可能保留當下 route 的 DOM/CSS；仍只保存觀察時刻的結果 | 可保存目前已開啟的 DOM 狀態；不會把未點擊的 dialog、後續 API 狀態或業務邏輯變成元件 | 不應保存 authenticated storage；動態資料通常只是快照                        | 否，偏單頁快照                              | 對照當前 route 的視覺、建立截圖／DOM 證據                     |
| [WebScrapBook](https://github.com/danny0838/webscrapbook)                                                                       | 瀏覽器 extension，以多種封存格式保存頁面並可註記／整理                       | 官方專案說明以目前頁面 capture 為主；作者也明確指出它不是 headless 全站 spider              | 保存當下頁面與註記，不等於重建所有互動流程                                          | 進階功能可能需要其 backend；不可把原站 session 當作授權                     | 否                                          | 人工保存授權頁面的視覺參考                                    |
| [pywb](https://github.com/webrecorder/pywb)／Webrecorder                                                                        | WARC 錄製與回放；支援 server/client-side rewrite、auto-fetch、access control | 官方文件提供 client-side replay 及 wombat network rewriting，對 JS-heavy 頁面較有機會回放   | 可回放已錄製的網路結果；未錄到的狀態仍不存在，回放也不是新 app                      | recording 會寫本機 WARC，且可記錄 API／其他請求；只能在已授權、隔離環境執行 | 否，是高保真封存／回放                      | 自有 staging 的動態頁面行為證據；不作目前第三方站的直接 clone |
| [Playwright codegen](https://playwright.dev/docs/codegen)／[network mocking](https://playwright.dev/docs/network)               | 產生測試操作、監看／攔截 request、mock API 或 HAR                            | 以真實瀏覽器執行 runtime，最適合觀察 route 與互動                                           | 可測原生 `alert`／`confirm`／`prompt`；Element UI 這類 DOM modal 仍要自行盤點與實作 | 可在本機 mock API，避免打真 API；不要使用 `--save-storage` 保存 session     | 否，但最適合把互動轉成可測的 local contract | 建立互動清單、mock fixture、彈窗／抽屜測試                    |

## 為什麼 Vue／SPA 不能靠一鍵下載完整複製

### 1. 路由可能只存在於瀏覽器狀態

`#/account_tatistics` 這種 hash route 的 HTTP 請求仍然通常只取得同一個入口 HTML；真正的頁面由 JS runtime 依 hash、store 與 API response 生成。靜態 crawler 不會因為使用者在瀏覽器點開了下拉選單，就知道該選單的所有分支。

這也是 Wget／HTTrack 與 SingleFile／Playwright 的差異：前兩者偏文件與資源遞迴，後兩者能執行瀏覽器，但執行瀏覽器也只會得到「已經被打開或錄到的狀態」。

### 2. 彈窗不一定是原生 dialog

Playwright 官方的 dialog API 處理的是 `alert`、`confirm`、`prompt` 和 `beforeunload`。Element UI、Vue 或自訂控制台常見的是頁面中的 `<div>`／component modal、drawer、popover；它們不是瀏覽器 dialog，必須透過 DOM、截圖與互動測試逐一盤點。

### 3. API response 不是前端資產

SPA 可能先下載一個 JS bundle，再由 `fetch`／XHR／WebSocket 取得表格、權限、統計與錯誤狀態。下載 bundle 不會取得後端實作；把真實 API、登入 cookie 或 production data 放進新專案也不是合法或安全的前端復刻。Playwright 的 API mock／HAR 能把已授權、已去識別化的契約轉成測試資料，但本專案應改用自有 fixtures，不提交原站 response。

## 可直接使用的「已授權公開 GET」命令

以下都是**範本，不是本次執行結果**。只把 `$TargetUrl` 換成自有或有明確書面授權的公開 URL；不要填入目前瀏覽器登入頁、Cookie、token、帳號、密碼或 Telegram session。這些命令不應指向未授權的第三方站。

### 共用 PowerShell 變數

```powershell
# 僅限自有／書面授權且限定公開 GET 的來源。
$TargetUrl = "https://authorized.example/"
$TargetUri = [Uri]$TargetUrl
$MirrorRoot = Join-Path (Get-Location) "artifacts\authorized-mirror"
New-Item -ItemType Directory -Force -Path $MirrorRoot | Out-Null

if ($TargetUri.Scheme -notin @("http", "https")) {
  throw "Only HTTP(S) public read-only targets are allowed."
}
if ([string]::IsNullOrWhiteSpace($TargetUri.Host)) {
  throw "Target URL must include a host."
}

Write-Output "Review ownership/permission and robots.txt before choosing one tool."
Write-Output ("Target host: " + $TargetUri.Host)
Write-Output ("Output root: " + $MirrorRoot)
```

### HTTrack：有界、先人工確認的鏡像

官方手冊列出 `-O` 輸出路徑、`-W` 半自動 wizard、`-w` mirror 與深度／速率選項。先用 `-W` 逐項確認 scope，不要直接用無界深度或跨網域設定：

```powershell
$HttrackOut = Join-Path $MirrorRoot "httrack"
New-Item -ItemType Directory -Force -Path $HttrackOut | Out-Null

# -W 會要求確認；這是刻意保留的安全閘門。
httrack.exe $TargetUrl "-O$HttrackOut" -W
```

只在已審核 scope 後才考慮自動化，而且仍須保留 same-domain、深度與速率限制：

```powershell
# 仍然只限已授權來源；-r2 是有界深度，-d 限制同一網域。
httrack.exe $TargetUrl "-O$HttrackOut" -w -r2 -d
```

HTTrack 產物是本機檔案鏡像，不是 Vue 專案；若入口 JS 需要 API 才能繪製表格或 modal，這些功能不會因為檔案已下載而自動存在。

### GNU Wget：有界遞迴、保留 robots 約束

GNU 手冊說 `--recursive` 解析 HTML/CSS、`--page-requisites` 抓顯示頁面所需資源、`--convert-links` 轉換本地連結，且 `--robots=on` 是預設／應保留的行為。PowerShell 請呼叫 `wget.exe`，避免被 `wget` alias 解析成 `Invoke-WebRequest`：

```powershell
$WgetOut = Join-Path $MirrorRoot "wget"
New-Item -ItemType Directory -Force -Path $WgetOut | Out-Null

wget.exe `
  --recursive --level=2 `
  --page-requisites --convert-links --adjust-extension `
  --no-parent --robots=on `
  --domains="$($TargetUri.Host)" `
  --wait=1 --limit-rate=500k --timeout=30 --tries=1 `
  --directory-prefix="$WgetOut" `
  "$TargetUrl"
```

若要做完整 mirror，GNU 手冊的 `--mirror` 會啟用無限遞迴／時間戳等設定；這可能造成大量請求，只有在授權人明確批准範圍與速率後才可使用：

```powershell
# 高風險的完整遞迴範本；先確認授權、robots、上限與磁碟空間。
wget.exe `
  --mirror --page-requisites --convert-links --adjust-extension `
  --no-parent --robots=on `
  --domains="$($TargetUri.Host)" `
  --wait=2 --limit-rate=500k --timeout=30 --tries=1 `
  --directory-prefix="$WgetOut" `
  "$TargetUrl"
```

### SingleFile CLI：保存一個已渲染 route

官方 CLI 語法為 `single-file <url> [output] [options ...]`，在 headless browser 中執行。它適合保存目前 route 的外觀，不是整站功能複製：

```powershell
$SingleFileOut = Join-Path $MirrorRoot "singlefile"
New-Item -ItemType Directory -Force -Path $SingleFileOut | Out-Null

npx.cmd --yes single-file-cli `
  "$TargetUrl" `
  (Join-Path $SingleFileOut "index.html")
```

若已取得授權並要有限度地爬內部連結，官方 README 提供 `--crawl-links`、`--crawl-inner-links-only` 與 `--crawl-max-depth`：

```powershell
npx.cmd --yes single-file-cli `
  "$TargetUrl" `
  (Join-Path $SingleFileOut "index.html") `
  --crawl-links=true `
  --crawl-inner-links-only=true `
  --crawl-max-depth=1
```

不要把 `--save-storage`、Cookie header、token 或目前瀏覽器 profile 傳給 CLI；要保存登入後頁面時，先停止並取得清楚的授權與資料處理範圍。

### WebScrapBook：瀏覽器按鈕保存當前頁面

WebScrapBook 官方專案定位是瀏覽器 extension，可保存當前頁面到本機或 backend，並支援多種 archive format。使用流程是：

1. 只在有授權的瀏覽器 profile 開啟公開頁面。
2. 從官方 [GitHub README](https://github.com/danny0838/webscrapbook) 連到對應 Chrome／Firefox store 安裝。
3. 點 extension toolbar 的 capture current tab，選擇本機 archive format。
4. 逐一保存需要對照的 route；不要把登入工作階段、私有 API response 或帳號資料匯出。

作者的 [project issue #153](https://github.com/danny0838/webscrapbook/issues/153) 明確說明目前頁面 capture 與 headless 全站 spider 是不同用途；所以它不能代替 route／modal／API 互動盤點。

### pywb／Webrecorder：只在自有 staging 做封存回放

官方 README 顯示可用 `pip install pywb` 安裝並以 `wayback` 執行；官方設定文件的 recording mode 會把 live response 寫入 WARC，並可選擇 auto-fetch responsive resources。這是強力的封存工具，不是本專案對第三方站的「一鍵 clone」命令。

```powershell
# Windows 若官方相依性不完整，請改在隔離的 WSL／Docker 環境；不要在本專案環境直接安裝。
$PywbRoot = Join-Path $MirrorRoot "pywb"
python.exe -m venv (Join-Path $PywbRoot ".venv")
$PywbPython = Join-Path $PywbRoot ".venv\Scripts\python.exe"
& $PywbPython -m pip install pywb

# 只對自有／書面授權 staging 使用；會寫本機 WARC 並向來源發出讀取請求。
& (Join-Path $PywbRoot ".venv\Scripts\wayback.exe") --record
```

`pywb` 的 client-side replay、WARC 與 rewrite 可以協助重播已捕獲的網路內容，但未捕獲的 API／WebSocket／權限分支仍不存在；回放結果也不可當成原始碼或 production backend。不要啟用會把本機 archive 暴露到外網的 proxy，也不要使用任何登入 cookie。

### Playwright：把點擊流程記成測試，不是複製程式

官方 codegen 支援 viewport、device、color scheme 等條件；官方 network／mock 文件支援攔截 API、HAR replay，官方 dialogs 文件支援原生 dialog。只在授權公開頁面做人工只讀操作：

```powershell
# 不使用 --save-storage；不要登入、不要點擊新增／刪除／發送／付款／Telegram 操作。
npx.cmd playwright codegen `
  --target=typescript `
  --viewport-size="1440,900" `
  "$TargetUrl"
```

對本專案，後續應把觀察結果轉成 local fixture，而不是把真 API 帶入測試：

```powershell
# 僅對本機 app 執行，不會向目標網站發請求。
npx.cmd playwright test --project=chromium --grep="local|dialog|dry-run"
```

如果在自有 staging 需要產生 HAR，必須先檢查它是否含 Cookie、Authorization、PII、真實資料或 POST body；官方文件也說 HAR 會包含 request/response headers、cookies、timing 等資訊。未完成去識別化前不得提交或分享：

```powershell
# 只限 synthetic／自有 staging，且輸出必須經過秘密與 PII 清理；不要對目前第三方目標執行。
npx.cmd playwright open `
  --save-har=(Join-Path $MirrorRoot "staging-public.har") `
  --save-har-glob="**/public/**" `
  "$TargetUrl"
```

## 授權、robots 與請求邊界

- [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) 說明 robots exclusion protocol 是讓服務擁有者控制 crawler 存取的規則；同一文件也明確指出 robots 規則**不是 access authorization**。所以 `robots.txt` 沒有禁止，不代表取得了複製、重製、商標、API 或資料的授權。
- 遞迴 mirror 可能造成大量請求。GNU Wget 官方手冊特別提醒這可能壓垮遠端伺服器；應使用有限深度、延遲、速率與同網域限制，並尊重服務條款、robots 與對方書面 scope。
- 不要用 `--robots=off`、跨網域無界爬取、代理匿名化、Cookie 檔、`Authorization` header、`--save-storage`、瀏覽器現有 profile 或任何 session replay 來繞過限制。
- 不要以 GET 命令測試看似安全但會產生外部副作用的 endpoint；本專案禁止對目標站 POST／PUT／DELETE、付款、Telegram 操作、fuzzing、滲透測試或憑證嘗試。
- 工具本身的授權與抓下來的網站資產授權是兩件事；即使工具是開源，目標站的 CSS、圖片、logo、商標、文字與資料仍須另外確認可重製範圍。

## 對目前專案的決策

1. 不對 `http://konk.cc/tgcloud_pc/` 執行上述 mirror／record／codegen 命令：目前沒有原始碼、私有 API、資產與資料的所有權或書面授權證據；瀏覽器已登入狀態也不是授權。
2. 既有公開 inventory 只作資訊架構參考；不要把 network response、token、Cookie、私有圖片或原站 bundle 複製到 repository。
3. 若要達到截圖中的深色控制台與每個功能點的彈窗行為，先建立 neutral clean-room visual system，再以本機 typed fixtures／MSW 建立每個 route 的 loading、empty、error、permission-denied、timeout、fallback、dialog、drawer、confirm、cancel、safe-stop 與 audit 狀態。
4. 以 Playwright 只測 `127.0.0.1` 的新 app；對每一個可見按鈕建立 local interaction test，mutating-looking action 固定顯示 `mutation_applied: false`。
5. 只有在取得明確授權、範圍限定、測試資料隔離、停止條件與讀回證據後，才重新評估是否對自有 staging 做 SingleFile／pywb／Playwright 觀察；那仍然不能取代手動重建前端。

## 來源清單（官方／第一方）

- [HTTrack manual](https://www.httrack.com/html/httrack.man.html)；[HTTrack user guide](https://www.httrack.com/HelpHtml/fcguide.html)
- [GNU Wget manual](https://www.gnu.org/software/wget/manual/wget.html)
- [SingleFile repository](https://github.com/gildas-lormeau/SingleFile)；[SingleFile CLI](https://github.com/gildas-lormeau/single-file-cli)
- [WebScrapBook repository](https://github.com/danny0838/webscrapbook)；[WebScrapBook capture limitations](https://github.com/danny0838/webscrapbook/issues/153)
- [webrecorder/pywb](https://github.com/webrecorder/pywb)；[pywb configuring and recording](https://github.com/webrecorder/pywb/blob/main/docs/manual/configuring.rst)
- [Playwright codegen](https://playwright.dev/docs/codegen)；[network](https://playwright.dev/docs/network)；[mock APIs/HAR](https://playwright.dev/docs/mock)；[dialogs](https://playwright.dev/docs/dialogs)
- [IETF RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
