# Spec: Dali Outreach Email + Telegram 可組裝控制面

## Final Goal

在 `production/dali-outreach/` 建立可組裝、可拆換的 React/TypeScript 黑色 Dali Outreach 控制面。保留 GitHub canonical shell 的視覺與操作密度，第一個 assembly 只安裝 Email 與 Telegram 模塊；未註冊模塊沒有 navigation、route、fixture、bridge operation 或 backend handler。

第一個完成門檻是 synthetic fixtures、temporary store、fake adapters、typed loopback bridge 與 local-only UI/backend 的 contract、unit、integration、build、browser、security readback 全部通過。真實帳號、OAuth、Token、provider、正式排程與 live-send 是後續獨立 approval gate。

## Problem Statement

使用者已確認的 Dali Outreach 黑色 UI 存在於 GitHub canonical source，但本地可見 Vue 前端已退役，歷史 reference 也不可當 runtime。需要在不恢復舊前端、只裝配 Email/TG、且不接真實 provider 的前提下，建立可驗證並可持續擴充的正式控制面。

## Solution

採 compile-time composition root 與多個小而穩定的 module contributions。Shell、read model、operation registry、bridge 與 domain modules 分離；第一版 registry 只裝配 `email` 與 `telegram`。未來渠道只能以 opt-in module contract 加入，不得改寫 Email/TG 核心或預先建立空白頁。

## User Stories

1. 作為操作員，我只看見 Email 與 Telegram 的導航和狀態。
2. 作為操作員，我可以從總覽辨識來源 freshness、degraded、unavailable 與 stale。
3. 作為操作員，我可以用合成資料預覽 Email 聯絡人與導入結果。
4. 作為審核者，我可以批准 Email 草稿後才讓它進入本地 fake queue。
5. 作為操作員，我可以預覽 Telegram target 與訊息，批准後才進入本地 fake queue。
6. 作為操作員，我可以暫停與恢復 Email/TG fake automation，並看見明確 readback。
7. 作為稽核者，我可以用 correlation/operation ID 追蹤每次 transition。
8. 作為維運者，我可以辨識 success、failure 與 unknown；unknown 必須先 reconciliation。
9. 作為安全審查者，我能證明 phase 0 沒有 outbound provider call、秘密讀取或外部寫入。
10. 作為開發者，我可以新增 opt-in 渠道模塊，而不改寫 shell、Email 或 Telegram 核心。
11. 作為測試者，我可以在 1366×768 與 1920×1080 驗證 canonical 黑色介面。
12. 作為使用者，我不會看到未註冊模塊的 placeholder、隱藏 route 或死連結。

## Implementation Decisions

- Source revision 固定為 `82141617f15e8921be471f44804da1c2a0683c34`。
- `outreach-contracts`: branded IDs、fixed envelope/error、freshness、audit events、operation unions。
- `outreach-runtime-core`: module registry、combined snapshot、pause/resume、idempotency、audit/reconciliation。
- `email-outreach`: contract/backend/frontend entries 與 fake Email adapter。
- `telegram-outreach`: contract/backend/frontend entries 與 fake Telegram adapter。
- `outreach-bridge`: loopback transport、strict schema validation、role/operation allowlist；allowlist 由已註冊 modules 生成。
- `dali-outreach-shell`: canonical shell/tokens、topbar/source state、nav/route composition；nav/routes 由 presentation registry 生成。
- `outreach-verification`: contract/unit/fake integration/build/Playwright/security/no-write acceptance。
- 三個公共 seams 分開：presentation、snapshot、operation；不做耦合 React/backend 的巨型 plugin interface。
- 所有模塊同時只依賴一版 contracts；contract evolution 只 additive。
- Phase 0 固定 `MonitoringOnly`，拒絕 `Active` 與任何 provider adapter，即使環境存在 credentials。
- Approval 綁定 payload hash、schema version 與 expected state；內容被編輯後 approval 失效。
- Transport 除 loopback 外仍需 server-side method/role enforcement，並明定 Origin/CORS/CSRF 或 per-process capability。
- Threat model 必須覆蓋 renderer→bridge、bridge→fake backend/store、import→parser、GitHub source→build、state→audit/artifacts 與未啟用 provider seam。
- Phase 0 process 必須 fail-closed 阻止非 loopback outbound HTTP/socket；任何 egress attempt 令測試與 runtime gate 失敗。
- 所有輸入使用 strict schemas、拒絕額外欄位，並設 request/body/list/page/timeout/concurrency 上限。
- 新 production tree 使用獨立 package/lockfile/config boundary，不修改退役 root Vue harness。

## Agreed Test Seams

- Module composition seam：註冊/未註冊 module 對 nav、routes、operations、snapshots 的影響。
- Typed bridge seam：request → fixed envelope，含 validation、authorization、idempotency、redaction。
- Email operation seam：draft → approve → local queue → fake outcome → reconciliation。
- Telegram operation seam：target → preview → approve → local queue → fake outcome → reconciliation。
- Browser seam：操作員從 UI 完成 preview/approval/no-send readback。
- Network/security seam：non-loopback、outbound network、provider/live operation 必須拒絕。

## Testing Decisions

- 測外部行為與公共 seams，不測 private implementation。
- 每個 slice 先 RED，再最小 GREEN。
- 使用 deterministic clock、fixtures、temporary store、MSW/fake adapters 與 outbound-call counter。
- UI 驗收包含 loading/ready/degraded/unavailable/stale、success/failure/unknown/duplicate。
- 輸入測試包含 size/row caps、CSV formula/path protection、Email HTML 與 Telegram Markdown escaping。
- 最終分層報告 static/config、unit、integration、build、browser、security；provider/live 保持 blocked。

## Out of Scope

- 所有未註冊、未授權能力及其 nav、route、schema、operation、fixture。
- 退役 Vue、歷史 reference runtime、Mailspring live provider。
- OAuth、Token、QR login、真實 PII/正文、正式排程、live-send、部署、遠端寫入。
- 任意第三方 dynamic plugin loader、任意 shell/SQL/file-write/URL bridge。

## Rollback and Stop Conditions

- Rollback 以 activation switch 停用新入口，保留 production tree、manifest 與 audit；不得 destructive reset。
- Source 無 fresh readback、shared contract 未凍結、ownership 重疊、需要 provider/secret/live、non-loopback bind、outbound deny 失敗、build/test/security 失敗或 unknown 未 reconcile 時立即停止。
