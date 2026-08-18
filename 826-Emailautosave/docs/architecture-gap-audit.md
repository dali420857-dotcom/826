# Architecture Gap Audit — draft-for-discussion

> Status: `draft-for-discussion`
> Date: 2026-08-17
> Purpose: 邊盤點、邊記錄決策；本文件不是已批准的實作規格。每個建議都要經過討論後，才可改成 `accepted`。

## 1. 本輪範圍

### Include

- 盤點目前 production tree、模塊註冊、Bridge、後端契約、測試與部署入口。
- 找出支撐「數據 → 客戶 → 工單 → Email/TG 處理狀態」所缺的功能與契約。
- 建立可討論的優先級、依賴順序與決策問題。

### Exclude

- 不重新啟用退役 Vue 前端。
- 不啟動或修改歷史 reference runtime。
- 不登入 Mailspring、不讀取 OAuth／Token、不接真實 provider、不發信。
- 不在本文件中批准資料庫、身份方案、部署平台或正式排程。

## 2. 目前已讀回的基線

| 項目 | 目前證據 | 狀態 |
| --- | --- | --- |
| Production UI/runtime | `production/dali-outreach/` 已有 React/Vite、Email/TG shell、typed loopback bridge | `partial` |
| Domain modules | 只有 `email`、`telegram`；沒有 `data`、`customer`、`work-item` 模塊 | `verified` |
| Bridge operations | runtime 4 個、Email 6 個、Telegram 6 個；沒有資料／客戶／工單操作 | `verified` |
| Backend state | 目前主要是 in-memory map/array；沒有 durable store readback | `verified` |
| Provider | fake adapter only；Mailspring seam fail-closed | `verified` |
| Safety | loopback、Origin/Host、process capability、role、schema、idempotency、reconciliation 已有 | `partial` |
| Verification | `npm run typecheck` exit 0；`npm test` 16 files / 231 tests pass | `verified` |
| Build/browser/WebView2 | 文件有歷史證據，但本輪沒有重新執行完整 build、browser、WebView2 packaging | `unverified` |

## 3. 缺口矩陣

| ID | 缺口／要補的功能 | 目前情況 | 優先級 | 建議模塊 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| G-001 | 數據 Hub：導入、預覽、欄位映射、驗證、去重、批次 | 已有合成 CSV 預覽、欄位驗證、批次導入與批次內 customerRef 去重；跨批次去重與正式欄位映射尚未完成 | P0 | `data` | `partial` |
| G-002 | 客戶與 Work Item：客戶主檔、資料批次、工單 owner、總狀態 | 已建立暫存 Customer／Work Item 與 Email／TG 狀態欄位；跨批次主檔合併尚未完成 | P0 | `customers`, `work-items` | `partial` |
| G-003 | 共用 read model：列表、篩選、排序、分頁、詳情抽屜 | 已有列表、狀態／owner 篩選、排序與分頁；詳情抽屜尚未完成 | P0 | `shared-read-model` | `partial` |
| G-004 | Durable store：重啟後仍能讀回資料、狀態、稽核 | 已建立 SQLite repository、runtime `dataStorePath` 與重啟讀回測試；後續 migration policy 仍需完成 | P0 | `storage` | `partial` |
| G-005 | 正式身份與權限：使用者、角色、審核者、工作階段 | Bridge request 帶 role，但目前不是完整身份驗證 | P0 | `identity-access` | `partial` |
| G-006 | 模塊化 App Shell：Data/Customer/Task/Email/TG/Settings 可註冊 | Data 已進入固定操作清單並顯示在總覽工單面板；左側完整 App 導航與第二層頁籤尚未完成 | P0 | `shell`, `module-registry` | `partial` |
| G-007 | 共用工單狀態機與批量操作 | 已有單筆狀態更新、owner 欄位與版本衝突保護；批量指派／批量標記尚未完成 | P0 | `work-items` | `partial` |
| G-008 | Audit／reconciliation 的持久化與查詢 | Data audit 已可寫入 SQLite 並重新讀回；provider reconciliation 尚未建立 | P1 | `audit`, `reconciliation` | `partial` |
| G-009 | 排程與 worker：先預覽，再批准，再執行 | phase 0 schedules disabled；沒有正式 scheduler/worker | P1 | `scheduler`, `worker` | `missing` |
| G-010 | Mailspring adapter：health、draft、send receipt、錯誤對帳 | adapter 目前明確 fail-closed，未做 runtime probe | P1 | `email-mailspring-adapter` | `blocked` |
| G-011 | WebView2 host：載入同一份 dist、啟動 bridge、關閉與升級 | repository 沒有 native host/installer 入口 | P1 | `webview2-shell` | `missing` |
| G-012 | 公開網站部署：HTTPS、server auth、hosted email adapter、環境配置 | 目前只有 local loopback/no-send boundary | P1 | `web-deployment` | `missing` |
| G-013 | 設定與 capability 管理：啟用模塊、來源狀態、版本相容 | 現有 manifest 可描述 phase 0，但不能承載完整產品配置 | P1 | `configuration` | `partial` |
| G-014 | 觀測與復原：health、structured logs、metrics、safe-stop、backup | 有安全事件與 local readback，沒有正式營運觀測鏈 | P1 | `observability`, `recovery` | `partial` |
| G-015 | 完整驗收矩陣：build、browser、WebView2、資料庫、provider 分層 | unit/typecheck 已驗證；其餘層級需重新建立 evidence | P0 | `verification` | `partial` |

## 4. 建議依賴順序

```text
domain glossary
  → data/customer/work-item contracts
  → durable read/write store
  → typed bridge operations
  → App Shell + feature modules
  → Email/TG adapters
  → WebView2 packaging / public deployment
```

