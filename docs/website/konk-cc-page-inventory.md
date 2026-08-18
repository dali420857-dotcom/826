# konk.cc 頁面、入口與請求族群盤點

## 結論

目前已取得三個匿名公開入口的可驗證證據：根頁面 `/`、TG 雲控入口 `/tgcloud_pc/`、客服入口 `/customer/`。根頁面只有兩個同網域入口按鈕；兩個子系統在匿名狀態都先顯示「免責聲明」彈窗，背後是登入頁。

這份盤點只描述已落盤或已觀察的結果。登入後頁面、抽屜、業務彈窗、登入提交、私有 API 回應與需要動作的路由仍是未驗證，不能把 bundle 裡的字串當成已抓到的頁面。

## 證據與邊界

- 靜態取得：`2026-08-16T02:48:09.652Z` 至 `2026-08-16T02:48:18Z`（UTC）。證據：`artifacts/authorized-mirror/manifest.json`、`artifacts/authorized-mirror/authorization.json`。
- 匿名 runtime 觀察：`2026-08-16T02:45:46.840Z` 至 `2026-08-16T02:45:53.605Z`（UTC）。證據：`artifacts/authorized-mirror/runtime/runtime-manifest.json`、`runtime/pages/*.html`、`runtime/screenshots/*.png`、`runtime/requests/*.json`。
- 目標範圍：`http://konk.cc`，同 host；靜態種子為 `/`、`/tgcloud_pc/`，runtime 另觀察 `/customer/`。
- 只允許 GET；沒有提交表單、沒有 POST/PUT/DELETE、沒有外部變更。
- 使用全新匿名瀏覽器上下文；沒有匯入 cookie、session、token 或 Authorization header。runtime policy 表示 cookie 不落盤；客服頁只記錄到有 1 個瀏覽器 cookie，但沒有保存名稱或值。
- robots.txt 已讀取並遵守；`disallow` 為空。靜態抓取結果為 `status=success`、`requests=34`、`records=32`、`artifacts=29`、`warnings=0`、總落盤位元組 `7,581,909`。
- 以下「已觀察」只引用上述本機證據；「bundle 線索」只代表下載的 JavaScript 內有路由或 API 字串，尚未對該路徑發請求。

## 頁面與入口矩陣

| 入口           | 已觀察內容                                                                                                                                                                                                     | 證據與請求                                                                                                                                                                                                | 狀態                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `/`            | 頁面標題「系统选择」；中央顯示「请选择系统 / Please select a system」；兩個按鈕「进入TG云控系统 / Enter TG Cloud Control」與「进入客服系统 / Enter Customer Service」。連結分別為 `/tgcloud_pc`、`/customer`。 | 靜態 `index.html` 77,048 bytes；runtime `pages/root.html` 77,036 bytes；runtime 只有 1 個 document GET；[root screenshot](../../artifacts/authorized-mirror/runtime/screenshots/root.png)。               | 已觀察、匿名公開入口                     |
| `/tgcloud_pc/` | 匿名頁面先顯示「免责声明」彈窗；內含 1–19 條免責/使用限制文字與「同意」按鈕。彈窗後方可見 Telegram 雲控登入卡，含帳號、密碼、Google 驗證碼（未設定可不填）、記住用戶名、去注册、登入。                         | 靜態 `tgcloud_pc/index.html` 4,905 bytes；runtime HTML 16,812 bytes、body text length 1,310、14 個 requests；[tgcloud screenshot](../../artifacts/authorized-mirror/runtime/screenshots/tgcloud_pc.png)。 | 已觀察初始狀態；未進入登入後頁面         |
| `/customer/`   | 匿名頁面先顯示「免责声明」彈窗；彈窗後方是「客服系统／欢迎登录」登入卡，含帳號、密碼、忘记密码？與「登 录」。runtime 畫面另出現「请先登录」提示。根頁面可直接進入此入口。                                      | 靜態 `customer/index.html` 5,360 bytes；runtime HTML 117,132 bytes、body text length 1,249、13 個 requests；[customer screenshot](../../artifacts/authorized-mirror/runtime/screenshots/customer.png)。   | 已觀察初始狀態；未登入、未進入客服工作區 |

### `/tgcloud_pc/` 的登入與彈窗細節（已觀察）

