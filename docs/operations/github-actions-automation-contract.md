# GitHub Actions automation contract

Status: `candidate`

This document defines the project-level contract for repository automation in
`dali420857-dotcom/826`. It does not grant permission to change GitHub settings,
send Telegram messages, or push a branch by itself.

## Canonical surfaces

- `scripts/ci/sync.mjs` is the repository synchronization entrypoint.
- `.github/workflows/quality.yml` is the quality-check workflow.
- `.github/workflows/automation.yml` is the only workflow allowed to create
  automation commits, push a branch, create a pull request, or queue a squash
  merge.
- The root `package.json` is the web-clone quality boundary.
- `826-Emailautosave/production/dali-outreach/package.json` is the outreach
  quality boundary.

`826-Emailautosave` is not an independent Git repository. It remains inside
the target repository boundary.

## Schedule and idempotency

- Scheduled slots are `01:00`, `10:30`, and `16:30` in
  `America/Los_Angeles`.
- The workflow uses IANA timezone scheduling plus a local-time guard for DST
  and delayed-run protection.
- Each run has an `automation-slot:YYYYMMDD-HHMM` marker. An existing marker,
  branch, or pull request stops the duplicate run without another commit.
- Public scheduled workflows may be automatically disabled after 60 days
  without repository activity; this is an operational warning, not a reason to
  bypass the guard.

## Git write boundary

- The sync entrypoint may fetch and fast-forward a clean checkout only.
- The automation workflow stages tracked modifications with `git add --update`.
- Unknown untracked files are never automatically staged.
- The historical reference snapshot is permanently excluded by `.gitignore`:
  `826-Emailautosave/reference-mail-control-panel-head-c3e1e80-20260528/`.
- Any dirty worktree, divergent branch, secret-pattern hit, quality failure,
  missing check, or uncertain provider result stops the run.
- No `git reset`, `git checkout`, or `git clean` is part of this contract.

## Quality and merge gates

The automation workflow must verify these required checks before queueing a
squash merge:

- `quality / root`
- `quality / outreach`

The one-time GitHub settings readback must also show:

- repository `allow_auto_merge=true`;
- `main` branch protection enabled;
- both required status checks configured;
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

As of the initial contract draft, the repository is public and the workflow
files are not yet installed on GitHub. `allow_auto_merge`, branch protection,
required checks, and a successful scheduled run require fresh readback before
the project can be marked `verified`.
