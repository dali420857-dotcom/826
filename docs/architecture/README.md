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

## 圖譜索引

- `graphs/system-context.mmd`：系統邊界與外部依賴
- `graphs/control-plane.mmd`：請求到能力執行與回退的流程
- `graphs/data-flow.mmd`：資料與證據如何穿過邊界
- `graphs/state-machine.mmd`：連線、執行、隔離與恢復狀態
- `graphs/fallback-decision.mmd`：失敗分類與決策路徑
- `docs/architecture/agent-layers.md`：代理 12 層風險對應

## 分層規則

1. `src/core` 保持業務語意，不依賴特定供應商。
2. `src/adapters` 只處理端點、認證、序列化、逾時與供應商錯誤映射。
3. `agent-control` 只負責能力選擇、權限、批准、冪等、快照、回退與輸出封裝。
4. 所有外部變更都要有新鮮讀回，沒有證據就停止。
5. 快取只能支援唯讀降級，不得在陳舊資料上做變更。
