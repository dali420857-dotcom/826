# 技能與倉庫目錄

這個專案把「現在可用」與「可能會用到」分開管理：

- `config/skill-registry.yaml`：安裝狀態、能力分類、啟用條件與安全邊界。
- `.agents/skills/`：已安裝、專案級 Codex 技能；每個任務依序走強制的 `ask-matt` 與 `using-agent-skills` 路由，再選取其他明確匹配的技能。
- `skills-lock.json`：來源與內容雜湊鎖定，更新後要重新驗證。
- `.codex/config.toml`：ECC 專案級 MCP 與唯讀／工作區設定；只引用環境憑證，不保存密鑰。
- `docs/agents/hermes-research-coordinator.md`：Codex V2 的 Hermes 唯讀研究協調器契約與 runtime 邊界。

目前暴露規則是：每個任務先自動執行本地唯讀技能預檢，索引 `.agents/skills/` 下的全部技能；預檢成功後必須依序執行 `ask-matt` 與 `using-agent-skills`，再由代理匹配相關 `SKILL.md`。技能索引可用不等於 provider 倉庫、登入權限或真實外部操作已啟用。

## 每任務自動預檢

預檢不下載套件、不呼叫網路、不執行技能內腳本，也不觸發外部變更；它只驗證技能目錄、lockfile、frontmatter 並輸出固定的 `status`、`summary`、`next_actions`、`artifacts` 結構：

```powershell
pwsh -NoProfile -File .\scripts\Invoke-SkillPreflight.ps1
```

預檢通過後，代理先執行 `ask-matt`，再執行 `using-agent-skills` 選擇與任務匹配的工程技能。MCP、Firecrawl、真實裝置／雲端／Telegram 和任何寫入操作仍由批准、健康檢查、讀回與停止條件控制。

## Codex V2 Hermes 角色

`hermes_research_coordinator` 已對所有專案代理註冊，專門處理證據整理、來源查核與唯讀診斷。它是 Codex 自訂角色，不是已連線的 Hermes runtime；目前 `adapter_status` 固定為 `contract_only_not_live`，A2A 與外部變更預設關閉。每個任務會先執行 `Invoke-HermesResearchPreflight.ps1`，並要求固定 envelope、來源與讀回證據。

## 已直接安裝

| 來源                                                                  | 用途                                   | 狀態                                 |
| --------------------------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| [Graphify](https://github.com/Graphify-Labs/graphify)                 | 全專案 AST／文件知識圖譜與 Git hook    | `graphifyy 0.9.44`；預設 code-only   |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 工程生命週期、測試、安全、瀏覽器與觀測 | 已安裝到 `.agents/skills`            |
| [headroom](https://github.com/headroomlabs-ai/headroom)               | 本機優先的上下文壓縮／代理層           | `headroom-ai 0.35.0`；只在需要時啟動 |
| [mattpocock/skills](https://github.com/mattpocock/skills)             | 可組合的工程、除錯、TDD、架構技能      | 已安裝到 `.agents/skills`            |
| [anthropics/skills](https://github.com/anthropics/skills)             | Web 測試、MCP、技能範本與文件工作流    | 已安裝到 `.agents/skills`            |

Headroom 已安裝但不會自動執行 `headroom wrap` 或 `headroom proxy`，避免未經確認改變 Codex 路由或啟動常駐服務。使用前先執行：

```powershell
headroom doctor
```

## 已暴露但尚未選定 provider 的路線

以下路線已對所有專案代理暴露為 task-matched route，使用現有已鎖定技能；底層 provider 倉庫仍未選定，只有在具體任務、目標範圍與授權條件明確後才可引入：

1. 網頁複製、抓取、克隆與來源保全。
2. 網頁應用安全測試、滲透測試、瀏覽器測試與 fuzzing。
3. 雲控、Android 手機群控、裝置農場與 ADB 編排。
4. 雲手機、Android 虛擬化、模擬器與遠控基礎設施。
5. Telegram Bot、群組／頻道管理、自動化行銷、自訂客戶端與 MTProto。

對應路由 ID 與技能組合記錄在 `config/skill-registry.yaml` 和 `config/capabilities.yaml`。這些路線不是授權本身：安全測試只對自有或明確書面授權的目標；Telegram 自動化必須遵守帳號、聊天、速率、反濫用與讀回稽核邊界。

## 更新與驗證

```powershell
npx skills list --json -a codex
npx skills update -p
pwsh -NoProfile -File .\scripts\Verify-Baseline.ps1
pwsh -NoProfile -File .\scripts\Update-KnowledgeGraph.ps1
```

更新第三方技能後，先閱讀變更與 `skills-lock.json` 差異，再讓技能參與實作；不要把任何 token、session、私鑰或外部服務憑證放入技能目錄或 lockfile。
