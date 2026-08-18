# 826 Device and Cloud Control

這是裝置與雲端控制專案的初始化基線。此階段先固定架構邊界、能力契約、圖譜、回退策略與驗證方式，再接入實際裝置、雲端供應商或代理模型。

## 目前狀態

- 生命週期：`initialization`
- 啟用設定：`safe-default`
- 連線策略：本機優先，預設只綁定 `127.0.0.1`
- 真實裝置／雲端連線：尚未接入
- Hermes：已註冊 Codex V2 唯讀研究協調角色；live runtime 仍未啟用
- 憑證：不存放於此專案

## 目錄

| 路徑               | 用途                                         |
| ------------------ | -------------------------------------------- |
| `config/`          | 機器可讀的基線、能力、連接器、儲存與回退設定 |
| `.codex/`          | ECC 專案級 MCP、Codex V2 角色與 Graphify 設定 |
| `.agents/skills/`  | 已鎖定、專案級 Codex 技能；先走 `ask-matt` 與 `using-agent-skills` 再按任務匹配 |
| `skills-lock.json` | 第三方技能來源與內容雜湊鎖定                 |
| `graphs/`          | Mermaid 架構、資料流、狀態與失敗回退圖       |
| `graphify-out/`    | Graphify 產生的全專案知識圖譜、報告與可視化  |
| `docs/`            | 架構說明、操作手冊與驗收標準                 |
| `schemas/`         | 能力與回退契約的 JSON Schema                 |
| `scripts/`         | 本機驗證與後續初始化工具                     |
| `src/`             | 核心服務與適配器的預留位置                   |
| `runtime/`         | 僅供執行期狀態使用，不應提交狀態資料         |
| `tests/`           | 基線與後續功能測試                           |
| `docs/skills/`     | 已安裝技能與候選技能路線說明                 |

## 驗證

在 PowerShell 執行：

```powershell
pwsh -NoProfile -File .\scripts\Verify-Baseline.ps1
```

驗證腳本會檢查必要檔案、設定標記、圖譜格式、回退契約欄位，以及常見憑證誤放情況。

## 全知識圖譜

本專案使用 Graphify 將程式碼、設定、文件、Mermaid 圖與契約建立成可查詢的專案圖譜。專案級 Codex skill 位於 `.codex/skills/graphify/`，圖譜設定位於 `config/knowledge-graph.yaml`。

```powershell
pwsh -NoProfile -File .\scripts\Update-KnowledgeGraph.ps1
graphify query "What are the mutation capabilities and their fallback paths?"
graphify god-nodes
```

預設命令使用 Graphify 的 deterministic code-only AST，不需要模型或網路，確保 Git hook 能穩定更新。要補做文件語意抽取時才明確執行：

```powershell
pwsh -NoProfile -File .\scripts\Update-KnowledgeGraph.ps1 -Semantic
```

語意模式使用本機 Ollama `qwen3:4b-no-think`；若本機模型失敗，腳本會保留失敗訊息並自動退回 code-only 圖，不會把失敗宣告成完整語意圖譜。`graphify-out/` 的三個主要產物會納入 Git，讓每次初始化或更新都有可回溯版本。

Graphify 的 Git hook 可用以下指令安裝：

```powershell
graphify hook install
graphify hook status
```

## 技能路線

已直接安裝 ECC 工程技能、Headroom、Matt Pocock 技能與 Anthropic 技能。每個任務先自動執行本地唯讀技能預檢與 Hermes contract preflight，預檢成功後必須依序執行 `ask-matt` 與 `using-agent-skills` 代理工程路由，再由代理選取當次適用技能；網頁抓取／克隆、網頁安全測試、Android 雲控／群控、雲手機虛擬化、Telegram 控制等路線也已暴露為安全能力路由，但具體 provider 倉庫、憑證、登入與真實外部操作仍須另行明確授權。Hermes 角色只做證據協調，預設 `contract_only_not_live`，不代表已有 live Hermes 任務連線。

## 設定檔

目前啟用設定位於 `config/project-baseline.yaml` 的 `profiles.active`。可用設定：

- `config/profiles/safe-default.yaml`：唯讀優先、最小權限、可停止、可回滾
- `config/profiles/rapid-prototype.yaml`：僅供隔離開發環境，仍需顯式環境變數才能放寬邊界

設定檔只描述行為與邊界，不包含任何 token、密碼、私鑰或真實端點憑證。

## 下一階段

1. 確認第一批裝置與雲端目標。
2. 依 `config/capabilities.yaml` 實作核心服務與適配器。
3. 為每個真實連接器補上健康檢查、讀回、快照與回滾測試。
4. 在改動圖譜後重新執行基線驗證與功能測試。
