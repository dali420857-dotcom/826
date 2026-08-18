# Multi-Agent V2 Orchestration: Dali Outreach

## Parent ownership

Parent 獨占 source baseline、shared contracts、composition root、package lock、授權、整合、capabilities/graph 與最終驗收。Worker 需要改 shared contract 時必須停止並提交 change request。

## Dependency graph

```text
DA-000 Source baseline
  → { DA-001 Shared contract freeze, DA-001S Security invariants }
    → DA-002 Production/test harness
      → { DA-003 Shared store, DA-004 Bridge, DA-005 Shell }
      → DA-003 → { DA-006 Email backend, DA-007 Telegram backend }
      → DA-004 + DA-005 + DA-006 → DA-008 Email E2E
      → DA-004 + DA-005 + DA-007 → DA-009 Telegram E2E
      → DA-008 + DA-009 → DA-010 Shared composition
      → DA-011 Independent review
      → DA-012 Migration/rollback closeout
```

## Waves

| Wave | Parallel owners | Gate |
| --- | --- | --- |
| 0 | Parent: DA-000/001/001S/002 | source、contracts、threat model、package strategy frozen |
| 1 | Shared backend、Bridge、Shell | DA-002 complete；unique files |
| 2 | Email backend、Telegram backend | DA-003 complete |
| 3 | Email E2E、Telegram E2E | Bridge+Shell+matching backend complete |
| 4 | Single composition owner | Both E2E lanes pass |
| 5 | Reviewer role | Composition complete；read-only first |
| 6 | Parent closeout | All findings resolved |

每個 worker prompt 必含 ownership、不是獨占工作區、不得回退他人變更、shared contract read-only、include/exclude、no-provider/no-secret/no-live、acceptance、verification、stop conditions。

## Shared-file exclusions

Workers 不得同時修改 contracts、composition root、route registry、package lock、capabilities、graph、ADR 或 migration manifest。Reviewer 發現問題後退回原 owner，不直接跨 lane 修復。

## Status

`multi_agent_v2` 已啟用；目前只完成唯讀規劃 lanes。Production agents 要等 ticket 粒度核准、DA-001 contract 與 DA-002 package strategy 凍結後才啟動。
