# 初始化基線驗收

## 必須通過

- [ ] `config/project-baseline.yaml` 指向所有必要契約與圖譜
- [ ] `config/skill-registry.yaml` 記錄已安裝技能與已暴露的 task-matched 路線；provider 倉庫仍須明確範圍與授權
- [ ] 每個任務可執行 `scripts/Invoke-SkillPreflight.ps1`，只做本地唯讀技能索引並輸出固定 response envelope
- [ ] 每個任務在技能預檢成功後都先執行 `ask-matt`，再進入其他技能路由
- [ ] 每個任務在 `ask-matt` 後都執行 `using-agent-skills`，再選取當次代理工程技能
- [ ] `.agents/skills/` 與 `skills-lock.json` 的技能數量和來源雜湊一致
- [ ] `npx skills list --json -a codex` 顯示全部專案技能對 Codex 可發現
- [ ] `.codex/config.toml` 可由 `codex mcp list` 載入，且不含內嵌憑證
- [ ] Codex V2 已註冊 `hermes_research_coordinator` 唯讀角色；每個任務同時執行 Hermes contract preflight
- [ ] Hermes adapter 預設為 `contract_only_not_live`、A2A 關閉、最多 3 個子任務／深度 1，未經端點與讀回驗證不得委派
- [ ] Headroom 已安裝但不自動啟動 proxy、wrap 或改寫路由
- [ ] `config/knowledge-graph.yaml` 指向 Graphify 設定與產物
- [ ] `graphify-out/graph.json`、`GRAPH_REPORT.md` 與 `graph.html` 已生成並可由 Git 追蹤
- [ ] 預設 AST extraction 不需要模型或網路；語意 extraction 只有明確 `-Semantic` 才啟用
- [ ] 語意 extraction 使用本機 backend，沒有未申報的雲端 API key
- [ ] `safe-default` 為啟用設定
- [ ] 預設 bind host 為 `127.0.0.1`
- [ ] repository 不含真實 token、密碼、私鑰或端點憑證
- [ ] 每項能力都有 classification、mutating、inputs、readback 與 approval
- [ ] 每條回退策略都有 trigger、retry、stop_condition、recovery 與 audit_event
- [ ] Mermaid 圖譜包含輸入、核心、外部依賴、證據與回退路徑
- [ ] 快照與回滾規則已定義
- [ ] 工具回應 envelope 包含 `status`、`summary`、`next_actions`、`artifacts`

## 驗證指令

```powershell
pwsh -NoProfile -File .\scripts\Verify-Baseline.ps1
pwsh -NoProfile -File .\scripts\Invoke-HermesResearchPreflight.ps1
pwsh -NoProfile -File .\scripts\Update-KnowledgeGraph.ps1
codex mcp list
headroom doctor
```

Headroom 在尚未明確啟動 proxy 時會回報 `proxy not reachable`（目前是預期狀態），這只代表路由尚未啟用，不代表套件安裝失敗。

此驗收只證明初始化基線完整，不代表任何真實裝置或雲端連線已成功。