- 免責聲明是初始阻塞層；截圖顯示中央白色對話框、標題「免责声明」、可滾動文字區與底部「同意」按鈕。
- 登入欄位可由 runtime HTML 的 placeholder 驗證：`请输入登录账号`、`请输入登录密码`、`请输入谷歌验证码,未设置可不填`。
- 有一個「記住用户名」checkbox，以及「去注册？」文字入口；這些只代表 DOM/畫面存在，沒有點擊或提交。
- runtime 載入到一個 hashed CSS/JS chunk（`9022.4ad8bedd.css`、`9022.eaa6e706.js`）與兩張背景/插圖；原始 runtime capture 不保存 response body，但後續已依 request index 的公開 GET URL 做 bounded static supplement，落在 `artifacts/authorized-mirror/runtime-static-20260815/`。

### `/customer/` 的公開入口細節（已觀察）

- 根頁面的 `/customer` 連結可匿名到達客服入口；頁面標題為「客服系统」。
- runtime 載入到同網域的 `GET /api/common/config_init?system=<redacted>`，HTTP 200；請求索引沒有保存 response body，所以只確認請求與狀態，不推斷回應 schema 或登入狀態。
- 登入 DOM 可由 placeholder 驗證：`请输入登录账号`、`请输入登录密码`；另有「忘记密码？」與登入按鈕。
- runtime 初始畫面可見「请先登录」告警；沒有送出帳密，也沒有驗證忘記密碼流程。

## 靜態落盤內容

靜態 manifest 的 32 筆 records 中，29 筆成功資源實際落盤；其中 2 個同內容的無尾斜線/有尾斜線入口共用同一個本地 HTML，另有兩個 `config.js` 以 404 結束而未落盤。

| 類型       |                                                                                                 已落盤/觀察 | 代表檔案                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------- |
| HTML       |                                                                      3 個公開入口（另含 runtime page 三份） | `index.html`、`tgcloud_pc/index.html`、`customer/index.html`                                             |
| CSS        |                                                       根入口引用的 index、Element UI、vendor/app hashed CSS | `tgcloud_pc/assets/css/*`、`customer/assets/css/*`                                                       |
| JavaScript |                                                              Vue、Element UI、兩個子系統 vendor/app bundles | `tgcloud_pc/assets/js/*`、`customer/assets/js/*`                                                         |
| 字型       |                                                                              Element UI 與子系統 icon fonts | `*/element-ui/.../fonts/*`、`tgcloud_pc/assets/fonts/*`、`customer/assets/fonts/*`                       |
| 圖片/音訊  |             客服 bundle 引用的 PNG 與提示音；runtime supplement 另補 TG 雲控背景圖、lazy chunk 與客服背景圖 | `customer/assets/img/*`、`customer/assets/media/notice.a1907b77.mp3`、`tgcloud_pc/assets/{css,js,img}/*` |
| 失敗或缺口 | `/tgcloud_pc/config.js`、`/customer/config.js` 回 404；客服 HTML 參考的 `logo.ico` 沒有出現在 request index | 只記錄失敗，不補猜測檔案                                                                                 |

根頁面的 Telegram 與客服圖示是 inline data URI，不是獨立 URL 資源；這解釋了為何根頁面只有 document GET。

## Runtime 請求族群

以下是 `runtime/requests/*.json` 的匿名、只讀觀察；request body 與 response body 都沒有保存。

| 入口           | 請求族群                                              | 已觀察內容                                                                                                     | 數量/結果                                       |
| -------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `/`            | document                                              | 根 HTML                                                                                                        | 1，200                                          |
| `/tgcloud_pc/` | document、stylesheet、script、image                   | index/Element UI/hashed CSS；Vue、Element UI、vendor/app；`config.js` 404；runtime 另見 9022 chunk 與兩張圖片  | 14；其中 1 個 404                               |
| `/customer/`   | document、stylesheet、script、font、image、media、XHR | hashed CSS/JS、Element UI font、PNG、MP3；`config.js` 404；`GET /api/common/config_init?system=<redacted>` 200 | 13；其中 1 個 404、1 個 XHR 200、1 個 media 206 |

沒有觀察到表單提交、登入 POST、WebSocket 建立、跨 host 資源請求或任何外部變更。JavaScript 裡出現的 endpoint 字串不等於已發生請求，見下一節。

## Bundle 內的路由線索（未驗證，不是已抓頁面）

### TG 雲控 bundle

下載的 `tgcloud_pc/assets/js/app.9bb32e81.js` 宣告了下列 Vue Router path。除 `/login` 與初始入口的登入畫面外，這些路徑沒有在本輪 runtime 導航或抓取，因此都標為「未驗證」：

