# 無人值守 Git 全流程研究與補缺口方案

- **狀態：** `partial`
- **目的：** 記錄每日定時完成變更、驗證、提交、PR、CI、合併與清理的可行架構，以及目前實作缺口。
- **權威來源：** [GitHub Actions 自動化契約](github-actions-automation-contract.md)、[排程 workflow](../../.github/workflows/automation.yml)、[品質 workflow](../../.github/workflows/quality.yml) 與 [同步入口](../../scripts/ci/sync.mjs)。本文件是研究與實作方案，不代表 GitHub 設定或本機排程已完成。
- **最後核對：** 2026-08-24；GitHub 與 Microsoft 官方文件、目前本機 source readback。

## 摘要

目前已改為一個 Windows Task Scheduler 協調器依序處理四個 Git repository；每個 repository 使用獨立 lock、receipt 與外部 worktree root。原本 826 GitHub workflow 的 cron 已移除，只保留手動 dispatch，避免本機與 GitHub 同一時段重複執行。

GitHub-hosted runner 也無法看見使用者電腦上尚未提交或推送的工作。若自動化目標包含本機工作樹，建議採混合模式：Windows 排程器與受限本機 orchestrator 負責建立安全的 automation branch；GitHub 負責 PR、CI、auto-merge 與遠端分支清理。

本研究不授權安裝排程、修改 GitHub 設定、提交、推送、建立 PR、合併、刪除分支或發送通知。

## 目前缺口

| 缺口                        | 目前證據                                                                        | 影響                                              | 補法                                                                              |
| --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| 沒有變更來源                | `sync.mjs --sync` 只 fetch 與 fast-forward，不產生檔案                          | 乾淨 runner 得到 `changed=false`                  | 新增 deterministic generator，或由受限本機 orchestrator 匯入 allowlist 變更       |
| 看不到本機 dirty work       | GitHub-hosted runner 使用遠端 checkout                                          | 本機新工作不會進入 commit                         | 使用 Windows 排程器啟動本機入口，再把變更送到獨立暫時 worktree                    |
| `GITHUB_TOKEN` 下游觸發限制 | GitHub 對 token 產生的事件有遞迴防護；自動建立或更新的 PR workflow 可能需要批准 | 無法保證完全無人值守                              | 使用 GitHub App installation token／適用 PAT，或明確 dispatch quality workflow    |
| 合併後清理未完整            | workflow 建立 `automation/*` branch，但未明確刪除；目前沒有額外本機 worktree    | 遠端 branch 或未來本機暫時 worktree 可能殘留      | 開啟 GitHub auto-delete，並以 exact branch/worktree receipt 做 post-merge cleanup |
| 排程不是精確即時保證        | GitHub schedule 是 best effort，只在 default branch 生效                        | 高負載時可能延遲                                  | 接受延遲；若必須由本機定時啟動，使用 Task Scheduler 的補跑、喚醒、網路與單例設定  |
| 工作樹 ownership 未隔離     | 目前本機 repo 有大量 staged、unstaged 與 untracked 工作                         | 全量 `git add` 可能提交秘密、產物或其他工作的內容 | 固定 allowlist、拒絕未知檔案、秘密掃描、在暫時 worktree 驗證後才提交              |

## 建議架構：混合模式

```text
Windows Task Scheduler
  -> acquire single-run lock
  -> preflight repo, auth, network and remote
  -> classify local changes against an explicit allowlist
  -> reject unknown paths, secrets, conflicts and ambiguous ownership
  -> create a temporary worktree from origin/main
  -> copy or apply only the approved change set
  -> run formatting, tests, build and secret gates
  -> commit to automation/YYYYMMDD-HHMM
  -> push the exact branch
  -> create or update one PR
  -> start and read back required GitHub checks
  -> enable auto-merge
  -> wait for a terminal merge result
  -> delete the exact remote branch
  -> remove the exact temporary worktree and local branch
  -> prune stale worktree metadata
  -> send a masked result notification
```

### 本機安全入口

目前已建立以下 surfaces；fleet 與四個 child config 已啟用，但尚未執行真實 GitHub push／PR／merge：

- `config/git-automation.json`：四倉 fleet catalog；固定順序為 Dali-Automation、826、826-Emailautosave、826-Telegram。
- `config/git-automation/*.json`：各倉 repository root、base branch、允許／排除路徑、獨立 worktree／receipt root、required checks 與 timeout。
- `scripts/git-automation/daily-git-automation.mjs`：核心 orchestrator，負責一致快照、臨時 worktree、provider gate、commit、PR、CI、merge readback 與 finally cleanup。
- `scripts/git-automation/Invoke-DailyGitAutomation.ps1`：Windows 與 Task Scheduler 使用的薄入口。
- `scripts/git-automation/Register-DailyGitAutomationTask.ps1`：預設只輸出排程 plan；只有顯式 `-Register` 才建立或更新 Windows 排程，且不保存 token。
- `tests/git-automation.test.ts`：使用暫存 repository、bare remote 與 fake `gh` 驗證完整流程、錯誤停止和清理。