先補 UI 但沒有 `G-001`～`G-004`，會得到漂亮但沒有共同資料來源的頁面；先接 Mailspring 也會把 provider 細節倒灌進核心業務。

## 5. 建議第一條垂直切片

### `data-work-item`（P0）

**流程：**

```text
synthetic CSV
→ preview/mapping
→ validation/dedup
→ import batch
→ work-item list
→ customer detail
→ assign/status update
→ audit readback
```

**最低驗收：**

- 能建立一個可追蹤的 `batchId`、`customerId`、`workItemId`。
- 列表支援固定欄位、篩選、排序、分頁與詳情讀回。
- 狀態轉換有角色檢查、idempotency key、audit event。
- 使用 temporary/synthetic store；沒有 provider、發信或外部寫入。

## 6. 待討論決策（尚未接受）

| ID | 決策問題 | 建議答案 | 目前狀態 |
| --- | --- | --- | --- |
| D-001 | `Data`、`Customer`、`Work Item` 的主從關係 | Data Batch 是來源；Customer 是長期主檔；Work Item 是一次可處理任務 | `accepted` |
| D-002 | 初期資料庫 | 本機可先 SQLite；以 repository interface 隔離，公開版再接 Postgres 或託管資料庫 | `accepted` |
| D-003 | 三層是否一開始三個程序 | 先保持三層契約，但 Bridge + Backend 可同程序；需要 Mailspring isolation 時再拆程序 | `accepted` |
| D-004 | 模塊載入方式 | 初期 compile-time allowlist；不做任意 dynamic plugin loader | `accepted` |
| D-005 | Mailspring 範圍 | 只作桌面版 adapter；公開網站另接 hosted provider | `proposed` |
| D-006 | UI 元件來源 | 先固定 Shell 與契約，再挑表格、抽屜、表單等可替換元件 | `proposed` |

### D-001 accepted record

- **Decision date:** 2026-08-17
- **Decision:** Data Batch 保存一次導入來源；Customer 是可跨批次重用的客戶主檔；Work Item 是針對客戶／批次的一次處理任務。
- **Consequence:** Email、Telegram 只作 Work Item 的渠道狀態，不再各自擁有一套互不相通的客戶主檔。
- **Still open:** 去重規則、Customer 合併、Work Item 是否允許多渠道並行，另在下一輪決策中討論。

### D-003 accepted record

- **Decision date:** 2026-08-17
- **Decision:** 保留三個邏輯層：前端、局域通信、後端。初期局域通信和後端可在同一個服務中運行；只有在 Mailspring 需要隔離，或部署條件確實需要時，才拆成不同程序。
- **Consequence:** 初期少維護程序、連接埠和啟停流程，但前端看到的通信契約先分清楚，之後拆分時不用重寫前端。

### D-004 accepted record

- **Decision date:** 2026-08-17
- **Decision:** 只允許已寫入程式、已審核的內建模塊，透過設定開啟或關閉；不允許未知的下載插件或任意動態插件在運行時自行新增頁面、路由或後端能力。
- **Consequence:** 安全、測試和審查範圍較清楚；新增模塊必須同時補上程式、契約和測試，不能只改設定就注入未知功能。

### D-002 accepted record

- **Decision date:** 2026-08-17
- **Decision:** Data Work Item 先使用本機 SQLite；核心服務只依賴 `DataWorkItemRepository`，不直接依賴 SQLite API。測試可使用 in-memory repository，監控 runtime 由本機路徑啟用 SQLite。
- **Consequence:** 重啟後可讀回 preview、batch、customer/work item、狀態與 data audit；未來切換 Postgres 或託管資料庫時只替換 repository adapter。
- **Safety boundary:** 只允許合成資料；公開讀回一律遮罩 Email；SQL 使用參數化查詢；不接真實帳號、provider、發信或部署。
- **Still open:** schema migration/versioning、跨批次 Customer 去重與正式多使用者權限仍未完成。

## 6.1 已完成的第一條本機切片

- `data.previewImport`：合成 CSV 預覽、欄位驗證、遮罩 Email、來源稽核。
- `data.importBatch`：建立暫存 Data Batch、Customer、Work Item。
- `data.listWorkItems`：固定分頁、狀態／owner 篩選與列表讀回。
- `data.updateWorkItem`：版本檢查、狀態／owner／渠道狀態更新與稽核。
- `data.readAudit`：只讀稽核讀回。
- 測試預設仍可使用 in-memory repository；本機 runtime 可使用 SQLite，沒有真實帳號、provider 或發信副作用。

## 6.2 D-002 SQLite repository slice

- `DataWorkItemRepository` 隔離 preview、batch、work item 與 audit 的保存／讀回。
- SQLite adapter 使用固定 schema、參數化 SQL 與 transaction；SQLite 只在 Node runtime adapter 中載入，不進入瀏覽器 bundle。
- 測試已證明關閉 repository 後重新開啟，仍能讀回 batch、狀態、owner、版本與稽核；公開讀回不含原始 Email。

## 7. 文件生命週期

```text
draft-for-discussion
  → user discussion
  → proposed decision
  → accepted ADR/spec
  → implementation ticket
  → verification evidence
```

本文件只記錄缺口與候選決策；真正不可逆的選擇（資料庫、身份、provider、部署）要另立 ADR，並保留替代方案與拒絕理由。

## 8. 下一個安全動作

下一輪先討論 `D-005`、`D-006`，並釐清 D-001 的去重與多渠道邊界，再補齊 schema migration、批量操作與詳情抽屜；不接真實帳號、不改 WebView2/native packaging。
