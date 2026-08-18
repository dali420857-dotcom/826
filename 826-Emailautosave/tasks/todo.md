# Dali Outreach — Email + Telegram 任務清單

> `status: approved_for_no_send_implementation`。Gate 0 已批准；依 `/to-spec → /to-tickets` 先凍結規格與 tickets，再開始 production code。

## Gate 0 — 使用者決策

- [x] 確認 production path：`production/dali-outreach/`。
- [x] 確認使用目前 working tree；不假設 commit rollback。
- [x] 確認從 GitHub `Dali_Pro` 適配移植黑色 Dali Outreach UI。
- [x] 確認唯一業務範圍為 Email + Telegram。
- [x] 確認 phase 0 僅 synthetic fixture、fake adapters、loopback、no-send。
- [x] 確認歷史 `docs/agent-rules/README.md` 只作唯讀工作流索引證據，不作現行 runtime 入口。
- [x] 核准 `tasks/ticket-proposal.md` 的 ticket 粒度與 blocking edges；已發布至 `.scratch/dali-outreach/issues/`。

## Phase 1 — 共用契約

- [x] 建立歷史 Email/TG 工作流意圖到現行 `preflight → ask-matt → using-agent-skills → tasks/tests` 的映射表。
- [x] 定義 Email/TG read-model、schema version、freshness 與固定 envelope。
- [x] 定義 Email/TG allowlist、roles、errors、correlation、operation、idempotency。
- [ ] 建立 deterministic fixtures、masked metadata、stale/degraded/unavailable cases。
- [x] 建立 shared audit、pause/resume、reconciliation、safe-stop contract。
- [x] Checkpoint：schema/unit/contract pass；external calls = 0。

## Phase 2 — 黑色控制台外框

- [x] 適配 canonical shell、topbar、source-state band。
- [x] 只建立 Email + Telegram 精簡導航與 fixture overview。
- [x] 驗證 loading、degraded、unavailable、stale。
- [ ] Checkpoint：build、components、1366/1920 Playwright no-send screenshots pass。

## Phase 3 — Email 垂直切片

- [x] Email contacts/import dry-run preview。
- [x] Email templates、variables、draft/review/local queue backend。
- [x] Email fake success/failure/unknown、reconciliation、pause/resume、audit backend。
- [x] Checkpoint：Email contract/unit/fake integration/UI no-send pass。

## Phase 4 — Telegram 垂直切片

- [x] TG targets/import dry-run preview。
- [x] TG templates、variables、message preview/approval/local queue backend。
- [x] TG masked account/session 與 stale/degraded cases。
- [x] TG fake success/failure/unknown、reconciliation、pause/resume、audit backend。
- [x] Checkpoint：TG contract/unit/fake integration/UI no-send pass。
- [ ] Checkpoint：TG contract/unit/fake integration/UI no-send pass。

## Phase 5 — 共用營運與遷移閘門

- [ ] Email/TG-only schedule preview、audit、recovery、reports、settings。
- [ ] 執行 baseline、unit/integration、build、lint、format、security checks。
- [ ] 執行 Playwright route/interaction/accessibility/no-send acceptance。
- [ ] 更新 capabilities、graph、ADR、migration/rollback manifest。
- [ ] 驗證 production tree、scripts 與文件沒有 import、啟動或依賴 reference 工作流入口。
- [ ] Checkpoint：Email + Telegram no-send verified；provider/live 保持 unverified/blocked。

## 明確排除

- [ ] 不重新啟用退役 Vue frontend 或 route。
- [ ] 不修改、啟動或部署唯讀 reference snapshot。
- [ ] 不登入 OAuth、不讀 token、不接真實 Email/TG 帳號。
- [ ] 不發信、不發 TG 訊息、不啟動正式排程、不寫 provider。
