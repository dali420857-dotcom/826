# Local web surface acceptance

這份驗證案例涵蓋公開路由清單的全量 clean-room 本地 Vue surface，不代表原站登入、後端 API、裝置、Telegram、付款或任何外部寫入已可用。

## 先決條件

- dev server 只綁 `127.0.0.1`。
- `mockServiceWorker.js` 由 MSW 產生並放在 `public/`。
- `/api/preventing-fraud/overview` 的所有回應來自本地 fixture；不使用真 token、cookie、session 或原站 API。
- 其餘頁面使用 `/api/mock/pages/:pageId?scenario=:scenario` 的本地 fixture；路由資料與 demo session 都不出 workspace。
- UI 文字使用簡體中文；技術識別字、能力 id 與 audit 欄位維持英文。

## 驗證矩陣

| scenario            | 預期狀態        | 必須可見的證據                                      | 變更權限 |
| ------------------- | --------------- | --------------------------------------------------- | -------- |
| `success`           | fresh readback  | 本地样本、audit event、`新鲜读回`                   | none     |
| `empty`             | valid empty     | `没有符合条件的本地样本`、`无资料`                  | none     |
| `error`             | provider error  | safe error panel、audit decision `error`            | none     |
| `permission-denied` | denied          | `当前范围被拒绝`、audit decision `denied`、无 retry | none     |
| `timeout`           | bounded timeout | `新鲜读回超时`、audit decision `timeout`            | none     |
| `fallback`          | stale warning   | `回退启用`、`缓存读回`、`mutations_allowed: false`  | disabled |

## 全量路由清單

以下公開 route 必須可直接開啟且不出現空白頁；尚未連接後端的頁面可呈現本地 fixture 或明確的功能未連接狀態：

`/login`、`/index`、`/preventing_fraud`、`/proxy_manager`、`/user_info`、`/reset_password`、`/source_manager`、`/device_manager`、`/ip_manager`、`/task_manager`、`/group_send_msg`、`/pull_group`、`/screen_data`、`/service_manager`、`/position`、`/account_tatistics`、`/intelligence`、`/group_adv`、`/build_group`、`/collect`、`/position_collect`、`/work_order`。

## Demo session 與 dry-run

- demo roles：`operator`、`viewer`、`reviewer`；不接受真實帳密，不保存 token。
- 需要變更的 UI 保留按鈕與確認流程，但只能產生本地 audit receipt。
- receipt 必須標記 `dry_run: true`、`mutation_applied: false`、`readback: local-simulation`。
- 不得對 `konk.cc` 發送 POST/PUT/DELETE，也不得重放登入 session。

## 執行命令

```powershell
pwsh -NoProfile -File .\scripts\Verify-Baseline.ps1
npm.cmd run toolchain:check
npm.cmd run build
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test
npm.cmd run test:coverage
npm.cmd run e2e
npm.cmd run audit
```

Coverage gate：本地 clean-room frontend 目標要求 statements 與 lines 至少 80%；branches 與 functions 保留為診斷輸出，因 Vue template 分支另外由 component tests 與 Playwright 路由 sweep 覆蓋。

若任一命令失敗，不得宣稱 web surface 完成；先保留失敗輸出與 correlation context，再修正或明確回報阻塞。
