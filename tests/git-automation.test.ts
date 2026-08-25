import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each case creates a real disposable Git repository and some paths include
// the configured three-second stability window. Windows process startup can
// legitimately push those integration cases beyond Vitest's 5s unit default.
vi.setConfig({ testTimeout: 20_000 });

// The developer checkout installs a graphify post-commit/post-checkout hook.
// These disposable repositories do not test that hook; disable it so its
// detached rebuild cannot race the allowlist/status assertions or consume the
// local-ahead test timeout.
process.env.GRAPHIFY_SKIP_HOOK = "1";

const SCRIPT = resolve("scripts/git-automation/daily-git-automation.mjs");
const REGISTER_SCRIPT = resolve(
  "scripts/git-automation/Register-DailyGitAutomationTask.ps1",
);
const PROJECT_CONFIG = resolve("config/git-automation.json");
const temporaryRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "daily-git-automation-"));
  temporaryRoots.push(root);
  const origin = join(root, "origin.git");
  const repository = join(root, "repository");
  const worktreeRoot = join(root, "worktrees");
  const receiptRoot = join(root, "receipts");

  git(root, "init", "--bare", origin);
  git(root, "clone", origin, repository);
  // The developer machine installs a global post-checkout graphify hook.
  // Keep that generated cache out of the disposable fixture so the test only
  // exercises the automation allowlist.
  writeFileSync(join(repository, ".git", "info", "exclude"), "graphify-out/\n");
  git(repository, "config", "user.name", "Automation Test");
  git(repository, "config", "user.email", "automation@example.invalid");
  git(repository, "switch", "-c", "main");
  mkdirSync(join(repository, "src"), { recursive: true });
  mkdirSync(join(repository, "docs"), { recursive: true });
  writeFileSync(join(repository, "src", "app.txt"), "base\n");
  writeFileSync(join(repository, "docs", "note.md"), "remove me\n");
  writeFileSync(join(repository, "ignored.txt"), "unchanged\n");
  git(repository, "add", "src/app.txt", "docs/note.md", "ignored.txt");
  git(repository, "commit", "-m", "initial");
  git(repository, "push", "-u", "origin", "main");

  return { root, repository, worktreeRoot, receiptRoot };
}

function writeConfig(
  root: string,
  repository: string,
  worktreeRoot: string,
  receiptRoot: string,
  overrides: Record<string, unknown> = {},
) {
  const configPath = join(root, "git-automation.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        enabled: true,
        repositoryRoot: repository,
        remote: "origin",
        baseBranch: "main",
        branchPrefix: "automation/",
        worktreeRoot,
        receiptRoot,
        allowedPaths: ["src", "docs"],
        ignoredDirtyPaths: ["ignored.txt"],
        forbiddenExtensions: [
          ".env",
          ".pem",
          ".key",
          ".p12",
          ".pfx",
          ".db",
          ".sqlite",
        ],
        snapshotStabilityDelayMs: 0,
        validationCommands: [],
        ...overrides,
      },
      null,
      2,
    ),
  );
  return configPath;
}

