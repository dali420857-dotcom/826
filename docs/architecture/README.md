# 架構基線

## DALI 控台前端退役

`index.html` → `src/main.ts` → `src/App.vue` 以及 `/index` 的
`src/views/ProductHomeView.vue` 已於 2026-08-17 標記為
`retired/disabled`。目前瀏覽器中的
`http://127.0.0.1:5173/#/index` 只代表既有本機證據，不是新的產品 UI
source of truth。

尚未選定替代前端；保留原始碼、路由契約與測試作歷史 readback。後續代理
不得從這個前端新增頁面、導航或功能，也不得自行重新啟用、刪除或搬遷它。

本專案採用「核心服務 + 窄化適配器 + 明確控制面」的分層方式。代理或其他客戶端不能直接操作裝置、雲端、資料庫或 shell；所有操作必須先進入能力註冊表、權限判斷與讀回驗證。

## 模組化單體目標

826 不需要全面重做目錄。目標依賴方向固定為：

```text
UI / shared shell
  -> typed bridge or application service
  -> owning module/domain
  -> repository or provider adapter
```

父專案的裝置／雲端核心維持 `src/core` 與 `src/adapters`；Email、Telegram
與 Dali Outreach 的實際垂直模組由最近的 Emailautosave project map
說明。模組化是依賴與 ownership 邊界，不要求所有檔案立刻搬到新目錄。
既有功能以測試保護後逐塊切換；資料庫 schema、provider 與 runtime owner
不因 UI 或資料夾整理而自動改變。

## 圖譜索引

- `graphs/system-context.mmd`：系統邊界與外部依賴
- `graphs/control-plane.mmd`：請求到能力執行與回退的流程
- `graphs/data-flow.mmd`：資料與證據如何穿過邊界
- `graphs/state-machine.mmd`：連線、執行、隔離與恢復狀態
- `graphs/fallback-decision.mmd`：失敗分類與決策路徑
- `docs/architecture/agent-layers.md`：代理 12 層風險對應

## Decision-relevant path index

這份 project map 只列會影響代理導航、架構判斷、驗證或能力選擇的 roots；
不要求每個檔案都有一列。固定八欄如下，巢狀 Emailautosave map 會沿用同一
契約。

| Layer | Path/root | Purpose | Owner/canonical source | Consumers/adapters | Classification | Include/exclude boundary | Freshness/stale condition |
|---|---|---|---|---|---|---|---|
| project | `.` | 826 裝置、雲端、Telegram 專案入口 | `AGENTS.md`, `CONTEXT.md`, local ADRs | Project agents and control-plane adapters | authoritative | Include project policy and entry points; exclude provider secrets and runtime DBs | Read when entering this subtree; stale when boundaries change |
| project | `AGENTS.md` | Project policy, permissions, and verification gates | This nearest policy file | Codex and other harness adapters | authoritative | Include durable rules; exclude volatile tool rows and secret values | Read on every scoped task; stale when policy changes |
| project | `src/core` | Provider-neutral business semantics | Source modules and tests | Adapters and control plane | authoritative | Include domain logic; exclude provider credentials and direct runtime writes | Read for core behavior; stale when source/tests change |
| project | `src/adapters` | Device/cloud/provider endpoint mapping | Adapter source and contract tests | Control plane and local clients | authoritative | Include serialization, timeout, and error mapping; exclude raw tokens and private sessions | Read for integration work; stale when provider contracts change |
| project | `config/` | Project capability and runtime configuration schemas | Config files plus applicable ADRs | Preflight and capability consumers | authoritative | Include schema and non-secret defaults; exclude secret values and local auth stores | Refresh when capability/config schema changes |
| project | `schemas/` | Request, capability, fallback, and graph contracts | JSON schemas and schema tests | Core, adapters, and validation | authoritative | Include contract definitions; exclude live data and credentials | Read before contract changes; stale when schema/tests change |
| project | `tests/` | Deterministic project evidence | Tests and fixtures | CI, Verify-Baseline, and reviewers | authoritative | Include relevant no-write/fake tests; exclude live provider data and secret fixtures | Run after behavior/contract changes |
| project | `scripts/` | Project preflight, baseline, and verification commands | Named script plus owning rule/Skill | Agents and CI | authoritative | Include commands and readback contracts; exclude ad hoc private scripts | Read before execution; stale when command contract changes |
| project | `graphs/` | Architecture diagrams for navigation and review | Diagram source files | Humans, Graphify, and architecture review | derived | Include system/control/data/state diagrams; exclude private data and runtime health | Refresh with architecture changes; never source of truth |
| project | `docs/architecture/` | Architecture maps, contracts, and handoff docs | This README and linked canonical documents | Agents and reviewers | authoritative | Include decision-relevant docs; exclude runtime DB, provider data, and full secrets | Read for architecture questions; stale when ownership changes |
| project | `826-Emailautosave/` | Nested mail automation project root | Nested `AGENTS.md` and its architecture map | Email-specific agents and adapters | authoritative | Include nested entry points; exclude mailbox content, OAuth, and runtime stores | Read when task enters nested project |
| project | `826-Emailautosave/production/dali-outreach/` | Current modular Outreach composition and typed runtime | Nested source, contracts, accepted ADRs, and tests | 4174 UI adapter, 5173 bridge, Data, Email, and Telegram modules | authoritative | Include source/contracts/tests; exclude runtime DB, mailbox bodies, credentials, and provider state | Read for Outreach implementation; stale when module ownership or runtime composition changes |
| project | `826-Emailautosave/docs/architecture/README.md` | Nested project path and data-boundary index | Nested project map | Emailautosave agents and parent map | authoritative | Include contracts, ADR links, source roots, and exclusions; exclude message bodies and runtime DB | Read when Emailautosave scope is involved |
| project | `826-Emailautosave/reference-mail-control-panel-head-c3e1e80-20260528/` | Retired historical source snapshot | Nested project policy and snapshot metadata | Read-only comparison only | retired | Include historical evidence; exclude edits, startup, install, deploy, and runtime claims | Never treat as current; stale by definition |

Private, credential, session, provider/runtime database, and mailbox-content roots
are excluded from this map. A generated graph or capability snapshot may point back
to these boundaries as metadata, but cannot become their source of truth.

## 分層規則

1. `src/core` 保持業務語意，不依賴特定供應商。
2. `src/adapters` 只處理端點、認證、序列化、逾時與供應商錯誤映射。
3. `agent-control` 只負責能力選擇、權限、批准、冪等、快照、回退與輸出封裝。
4. 所有外部變更都要有新鮮讀回，沒有證據就停止。
5. 快取只能支援唯讀降級，不得在陳舊資料上做變更。
