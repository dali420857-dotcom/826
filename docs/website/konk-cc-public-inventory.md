# konk.cc 公開面盤點與複製前置條件

> 盤點日期：2026-08-15  
> 盤點方式：只讀公開 `GET`；未登入、未送出表單、未呼叫付款、未使用 Telegram 帳號或工作階段資料。

## 目前結論

`http://konk.cc/tgcloud_pc/` 是 Vue + Element UI 的單頁應用程式，首頁透過同源 Axios API 與後端交互，並使用雜湊命名的 JS/CSS chunk。公開前端表面已足夠建立「路由、資料模型、操作狀態」的 clean-room 重製；尚不能把它宣稱為完整功能複製，因為後端 API、登入狀態與受權限保護的資料尚未取得，也沒有取得原始碼或資產授權。

## 已觀察的公開表面

| 面向     | 觀察結果                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------ |
| 根頁     | `/` 回應 200，顯示系統選擇，連到 `/tgcloud_pc` 與 `/customer`                                    |
| 應用入口 | `/tgcloud_pc/` 回應 200，Vue SPA，載入 Element UI 與雜湊 chunk                                   |
| 設定     | `/tgcloud_pc/config.js` 目前回應 404；不可假設正式設定已可用                                     |
| HTTP     | Axios 使用同源 base URL、`withCredentials`，可附加 `state.port` 與 localStorage token            |
| 網路範圍 | 本專案重製預設只綁 `127.0.0.1`，不向原站發送寫入請求                                             |
| 風險面   | 登入、帳號/設備/IP 管理、群發/拉群/採集、付款錢包、Telegram 工作階段等功能需要明確授權與測試資料 |

## 路由能力地圖（僅公開前端標籤）

`/login`、`/index`、`/preventing_fraud`、`/proxy_manager`、`/user_info`、`/reset_password`、`/source_manager`、`/device_manager`、`/ip_manager`、`/task_manager`、`/group_send_msg`、`/pull_group`、`/screen_data`、`/service_manager`、`/position`、`/account_tatistics`、`/intelligence`、`/group_adv`、`/build_group`、`/collect`、`/position_collect`、`/work_order`。

## API 家族（只作本地 mock 契約，不代表已獲後端授權）

- 系統/設定：`/api/common/*`、`/api/sys/*`
- 使用者：`/api/user/*`、`/api/token/check`
- 客戶與客服：`/api/customer/*`
- IP/代理：`/api/ip/*`
- 任務/匯出：`/api/sys/export_list*`
- 付款/錢包/翻譯充值：`/api/sys/pay`、`/api/sys/account_wallet`、`/api/sys/translate_recharge`

本階段只在 MSW 使用本地 fixture 重現成功、空資料、權限不足、逾時與回退狀態；不重放真 token、cookie、Telegram session、代理憑證或付款資料。

## 複製方式與授權閘門

1. 預設採 clean-room：依公開行為與自有 mock 資料重建，不複製原始碼、商標、受版權保護的圖片或私有 API。
2. 若要使用原站原始碼、圖片、CSS、私有 API 或完整資產，必須先提供所有權/書面授權與授權範圍。
3. 在授權未確認前，禁止登入原站、提交 POST/PUT/DELETE、測試付款、操作 Telegram 帳號、批量發訊息或執行滲透測試。
4. 所有本地寫入先走 dry-run、驗證、審計與可回退流程；外部寫入需要額外明確批准。

## 已配置的網站重製工具鏈

完整清單在 [`config/web-clone-toolchain.yaml`](../../config/web-clone-toolchain.yaml)，目前已安裝並鎖定：

- Vue、Vue Router、Pinia、Element Plus、Axios、Zod、Vite
- MSW 本地同源 API 夾具
- Vitest、Testing Library、Playwright（含 Chromium）
- TypeScript、vue-tsc、ESLint、Prettier
- Firecrawl Node SDK 與官方 Firecrawl MCP（無金鑰限流模式；完整功能只讀取環境變數金鑰）
- Git、Graphify，以及專案既有的 GitHub/Context7/Exa/Memory/Playwright/Sequential Thinking MCP

驗證命令：

```powershell
npm.cmd run toolchain:check
npm.cmd run lint
npm.cmd run format:check
npm.cmd audit --omit=dev --audit-level=high
npx.cmd playwright install --list
```

Firecrawl 的官方 MCP 已登記為全域與本專案 MCP：
`https://mcp.firecrawl.dev/v2/mcp`。本階段只使用公開頁面的 Search/Scrape/Parse；不要把 API key 放進 TOML、`.env` 實值、日誌或快取。

## 代理分工

- `explorer`：公開路由、chunk、UI 狀態盤點；只讀。
- `docs-researcher`：來源、授權、官方文件與依賴版本核查。
- `worker`：在授權/clean-room 範圍內實作 Vue、mock API、回退狀態。
- `reviewer`：依賴、權限、秘密、外部請求與回退機制審查。
- `browser-qa`：本地 Playwright 互動與視覺回歸；只測本地或明確授權的 staging。
- 主代理：整合、驗證、決定是否進入下一階段。

## 下一個可執行階段

工具鏈已就緒後，下一步是建立本地 Vue 路由殼、MSW mock 契約與 `preventing_fraud` 首頁的 clean-room 版本，再逐頁補上空狀態、錯誤回退、權限拒絕與操作審計。這一步不需要接觸原站登入或真實 Telegram/付款資料。
