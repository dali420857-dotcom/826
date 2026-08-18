# Implementation Plan: Dali Outreach — Email + Telegram 控制台

## 狀態與邊界

- `status`: `approved_for_no_send_implementation`。使用者已批准在目前 working tree 建立新 production tree；runtime 仍未建立或驗證。
- 唯一業務範圍：Email 與 Telegram；共用能力只在直接支援這兩條鏈路時保留。
- 本階段只規劃 synthetic fixture、fake adapter、loopback bridge 與 no-send readback。
- 不修改退役 Vue、不啟動唯讀快照、不接真實帳號／OAuth／provider、不啟動正式排程、不發送訊息。

## Source of truth

- Repo：`dali420857-dotcom/Dali_Pro`
- 入口：`ControlPanelApp.tsx → TrayWorkbenchOutreachPage.tsx → OutreachPrototypeApp.tsx → OutreachAppShell.tsx → outreach.css`
- Canonical reference：`dali-outreach-ui-reference.html`、`dali-outreach-reference-runtime.ts`
- 視覺對照：`.local-artifacts/dali-outreach-reference-port-current.png`
- 關鍵提交：`ea52e72a0501`、`fcb93fa1c19a`、`286261376cb2`、`ec6de43b9677`、`691bfbe01dbe`、`53a610458227`

Fresh GitHub readback 已恢復並固定到 `main` revision `82141617f15e8921be471f44804da1c2a0683c34`。這只證明 source 可讀，不代表本地 runtime-ready。

### 工作流來源分層

- 歷史 reference 曾以 `reference-mail-control-panel-head-c3e1e80-20260528/docs/agent-rules/README.md` 作為單一工作流索引，再分流到任務啟動、診斷、GUI 對齊、設計審查、退場、首發、回訪與閉環驗證。
- 該索引只作術語、順序與驗收意圖的唯讀歷史證據；其中命令、路徑、規則與 runtime 假設不得直接啟用或支配目前項目。
- 現行唯一可執行工作入口是在 `D:\Dali-Automation\826-Device-and-Cloud-Control` 執行 `pwsh -NoProfile -File .\scripts\Invoke-SkillPreflight.ps1`，成功後依序走 `ask-matt → using-agent-skills`，再按本方案選取最小工程技能集合。
- 遷移時只抽取與 Email/TG 直接相關的工作流意圖，重新落入現行 contract、tasks、tests 與 approval gates；不得複製或啟動 reference runtime。

## 前端範圍

保留使用者確認的純黑 Dali Outreach shell、側欄、頂欄與來源狀態列，導航只留下：

- 總覽
- 客戶：Email／Telegram 聯絡人、待辦佇列、導入與資料
- Email：郵件流程、郵件範本、訊息變數
- Telegram：Telegram 流程、APP 訊息範本、訊息變數
- 帳號與工作階段：只顯示 Email／Telegram 遮蔽狀態
- 系統：只服務 Email／Telegram 的排程、稽核、異常復原、報表、設定

## 架構、ownership 與依賴

| Module | Ownership / output | Status |
| --- | --- | --- |
| `email-telegram-read-model` | Backend：versioned Email/TG snapshots | proposal |
| `email-automation` | Email：draft/review/local queue + audit | proposal；既有 fake seam 僅作相容參考 |
| `telegram-automation` | Telegram：target/preview/approval/local queue + audit | proposal |
| `email-telegram-bridge` | Bridge：allowlisted typed request + fixed envelope | proposal |
| `dali-outreach-shell` | Frontend：canonical black UI | proposal |
| `email-telegram-verification` | Tests：分層驗收證據 | proposal |

依賴：`read-model → Email/TG domain → bridge → shell → verification`。實作採垂直切片，每片包含最少量 frontend、bridge、backend fake 與測試。

## 已批准 production 邊界

