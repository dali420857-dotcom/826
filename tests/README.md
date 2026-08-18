# Tests

初始化階段先由 `scripts/Verify-Baseline.ps1` 驗證契約與圖譜完整性。接入 runtime 後，需增加：

- 能力白名單與權限測試
- 回退策略與停止條件測試
- 快照／回滾與讀回測試
- 連接器健康檢查與錯誤映射測試
- 敏感資料遮罩與輸出 envelope 測試

目前本地 web surface 的驗證案例：

- `tests/fraud-contract.test.ts`：fresh、empty、fallback、permission-denied 與 timeout 的 MSW contract。
- `tests/fraud-view.test.ts`：`/preventing_fraud` 的 loading 後成功、空資料、拒絕與回退呈現。
- `e2e/local-frontend.spec.ts`：Chromium 在 loopback dev server 上驗證全路由、四種 viewport、audit、dry-run 與安全停止訊息。
