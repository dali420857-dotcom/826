# 代理 12 層基線

此表把代理架構審查框架固定成專案設計規則，避免 prompt、記憶、工具與輸出層各自暗中改寫結果。

| 層                      | 本專案控制點                                      |
| ----------------------- | ------------------------------------------------- |
| 1. System prompt        | 只放穩定不變的規則；長文件放到可追蹤檔案          |
| 2. Session history      | 每次請求以 correlation id 分界，避免跨任務串入    |
| 3. Long-term memory     | 只有明確來源、期限與審核狀態的資料可入庫          |
| 4. Distillation         | 不把代理自述當成事實；保留來源與時間              |
| 5. Active recall        | 只載入與目前 capability/resource scope 相關的內容 |
| 6. Tool selection       | 以 `config/capabilities.yaml` 做白名單            |
| 7. Tool execution       | 在程式碼中驗證 schema、權限、逾時與冪等           |
| 8. Tool interpretation  | 所有工具結果需有固定 envelope 與 readback 狀態    |
| 9. Answer shaping       | 不靜默改寫工具結果；錯誤維持可追蹤                |
| 10. Platform rendering  | 對外輸出與內部 envelope 分離，保留原始狀態        |
| 11. Hidden repair loops | 禁止未申報的第二次模型呼叫或自動修復              |
| 12. Persistence         | 快取、快照與記憶帶 TTL、來源、版本與失效狀態      |

任何新增 wrapper、memory、retry 或 output transform 都必須更新本表與回退契約。

## Hermes 協調器邊界

`hermes_research_coordinator` 位於工具選擇與工具執行之間，只有在本地預檢、任務範圍、授權與讀回條件都成立時，才可把唯讀證據工作交給可選 Hermes adapter。它不可寫入專案或外部系統，不可攜帶憑證，不可建立第二層 Codex 代理；內部分派上限為 3 個子任務、深度 1。未驗證 runtime 時只產生 `contract_only_not_live` 的 warning 回執。