```text
production/dali-outreach/
  frontend/       # React/TS canonical UI adapter
  bridge/         # loopback typed bridge
  backend/        # Email/TG contracts and read model
  fixtures/       # synthetic Email/TG data only
  tests/          # contract, integration, UI no-send
```

路徑與 current-working-tree 實作已批准，但尚未建立。退役 UI 不 import、不 mount、不 route、不擴充；reference 不修改、不啟動、不部署。

## Data / read model

- `sourceState`: `loading | ready | degraded | unavailable`，含來源、`asOf`、TTL、錯誤摘要。
- `runMode`: `Stopped | MonitoringOnly | Active | Degraded`；phase 0 預設 `MonitoringOnly`。
- `emailSnapshot`: accounts、contacts、drafts、review、queue、templates。
- `telegramSnapshot`: accounts/sessions、targets、previews、local queue、templates。
- `sharedOperationsSnapshot`: pause、recovery、audit、reconciliation、reports。
- 全部只含 synthetic/masked metadata，且帶 schema version、來源、時間與有效期限。

## Bridge contract

```ts
type BridgeEnvelope<T> = {
  status: "success" | "partial" | "blocked" | "error";
  summary: string;
  next_actions: string[];
  artifacts: T;
  correlationId: string;
  operationId?: string;
  asOf: string;
};
```

Phase 0 allowlist：

- `health.read`、`emailTelegram.snapshot.read`、`emailTelegram.route.read`
- `email.draft.create`、`email.draft.approve`、`email.queue.enqueueLocal`
- `telegram.target.preview`、`telegram.message.preview`、`telegram.preview.approve`、`telegram.queue.enqueueLocal`
- `automation.pauseAll`／`automation.resumeAll`（只改本地 Email/TG fake state）
- `audit.read`、`reconciliation.read`

所有變更請求必須帶 idempotency key；同 key 不同 payload 拒絕。結果 unknown 時先 reconciliation，禁止盲目重送。錯誤不回傳 stack、秘密、正文或真實聯絡人資料。

## State machines

```text
Email: draft.pending_review → draft.approved → queue.queued_local
       → fake.completed | fake.failed | fake.unknown

TG:    target.ready → message.previewed → preview.approved → queue.queued_local
       → fake.completed | fake.failed | fake.unknown
```

未批准不得入隊；phase 0 沒有 provider dispatch。每次 transition 產生 audit event；pause 可觀察，resume 必須重新檢查 gate。

## Security gates

- `safe-default`、只綁 `127.0.0.1`、外部 mutation disabled。
- synthetic fixture、masked metadata、temporary store、fake adapters、no-write assertion。
- bridge 僅接受 Email/TG allowlist 與 role scope；UI 不可指定任意 adapter method、SQL、shell 或 URL。
- 不讀取、保存或輸出 token、密碼、OAuth、訊息正文或真實 PII。
- 真實帳號、provider、正式排程、發信／發訊息與外部寫入均需獨立 action-specific approval。

## 分階段方案

### Phase 0 — Decision gate

- **Include:** production path、branch／working-tree、GitHub source 適配授權、canonical revision、歷史索引到現行 preflight/skills/tasks 的映射。
- **Exclude:** runtime、route mutation、帳號與 provider。
- **Output:** approved spec、capability map、ADR、task list。
- **Acceptance:** 文件 readback、Git status、`git diff --check`。
- **Status:** approved。production path、current working tree、GitHub source 適配、Email+TG-only、synthetic/fake/no-send 與 additive seams 均已確認。

### Phase 1 — Contract foundation

- **Include:** Email/TG snapshots、bridge envelope、allowlist、idempotency/audit contracts、fixtures。
- **Exclude:** 真實資料、provider 與 UI side effect。
- **Output:** schemas、fake adapters、contract tests。
- **Acceptance:** schema/unit/contract tests；external calls = 0。
- **Status:** unverified。

### Phase 2 — Canonical shell + overview