| path                 | bundle 中的名稱/標題                |
| -------------------- | ----------------------------------- |
| `/login`             | login                               |
| `/`                  | home，redirect 到防騙查詢           |
| `/index`             | 系統公告                            |
| `/preventing_fraud`  | 防骗查询                            |
| `/proxy_manager`     | 账号管理                            |
| `/user_info`         | 用户信息                            |
| `/reset_password`    | 修改密码                            |
| `/source_manager`    | 资源管理                            |
| `/device_manager`    | 设备管理                            |
| `/ip_manager`        | IP管理                              |
| `/task_manager`      | 群发私信                            |
| `/group_send_msg`    | 群成员私信                          |
| `/pull_group`        | 智能拉群                            |
| `/screen_data`       | 筛选数据                            |
| `/service_manager`   | 客服管理                            |
| `/position`          | 定位营销                            |
| `/account_tatistics` | 账号统计（path 拼字依 bundle 原文） |
| `/intelligence`      | 智能群聊                            |
| `/group_adv`         | 群聊广告                            |
| `/build_group`       | 建群 / 养群                         |
| `/collect`           | 群成员采集                          |
| `/position_collect`  | 定位采集                            |
| `/work_order`        | 接粉工单                            |
| `/test`              | test                                |

這些路由大多指向按需載入的 chunk；本輪只取得入口 bundle 和 runtime 初始請求，沒有以路由枚舉方式下載 chunk，也沒有繞過登入或權限。

### 客服 bundle

`customer/assets/js/app.ca9f74c3.js` 的 router 宣告包含 `/login`、`/` layout、`/test` 與 `/:id`；同一 bundle 的選單字串出現 `/home`。目前只能確認這些字串/宣告存在，不能據此宣稱 `/home` 或任意 `/:id` 已可匿名使用。

## Bundle 內的 API/請求線索（未呼叫）

這些是本地下載 JavaScript 的靜態字串掃描結果，不是 runtime request evidence；沒有對它們發新請求，也沒有推斷 HTTP method、body、權限或回應內容。

- TG 雲控 bundle：`/api/common/config_init`、`/api/common/download`、`/api/common/expiring_soon_device`、`/api/common/system_config`、`/api/sys/sys_notice`、`/api/user/extra_config`、`/api/user/extra_menu`、`/api/user/index`、`/api/user/twostep_set_info`、`/api/user/userinfo`。
- 客服 bundle：`/api/common/config_init`、`/api/common/language_list`、`/api/common/upload_oss`、`/api/user/resetpwd`，以及帳號/客服訊息相關的 path 字串。含 token 依賴的字串只作為缺口記錄，未讀取、未生成、未使用任何 token。
- 已實際觀察的唯一 API request 是客服入口的 `GET /api/common/config_init?system=<redacted>`，200；body 未保存。

## 未覆蓋缺口與下一個安全分工

### 明確未驗證

1. 點擊「同意」後的畫面差異與所有免責聲明彈窗行為。
2. 登入成功後的 dashboard、側邊欄、抽屜、二級彈窗與按需 chunk。
3. `/tgcloud_pc/` 的所有 bundle 依賴、`/customer/` 的 `logo.ico` 與所有 lazy-loaded 資源是否可離線重放。
4. 登入、註冊、忘記密碼、上傳、訊息、設備、群發、定位等任何會改變狀態的請求。
5. API response body、WebSocket 訊息、localStorage/sessionStorage、cookie 值與任何帳號資料。

### 建議分工（以證據為先）

- **頁面資訊線**：只讀本地 manifest、runtime HTML、截圖、request index、bundle 靜態字串；維護本文件，持續標示「已觀察/未驗證」。
- **離線組裝線**：只使用已落盤的 HTML/CSS/JS/圖片/字型/音訊，建立本地資源映射與重放清單；不把未驗證 route 或 API 當成已完成。
- **交互整合線**：以匿名、同網域、GET-only 的 route matrix 驗證初始彈窗/登入頁的可見狀態；任何登入、提交、寫入、私有路由都停在明確批准與讀回證據閘門。

目前最有效率的組合是「先用已落盤的網頁檔做靜態骨架，再用 runtime request index 補 lazy chunk 與初始狀態差異」。單靠離線 HTML 不能推導登入後所有交互；單靠 runtime 截圖也不能證明所有資源已可離線重放。