function writeFakeGitHub(root: string) {
  const scriptPath = join(root, "fake-gh.mjs");
  const logPath = join(root, "fake-gh.jsonl");
  writeFileSync(
    scriptPath,
    `import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
 const args = process.argv.slice(2);
 const previousCalls = existsSync(process.env.FAKE_GH_LOG) ? readFileSync(process.env.FAKE_GH_LOG, "utf8").trim().split("\\n").filter(Boolean) : [];
 appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n");
 const command = args.slice(0, 2).join(" ");
 if (process.env.FAKE_GH_FAIL_COMMAND === command) process.exit(9);
if (args[0] === "api" && args[1].endsWith("/protection")) process.stdout.write(JSON.stringify({ required_status_checks: { contexts: ["quality / root", "quality / outreach"] }, required_pull_request_reviews: { required_approving_review_count: 0 } }) + "\\n");
 else if (args[0] === "api") process.stdout.write(JSON.stringify({ allow_auto_merge: process.env.FAKE_GH_AUTO_MERGE !== "false" }) + "\\n");
 if (command === "pr create") process.stdout.write("https://github.test/pull/42\\n");
 if (command === "pr list") process.stdout.write("[]\\n");
 if (command === "run list") process.stdout.write("9001\\n");
 if (command === "pr view") {
   const viewCount = previousCalls.filter((line) => JSON.parse(line).slice(0, 2).join(" ") === "pr view").length;
   const headRefOid = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
   const wrongHead = process.env.FAKE_GH_HEAD_MISMATCH === "true" || (process.env.FAKE_GH_MERGED_REF_MISMATCH === "true" && viewCount > 0);
   const wrongBase = process.env.FAKE_GH_BASE_MISMATCH === "true" || (process.env.FAKE_GH_MERGED_REF_MISMATCH === "true" && viewCount > 0);
   process.stdout.write(JSON.stringify({ state: "MERGED", mergedAt: "2026-08-24T12:00:00Z", mergeCommit: { oid: "merge-sha" }, headRefName: process.env.FAKE_GH_HEAD_NAME || "automation/test-run", headRefOid: wrongHead ? "wrong-head" : headRefOid, baseRefName: wrongBase ? "wrong-base" : "main" }) + "\\n");
 }
`,
  );
  return { scriptPath, logPath };
}