- **Include:** 黑色 shell、精簡導航、topbar、source-state、Email/TG fixture overview。
- **Exclude:** 真實帳號與外部操作。
- **Output:** UI + `emailTelegram.snapshot.read`。
- **Acceptance:** component/build、1366×768 與 1920×1080 Playwright no-send 截圖。
- **Status:** unverified。

### Phase 3 — Email vertical slice

- **Include:** contacts/import preview、template/variables、draft → approve → local queue、pause/recovery/audit。
- **Exclude:** OAuth、provider dispatch、真實 CSV 寫入。
- **Output:** Email UI + typed bridge + fake backend readback。
- **Acceptance:** success/failure/unknown、duplicate idempotency、no-write tests。
- **Status:** unverified。

### Phase 4 — Telegram vertical slice

- **Include:** targets/import preview、template/variables、preview → approve → local queue、masked account/session、pause/recovery/audit。
- **Exclude:** 登入、QR、token、真實聊天與 live-send。
- **Output:** TG UI + typed bridge + fake backend readback。
- **Acceptance:** success/failure/unknown、stale/degraded session、idempotency、no-write tests。
- **Status:** unverified。

### Phase 5 — Shared operations and acceptance

- **Include:** Email/TG-only 排程預覽、稽核、reconciliation、復原、報表、safe-stop、build/UI/security verification。
- **Exclude:** 正式排程、真實資料回滾、provider health/live E2E。
- **Output:** combined no-send control plane + migration manifest。
- **Acceptance:** contract/unit/integration/build/browser/security pass；provider/live 保持 `unverified/blocked`。
- **Status:** unverified。

## Verification matrix

| Layer | Evidence | Gate |
| --- | --- | --- |
| Static/config | `Verify-Baseline.ps1`、schema parse、`git diff --check` | pass |
| Unit | Email/TG read-model、state machine、bridge tests | pass |
| Integration | fake Email/TG adapters、temporary store、no-write assertion | pass |
| Build/lint | build、typecheck、lint、format check | pass |
| UI/browser | loopback Playwright、route allowlist、1366/1920 screenshots | pass |
| Security | secret/input/error/redaction checks、dependency triage | 無未處理 high/critical |
| Provider/live | account health、OAuth、live send | 不執行；另案批准 |

## Migration / rollback

- 新 UI 先放獨立 production path；不重新啟用退役 route 或 Vue frontend。
- `docs/agent-rules/README.md` 不搬成可執行入口；只把 Email/TG 相關任務啟動、診斷、GUI 對齊、設計審查、退場與驗證意圖映射到現行 `preflight → ask-matt → using-agent-skills → task-specific checks`。
- 所有被採用的歷史流程都必須在 reference 之外重寫成當前 tasks/contracts/tests，並重新驗證；來源存在不等於已遷移或 runtime-ready。
- manifest 記錄 source revision、contract/fixture version、導航範圍與截圖證據。
- rollback 為停用新入口並保留 tree、fixture 與 audit；不刪 reference、不 reset dirty paths。
- Email + Telegram no-send 全部 verified 且另行批准後，才討論 route cutover；live/provider 是另一 gate。

## Stop conditions

production path／branch 未確認、source revision 無法 fresh readback、需要秘密/provider、contract/build/UI/security 失敗、unknown 未 reconciliation，或新 UI 依賴退役 Vue 時，立即停止實作或外部操作。

## 已批准決策

1. 使用 `production/dali-outreach/`。
2. 在目前 working tree 作最小新增；不得依賴不存在的 Git commit rollback。
3. 從 `Dali_Pro/apps/mail-control-panel` canonical source 適配黑色 UI。
4. 第一個 assembly 固定為 Email + Telegram shell、synthetic snapshot、typed loopback bridge 與 no-send fake adapters。
5. 保留既有 Email fake seam 作相容參考，新增獨立 Telegram seam；共用 contracts、runtime core、audit/reconciliation。
