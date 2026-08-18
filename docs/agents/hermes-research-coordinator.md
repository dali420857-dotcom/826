# Hermes 研究協調器

本專案已把 `hermes_research_coordinator` 登記成 Codex V2 自訂代理角色。它的定位是唯讀證據協調器：把獨立的來源比對、診斷、API／版本文件查核與本地檢查整理成可追溯回執，再交回主要 Codex 代理整合。

## 目前狀態

- Codex 角色：`.codex/agents/hermes-research-coordinator.toml`
- 角色註冊：`.codex/config.toml` 的 `[agents.hermes_research_coordinator]`
- 每任務預檢：`scripts/Invoke-HermesResearchPreflight.ps1`
- 能力契約：`src/agent-control/hermes-research.ts` 與 `config/capabilities.yaml`
- 狀態：`registered_contract_only`／`contract_only_not_live`
- 預設端點：只接受 `127.0.0.1:8642` 的明確、唯讀、選擇性 probe；不會自動啟動服務或呼叫 Hermes 任務 API。

「角色已註冊」不代表本機 Hermes 已經連線。只有使用者明確要求、端點與授權已確認、健康檢查成功，並取得任務讀回後，才可把 adapter 狀態提升為 `loopback_verified`。A2A 預設關閉，沒有憑證、Telegram、雲端、裝置或外部寫入能力。

## 任務契約

協調器只做以下事情：

1. 執行本地技能與 Hermes 契約預檢。
2. 在已批准的範圍內收集、比較與標註證據來源、時間、有效期限和阻塞原因。
3. 若真正的 Hermes adapter 已獲明確啟用，最多分派 3 個獨立子任務，深度最多 1；不再建立 Codex 子代理。
4. 回傳 `status`、`summary`、`next_actions`、`artifacts`，以及 `run_id`、`evidence_refs`、`provenance`、`adapter_status`、`mutation_applied=false`、`external_mutations=false`、`credentials_accessed=false`、`network_requests`。

若 adapter 仍是 `contract_only_not_live`，必須回傳 warning 並說明缺少的證據，不得捏造 Hermes 結果。主要 Codex 代理保留所有編輯、整合與最終驗證權限。

## 預檢

```powershell
pwsh -NoProfile -File .\scripts\Invoke-HermesResearchPreflight.ps1
```

預設不讀取外部 Hermes 設定、不呼叫網路、不執行任務。若要在已授權情況下做 loopback health probe，才額外提供明確的 `HERMES_HOME` 並加上 `-ProbeLoopback`；probe 失敗會維持 contract-only，不會重試或自動切換路由。

相關安全規則與能力白名單見 `AGENTS.md`、`config/skill-registry.yaml`、`config/capabilities.yaml` 和 `docs/architecture/agent-layers.md`。
