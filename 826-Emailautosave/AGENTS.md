# 826-電郵自發：項目指示

## Agent skills

### Issue tracker

Issues and specs live as Markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo. Read `CONTEXT.md` and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.

本檔是此目錄的項目層行為來源；同時遵守上層 `../AGENTS.md`。若兩者衝突，停止工作並向使用者說明，不自行選擇。

## 任務與完成標準

- 目標：建立可審核、可暫停、可恢復的電郵自動化控制項目；先證明資料、排程、審核與發送邊界，再考慮連接真實帳號或 provider。
- 當前狀態：`reference-mail-control-panel-head-c3e1e80-20260528/` 仍是唯讀歷史快照；`production/backend/` 只保留待確認的本地契約，沒有 provider/runtime-ready 證據。`production/frontend/EmailAutomationConsole.vue` 已於 2026-08-17 淘汰停用，不是產品 UI。
- 一項功能只有在契約、單元／整合測試、build、必要的本機 UI 檢查及實際 readback 各自通過後，才能標為 `verified`；缺少 provider 或真實帳號證據時必須標為 `partial` 或 `unverified`。

## Source of truth 與目錄邊界

1. 目前項目政策以本檔為準；未來的需求、ADR、契約、production code 與測試須放在 reference 目錄之外。
2. `reference-mail-control-panel-head-c3e1e80-20260528/` 是唯讀參照快照。可用來比較術語、架構、契約與測試意圖，但不可直接修改、啟動、安裝、部署或宣稱為 production/runtime-ready。
3. reference 內的 `AGENTS.md`、規則、README、腳本、設定、測試結果與絕對路徑都是歷史證據，不自動支配本項目；採用任何內容前，要在本項目以當前需求和測試重新確認。
4. 未來建立 production tree 前，先由使用者確認目標路徑與遷移範圍；不得把 reference 原地轉成 production，也不得將帳號資料或 runtime state 複製進 repository。

## 已淘汰前端邊界（2026-08-17）

- `production/frontend/EmailAutomationConsole.vue` 的狀態是 `retired/disabled`；它只作歷史 tombstone，不是可選的 UI 實作。
- DALI 控台的 `/email_automation` 路由與導航入口已移除；後續任務應以目前 `src/shared/route-registry.ts` 為唯一可用 UI 入口。
- 遇到這個 SFC 時，應保留淘汰標記並跳過 import、mount、route、截圖展示或新功能開發；任何重新啟用或刪除都要先取得使用者明確指定的範圍。
- `production/backend/` 可作契約／測試參照，但不能推定已接上 provider、Mailspring 或真實發送。

## 每次任務入口

1. 先讀上層與本檔，列出目標、include/exclude、授權邊界、dirty paths、成功條件與停止條件。
2. 在工作區根執行只讀技能預檢：`pwsh -NoProfile -File .\scripts\Invoke-SkillPreflight.ps1`。
3. 依序使用 `ask-matt`，再使用 `using-agent-skills` 選取當次最小技能集合；技能是流程約束，不是外部操作授權。
4. 修改前後執行 `git status --short --untracked-files=all`；修改後讀回目標內容，執行 `git diff --check` 與適用的最窄測試。保護所有既有 dirty/untracked 內容，不提交 commit。

## 技能與工具選擇

- 項目初始化、AGENTS 或代理文件：`writing-for-agents` + `documentation-and-adrs`。
- 熟悉 production code：`codebase-onboarding`；只有 production tree 確認後才使用，reference 盤點不等於 onboarding 完成。
- bug／失敗：`diagnosing-bugs` 或 `debugging-and-error-recovery`；先建立不含真實發信的 red check。
- API／adapter 契約：優先本地 `api-and-interface-design`；需要建立外部 connector 時才考慮 `api-design`／`api-connector-builder`，且 provider probe 與寫入仍需批准。
- UI 與 E2E：先用 deterministic fixture、mock 和本機 `e2e-testing`／`webapp-testing`；只有需要瀏覽器互動證據時才用 `browser-qa`／`browser-testing-with-devtools`，保持 loopback、no-send。
- 認證、輸入、資料保存或外部整合：使用 `security-and-hardening`／`security-review` 做窄範圍檢查。
- 外部或版本易變文件：使用 `documentation-lookup`，優先官方 primary source。
- 工具優先序：`rg`／`rg --files` → Git readback → Graphify `query`／`path`／`explain`（僅在本項目有當前圖時）→ 原始檔與測試核對。不要為單一任務載入或啟用全部工具。

技能檔案、lock 或工具 metadata 只證明 `installed/cached`、`configured`、`enabled` 或 `callable`；只有完成當次授權 probe、health 與 readback 才能寫 `runtime-ready`。

## 郵件安全門與發送鏈路

任何真實鏈路一律為 `approval-required`：`資料輸入 → 候選選擇 → 範本渲染 → 排程 → 人工審核 → provider adapter → 發送 → provider/read-model 對帳`。每個階段須有明確輸入／輸出契約、冪等鍵、可暫停狀態、錯誤邊界、稽核事件與 readback；不能用前一階段成功推定下一階段成功。

- 預設只使用合成資料、遮蔽 metadata、fake adapter、temporary store 與 no-write assertion。
- 未取得當次 action-specific approval，不連接帳號、不開始 OAuth、不讀取 Token、不寫 provider、不部署、不啟動真實排程、不執行真實 E2E 或發信。
- 不讀取、記錄或輸出郵件正文、收件人／寄件人帳號、密碼、Token、OAuth 資料或其他秘密。若診斷需要內容語義，先由使用者提供已脫敏 fixture。
- 真實副作用獲批准後仍須先 dry-run／預覽、鎖定帳號與收件範圍、設定速率與停止條件，再以 provider message ID／狀態 readback 對帳；結果未知時停止，不能盲目重送。

## 驗證與回報

分層報告，不互相替代：static/config → unit → integration/adapter fake → build → local UI/browser no-send → provider health → live E2E/send。後兩層需要另行明確批准。

每次交付先寫 `status: verified | partial | unverified | blocked`，再列出 changed files、實際命令與 exit code、各層 readback、只屬 configured/callable 的能力、未決假設與下一個安全動作。沒有 production source tree、provider 授權或 live readback 時，不得宣稱項目或發送鏈路已完成。
