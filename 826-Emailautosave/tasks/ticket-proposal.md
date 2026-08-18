# Dali Outreach Tracer-Bullet Ticket Proposal

> `/to-tickets` draft。核准粒度與 blocking edges 後，才發布為 `.scratch/dali-outreach/issues/NN-*.md`。

| ID | Title | Blocked by | Owner | What it delivers |
| --- | --- | --- | --- | --- |
| DA-000 | Freeze source and rollback baseline | Approval complete | Parent | 固定 source revision、scope、dirty baseline、rollback/stop |
| DA-001 | Freeze shared contracts | DA-000 | Parent/Contract | Envelope、IDs、state unions、module contributions、allowlist、idempotency |
| DA-001S | Freeze threat model and security invariants | DA-000 | Parent/Security | trust boundaries、Origin/Host/session capability、no-egress、approval hash、input/artifact policy |
| DA-002 | Build isolated production/test harness | DA-001, DA-001S | Foundation | React/TS package boundary、fixture loader、process-level no-egress/no-write spine |
| DA-003 | Build shared fake store and audit runtime | DA-001, DA-002 | Shared backend | temporary store、freshness、pause、audit、reconciliation |
| DA-004 | Build typed loopback bridge tracer | DA-001, DA-002 | Bridge | validation、authorization、fixed envelope、loopback-only dispatcher |
| DA-005 | Build canonical black shell tracer | DA-001, DA-002 | Frontend shell | shell/tokens、source state、Email/TG-only registry |
| DA-006 | Build Email backend tracer | DA-003 | Email | import preview、draft/approve/local queue、fake outcomes |
| DA-007 | Build Telegram backend tracer | DA-003 | Telegram | target/message preview、approve/local queue、masked sessions |
| DA-008 | Complete Email UI tracer | DA-004, DA-005, DA-006 | Email integration | UI 到 fake backend 的完整 no-send readback |
| DA-009 | Complete Telegram UI tracer | DA-004, DA-005, DA-007 | TG integration | UI 到 fake backend 的完整 no-send readback |
| DA-010 | Compose shared operations | DA-008, DA-009 | Parent/single owner | Email/TG-only audit、recovery、reports、settings assembly |
| DA-011 | Independent verification/security review | DA-010 | Reviewer | contract/build/browser/security evidence matrix |
| DA-012 | Close migration and rollback evidence | DA-011 | Parent | capabilities、graph、ADR、manifest、final acceptance |

## Approval questions

1. Ticket 粒度是否合適？
2. `DA-001` 與 `DA-001S` 共同作所有並行工作的硬 blocker 是否正確？
3. `DA-002` 是否應包含 React package 版本/lockfile 審查，還是拆成獨立 ticket？
4. `DA-010` 是否固定由 Parent 執行，以避免共用檔衝突？