變更集合必須相對目前 `HEAD` 建立，tracked 檔案只接受 allowlist pathspec；untracked 檔案必須同時匹配 allowlist 且通過秘密與禁止副檔名檢查。未知 staged、unstaged 或 untracked 路徑一律停止，不自行 stash、reset、checkout 或 clean 原始工作樹。

暫時 worktree 應放在 repository 外的固定 automation root。每次建立 receipt，記錄 run ID、base SHA、branch、絕對 worktree 路徑與允許檔案清單。清理只接受同一 receipt 的精確值，不使用 wildcard 刪除。

核心入口不會對主要工作區執行 `git add`、`commit`、`switch`、`checkout`、`reset`、`clean`、`pull` 或 `merge`。它只讀取主要工作區，fetch 最新 remote tracking ref，並把經過前後 hash 核對的 allowlist snapshot 套用到外部臨時 worktree。來源在穩定窗口或複製期間改變時，本輪停止並留待下一次排程。

單例 lock 位於外部 receipt root。取得 lock 後、副作用前會以 exclusive create 建立 `<run-id>.active.json`；既有 active 或 final receipt 都會阻擋同 run ID 重送。active receipt 在 push/PR 副作用前後更新 branch、commit、PR 與 phase，供 crash 後 reconciliation。正常完成、CI 失敗或 provider gate 阻擋時，`finally` 都會移除本機 worktree 與本機 automation branch；只有 final receipt 寫入成功才移除 active marker。程序崩潰留下的 lock 只有在超過 TTL、原 PID 已不存在，而且 lock 內容前後一致時才可回收。

失敗後保留的遠端 branch 只依 exact blocked/active receipt 做 48 小時 TTL reconciliation：已有 PR 時，remote OID、PR `headRefOid`、head/base 與 receipt commit 必須全部一致且 PR 已合併；crash 發生在 PR 建立前時，必須確認該 branch OID 等於 receipt commit 且 provider 查不到任何 PR，才會刪除該精確 branch。open/unmerged PR、force-push/ref mismatch、auth/network unknown 一律保留並阻擋本輪。active journal 使用 atomic replace 並保留 previous fallback。repository 內的 config 在 `--execute` 前必須與最新 remote base blob byte-for-byte 相同；repository 外 config 才視為 caller-owned trusted input。snapshot 同時保存內容 hash 與 Git `100644`/`100755` mode。

Windows 註冊器固定 absolute `pwsh`、Node、Git 與 GitHub CLI 路徑，並把對應目錄注入 task action 的 PATH；它會解析並驗證全部 child config／Git root。缺任一 executable、主機不是 `Pacific Standard Time`、任一 repository 的 GitHub schedule 仍啟用或選擇未驗證的 S4U 時，註冊前即 blocked。註冊後必須讀回 action、arguments、logon type、network/wake/instance/timeout 設定。

### GitHub 合併入口

1. 使用 GitHub App installation token；若暫時使用 fine-grained PAT，權限只給目標 repository 所需的 contents、pull requests、actions 與 checks。
2. 建立 PR 後，明確 dispatch `quality.yml` 到 automation branch，並保存回傳的 run ID。
3. 只接受各 repository 設定中列出的 required checks 成功；826 parent repository 目前只要求穩定的 `quality / root`，已拆出的 Outreach 由獨立 child repository 自行驗證。
4. 呼叫 auto-merge 後輪詢 PR，直到 `MERGED`、明確失敗或 timeout；timeout 視為 `unknown`，先 reconciliation，不重複建立 PR 或 merge。
5. 讀回 `mergedAt` 與 merge commit，再刪除精確的 automation branch。Repository 可另開啟 **Automatically delete head branches** 作第一層清理。

## 雲端 generator 替代方案

如果未來要自動提交的內容完全由 GitHub runner 產生，可以保留純 GitHub Actions 架構：

```text
schedule
  -> deterministic generator
  -> allowlist and secret gate
  -> create/update pull request
  -> explicit quality dispatch
  -> required checks
  -> native auto-merge
  -> branch deletion and readback
```

這條路可使用 [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request) 取代部分手寫 branch、commit 與 PR 邏輯。它適合接在會修改檔案的 generator 後方，支援 `add-paths`；它不能取得使用者電腦上的 dirty work。`delete-branch` 不保證合併後立即刪除，仍需 GitHub auto-delete 或明確 cleanup。

## 排程設定

唯一排程來源是 Windows Task Scheduler，使用主機 `Pacific Standard Time` 的 `01:00`、`10:30` 與 `16:30`。GitHub workflows 不得再設定 `schedule`，只保留 orchestration 需要的 `workflow_dispatch`。

本機 Task Scheduler 建議使用：

- `StartWhenAvailable`：錯過時段後補跑。
- `WakeToRun`：允許喚醒電腦。
- `RunOnlyIfNetworkAvailable`：只在有網路時啟動。
- `MultipleInstances = IgnoreNew`：同一時間只允許一個 run。
- 有限 execution timeout：超時進入 reconciliation，不直接重跑副作用。

