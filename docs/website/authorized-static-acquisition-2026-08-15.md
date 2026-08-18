# konk.cc 公開靜態取得紀錄

## 授權與範圍

- 授權證據：使用者在本工作階段明確指示「我讓你做的時候就是已經授權了」，並要求先執行公開靜態取得。
- 目標：`http://konk.cc/`、`http://konk.cc/tgcloud_pc/`；同源公開連結可發現 `/customer/`。
- 方法：匿名 `GET`；只允許 `konk.cc` 的 HTTP/HTTPS；不帶 Cookie、Session、Token、Authorization header，不提交表單，不送出 POST/PUT/PATCH/DELETE。
- 邊界：讀取 `robots.txt` 並遵守；每請求至少 250ms；最多 120 個請求、4 層、每資源 12MB、總量 120MB；外部跳轉拒絕。

## 實際結果

執行命令：

```powershell
npm.cmd run acquire:public-static -- --delay-ms 250 --max-requests 120 --max-depth 4
```

這是加入 JavaScript 靜態資產字串解析後的最後一次主抓取結果。

結果：

- `status`: `success`
- 34 次 HTTP GET（含 `robots.txt`）
- 29 份去重後靜態檔案
- 7,581,909 bytes
- `robots.txt`: `Disallow:` 空白，沒有阻擋本次公開範圍
- 0 個抓取錯誤；`/tgcloud_pc/config.js` 與 `/customer/config.js` 回應 404，未當成資產保存

已取得的類型包括：

- 根目錄系統選擇 HTML
- `/tgcloud_pc/` 與 `/customer/` 的 Vue SPA HTML 殼
- `index.css`、Element UI CSS、雜湊命名的應用／vendor CSS
- Vue、Element UI、應用／vendor JavaScript bundle
- Element UI 與應用字型（WOFF/TTF）
- 公開 PNG 圖片

Runtime 觀察另外指出了由 JavaScript 動態建立的公開靜態資產。已在同一個 GET-only 邊界補抓 8 份 CSS、JS、圖片與 MP3：`artifacts/authorized-mirror/runtime-static-20260815/manifest.json`，共 644,137 bytes、0 warnings。這個補抓不包含 `/api/*` 或任何登入後請求。

## 從已取得 bundle 讀出的候選路由

這只是對本機 JavaScript bundle 的字串盤點，不是對後端的請求，也不代表每個路由目前都可匿名使用：

`/account_tatistics`、`/build_group`、`/collect`、`/device_manager`、`/group_adv`、`/group_send_msg`、`/home`、`/index`、`/intelligence`、`/ip_manager`、`/login`、`/position`、`/position_collect`、`/preventing_fraud`、`/proxy_manager`、`/pull_group`、`/reset_password`、`/screen_data`、`/service_manager`、`/source_manager`、`/task_manager`、`/user_info`、`/work_order`。

Bundle 也包含 `/api/*`、`/tgcloud/*`、`/customer/*`、`/ws_cloud/*` 與 `/chatroom/*` API 字串，其中多數帶有 `token` 參數佔位符。這些字串只作為後續本地 mock／互動盤點輸入；本次沒有呼叫、重放或保存任何 token。

完整 URL、狀態碼、Content-Type、深度、大小、SHA-256、重導向與重複項目，都在本機忽略的 [manifest.json](../../artifacts/authorized-mirror/manifest.json)。授權與限制紀錄在 [authorization.json](../../artifacts/authorized-mirror/authorization.json)。

## 靜態階段的已知缺口

這次只解析 HTML/CSS 的引用，不執行 JavaScript，也不進入登入或已登入工作階段。因此下列內容尚未被此階段證明或取得：

- JavaScript 執行後才出現的路由、彈窗、抽屜、分頁與 API 資料
- 需要登入、Cookie、Session 或權限的資料
- 後端 API 回應與任何寫入操作
- 主抓取階段由 JavaScript 動態建立、但不在 HTML/CSS 引用中的 chunk 或圖片（已由 runtime request index 指出的公開靜態 URL 另行補抓，仍不執行登入後路由）

下一階段應使用已授權的 Playwright runtime capture，在本機保存去識別化的 DOM／網路 fixture 與互動狀態；不要把本次原始 bundle 直接併入產品程式碼。
