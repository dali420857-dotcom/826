# 全量前端本地 mock contract

## Endpoint

`GET /api/preventing-fraud/overview?scenario=<scenario>`

其他頁面使用：

`GET /api/mock/pages/<pageId>?scenario=<scenario>`

這些是同源 MSW handlers，只存在於本地開發與測試流程。它們不會向 `konk.cc`、任何登入 session、Telegram 帳號或付款服務發送請求。

## Response envelope

每個 response 都有固定欄位；`error` 僅在錯誤回應中出現，成功回應不填入 `error: null`：

```json
{
  "status": "success | warning | error",
  "summary": "human-readable summary",
  "next_actions": ["safe next step"],
  "artifacts": { "source": "local-fixture" },
  "audit": {
    "event_id": "audit-success",
    "timestamp": "2026-08-15T18:00:05.000Z",
    "actor": "local-user",
    "capability": "inspect_fraud_overview",
    "resource_scope": "local-fixture",
    "decision": "allowed"
  },
  "data": null
}
```

`data` 通過 Zod schema 後才進入 UI；第三方或 transport payload 不可直接渲染。錯誤狀態使用相同 envelope，`error.code` 只允許 `PERMISSION_DENIED`、`PROVIDER_ERROR`、`TIMEOUT`、`INVALID_DATA`、`SAFE_STOP`。

## Fixture scenarios

- `success`：fresh signals 與 allowed audit。
- `empty`：合法空資料，不把空集合當成 transport error。
- `error`：HTTP 500，UI safe-stop 並保留 audit。
- `permission-denied`：HTTP 403，UI 顯示拒絕原因且不提供 retry。
- `timeout`：handler 延遲超過 750ms client budget，UI 顯示 timeout。
- `fallback`：warning + stale `local-cache`，`mutations_allowed` 永遠是 `false`。

## Demo session

前端 Pinia store 在記憶體中建立本地 demo session；只允許 `operator`、`viewer`、`reviewer` 三種 role。此階段不另外呼叫 session endpoint，session 不寫入 localStorage，不含 token、cookie 或個人資料。

## Local dry-run receipt

需要變更的前端操作不呼叫外部 API，改由本地 capability function 產生 receipt：

```json
{
  "dry_run": true,
  "mutation_applied": false,
  "readback": "local-simulation"
}
```

所有 scenario 都是觀察或本地 dry-run 能力，沒有真實外部狀態，也沒有 idempotency side effect。
