# Project Instructions

## DALI 控台前端退役邊界（2026-08-17）

- `index.html` → `src/main.ts` → `src/App.vue` 以及 `/index` 對應的 `src/views/ProductHomeView.vue` 是 `retired/disabled` 的歷史前端，不是新的產品 UI 入口。
- 目前瀏覽器看到的 `http://127.0.0.1:5173/#/index` 只作本機證據與既有契約測試；後續代理不得以它為基礎新增頁面、重接導航或擴充功能。
- 尚未選定替代前端；任何重新啟用、移除路由或刪除檔案都要先取得使用者明確指定的範圍。

## 架構邊界

- 核心業務邏輯放在 `src/core`；裝置與雲端差異放在 `src/adapters`。
- 代理控制面只能透過明確能力契約呼叫核心服務，不得複製業務邏輯。
- 不以任意 shell、任意 SQL、任意檔案寫入或座標點擊作為主要控制能力。
- 任何新增能力都要同步更新 `config/capabilities.yaml`、相關圖譜與驗證案例。

## 權限與變更

- 預設使用 `safe-default`；觀察與診斷可用，變更與管理恢復需明確批准。
- 變更能力應支援 dry-run、冪等鍵、驗證、快照與回滾（若適用）。
- 預設只綁定 `127.0.0.1`。不得把憑證、token、密碼、私鑰或個人資料提交到 repository。
- 外部網路、真實裝置與雲端操作必須有健康檢查、讀回證據與停止條件。

## 回退與觀測

- 每條錯誤路徑都要記錄根因提示、安全重試方式與明確停止條件。
- 不得加入未申報的第二次模型呼叫、隱藏修復迴圈或靜默輸出改寫。
- 工具回應採固定結構：`status`、`summary`、`next_actions`、`artifacts`。
- 任何狀態、記憶或快取都要帶來源、時間與有效期限，過期資料不得當成即時證據。

## 第三方技能與可選路線

- 已安裝的第三方技能只放在 `.agents/skills/`，來源與雜湊以 `skills-lock.json` 鎖定；使用前先閱讀對應 `SKILL.md`，不得把技能視為可信任程式碼。
- 每個任務開始時都先執行 `pwsh -NoProfile -File .\scripts\Invoke-SkillPreflight.ps1`；它只讀取本地 `.agents/skills/`、`skills-lock.json` 與技能 frontmatter，建立完整技能索引，不發出網路請求或外部變更。
- `.agents/skills/` 下的全部專案技能都暴露給專案代理與其角色；預檢後由代理自動選取與任務匹配的 `SKILL.md`，不把所有技能腳本逐一執行或塞入每次提示。
- 預檢成功後，所有專案任務都必須依序執行 `ask-matt`，再執行 `using-agent-skills` 代理工程技能路由，從本地技能索引選取當次適用的工程技能，然後才能開始其他工作；不得因任務看似簡單而跳過。
- `config/skill-registry.yaml` 中 `exposed_via_installed_skills` 的路線是已暴露的能力路由，使用已鎖定技能組合；這不代表 provider 倉庫、SDK、憑證、登入狀態或真實外部權限已安裝。
- 若要新增具體 provider／第三方倉庫，仍須有明確任務、目標範圍、來源／授權與依賴安全審查；不得因路線已暴露而自動下載或啟用外部服務。
- Firecrawl、MCP 外部服務、真實裝置／雲端／Telegram 與任何寫入操作都必須通過明確批准、健康檢查、讀回和停止條件；自動預檢不得繞過這些閘門。
- Web 抓取、克隆與滲透測試必須保留來源／授權證據；滲透測試僅限自有或明確書面授權目標，預設使用本機或 staging。
- Android 群控、雲手機與 Telegram 控制必須先鎖定裝置／帳號／聊天範圍，具備最小權限、速率限制、讀回、稽核與停止條件。
- Headroom 只作為 opt-in 上下文壓縮層；未經明確任務要求，不得執行 `headroom wrap`、啟動 proxy 或改寫 Codex 路由。
- Hermes 研究協調器是 Codex V2 的唯讀自訂代理角色，不等同於已連線的 Hermes runtime；每次任務先執行 `scripts/Invoke-HermesResearchPreflight.ps1`，只有 loopback 端點、授權、範圍與讀回都明確驗證後，才可考慮啟用可選 adapter。
- Hermes 協調只允許證據整理、診斷與受控讀取；最多 3 個子任務、深度 1，不得再生 Codex 代理、寫檔、讀取憑證、操作 Telegram／裝置／雲端，或執行未申報的重試與第二次模型呼叫。

## 驗證

- 修改後先執行 `pwsh -NoProfile -File .\scripts\Verify-Baseline.ps1`。
- 新增 runtime 後再補 build、typecheck、lint、test 與安全掃描，未通過不得宣告完成。
- 保留工作區既有變更，不使用破壞性 reset 或 checkout 覆蓋使用者資料。
