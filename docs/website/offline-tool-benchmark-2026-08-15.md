# konk.cc 整站離線工具實測

## 直接結論

在同一個匿名、同 host、GET-only 範圍下，WebCopy 是本輪最快的第一階段工具；HTTrack 保留作為完整鏡像的備援，Wget2 作為 CLI 基準。最終本地預覽不是把未驗證的 API 或登入狀態塞進去，而是用 WebCopy 的 HTML/CSS/JS 基底，再把 runtime request index 已明確觀察到的 8 個公開靜態資源補入。

官方能力說明：

- [HTTrack 官方首頁](https://www.httrack.com/)：遞迴下載網站並供離線瀏覽，GPL 授權。
- [HTTrack 官方手冊](https://www.httrack.com/html/index.html)：說明 mirror、連結改寫、續抓與 CLI 參數。
- [Cyotek WebCopy 官方頁](https://www.cyotek.com/cyotek-webcopy)：支援遞迴／同網域複製與連結改寫，但明確說不包含 virtual DOM 或 JavaScript parsing。

## 實測環境與限制

- 目標：`http://konk.cc/`；同 host 內公開的 `/tgcloud_pc/`、`/customer/`。
- 全部工具都未帶 Cookie、Session、Token 或 Authorization header；沒有表單提交與 POST/PUT/DELETE。
- `robots.txt` 已讀取，`Disallow:` 為空。
- 每個結果都只存到 `artifacts/authorized-mirror/`，不併入 `src/` 產品程式碼。
- 單次測量會受當下網路與伺服器負載影響；檔案數和 404 以本機 log、manifest 與實際檔案讀回為準。

## 結果

| 工具           | 版本／本機執行檔                                                              |      實測耗時 |                                                                                     工具回報／實際落盤 | 主要結果                                                                                                   |
| -------------- | ----------------------------------------------------------------------------- | ------------: | -----------------------------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------- |
| Cyotek WebCopy | 1.9.0.822；`C:\\Program Files\\Cyotek\\WebCopy\\wcopy.exe`                    |     約 4.6 秒 | 28 個輸出檔（其中 `webcopy-origin.txt` 是 provenance；內容檔 27 個），7,558,500 bytes（含 provenance） | 最快；根頁、兩個 SPA 殼與靜態 CSS/JS/圖片/字型可取得                                                       |
| Wget2          | 2.2.1；`C:\\Users\\Dali\\AppData\\Local\\Microsoft\\WinGet\\Links\\wget2.exe` |      約 37 秒 |                                28 個網站檔，約 7,552,191 bytes；log 回報 2.17 MiB 傳輸、2 個 HTTP 錯誤 | CLI 可用；第一次使用絕對 Windows prefix 會把路徑 URI-encode，改用相對 prefix 後正常落盤                    |
| HTTrack        | 3.49-2；`C:\\Program Files\\WinHTTrack\\httrack.exe`                          | 約 1 分 32 秒 |                                        log 回報 23 個檔案、7,413,582 bytes；28 links scanned、4 errors | 官方 mirror 能力完整，但本輪安全限流下較慢，並把 `config.js`／`window.location.href` 的公開 404 記入錯誤頁 |

HTTrack 的 4 個錯誤都是公開入口程式引用的 404，不是登入或權限繞過；它們已保留在工具 log，沒有被當成有效業務頁面。

## 為什麼還要補 runtime 靜態資源

WebCopy 官方明確不執行 JavaScript parsing。實際在本機預覽時，TG 雲控頁會動態請求 `9022.4ad8bedd.css`、`9022.eaa6e706.js` 與兩張圖片；客服頁會請求 PNG、背景圖與提示音。這些 URL 已在匿名 runtime request index 中以 GET、200/206 觀察到，所以另外用既有的 bounded static fetch 補抓 8 個資源：

- 來源 manifest：`artifacts/authorized-mirror/runtime-static-20260815/manifest.json`
- 補抓結果：8 artifacts、644,137 bytes、0 warnings
- 沒有補抓 XHR/API；`/api/common/config_init` 仍只作為請求索引，不保存 response body

## 最終本地預覽驗證

組裝命令（也已暴露為 `npm.cmd run build:offline`）：

```powershell
node scripts/Build-OfflinePublicSnapshot.mjs `
  --webcopy artifacts/authorized-mirror/tool-runs/webcopy-20260815-195440 `
  --runtime-static artifacts/authorized-mirror/runtime-static-20260815 `
  --output artifacts/authorized-mirror/offline-preview
```

結果：

- `network_requests=0`；組裝器只讀本地檔案。
- 36 個內容檔案記錄、8,197,277 bytes（另有 `snapshot-manifest.json` 與 `runtime-gaps.json` 等 metadata）。
- 本機 HTTP server + Playwright 驗證 `/`、`/tgcloud_pc/index.html`、`/customer/index.html` 都回 200，沒有跨網域請求。
- TG 雲控的 9022 lazy chunk 已可由本機載入；兩個入口仍各有一個原站就回 404 的 `config.js`，沒有自行捏造內容。
- 客服入口可離線顯示免責聲明初始層；原站本身的 config API 404 行為仍被記錄為缺口。
- 組裝結果與 5 個明確未覆蓋項目見 `artifacts/authorized-mirror/offline-preview/snapshot-manifest.json`、`runtime-gaps.json`。

因此目前採用的流程是：**WebCopy 快速取得整站檔案 → runtime 只讀觀察補動態公開靜態資源 → 本地離線組裝與瀏覽驗證 → 才進入交互重建**。登入後路由、抽屜、私有 API、WebSocket 與任何寫入仍未被宣稱已抓到。
