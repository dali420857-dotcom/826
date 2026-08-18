#!/usr/bin/env node

/**
 * Safe repository synchronization gate for local runs and GitHub Actions.
 *
 * `--check` is read-only. `--sync` may fetch and fast-forward a clean checkout,
 * but it never resets, checks out, cleans, pushes, or creates a commit.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXIT_OK = 0;
const EXIT_SAFETY_STOP = 2;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function runGit(args, cwd, code = "git_command_failed") {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new SyncError(code, code);
  }
}

function runGitAllowFailure(args, cwd) {
  try {
    return {
      ok: true,
      value: execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch {
    return { ok: false, value: "" };
  }
}

function parseArgs(argv) {
  let mode = "check";
  let branch;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--check") {
      if (mode === "sync") {
        throw new SyncError("conflicting_modes", "conflicting_modes");
      }
      mode = "check";
      continue;
    }
    if (argument === "--sync") {
      if (mode === "check" && argv.includes("--check")) {
        throw new SyncError("conflicting_modes", "conflicting_modes");
      }
      mode = "sync";
      continue;
    }
    if (argument === "--branch") {
      branch = argv[index + 1];
      index += 1;
      if (!branch) {
        throw new SyncError("missing_branch", "missing_branch");
      }
      continue;
    }
    throw new SyncError("unknown_argument", "unknown_argument");
  }

  return { help: false, mode, branch };
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/ci/sync.mjs [--check|--sync] [--branch <name>]",
      "",
      "--check  Verify repository, origin, branch, and working-tree state (default).",
      "--sync   Fetch the selected origin branch and fast-forward a clean checkout only.",
      "",
      "The command never runs git reset, git checkout, git clean, git push, or git commit.",
    ].join("\n"),
  );
}

function getBranch(repoRoot, requestedBranch) {
  const branch =
    requestedBranch ||
    process.env.GITHUB_REF_NAME ||
    process.env.GITHUB_HEAD_REF ||
    runGit(["branch", "--show-current"], repoRoot, "branch_unavailable");

  if (!branch || branch.startsWith("-") || /[~^:?*[\\\s]/u.test(branch)) {
    throw new SyncError("invalid_branch", "invalid_branch");
  }
  return branch;
}

function getStatusCount(repoRoot) {
  const status = runGit(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repoRoot,
    "status_unavailable",
  );
  return status ? status.split(/\r?\n/u).filter(Boolean).length : 0;
}

function redactRemote(remote) {
  const value = remote.trim();
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value.replace(/(\/\/)[^/@\s]+@/u, "$1[redacted]@");
  }
}

function relation(repoRoot, remoteRef) {
  const counts = runGit(
    ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`],
    repoRoot,
    "relation_unavailable",
  )
    .split(/\s+/u)
    .map(Number);
  const [ahead, behind] = counts;
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    throw new SyncError("relation_unavailable", "relation_unavailable");
  }
  if (ahead > 0 && behind > 0) return { ahead, behind, state: "diverged" };
  if (ahead > 0) return { ahead, behind, state: "ahead" };
  if (behind > 0) return { ahead, behind, state: "behind" };
  return { ahead, behind, state: "equal" };
}

function buildResult(status, summary, nextActions, artifacts) {
  return {
    status,
    summary,
    next_actions: nextActions,
    artifacts,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return EXIT_OK;
  }

  const repoRoot = runGit(
    ["rev-parse", "--show-toplevel"],
    EXPECTED_REPO_ROOT,
    "not_a_git_repository",
  );
  if (path.resolve(repoRoot) !== EXPECTED_REPO_ROOT) {
    throw new SyncError("unexpected_repo_root", "unexpected_repo_root");
  }

  const branch = getBranch(repoRoot, options.branch);
  const currentBranch = runGitAllowFailure(
    ["branch", "--show-current"],
    repoRoot,
  ).value;
  if (currentBranch && currentBranch !== branch) {
    throw new SyncError("branch_mismatch", "branch_mismatch");
  }

  const origin = runGitAllowFailure(["remote", "get-url", "origin"], repoRoot);
  if (!origin.ok || !origin.value) {
    throw new SyncError("origin_missing", "origin_missing");
  }

  const headBefore = runGit(
    ["rev-parse", "HEAD"],
    repoRoot,
    "head_unavailable",
  );
  const dirtyCountBefore = getStatusCount(repoRoot);
  const artifacts = {
    mode: options.mode,
    repo_root: repoRoot,
    branch,
    current_branch: currentBranch || "detached",
    origin: redactRemote(origin.value),
    head_before: headBefore,
    dirty_count_before: dirtyCountBefore,
    fetched: false,
    fast_forwarded: false,
    relation: null,
  };

  if (dirtyCountBefore > 0) {
    return {
      exitCode: EXIT_SAFETY_STOP,
      result: buildResult(
        "blocked",
        "working_tree_not_clean",
        [
          "Preserve and isolate existing changes, then rerun this gate in a clean checkout.",
        ],
        artifacts,
      ),
    };
  }

  if (options.mode === "check") {
    return {
      exitCode: EXIT_OK,
      result: buildResult(
        "verified",
        "repository_ready_for_sync",
        ["Run --sync only from the approved automation workflow."],
        artifacts,
      ),
    };
  }

  const remoteRef = `refs/remotes/origin/${branch}`;
  runGit(["fetch", "--no-tags", "origin", branch], repoRoot, "fetch_failed");
  artifacts.fetched = true;
  runGit(
    ["rev-parse", "--verify", remoteRef],
    repoRoot,
    "remote_branch_missing",
  );
  artifacts.relation = relation(repoRoot, remoteRef);

  if (artifacts.relation.state === "diverged") {
    return {
      exitCode: EXIT_SAFETY_STOP,
      result: buildResult(
        "blocked",
        "branches_diverged",
        [
          "Stop and reconcile the branch history explicitly; no automatic merge was attempted.",
        ],
        artifacts,
      ),
    };
  }

  if (artifacts.relation.state === "behind") {
    runGit(
      ["merge", "--ff-only", "--no-edit", remoteRef],
      repoRoot,
      "fast_forward_failed",
    );
    artifacts.fast_forwarded = true;
  }

  artifacts.head_after = runGit(
    ["rev-parse", "HEAD"],
    repoRoot,
    "head_unavailable",
  );
  artifacts.dirty_count_after = getStatusCount(repoRoot);
  return {
    exitCode: EXIT_OK,
    result: buildResult(
      "verified",
      artifacts.fast_forwarded
        ? "repository_fast_forwarded"
        : "repository_in_sync",
      [
        "Continue to the separately governed quality, commit, push, and PR stages.",
      ],
      artifacts,
    ),
  };
}

try {
  const outcome = main();
  if (outcome && typeof outcome === "object") {
    process.stdout.write(`${JSON.stringify(outcome.result, null, 2)}\n`);
    process.exitCode = outcome.exitCode;
  } else {
    process.exitCode = outcome;
  }
} catch (error) {
  const code = error instanceof SyncError ? error.code : "sync_failed";
  process.stdout.write(
    `${JSON.stringify(
      buildResult(
        "blocked",
        code,
        ["Inspect the clean-checkout and remote state before retrying."],
        { error_code: code },
      ),
      null,
      2,
    )}\n`,
  );
  process.exitCode = EXIT_SAFETY_STOP;
}
