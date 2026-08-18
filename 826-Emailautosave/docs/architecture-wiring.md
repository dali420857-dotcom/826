# 本地 no-send 接線（前端已淘汰）

## 淘汰狀態

- `production/frontend/EmailAutomationConsole.vue` 於 2026-08-17 標記為 `retired/disabled`，不再是 DALI 控台的產品 UI。
- DALI 控台的 `/email_automation` 路由與導航入口已移除；本文件描述的是保留契約與歷史選型，不是重新接回 UI 的授權。
- 目前沒有已選定的替代電郵 UI；任何新 UI 必須先取得使用者明確確認目標檔案與接線範圍。

## 證據與選擇

- 參照版本：`reference-mail-control-panel-head-c3e1e80-20260528`，`package.json` 版本 `0.1.0`。
- 參照文件與測試共同指向目前最完整的鏈路：`Node/CLI` 業務服務 → `MailspringAdapter` → `private transport` → 插件 `send-operations`。
- `mailspring-adapter-private-transport.test.ts` 覆蓋發送、草稿、取消與 no-HTTP 路由；`mailspring-plugin-send-operations*.test.ts` 覆蓋插件端發送結果。這些是歷史選型證據，不是本項目 runtime-ready 證據。

## Retained backend seam

`EmailAutomationService` 是保留的後端契約實作，目前沒有被 DALI 控台 UI 暴露。若日後重新設計 UI，UI 只能建立草稿、審閱、批准、入隊與讀取快照；它不能直接呼叫 adapter。

`MailAdapter` 是發送 seam：

- `FakeMailAdapter` 是目前唯一啟用 adapter，只回傳合成回執。
- 真實 Mailspring adapter 留在 approval gate 外；未來若獲授權，方法映射維持 `mailspring.initial.dispatch`，並需獨立的 private-transport integration test。

歷史 no-send 流程：`UI → local service → approval gate → in-memory queue → send command → FakeMailAdapter → audit/readback`。這條流程目前不代表有產品 UI 入口。

## 本階段完成條件

- 未批准草稿不能入隊；批准後才能執行 fake command。
- 收件對象只使用安全占位 ID，不保存地址或正文秘密。
- 成功、失敗、隊列狀態與每個狀態轉換都有本地 audit readback。
- unit、integration、build 與保留契約測試可獨立驗證；真實 Mailspring、OAuth、provider、發信及任何替代 UI 保持未驗證。