function writeGitShim(root: string) {
  const shimRoot = join(root, "git-shim");
  mkdirSync(shimRoot, { recursive: true });
  const locator = process.platform === "win32" ? "where" : "which";
  const realGit = execFileSync(locator, ["git"], { encoding: "utf8" })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        (process.platform !== "win32" || line.toLowerCase().endsWith(".exe")),
    );
  if (!realGit) throw new Error("real git executable not found");
  const shimPath = join(shimRoot, "git-proxy.mjs");
  writeFileSync(
    shimPath,
    `import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "ls-remote" && process.env.FAIL_LS_REMOTE === "1") process.exit(128);
if (args[0] === "worktree" && args[1] === "remove" && process.env.FAIL_WORKTREE_REMOVE === "1") process.exit(9);
if (args[0] === "branch" && args[1] === "--delete" && process.env.FAIL_BRANCH_DELETE === "1") process.exit(9);
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
  );
  return {
    env: (flags: Record<string, string> = {}) => {
      return {
        ...process.env,
        ...flags,
        GIT_AUTOMATION_GIT_COMMAND: process.execPath,
        GIT_AUTOMATION_GIT_PREFIX: shimPath,
      };
    },
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("daily Git automation", () => {
  it("renders the Windows schedule plan without registering a task", () => {
    const execution = spawnSync(
      "pwsh",
      ["-NoProfile", "-File", REGISTER_SCRIPT, "-ConfigPath", PROJECT_CONFIG],
      { encoding: "utf8" },
    );

    expect(execution.stderr).toBe("");
    expect(execution.status).toBe(0);
    expect(JSON.parse(execution.stdout)).toMatchObject({
      status: "plan_only",
      task_name: "Dali-Daily-Git-Automation-Fleet",
      daily_at: ["01:00", "10:30", "16:30"],
      settings: {
        start_when_available: true,
        wake_to_run: true,
        run_only_if_network_available: true,
        multiple_instances: "IgnoreNew",
        execution_time_limit_hours: 2,
      },
    });
  });

  it("validates an isolated snapshot and removes its worktree without mutating main", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);

    writeFileSync(join(repository, "src", "app.txt"), "changed\n");
    writeFileSync(join(repository, "src", "new.txt"), "new\n");
    rmSync(join(repository, "docs", "note.md"));
    writeFileSync(join(repository, "ignored.txt"), "agent is still working\n");

    const headBefore = git(repository, "rev-parse", "HEAD");
    const statusBefore = git(
      repository,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    );

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "test-run"],
      { encoding: "utf8" },
    );

    expect(execution.stderr).toBe("");
    expect(execution.status).toBe(0);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "verified",
      summary: "isolated_snapshot_validated",
      artifacts: {
        run_id: "test-run",
        changed: true,
        cleanup_status: "removed",
      },
    });
    expect(result.artifacts.changed_paths).toEqual([
      "docs/note.md",
      "src/app.txt",
      "src/new.txt",
    ]);

    expect(git(repository, "rev-parse", "HEAD")).toBe(headBefore);
    expect(
      git(repository, "status", "--porcelain=v1", "--untracked-files=all"),
    ).toBe(statusBefore);
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(
      worktreeRoot,
    );
    expect(readdirSync(worktreeRoot)).toEqual([]);

    const receipt = JSON.parse(
      readFileSync(join(receiptRoot, "test-run.json"), "utf8"),
    );
    expect(receipt.status).toBe("verified");
    expect(receipt.artifacts.cleanup_status).toBe("removed");
  });

  it("blocks forbidden files even when they are inside an allowed path", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    writeFileSync(join(repository, "src", "local.env"), "PRIVATE=value\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "secret-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "forbidden_snapshot_path",
      artifacts: {
        cleanup_status: "removed",
      },
    });
    expect(result.artifacts.error_details.paths).toEqual(["src/local.env"]);
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(
      worktreeRoot,
    );
    expect(readdirSync(worktreeRoot)).toEqual([]);
  });

  it("defers when an agent changes the source during the stability window", async () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      { snapshotStabilityDelayMs: 2000 },
    );
    writeFileSync(join(repository, "src", "app.txt"), "first version\n");

    const child = spawn(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "moving-run"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    await new Promise((resolve) => setTimeout(resolve, 1000));
    writeFileSync(join(repository, "src", "app.txt"), "second version\n");
    const exitCode = await new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );

    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "source_changed_during_snapshot",
    });
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(
      worktreeRoot,
    );
    expect(existsSync(worktreeRoot)).toBe(false);
  }, 15_000);

  it("removes the temporary worktree when validation fails", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        validationCommands: [
          { command: process.execPath, args: ["-e", "process.exit(9)"] },
        ],
      },
    );
    writeFileSync(join(repository, "src", "app.txt"), "invalid change\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "failed-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "command_failed",
      artifacts: {
        cleanup_status: "removed",
      },
    });
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(
      worktreeRoot,
    );
    expect(readdirSync(worktreeRoot)).toEqual([]);
  });

  it("blocks high-confidence secret content in an allowed text file", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    writeFileSync(
      join(repository, "src", "looks-safe.txt"),
      ["-----BEGIN OPENSSH ", "PRIVATE KEY-----\n"].join(""),
    );

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "pattern-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "secret_pattern_detected",
      artifacts: {
        cleanup_status: "removed",
      },
    });
    expect(result.artifacts.error_details.paths).toEqual([
      "src/looks-safe.txt",
    ]);
  });

  it("blocks an unknown dirty path before creating a worktree", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    mkdirSync(join(repository, "unexpected"));
    writeFileSync(join(repository, "unexpected", "artifact.txt"), "unknown\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "unknown-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "unknown_dirty_paths",
    });
    expect(result.artifacts.error_details.paths).toEqual([
      "unexpected/artifact.txt",
    ]);
    expect(existsSync(worktreeRoot)).toBe(false);
  });

  it("blocks execute when a repository-owned config differs from origin/main", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const externalConfig = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
    );
    const internalConfig = join(repository, "config", "git-automation.json");
    mkdirSync(join(repository, "config"), { recursive: true });
    writeFileSync(internalConfig, readFileSync(externalConfig));
    git(repository, "add", "config/git-automation.json");
    git(repository, "commit", "-m", "add automation config");
    git(repository, "push", "origin", "main");
    writeFileSync(internalConfig, `${readFileSync(internalConfig, "utf8")}\n`);

    const execution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        internalConfig,
        "--execute",
        "--run-id",
        "dirty-config",
      ],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "config_modified_from_remote_base",
    });
    expect(result.artifacts.error_details).toMatchObject({
      config_path: "config/git-automation.json",
      base_ref: "origin/main",
    });
    expect(existsSync(worktreeRoot)).toBe(false);
  });

  it.skipIf(process.platform !== "win32" || !existsSync("D:\\"))(
    "treats worktree and receipt roots on another Windows volume as external",
    () => {
      const { repository } = createRepository();
      const externalRoot = mkdtempSync("D:\\git-automation-cross-volume-");
      temporaryRoots.push(externalRoot);
      const worktreeRoot = join(externalRoot, "worktrees");
      const receiptRoot = join(externalRoot, "receipts");
      const configPath = writeConfig(
        externalRoot,
        repository,
        worktreeRoot,
        receiptRoot,
      );
      writeFileSync(join(repository, "src", "app.txt"), "cross-volume\n");

      const execution = spawnSync(
        process.execPath,
        [
          SCRIPT,
          "--config",
          configPath,
          "--dry-run",
          "--run-id",
          "cross-volume",
        ],
        { encoding: "utf8" },
      );

      expect(execution.stderr).toBe("");
      expect(execution.status).toBe(0);
      expect(JSON.parse(execution.stdout)).toMatchObject({
        status: "verified",
        artifacts: { cleanup_status: "removed" },
      });
      expect(readdirSync(worktreeRoot)).toEqual([]);
    },
  );

  it("treats a config owned by a nested control repository as external to the target", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const controlRepository = join(repository, "control-repository");
    mkdirSync(controlRepository, { recursive: true });
    git(controlRepository, "init");
    git(controlRepository, "config", "user.name", "Control Test");
    git(controlRepository, "config", "user.email", "control@example.invalid");
    const configPath = writeConfig(
      controlRepository,
      repository,
      worktreeRoot,
      receiptRoot,
      { ignoredDirtyPaths: ["ignored.txt", "control-repository"] },
    );
    git(controlRepository, "add", "git-automation.json");
    git(controlRepository, "commit", "-m", "add external target config");

    const execution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--execute",
        "--run-id",
        "nested-control-config",
      ],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(0);
    expect(JSON.parse(execution.stdout)).toMatchObject({ status: "verified" });
    expect(readdirSync(worktreeRoot)).toEqual([]);
    expect(git(repository, "worktree", "list", "--porcelain")).not.toContain(
      worktreeRoot,
    );
  });

  it("blocks duplicate active and final receipts before any side effect", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    mkdirSync(receiptRoot, { recursive: true });
    const activePath = join(receiptRoot, "duplicate-active.active.json");
    const activePayload = JSON.stringify({
      run_id: "duplicate-active",
      status: "active",
    });
    writeFileSync(activePath, activePayload);

    const activeExecution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--dry-run",
        "--run-id",
        "duplicate-active",
      ],
      { encoding: "utf8" },
    );
    expect(activeExecution.status).toBe(2);
    expect(JSON.parse(activeExecution.stdout)).toMatchObject({
      status: "blocked",
      summary: "run_receipt_exists",
    });
    expect(readFileSync(activePath, "utf8")).toBe(activePayload);
    expect(existsSync(worktreeRoot)).toBe(false);

    const finalPath = join(receiptRoot, "duplicate-final.json");
    const finalPayload = JSON.stringify({
      run_id: "duplicate-final",
      status: "verified",
    });
    writeFileSync(finalPath, finalPayload);
    const finalExecution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--dry-run",
        "--run-id",
        "duplicate-final",
      ],
      { encoding: "utf8" },
    );
    expect(finalExecution.status).toBe(2);
    expect(JSON.parse(finalExecution.stdout)).toMatchObject({
      status: "blocked",
      summary: "run_receipt_exists",
    });
    expect(readFileSync(finalPath, "utf8")).toBe(finalPayload);
  });

  it("fails closed when an expired remote branch status is unknown", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        remoteCleanup: { enabled: true, ttlMinutes: 1 },
        github: {
          command: process.execPath,
          prefixArgs: [],
          repository: "owner/repository",
        },
      },
    );
    git(repository, "branch", "automation/old-run");
    git(repository, "push", "origin", "automation/old-run");
    mkdirSync(receiptRoot, { recursive: true });
    writeFileSync(
      join(receiptRoot, "old-run.json"),
      JSON.stringify({
        status: "blocked",
        receipt_created_at: "2000-01-01T00:00:00.000Z",
        artifacts: {
          run_id: "old-run",
          branch: "automation/old-run",
          pr_number: 42,
        },
      }),
    );
    const shim = writeGitShim(root);
    writeFileSync(join(repository, "src", "app.txt"), "new change\n");

    const execution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--execute",
        "--run-id",
        "unknown-cleanup",
      ],
      { encoding: "utf8", env: shim.env({ FAIL_LS_REMOTE: "1" }) },
    );

    expect(execution.status).toBe(2);
    expect(JSON.parse(execution.stdout)).toMatchObject({
      status: "blocked",
      summary: "remote_cleanup_unknown",
    });
    expect(
      git(repository, "ls-remote", "--heads", "origin", "automation/old-run"),
    ).not.toBe("");
    expect(existsSync(worktreeRoot)).toBe(false);
  });

  it("reconciles an expired crash journal branch with no pull request", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        remoteCleanup: { enabled: true, ttlMinutes: 1 },
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
        },
      },
    );
    const commitSha = git(repository, "rev-parse", "HEAD");
    git(repository, "branch", "automation/crashed-run");
    git(repository, "push", "origin", "automation/crashed-run");
    mkdirSync(receiptRoot, { recursive: true });
    const activePath = join(receiptRoot, "crashed-run.active.json");
    writeFileSync(activePath, "{interrupted journal write");
    writeFileSync(
      `${activePath}.previous`,
      JSON.stringify({
        run_id: "crashed-run",
        status: "active",
        created_at: "2000-01-01T00:00:00.000Z",
        phase: "push_complete",
        artifacts: {
          branch: "automation/crashed-run",
          commit_sha: commitSha,
          base_branch: "main",
        },
      }),
    );

    const execution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--execute",
        "--run-id",
        "cleanup-sweep",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, FAKE_GH_LOG: logPath },
      },
    );

    expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(
      0,
    );
    expect(JSON.parse(execution.stdout)).toMatchObject({
      status: "verified",
      artifacts: {
        remote_reconciliation: [
          {
            run_id: "crashed-run",
            branch: "automation/crashed-run",
            state: "deleted",
          },
        ],
      },
    });
    expect(
      git(
        repository,
        "ls-remote",
        "--heads",
        "origin",
        "automation/crashed-run",
      ),
    ).toBe("");
    expect(existsSync(activePath)).toBe(false);
    expect(existsSync(`${activePath}.previous`)).toBe(false);
  }, 20_000);

  it("retains an expired merged-PR branch when its remote OID drifted", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        remoteCleanup: { enabled: true, ttlMinutes: 1 },
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
        },
      },
    );
    const recordedCommit = git(repository, "rev-parse", "HEAD");
    writeFileSync(join(repository, "src", "app.txt"), "force-pushed\n");
    git(repository, "add", "src/app.txt");
    git(repository, "commit", "-m", "replacement branch commit");
    git(repository, "branch", "automation/force-pushed");
    git(repository, "push", "origin", "automation/force-pushed");
    mkdirSync(receiptRoot, { recursive: true });
    writeFileSync(
      join(receiptRoot, "force-pushed.json"),
      JSON.stringify({
        status: "blocked",
        receipt_created_at: "2000-01-01T00:00:00.000Z",
        artifacts: {
          run_id: "force-pushed",
          branch: "automation/force-pushed",
          commit_sha: recordedCommit,
          pr_number: 42,
        },
      }),
    );

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--execute", "--run-id", "oid-sweep"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_GH_LOG: logPath,
          FAKE_GH_HEAD_NAME: "automation/force-pushed",
        },
      },
    );

    expect(execution.status).toBe(2);
    expect(JSON.parse(execution.stdout)).toMatchObject({
      status: "blocked",
      summary: "remote_cleanup_unknown",
      artifacts: {
        error_details: {
          artifacts: [
            {
              run_id: "force-pushed",
              state: "unknown",
              reason: "remote_cleanup_commit_mismatch",
            },
          ],
        },
      },
    });
    expect(
      git(
        repository,
        "ls-remote",
        "--heads",
        "origin",
        "automation/force-pushed",
      ),
    ).not.toBe("");
  }, 20_000);

  it("completes the isolated commit, PR, CI, merge, branch deletion, and cleanup flow", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        gitIdentity: {
          name: "automation[bot]",
          email: "automation@example.invalid",
        },
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
          qualityWorkflow: "quality.yml",
          requiredChecks: ["quality / root", "quality / outreach"],
          mergeMethod: "merge",
          mergePollAttempts: 2,
          mergePollIntervalMs: 0,
        },
      },
    );
    writeFileSync(join(repository, "src", "app.txt"), "ready to merge\n");
    const headBefore = git(repository, "rev-parse", "HEAD");
    const statusBefore = git(
      repository,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    );

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--execute", "--run-id", "merge-run"],
      {
        encoding: "utf8",
        env: { ...process.env, FAKE_GH_LOG: logPath },
      },
    );

    expect(execution.stderr).toBe("");
    expect(execution.status).toBe(0);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "verified",
      summary: "merge_verified",
      artifacts: {
        run_id: "merge-run",
        branch: "automation/merge-run",
        pr_number: 42,
        quality_run_id: "9001",
        merge_commit_sha: "merge-sha",
        remote_branch_cleanup: "deleted",
        local_branch_cleanup: "deleted",
        cleanup_status: "removed",
      },
    });
    expect(result.artifacts.commit_sha).toMatch(/^[0-9a-f]{40}$/u);
    expect(
      git(repository, "ls-remote", "--heads", "origin", "automation/merge-run"),
    ).toBe("");
    expect(git(repository, "branch", "--list", "automation/merge-run")).toBe(
      "",
    );
    expect(git(repository, "rev-parse", "HEAD")).toBe(headBefore);
    expect(
      git(repository, "status", "--porcelain=v1", "--untracked-files=all"),
    ).toBe(statusBefore);
    expect(readdirSync(worktreeRoot)).toEqual([]);

    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.map((args) => args.slice(0, 2).join(" "))).toEqual([
      "api repos/owner/repository",
      "api repos/owner/repository/branches/main/protection",
      "pr create",
      "workflow run",
      "run list",
      "run watch",
      "pr checks",
      "pr view",
      "pr merge",
      "pr view",
    ]);
  }, 20_000);

  it("blocks before merge when the PR head SHA does not match the staged commit", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
          qualityWorkflow: "quality.yml",
          requiredChecks: ["quality / root", "quality / outreach"],
          mergeMethod: "merge",
          mergePollAttempts: 1,
          mergePollIntervalMs: 0,
        },
      },
    );
    writeFileSync(join(repository, "src", "app.txt"), "head mismatch\n");

    const execution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--execute",
        "--run-id",
        "head-mismatch",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_GH_LOG: logPath,
          FAKE_GH_HEAD_MISMATCH: "true",
        },
      },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "pull_request_head_mismatch",
      artifacts: {
        remote_branch_cleanup: "retained",
        cleanup_status: "removed",
      },
    });
    expect(
      git(
        repository,
        "ls-remote",
        "--heads",
        "origin",
        "automation/head-mismatch",
      ),
    ).not.toBe("");
    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.map((args) => args.slice(0, 2).join(" "))).not.toContain(
      "pr merge",
    );
  }, 20_000);

  it("blocks after merge readback when PR head/base refs drift", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
          qualityWorkflow: "quality.yml",
          requiredChecks: ["quality / root", "quality / outreach"],
          mergeMethod: "merge",
          mergePollAttempts: 1,
          mergePollIntervalMs: 0,
        },
      },
    );
    writeFileSync(join(repository, "src", "app.txt"), "after mismatch\n");

    const execution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--execute",
        "--run-id",
        "after-mismatch",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_GH_LOG: logPath,
          FAKE_GH_MERGED_REF_MISMATCH: "true",
        },
      },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "pull_request_head_mismatch",
      artifacts: {
        remote_branch_cleanup: "retained",
        cleanup_status: "removed",
      },
    });
    expect(
      git(
        repository,
        "ls-remote",
        "--heads",
        "origin",
        "automation/after-mismatch",
      ),
    ).not.toBe("");
    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.map((args) => args.slice(0, 2).join(" "))).toContain(
      "pr merge",
    );
  }, 20_000);

  it("downgrades a verified dry run when exact worktree cleanup is pending", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    const shim = writeGitShim(root);
    writeFileSync(join(repository, "src", "app.txt"), "cleanup pending\n");

    const execution = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--config",
        configPath,
        "--dry-run",
        "--run-id",
        "cleanup-pending",
      ],
      { encoding: "utf8", env: shim.env({ FAIL_WORKTREE_REMOVE: "1" }) },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "cleanup_pending",
      artifacts: { cleanup_status: "cleanup_pending" },
    });
    expect(existsSync(result.artifacts.worktree_path)).toBe(true);
    // Reconcile the deliberately injected failure so this disposable repo
    // does not leave a linked worktree for later tests.
    git(
      repository,
      "worktree",
      "remove",
      "--force",
      result.artifacts.worktree_path,
    );
    git(repository, "worktree", "prune", "--expire", "now");
  }, 20_000);

  it("removes the local branch and worktree but retains the remote branch when CI fails", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        gitIdentity: {
          name: "automation[bot]",
          email: "automation@example.invalid",
        },
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
          qualityWorkflow: "quality.yml",
          requiredChecks: ["quality / root", "quality / outreach"],
          mergeMethod: "merge",
          mergePollAttempts: 2,
          mergePollIntervalMs: 0,
        },
      },
    );
    writeFileSync(join(repository, "src", "app.txt"), "CI will fail\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--execute", "--run-id", "failed-ci"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_GH_LOG: logPath,
          FAKE_GH_FAIL_COMMAND: "run watch",
        },
      },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "command_failed",
      artifacts: {
        branch: "automation/failed-ci",
        remote_branch_cleanup: "retained",
        local_branch_cleanup: "deleted",
        cleanup_status: "removed",
      },
    });
    expect(
      git(repository, "ls-remote", "--heads", "origin", "automation/failed-ci"),
    ).not.toBe("");
    expect(git(repository, "branch", "--list", "automation/failed-ci")).toBe(
      "",
    );
    expect(readdirSync(worktreeRoot)).toEqual([]);
  }, 20_000);

  it("preserves a Git executable-mode-only change in the automation commit", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        gitIdentity: {
          name: "automation[bot]",
          email: "automation@example.invalid",
        },
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
          qualityWorkflow: "quality.yml",
          requiredChecks: ["quality / root", "quality / outreach"],
          mergeMethod: "merge",
          mergePollAttempts: 2,
          mergePollIntervalMs: 0,
        },
      },
    );
    git(repository, "update-index", "--chmod=+x", "src/app.txt");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--execute", "--run-id", "mode-only"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_GH_LOG: logPath,
          FAKE_GH_FAIL_COMMAND: "run watch",
        },
      },
    );

    expect(execution.status).toBe(2);
    expect(JSON.parse(execution.stdout)).toMatchObject({
      status: "blocked",
      artifacts: { changed_paths: ["src/app.txt"] },
    });
    expect(
      git(
        join(root, "origin.git"),
        "ls-tree",
        "refs/heads/automation/mode-only",
        "--",
        "src/app.txt",
      ),
    ).toMatch(/^100755\s+blob\s/u);
  }, 20_000);

  it("stops before push when GitHub auto-merge is not enabled", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const { scriptPath: fakeGitHub, logPath } = writeFakeGitHub(root);
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      {
        github: {
          command: process.execPath,
          prefixArgs: [fakeGitHub],
          repository: "owner/repository",
          qualityWorkflow: "quality.yml",
          requiredChecks: ["quality / root", "quality / outreach"],
          mergeMethod: "merge",
          mergePollAttempts: 2,
          mergePollIntervalMs: 0,
        },
      },
    );
    writeFileSync(join(repository, "src", "app.txt"), "provider gate\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--execute", "--run-id", "gate-run"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_GH_LOG: logPath,
          FAKE_GH_AUTO_MERGE: "false",
        },
      },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "github_auto_merge_disabled",
      artifacts: { cleanup_status: "removed" },
    });
    expect(
      git(repository, "ls-remote", "--heads", "origin", "automation/gate-run"),
    ).toBe("");
  }, 20_000);

  it("blocks a concurrent run before creating another worktree", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    mkdirSync(receiptRoot, { recursive: true });
    writeFileSync(
      join(receiptRoot, "automation.lock"),
      JSON.stringify({ run_id: "active-run", pid: 1234 }),
    );
    writeFileSync(join(repository, "src", "app.txt"), "new change\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "second-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "automation_lock_held",
    });
    expect(existsSync(worktreeRoot)).toBe(false);
  });

  it("uses the latest remote version of a tracked file that local agents did not change", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const updater = join(root, "updater");
    git(root, "clone", join(root, "origin.git"), updater);
    git(updater, "config", "user.name", "Remote Updater");
    git(updater, "config", "user.email", "updater@example.invalid");
    git(updater, "switch", "main");
    writeFileSync(join(updater, "src", "app.txt"), "remote update\n");
    git(updater, "add", "src/app.txt");
    git(updater, "commit", "-m", "remote update");
    git(updater, "push", "origin", "main");
    const latestRemoteSha = git(updater, "rev-parse", "HEAD");

    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    writeFileSync(join(repository, "src", "new.txt"), "local addition\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "remote-base"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(0);
    const result = JSON.parse(execution.stdout);
    expect(result.artifacts.base_sha).toBe(latestRemoteSha);
    expect(result.artifacts.changed_paths).toEqual(["src/new.txt"]);
  }, 15_000);

  it("stops before creating a worktree when local and remote changed the same path", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const updater = join(root, "conflict-updater");
    git(root, "clone", join(root, "origin.git"), updater);
    git(updater, "config", "user.name", "Remote Updater");
    git(updater, "config", "user.email", "updater@example.invalid");
    git(updater, "switch", "main");
    writeFileSync(join(updater, "src", "app.txt"), "remote version\n");
    git(updater, "add", "src/app.txt");
    git(updater, "commit", "-m", "remote version");
    git(updater, "push", "origin", "main");

    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);
    writeFileSync(join(repository, "src", "app.txt"), "local version\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "conflict-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(2);
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      summary: "snapshot_conflicts_with_remote",
    });
    expect(result.artifacts.error_details.paths).toEqual(["src/app.txt"]);
    expect(existsSync(worktreeRoot)).toBe(false);
  }, 15_000);

  it("includes committed local-main work that has not reached the remote", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    writeFileSync(join(repository, "src", "app.txt"), "locally committed\n");
    git(repository, "add", "src/app.txt");
    git(repository, "commit", "-m", "local agent checkpoint");
    const localHead = git(repository, "rev-parse", "HEAD");
    const configPath = writeConfig(root, repository, worktreeRoot, receiptRoot);

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "ahead-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(0);
    const result = JSON.parse(execution.stdout);
    expect(result.artifacts.source_relation).toBe("ahead");
    expect(result.artifacts.source_head_sha).toBe(localHead);
    expect(result.artifacts.changed_paths).toEqual(["src/app.txt"]);
    expect(git(repository, "rev-parse", "HEAD")).toBe(localHead);
  }, 15_000);

  it("reclaims a stale lock from a dead process and continues", () => {
    const { root, repository, worktreeRoot, receiptRoot } = createRepository();
    const configPath = writeConfig(
      root,
      repository,
      worktreeRoot,
      receiptRoot,
      { lockStaleMinutes: 1 },
    );
    mkdirSync(receiptRoot, { recursive: true });
    mkdirSync(worktreeRoot, { recursive: true });
    git(
      repository,
      "worktree",
      "add",
      "-b",
      "automation/dead-run",
      join(worktreeRoot, "dead-run"),
      "origin/main",
    );
    writeFileSync(
      join(receiptRoot, "automation.lock"),
      JSON.stringify({
        run_id: "dead-run",
        pid: 999999,
        created_at: "2000-01-01T00:00:00.000Z",
      }),
    );
    writeFileSync(join(repository, "src", "app.txt"), "safe retry\n");

    const execution = spawnSync(
      process.execPath,
      [SCRIPT, "--config", configPath, "--dry-run", "--run-id", "retry-run"],
      { encoding: "utf8" },
    );

    expect(execution.status).toBe(0);
    expect(JSON.parse(execution.stdout).summary).toBe(
      "isolated_snapshot_validated",
    );
    expect(existsSync(join(receiptRoot, "automation.lock"))).toBe(false);
    expect(readdirSync(worktreeRoot)).toEqual([]);
    expect(git(repository, "branch", "--list", "automation/dead-run")).toBe("");
  });
});