## 停止條件

任一條件成立時，本次 run 必須停止在 commit 或下一個外部寫入之前：

- repository root、base branch、origin 或 base SHA 不符合設定；
- 另一個 automation run 尚未結束；
- 變更包含 allowlist 外路徑、未知 untracked 檔案或秘密樣式；
- patch 無法乾淨套用到 `origin/main`；
- formatter、test、build、audit 或 required check 失敗；
- GitHub auth、branch protection、auto-merge 或 required checks 未通過 readback；
- PR、merge、branch deletion 或通知的 provider 狀態為 `unknown`；
- cleanup receipt 與實際 branch/worktree 路徑不一致。

失敗時保留原始工作樹與遠端狀態，不執行 `git reset`、`git checkout`、`git clean`、force push 或 wildcard branch/worktree deletion。

## 實作順序與驗收

1. 先實作純本機 safety core，以暫存 repository 驗證 allowlist、秘密阻擋、冪等鍵與 exact cleanup；此階段不連 GitHub。
2. 再接 GitHub fake runner，驗證 commit、push、PR、CI、merge 與 reconciliation 狀態機；此階段不做 live provider 寫入。
3. 取得個別批准後，設定 GitHub App、branch protection、auto-merge 與 branch auto-delete，並做 provider readback。
4. 取得個別批准後，註冊 Windows 排程，先執行一次手動受控 live run。
5. 只有完整讀回 commit SHA、PR、兩個 required checks、merge commit、branch 刪除及 worktree 清理後，狀態才可升為 `verified`。

## 目前實作狀態

- `verified`：暫存 Git repository 中的 tracked、untracked、deleted 與 executable-mode-only snapshot；主要 HEAD/status 不變；來源並行修改停止；禁止路徑與高信心秘密樣式停止；validation failure cleanup；active/final receipt 冪等 gate、單例與 stale-lock cleanup；latest remote base 與 internal-config trust；fake GitHub commit、push、PR head/base、quality、merge readback、遠端 branch deletion、receipt-based TTL reconciliation 與本機 cleanup。
- `partial`：GitHub provider 流程已實作，但只以 local bare remote 與 fake `gh` 驗證。
- `verified`：fleet catalog 依序執行、失敗後繼續、aggregate JSON、child run ID 唯一性，以及四倉 scheduler plan readiness 的本機測試與 readback。
- `unverified`：真實 GitHub App/PAT、四個 remote workflow 安裝、repository gate readback、live PR/CI/merge、Telegram 通知，以及 Windows Task Scheduler 首次實跑。
- `blocked`：目前 turn 禁止 push；因此新 remote 的 bootstrap、remote workflow 與 live provider E2E 必須留到後續允許 push 的 turn。

## 證據與限制

| 項目                                  | 來源／命令                                              | 狀態         | 限制                                                                   |
| ------------------------------------- | ------------------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| 現有 workflow 有 commit/push/PR/merge | [排程 workflow](../../.github/workflows/automation.yml) | `verified`   | 只證明本機 source；不代表 remote default branch 已安裝或成功執行       |
| sync 不產生內容變更                   | [同步入口](../../scripts/ci/sync.mjs)                   | `verified`   | 只會 fetch 與 clean fast-forward                                       |
| required checks 定義                  | [品質 workflow](../../.github/workflows/quality.yml)    | `partial`    | 本機檔案目前另有既存修改；remote 與 live CI 需重新讀回                 |
| 本機工作樹可被 hosted runner 看見     | GitHub runner checkout 模型                             | `blocked`    | hosted runner 無法讀取未 push 的本機變更                               |
| GitHub 設定與排程已完成               | provider readback                                       | `unverified` | 本研究沒有執行 GitHub 寫入或 Task Scheduler 註冊                       |
| 本機隔離 orchestrator                 | `npm test -- --run tests/git-automation.test.ts`        | `verified`   | 只證明暫存 repo、bare remote 與 fake `gh` 行為；live provider 尚未驗證 |

## 外部來源

- [GitHub workflow schedule 語法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)：timezone、default branch 與排程語意。
- [GitHub workflow 觸發規則](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)：`GITHUB_TOKEN` 事件與替代 token。
- [GitHub pull request auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)：required checks 通過後的自動合併。
- [GitHub 自動刪除 head branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)：合併後 branch cleanup。
- [GitHub self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)：本機環境與持久 runner 邊界。
- [GitHub Actions 安全強化](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)：不可信程式碼、秘密與 runner 風險。
- [Microsoft ScheduledTasks 設定](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset)：補跑、網路、喚醒、timeout 與多實例策略。
- [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request)：generator 後的 commit、branch 與 PR 管理。
- [`stefanzweifel/git-auto-commit-action`](https://github.com/stefanzweifel/git-auto-commit-action)：只覆蓋較窄的 commit/push 情境，不作本方案主 orchestrator。
