# GitHub Actions automation contract

Status: `candidate`

This document defines the project-level contract for one local coordinator
covering four repositories. It does not grant permission to change GitHub settings,
send Telegram messages, or push a branch by itself.

## Canonical surfaces

- `docs/operations/github-autonomous-git-flow-research.md` records the current
  gaps, external-source findings, and the proposed local/GitHub hybrid
  implementation. It is a research plan, not evidence that the automation is
  installed or runtime-ready.
- `scripts/git-automation/Invoke-DailyGitAutomation.ps1` is the Windows entry
  for the local isolated-snapshot flow; `daily-git-automation.mjs` owns its
  state machine, receipts, exact worktree cleanup, and GitHub readback.
- `config/git-automation.json` is the fleet catalog. Its four child configs
  target `Dali-Automation`, `826`, `826-Emailautosave`, and `826-Telegram`, each
  with independent locks, receipts, temporary worktrees, allowlists, and checks.
- `Register-DailyGitAutomationTask.ps1` creates at most one task. The task runs
  the fleet sequentially and reports an aggregate result after attempting every
  repository.
- `scripts/ci/sync.mjs` is the repository synchronization entrypoint.
- `.github/workflows/quality.yml` is the quality-check workflow.
- `.github/workflows/automation.yml` is manual-only and is the only 826 workflow allowed to create
  automation commits, push a branch, create a pull request, or queue a squash
  merge.
- The root `package.json` is the web-clone quality boundary.
- `826-Emailautosave/production/dali-outreach/package.json` is the outreach
  quality boundary.

`826-Emailautosave` and `826-Telegram` are independent Git repositories even
though they are physically nested below the 826 working directory. Config trust
uses the Git repository that owns the config path, not physical path nesting.

## Schedule and idempotency

- Scheduled slots are `01:00`, `10:30`, and `16:30` in
  `America/Los_Angeles`.
- Windows Task Scheduler is the only scheduler. Repository workflows must not
  contain an enabled top-level `schedule`; they remain callable by explicit dispatch.
- Each run has an `automation-slot:YYYYMMDD-HHMM` marker. An existing marker,
  branch, or pull request stops the duplicate run without another commit.
- The local orchestrator uses an exclusive active receipt before side effects
  and a final receipt afterward. The active crash journal is updated before and
  after push/PR side effects with the exact branch, commit, PR, and phase.
  Windows registration is blocked unless the host timezone is `Pacific
Standard Time` and the GitHub workflow schedule is disabled, so the two
  schedulers cannot run the same slot independently.
- The scheduled action pins absolute `pwsh`, Node, Git, and GitHub CLI paths,
  injects their directories into PATH, rejects S4U until its credential context
  is independently verified, and reads back the registered action/settings.
- Failed remote branches are eligible for exact receipt-based cleanup after 48
  hours only when remote OID, receipt commit, and a merged PR's head OID/base
  all match. A pre-PR crash branch additionally requires an empty PR lookup.
  Open PRs, force-push/mode mismatches, authentication failures, and network
  uncertainty are retained. Active journals use atomic replace plus a previous
  valid fallback.
- Public scheduled workflows may be automatically disabled after 60 days
  without repository activity; this is an operational warning, not a reason to
  bypass the guard.

## Git write boundary

- The sync entrypoint may fetch and fast-forward a clean checkout only.
- The automation workflow stages tracked modifications with `git add --update`.
- Unknown untracked files are never automatically staged.
- The primary worktree is read-only. Its allowlisted content and Git file mode
  are copied into an external temporary worktree; repository-owned execute
  config must byte-match the latest remote base blob.
- The historical reference snapshot is permanently excluded by `.gitignore`:
  `826-Emailautosave/reference-mail-control-panel-head-c3e1e80-20260528/`.
- Any dirty worktree, divergent branch, secret-pattern hit, quality failure,
  missing check, or uncertain provider result stops the run.
- No `git reset`, `git checkout`, or `git clean` is part of this contract.

## Quality and merge gates

Each repository automation run must verify the checks declared by its child
config before queueing a merge. The 826 repository requires:

- `quality / root`

Emailautosave runs its own `quality / root` workflow in its independent
repository; it is no longer an 826 `quality / outreach` job.

The one-time GitHub settings readback must also show:

- repository `allow_auto_merge=true`;
- `main` branch protection enabled;
- the child config's required status checks configured;
- zero required human approvals, matching the no-manual-approval requirement.

If any setting is missing, the workflow stops before push, PR creation, or
merge. CircleCI, if added later, is quality-only and never performs a merge.

## Telegram notification boundary

- The workflow uses only `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` GitHub
  Actions secrets.
- Notification text contains only masked status, slot, PR number, and run ID.
- Email content, customer data, tokens, cookies, credentials, and full error
  stacks are not sent or logged.
- Missing or failed Telegram notification does not hide the primary workflow
  result; it is reported as a notification warning.

## Evidence status

The isolated local implementation and fake GitHub/bare-remote tests are
verified. Live GitHub App/PAT, current workflow installation, branch
protection, required checks, one successful PR/CI/merge cycle, and Windows
Task Scheduler registration still require separately authorized fresh
readback before the unattended system can be marked runtime-ready.
