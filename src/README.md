<!--
  RETIREMENT MARKER — retired/disabled 2026-08-17.
  The Vue/Vite DALI console in this directory is a historical local UI only.
  Keep it for evidence and contract tests; do not treat it as a product UI
  implementation or add new routes/components here without explicit approval.
-->

# Source layout (historical frontend)

## Retirement boundary

The browser page at `http://127.0.0.1:5173/#/index` is wired through
`index.html` → `src/main.ts` → `src/App.vue` →
`src/views/ProductHomeView.vue`. That surface is `retired/disabled`; no
replacement frontend has been selected. Existing source and tests remain only
for local evidence and contract readback.

目前 runtime 是 Vue + Vite，並以本地 MSW fixture 驗證首個唯讀能力。預留以下邊界：

- `src/core/`：與供應商無關的核心服務、狀態機與資料驗證
- `src/adapters/`：裝置／雲端適配器與錯誤映射
- `src/agent-control/`：能力註冊、政策、批准、冪等、回退與輸出 envelope

首個能力是 `inspect_fraud_overview`：`src/agent-control/capabilities.ts` 只接受受 Zod 驗證的 scenario，呼叫 `src/core/fraud/service.ts`，再由 `src/adapters/local-api.ts` 讀取同源 MSW fixture。它不會呼叫原站，也不會產生外部寫入。

新增實作前，先在 `config/` 與 `graphs/` 註冊其能力、依賴與失敗路徑。
