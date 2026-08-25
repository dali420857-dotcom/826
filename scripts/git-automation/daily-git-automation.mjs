#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";

const EXIT_OK = 0;
const EXIT_BLOCKED = 2;

class AutomationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function parseArgs(argv) {
  const options = { config: "", dryRun: false, execute: false, runId: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") {
      options.config = argv[++index] || "";
    } else if (argument === "--run-id") {
      options.runId = argv[++index] || "";
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--execute") {
      options.execute = true;
    } else {
      throw new AutomationError("unknown_argument", { argument });
    }
  }
  if (!options.config) throw new AutomationError("config_required");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(options.runId)) {
    throw new AutomationError("invalid_run_id");
  }
  if (options.dryRun === options.execute) {
    throw new AutomationError("exactly_one_mode_required");
  }
  return options;
}

function expandEnvironment(value) {
  return value.replace(/%([^%]+)%/gu, (_, name) => process.env[name] || "");
}

function resolveConfigPath(value, configDirectory) {
  const expanded = expandEnvironment(value);
  return resolve(
    isAbsolute(expanded) ? expanded : join(configDirectory, expanded),
  );
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
}

function validateScopePath(value, field) {
  const normalized = normalizePath(value);
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    isAbsolute(value) ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  ) {
    throw new AutomationError("invalid_scope_path", { field, value });
  }
  return normalized;
}

function loadConfig(configPath) {
  const absoluteConfig = resolve(configPath);
  const configDirectory = dirname(absoluteConfig);
  const config = JSON.parse(readFileSync(absoluteConfig, "utf8"));
  if (config.enabled !== true) throw new AutomationError("automation_disabled");
  if (!Array.isArray(config.allowedPaths) || config.allowedPaths.length === 0) {
    throw new AutomationError("allowed_paths_required");
  }
  const loaded = {
    ...config,
    // Keep the caller's absolute config path as an audit input.  Resolving a
    // repository root or a worktree path must never accidentally rebase this
    // path against a later cwd/config directory.
    configPath: absoluteConfig,
    repositoryRoot: resolveConfigPath(config.repositoryRoot, configDirectory),
    worktreeRoot: resolveConfigPath(config.worktreeRoot, configDirectory),
    receiptRoot: resolveConfigPath(config.receiptRoot, configDirectory),
    allowedPaths: config.allowedPaths.map((value) =>
      validateScopePath(value, "allowedPaths"),
    ),
    ignoredDirtyPaths: (config.ignoredDirtyPaths || []).map((value) =>
      validateScopePath(value, "ignoredDirtyPaths"),
    ),
    snapshotStabilityDelayMs: Number(config.snapshotStabilityDelayMs || 0),
    lockStaleMinutes: Number(config.lockStaleMinutes || 120),
    validationCommands: config.validationCommands || [],
  };
  if (!loaded.remote || !loaded.baseBranch) {
    throw new AutomationError("remote_and_base_branch_required");
  }
  if (
    !Number.isInteger(loaded.snapshotStabilityDelayMs) ||
    loaded.snapshotStabilityDelayMs < 0 ||
    loaded.snapshotStabilityDelayMs > 60_000
  ) {
    throw new AutomationError("invalid_stability_delay");
  }
  if (
    !Number.isInteger(loaded.lockStaleMinutes) ||
    loaded.lockStaleMinutes < 1 ||
    loaded.lockStaleMinutes > 1440
  ) {
    throw new AutomationError("invalid_lock_ttl");
  }
  return loaded;
}

function pathInside(parent, candidate) {
  const value = relative(resolve(parent), resolve(candidate));
  return (
    value === "" ||
    (!isAbsolute(value) && !value.startsWith(`..${sep}`) && value !== "..")
  );
}

function verifyInternalConfigTrust(config, baseRef) {
  // A config supplied from outside the repository is an explicit caller
  // input. Only a config owned by the target repository needs the remote-base
  // integrity check. A nested control repository can live physically below a
  // target root without belonging to the target repository.
  const configDirectory = dirname(config.configPath);
  if (!gitSucceeds(configDirectory, "rev-parse", "--show-toplevel")) return;
  const configRepositoryRoot = git(
    configDirectory,
    "rev-parse",
    "--show-toplevel",
  );
  if (resolve(configRepositoryRoot) !== resolve(config.repositoryRoot)) return;

  const relativeConfigPath = normalizePath(
    relative(resolve(config.repositoryRoot), resolve(config.configPath)),
  );
  if (
    !relativeConfigPath ||
    relativeConfigPath === "." ||
    relativeConfigPath.startsWith("../") ||
    relativeConfigPath.includes("/../") ||
    relativeConfigPath === ".git" ||
    relativeConfigPath.startsWith(".git/")
  ) {
    throw new AutomationError("invalid_internal_config_path", {
      config_path: config.configPath,
    });
  }

  let remoteConfig;
  try {
    remoteConfig = gitNull(
      config.repositoryRoot,
      "show",
      `${baseRef}:${relativeConfigPath}`,
    );
  } catch {
    throw new AutomationError("config_missing_from_remote_base", {
      config_path: relativeConfigPath,
      base_ref: baseRef,
    });
  }

  const localConfig = readFileSync(config.configPath);
  if (!Buffer.isBuffer(remoteConfig) || !remoteConfig.equals(localConfig)) {
    throw new AutomationError("config_modified_from_remote_base", {
      config_path: relativeConfigPath,
      base_ref: baseRef,
    });
  }
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new AutomationError("command_failed", {
      command,
      args,
      exit_code: error.status ?? null,
    });
  }
}

function gitInvocation(args) {
  const override = process.env.GIT_AUTOMATION_GIT_COMMAND;
  if (!override) return { command: "git", args };
  const prefix = process.env.GIT_AUTOMATION_GIT_PREFIX;
  return {
    command: override,
    args: prefix ? [prefix, ...args] : args,
  };
}

function git(cwd, ...args) {
  const invocation = gitInvocation(args);
  return run(invocation.command, invocation.args, cwd);
}

function gitNull(cwd, ...args) {
  const invocation = gitInvocation(args);
  try {
    return execFileSync(invocation.command, invocation.args, {
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    throw new AutomationError("git_command_failed", {
      args,
      exit_code: error.status ?? null,
    });
  }
}

function gitSucceeds(cwd, ...args) {
  const invocation = gitInvocation(args);
  try {
    execFileSync(invocation.command, invocation.args, {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function splitNull(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean).map(normalizePath);
}

function matchesScope(path, scopes) {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

function dirtyPaths(repositoryRoot) {
  const fields = splitNull(
    gitNull(
      repositoryRoot,
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ),
  );
  const paths = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    paths.push(normalizePath(entry.slice(3)));
    if (status.includes("R") || status.includes("C")) {
      paths.push(normalizePath(fields[++index]));
    }
  }
  return [...new Set(paths)].sort();
}

function hashFile(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    return createHash("sha256")
      .update(`symlink:${readlinkSync(path)}`)
      .digest("hex");
  }
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function snapshotGitMode(repositoryRoot, path, stat) {
  const staged = splitNull(
    gitNull(repositoryRoot, "ls-files", "--stage", "-z", "--", path),
  )[0];
  const trackedMode = staged?.match(/^(100644|100755|120000)\s/u)?.[1];
  if (trackedMode) return trackedMode;
  if (stat.isSymbolicLink()) return "120000";
  return (stat.mode & 0o111) !== 0 ? "100755" : "100644";
}

function repositoryRelation(repositoryRoot, baseRef) {
  const head = git(repositoryRoot, "rev-parse", "HEAD");
  const base = git(repositoryRoot, "rev-parse", baseRef);
  if (head === base) return { state: "equal", head, base };
  if (
    gitSucceeds(repositoryRoot, "merge-base", "--is-ancestor", head, baseRef)
  ) {
    return { state: "behind", head, base };
  }
  if (
    gitSucceeds(repositoryRoot, "merge-base", "--is-ancestor", baseRef, head)
  ) {
    return { state: "ahead", head, base };
  }
  return { state: "diverged", head, base };
}

function sourceManifest(config, baseRef, relation) {
  const dirtyTracked = splitNull(
    gitNull(
      config.repositoryRoot,
      "diff",
      "--name-only",
      "-z",
      "HEAD",
      "--",
      ...config.allowedPaths,
    ),
  );
  const untracked = splitNull(
    gitNull(
      config.repositoryRoot,
      "ls-files",
      "-o",
      "--exclude-standard",
      "-z",
      "--",
      ...config.allowedPaths,
    ),
  );
  const committed =
    relation.state === "ahead"
      ? splitNull(
          gitNull(
            config.repositoryRoot,
            "diff",
            "--name-only",
            "-z",
            `${baseRef}..HEAD`,
            "--",
            ...config.allowedPaths,
          ),
        )
      : [];
  const candidates = [
    ...new Set([...dirtyTracked, ...untracked, ...committed]),
  ].sort();
  if (relation.state === "behind") {
    const remoteChanged = new Set(
      splitNull(
        gitNull(
          config.repositoryRoot,
          "diff",
          "--name-only",
          "-z",
          `HEAD..${baseRef}`,
          "--",
          ...config.allowedPaths,
        ),
      ),
    );
    const conflicts = candidates.filter((path) => remoteChanged.has(path));
    if (conflicts.length > 0) {
      throw new AutomationError("snapshot_conflicts_with_remote", {
        paths: conflicts,
      });
    }
  }
  const files = candidates
    .filter((path) => existsSync(join(config.repositoryRoot, path)))
    .map((path) => {
      const absolutePath = join(config.repositoryRoot, path);
      const stat = lstatSync(absolutePath);
      return {
        path,
        sha256: hashFile(absolutePath),
        // Preserve executable/setuid bits in the isolated snapshot.  Git
        // records only the file mode bits relevant to checkout; retaining the
        // complete permission mask here also makes stability checks fail
        // closed if an agent changes mode while the snapshot is copied.
        mode: stat.isSymbolicLink() ? null : stat.mode & 0o7777,
        git_mode: snapshotGitMode(config.repositoryRoot, path, stat),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const deletedPaths = candidates
    .filter((path) => !existsSync(join(config.repositoryRoot, path)))
    .sort();
  return {
    source_head_sha: git(config.repositoryRoot, "rev-parse", "HEAD"),
    files,
    deleted_paths: deletedPaths,
  };
}

function manifestIdentity(manifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function wait(milliseconds) {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function copyManifest(config, manifest, worktreePath) {
  for (const relativePath of manifest.deleted_paths) {
    rmSync(join(worktreePath, relativePath), { force: true });
  }
  for (const item of manifest.files) {
    const source = join(config.repositoryRoot, item.path);
    const destination = join(worktreePath, item.path);
    mkdirSync(dirname(destination), { recursive: true });
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) {
      rmSync(destination, { force: true });
      symlinkSync(readlinkSync(source), destination);
    } else {
      copyFileSync(source, destination);
      if (item.mode !== null) chmodSync(destination, item.mode);
    }
  }
}

function runValidationCommands(config, worktreePath) {
  for (const command of config.validationCommands) {
    if (!command || typeof command.command !== "string") {
      throw new AutomationError("invalid_validation_command");
    }
    run(command.command, command.args || [], worktreePath);
  }
}

function provider(config, cwd, ...args) {
  const github = config.github;
  if (!github || typeof github.command !== "string") {
    throw new AutomationError("github_configuration_required");
  }
  return run(github.command, [...(github.prefixArgs || []), ...args], cwd);
}

function remoteBranchExists(repositoryRoot, remote, branch) {
  const invocation = gitInvocation([
    "ls-remote",
    "--exit-code",
    "--heads",
    remote,
    branch,
  ]);
  try {
    const output = execFileSync(invocation.command, invocation.args, {
      encoding: "utf8",
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const line = output.trim();
    return line
      ? { state: "present", oid: line.split(/\s+/u)[0] }
      : { state: "absent" };
  } catch (error) {
    // git ls-remote --exit-code reserves status 2 for a valid remote with no
    // matching ref.  Other statuses include missing remotes, auth failures,
    // and network errors; those are unknown and must never be treated as an
    // already-clean branch.
    if (error?.status === 2) return { state: "absent" };
    return {
      state: "unknown",
      exit_code: error?.status ?? null,
    };
  }
}

function applyManifestGitModes(manifest, worktreePath) {
  for (const item of manifest.files) {
    if (item.git_mode === "100755") {
      git(worktreePath, "update-index", "--chmod=+x", "--", item.path);
    } else if (item.git_mode === "100644") {
      git(worktreePath, "update-index", "--chmod=-x", "--", item.path);
    }
  }
}

function remoteCleanupSettings(config) {
  const settings = config.remoteCleanup || {};
  const configuredHours = Number(
    settings.ttlHours ?? config.remoteBranchTtlHours ?? 48,
  );
  const configuredMinutes = Number(
    settings.ttlMinutes ??
      (Number.isFinite(configuredHours) ? configuredHours * 60 : NaN),
  );
  return {
    enabled: settings.enabled === true,
    ttlMinutes: configuredMinutes,
  };
}

function exactAutomationBranch(config, runId, branch) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(runId || "")) return false;
  const expected = `${config.branchPrefix || "automation/"}${runId}`;
  return branch === expected;
}

function readExpiredRemoteReceipts(config) {
  const settings = remoteCleanupSettings(config);
  if (!settings.enabled) return [];
  if (!Number.isFinite(settings.ttlMinutes) || settings.ttlMinutes < 1) {
    throw new AutomationError("invalid_remote_cleanup_ttl");
  }
  if (!existsSync(config.receiptRoot)) return [];

  const now = Date.now();
  const expired = [];
  for (const entry of readdirSync(config.receiptRoot, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const active = entry.name.endsWith(".active.json");
    const runId = entry.name.slice(0, active ? -12 : -5);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(runId)) continue;
    const receiptPath = join(config.receiptRoot, entry.name);
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    } catch {
      const previousPath = `${receiptPath}.previous`;
      if (!active || !existsSync(previousPath)) {
        // Unknown receipt contents are never eligible for deletion.
        continue;
      }
      try {
        receipt = JSON.parse(readFileSync(previousPath, "utf8"));
      } catch {
        continue;
      }
    }
    if (active ? receipt?.status !== "active" : receipt?.status !== "blocked") {
      continue;
    }
    const createdAt = Date.parse(
      receipt.receipt_created_at ||
        receipt.updated_at ||
        receipt.created_at ||
        "",
    );
    const timestamp = Number.isFinite(createdAt)
      ? createdAt
      : statSync(receiptPath).mtimeMs;
    if (now - timestamp < settings.ttlMinutes * 60_000) continue;
    const artifacts = receipt.artifacts || {};
    if (!exactAutomationBranch(config, runId, artifacts.branch)) continue;
    expired.push({ runId, receiptPath, receipt, artifacts, active });
  }
  return expired;
}

function reconcileExpiredRemoteArtifacts(config) {
  const expired = readExpiredRemoteReceipts(config);
  if (expired.length === 0) return [];
  const reconciliation = [];
  for (const item of expired) {
    const branch = item.artifacts.branch;
    const status = {
      run_id: item.runId,
      branch,
      receipt_path: item.receiptPath,
      state: "retained",
    };
    const before = remoteBranchExists(
      config.repositoryRoot,
      config.remote,
      branch,
    );
    if (before.state === "unknown") {
      status.state = "unknown";
      status.reason = "remote_branch_status_unknown";
      reconciliation.push(status);
      continue;
    }
    if (before.state === "absent") {
      status.state = "already_absent";
      if (item.active) removeActiveReceipt(config, item.runId);
      reconciliation.push(status);
      continue;
    }

    const prNumber = Number(item.artifacts.pr_number);
    let pullRequest;
    try {
      if (Number.isInteger(prNumber) && prNumber > 0) {
        pullRequest = parseProviderJson(
          provider(
            config,
            config.repositoryRoot,
            "pr",
            "view",
            String(prNumber),
            "--json",
            "state,mergedAt,headRefName,headRefOid,baseRefName",
          ),
          "remote_cleanup_pr_readback_invalid",
        );
      } else {
        const matches = parseProviderJson(
          provider(
            config,
            config.repositoryRoot,
            "pr",
            "list",
            "--head",
            branch,
            "--state",
            "all",
            "--json",
            "number,state,mergedAt,headRefName,headRefOid,baseRefName",
          ),
          "remote_cleanup_pr_list_invalid",
        );
        if (!Array.isArray(matches) || matches.length > 1) {
          throw new AutomationError("remote_cleanup_pr_match_ambiguous");
        }
        pullRequest = matches[0] || null;
      }
    } catch (error) {
      status.state = "unknown";
      status.reason =
        error instanceof AutomationError
          ? error.code
          : "remote_cleanup_pr_readback_unknown";
      reconciliation.push(status);
      continue;
    }
    if (
      !item.artifacts.commit_sha ||
      before.oid !== item.artifacts.commit_sha
    ) {
      status.state = "unknown";
      status.reason = "remote_cleanup_commit_mismatch";
      reconciliation.push(status);
      continue;
    }
    if (pullRequest) {
      // Ref mismatches are an unknown ownership state; never delete by PR
      // number alone, and never delete an open or otherwise unmerged PR.
      if (
        pullRequest.headRefName !== branch ||
        pullRequest.headRefOid !== item.artifacts.commit_sha ||
        pullRequest.baseRefName !== config.baseBranch
      ) {
        status.state = "unknown";
        status.reason = "remote_cleanup_ref_mismatch";
        reconciliation.push(status);
        continue;
      }
      if (pullRequest.state !== "MERGED" || !pullRequest.mergedAt) {
        status.state = "retained";
        status.reason = "pull_request_not_merged";
        reconciliation.push(status);
        continue;
      }
    }

    try {
      git(config.repositoryRoot, "push", config.remote, "--delete", branch);
    } catch {
      status.state = "unknown";
      status.reason = "remote_cleanup_delete_unknown";
      reconciliation.push(status);
      continue;
    }
    const after = remoteBranchExists(
      config.repositoryRoot,
      config.remote,
      branch,
    );
    if (after.state === "absent") {
      status.state = "deleted";
      if (item.active) removeActiveReceipt(config, item.runId);
    } else if (after.state === "present") {
      status.state = "retained";
      status.reason = "remote_cleanup_delete_pending";
    } else {
      status.state = "unknown";
      status.reason = "remote_branch_status_unknown";
    }
    reconciliation.push(status);
  }
  return reconciliation;
}

function parseProviderJson(raw, code) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AutomationError(code);
  }
}

function verifyGitHubGates(config, worktreePath, artifacts) {
  const github = config.github;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(github?.repository || "")) {
    throw new AutomationError("invalid_github_repository");
  }
  if (
    !Array.isArray(github.requiredChecks) ||
    github.requiredChecks.length === 0
  ) {
    throw new AutomationError("required_checks_configuration_missing");
  }
  const repository = parseProviderJson(
    provider(config, worktreePath, "api", `repos/${github.repository}`),
    "repository_readback_invalid",
  );
  if (repository.allow_auto_merge !== true) {
    throw new AutomationError("github_auto_merge_disabled");
  }
  const protection = parseProviderJson(
    provider(
      config,
      worktreePath,
      "api",
      `repos/${github.repository}/branches/${config.baseBranch}/protection`,
    ),
    "branch_protection_readback_invalid",
  );
  if (!protection.required_status_checks) {
    throw new AutomationError("required_status_checks_missing");
  }
  const contexts = new Set([
    ...(protection.required_status_checks.contexts || []),
    ...(protection.required_status_checks.checks || []).map(
      (check) => check.context,
    ),
  ]);
  const missing = github.requiredChecks.filter((check) => !contexts.has(check));
  if (missing.length > 0) {
    throw new AutomationError("required_status_checks_missing", {
      checks: missing,
    });
  }
  const approvals =
    protection.required_pull_request_reviews?.required_approving_review_count ||
    0;
  if (approvals !== 0) {
    throw new AutomationError("manual_approval_required", { approvals });
  }
  artifacts.github_gates_verified = true;
}

function verifyPullRequestRefs(config, worktreePath, artifacts, phase) {
  const readback = parseProviderJson(
    provider(
      config,
      worktreePath,
      "pr",
      "view",
      String(artifacts.pr_number),
      "--json",
      "state,headRefOid,baseRefName",
    ),
    `pull_request_${phase}_readback_invalid`,
  );
  if (readback.headRefOid !== artifacts.commit_sha) {
    throw new AutomationError("pull_request_head_mismatch", {
      phase,
      expected: artifacts.commit_sha,
      observed: readback.headRefOid || null,
    });
  }
  if (readback.baseRefName !== config.baseBranch) {
    throw new AutomationError("pull_request_base_mismatch", {
      phase,
      expected: config.baseBranch,
      observed: readback.baseRefName || null,
    });
  }
  return readback;
}

function completeGitHubFlow(config, worktreePath, artifacts) {
  const github = config.github;
  const branch = `${config.branchPrefix || "automation/"}${artifacts.run_id}`;
  git(config.repositoryRoot, "check-ref-format", "--branch", branch);
  artifacts.branch = branch;

  git(worktreePath, "switch", "--create", branch);
  git(
    worktreePath,
    "config",
    "user.name",
    config.gitIdentity?.name || "automation[bot]",
  );
  git(
    worktreePath,
    "config",
    "user.email",
    config.gitIdentity?.email || "automation@example.invalid",
  );
  git(
    worktreePath,
    "commit",
    "-m",
    `chore: automated snapshot ${artifacts.run_id}`,
    "-m",
    `automation-run:${artifacts.run_id}`,
  );
  artifacts.commit_sha = git(worktreePath, "rev-parse", "HEAD");
  updateActiveReceipt(config, artifacts.run_id, "push_pending", {
    branch,
    commit_sha: artifacts.commit_sha,
    base_branch: config.baseBranch,
  });
  git(worktreePath, "push", "--set-upstream", config.remote, branch);
  artifacts.remote_branch_cleanup = "retained";
  updateActiveReceipt(config, artifacts.run_id, "push_complete", {
    remote_branch_cleanup: "retained",
  });

  updateActiveReceipt(config, artifacts.run_id, "pr_create_pending", {});
  const prUrl = provider(
    config,
    worktreePath,
    "pr",
    "create",
    "--base",
    config.baseBranch,
    "--head",
    branch,
    "--title",
    `chore: automated snapshot ${artifacts.run_id}`,
    "--body",
    `Automated isolated snapshot ${artifacts.run_id}.`,
  );
  const prNumber = Number(prUrl.split("/").at(-1));
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new AutomationError("invalid_pull_request_readback", {
      pr_url: prUrl,
    });
  }
  artifacts.pr_number = prNumber;
  artifacts.pr_url = prUrl;
  updateActiveReceipt(config, artifacts.run_id, "pr_created", {
    pr_number: prNumber,
    pr_url: prUrl,
  });

  provider(
    config,
    worktreePath,
    "workflow",
    "run",
    github.qualityWorkflow,
    "--ref",
    branch,
  );
  let qualityRunId = "";
  const qualityAttempts = Number(github.qualityRunPollAttempts || 60);
  const qualityInterval = Number(github.qualityRunPollIntervalMs || 2000);
  for (let attempt = 0; attempt < qualityAttempts; attempt += 1) {
    qualityRunId = provider(
      config,
      worktreePath,
      "run",
      "list",
      "--workflow",
      github.qualityWorkflow,
      "--branch",
      branch,
      "--event",
      "workflow_dispatch",
      "--limit",
      "1",
      "--json",
      "databaseId",
      "--jq",
      ".[0].databaseId // empty",
    );
    if (qualityRunId) break;
    wait(qualityInterval);
  }
  if (!qualityRunId) throw new AutomationError("quality_run_not_found");
  artifacts.quality_run_id = qualityRunId;
  provider(config, worktreePath, "run", "watch", qualityRunId, "--exit-status");
  provider(config, worktreePath, "pr", "checks", String(prNumber), "--watch");

  // The provider must prove that the PR still points at the exact commit we
  // staged and at the configured base before we request a merge.
  verifyPullRequestRefs(config, worktreePath, artifacts, "before_merge");

  const mergeMethod = github.mergeMethod || "merge";
  if (!new Set(["merge", "squash", "rebase"]).has(mergeMethod)) {
    throw new AutomationError("invalid_merge_method");
  }
  provider(
    config,
    worktreePath,
    "pr",
    "merge",
    String(prNumber),
    `--${mergeMethod}`,
    "--auto",
  );

  let mergeReadback = null;
  const attempts = Number(github.mergePollAttempts || 60);
  const interval = Number(github.mergePollIntervalMs || 5000);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const raw = provider(
      config,
      worktreePath,
      "pr",
      "view",
      String(prNumber),
      "--json",
      "state,mergedAt,mergeCommit,headRefOid,baseRefName",
    );
    mergeReadback = parseProviderJson(raw, "merge_readback_invalid");
    if (mergeReadback.headRefOid !== artifacts.commit_sha) {
      throw new AutomationError("pull_request_head_mismatch", {
        phase: "after_merge",
        expected: artifacts.commit_sha,
        observed: mergeReadback.headRefOid || null,
      });
    }
    if (mergeReadback.baseRefName !== config.baseBranch) {
      throw new AutomationError("pull_request_base_mismatch", {
        phase: "after_merge",
        expected: config.baseBranch,
        observed: mergeReadback.baseRefName || null,
      });
    }
    if (mergeReadback.state === "MERGED") break;
    if (mergeReadback.state === "CLOSED") {
      throw new AutomationError("pull_request_closed_without_merge");
    }
    wait(interval);
  }
  if (
    mergeReadback?.state !== "MERGED" ||
    !mergeReadback.mergedAt ||
    !mergeReadback.mergeCommit?.oid
  ) {
    throw new AutomationError("merge_readback_unknown", {
      state: mergeReadback?.state || null,
    });
  }
  artifacts.merged_at = mergeReadback.mergedAt;
  artifacts.merge_commit_sha = mergeReadback.mergeCommit.oid;

  const beforeCleanup = remoteBranchExists(
    config.repositoryRoot,
    config.remote,
    branch,
  );
  if (beforeCleanup.state === "unknown") {
    artifacts.remote_branch_cleanup = "unknown";
    throw new AutomationError("remote_branch_status_unknown", {
      phase: "before_delete",
      branch,
      ...beforeCleanup,
    });
  }
  if (beforeCleanup.state === "present") {
    artifacts.remote_branch_cleanup = "deletion_requested";
    try {
      git(config.repositoryRoot, "push", config.remote, "--delete", branch);
    } catch (error) {
      artifacts.remote_branch_cleanup = "unknown";
      throw new AutomationError("remote_branch_cleanup_unknown", {
        branch,
        cause: error instanceof AutomationError ? error.code : "unknown",
      });
    }
  }

  const afterCleanup = remoteBranchExists(
    config.repositoryRoot,
    config.remote,
    branch,
  );
  if (afterCleanup.state === "unknown") {
    artifacts.remote_branch_cleanup = "unknown";
    throw new AutomationError("remote_branch_status_unknown", {
      phase: "after_delete",
      branch,
      ...afterCleanup,
    });
  }
  if (afterCleanup.state === "present") {
    artifacts.remote_branch_cleanup = "retained";
    throw new AutomationError("remote_branch_cleanup_pending", { branch });
  }
  artifacts.remote_branch_cleanup =
    beforeCleanup.state === "present" ? "deleted" : "already_absent";
}

function forbiddenSnapshotPaths(config, changedPaths) {
  const extensions = (config.forbiddenExtensions || []).map((value) =>
    String(value).toLowerCase(),
  );
  return changedPaths.filter((path) => {
    const lower = path.toLowerCase();
    const name = lower.split("/").at(-1);
    return extensions.some((extension) => {
      if (extension === ".env") {
        return (
          lower.endsWith(".env") ||
          (name.startsWith(".env.") && name !== ".env.example")
        );
      }
      return lower.endsWith(extension);
    });
  });
}

function secretPatternPaths(worktreePath, changedPaths) {
  const privateKeyPattern = new RegExp(
    ["-----BEGIN ", "(?:RSA|EC|OPENSSH|DSA|PGP) ", "PRIVATE KEY-----"].join(""),
    "u",
  );
  const patterns = [
    privateKeyPattern,
    /AKIA[0-9A-Z]{16}/u,
    /gh[pousr]_[A-Za-z0-9_]{20,}/u,
    /[0-9]{8,10}:[A-Za-z0-9_-]{30,}/u,
  ];
  const hits = [];
  for (const path of changedPaths) {
    const absolute = join(worktreePath, path);
    if (!existsSync(absolute)) continue;
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
    const content = readFileSync(absolute);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    if (patterns.some((pattern) => pattern.test(text))) hits.push(path);
  }
  return hits;
}

function writeReceipt(config, runId, result) {
  mkdirSync(config.receiptRoot, { recursive: true });
  const receiptPath = join(config.receiptRoot, `${runId}.json`);
  result.receipt_created_at = new Date().toISOString();
  writeFileSync(receiptPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
  });
  return receiptPath;
}

function activeReceiptPath(config, runId) {
  return join(config.receiptRoot, `${runId}.active.json`);
}

function finalReceiptPath(config, runId) {
  return join(config.receiptRoot, `${runId}.json`);
}

function createActiveReceipt(config, runId) {
  const activePath = activeReceiptPath(config, runId);
  try {
    writeFileSync(
      activePath,
      `${JSON.stringify({
        run_id: runId,
        pid: process.pid,
        created_at: new Date().toISOString(),
        status: "active",
      })}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new AutomationError("run_receipt_exists", {
        receipt_path: activePath,
        receipt_kind: "active",
      });
    }
    throw error;
  }
  return activePath;
}

function updateActiveReceipt(config, runId, phase, artifacts) {
  const activePath = activeReceiptPath(config, runId);
  const previousPath = `${activePath}.previous`;
  const temporaryPath = `${activePath}.${process.pid}.tmp`;
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(activePath, "utf8"));
  } catch {
    throw new AutomationError("active_receipt_unreadable", {
      receipt_path: activePath,
    });
  }
  receipt.phase = phase;
  receipt.updated_at = new Date().toISOString();
  receipt.artifacts = {
    ...(receipt.artifacts || {}),
    ...artifacts,
  };
  copyFileSync(activePath, previousPath);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    renameSync(temporaryPath, activePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function removeActiveReceipt(config, runId) {
  const activePath = activeReceiptPath(config, runId);
  rmSync(activePath, { force: true });
  rmSync(`${activePath}.previous`, { force: true });
}

function acquireRunLock(config, runId) {
  mkdirSync(config.receiptRoot, { recursive: true });
  const activePath = activeReceiptPath(config, runId);
  const receiptPath = finalReceiptPath(config, runId);
  if (existsSync(activePath) || existsSync(receiptPath)) {
    throw new AutomationError("run_receipt_exists", {
      receipt_path: existsSync(activePath) ? activePath : receiptPath,
      receipt_kind: existsSync(activePath) ? "active" : "final",
    });
  }
  const lockPath = join(config.receiptRoot, "automation.lock");
  const payload = `${JSON.stringify({ run_id: runId, pid: process.pid, created_at: new Date().toISOString() })}\n`;
  const create = () => writeFileSync(lockPath, payload, { flag: "wx" });
  try {
    create();
  } catch (error) {
    if (error?.code === "EEXIST") {
      const observed = readFileSync(lockPath, "utf8");
      let existing;
      try {
        existing = JSON.parse(observed);
      } catch {
        throw new AutomationError("automation_lock_held", {
          lock_path: lockPath,
          reason: "invalid_lock_receipt",
        });
      }
      const createdAt = Date.parse(existing.created_at || "");
      const ageMinutes = (Date.now() - createdAt) / 60_000;
      let processRunning = true;
      if (Number.isInteger(existing.pid) && existing.pid > 0) {
        try {
          process.kill(existing.pid, 0);
        } catch (processError) {
          processRunning = processError?.code !== "ESRCH";
        }
      }
      if (
        Number.isFinite(ageMinutes) &&
        ageMinutes >= config.lockStaleMinutes &&
        !processRunning &&
        readFileSync(lockPath, "utf8") === observed
      ) {
        cleanupStaleRun(config, existing.run_id);
        rmSync(lockPath, { force: true });
        create();
      } else {
        throw new AutomationError("automation_lock_held", {
          lock_path: lockPath,
          run_id: existing.run_id || null,
        });
      }
    } else {
      throw error;
    }
  }
  return lockPath;
}

function cleanupStaleRun(config, runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(runId || "")) {
    throw new AutomationError("stale_cleanup_invalid_run_id");
  }
  const worktreePath = join(config.worktreeRoot, runId);
  if (
    !pathInside(config.worktreeRoot, worktreePath) ||
    resolve(worktreePath) === resolve(config.worktreeRoot)
  ) {
    throw new AutomationError("stale_cleanup_path_outside_root");
  }
  try {
    if (existsSync(worktreePath)) {
      git(config.repositoryRoot, "worktree", "remove", "--force", worktreePath);
    }
    git(config.repositoryRoot, "worktree", "prune", "--expire", "now");
    const branch = `${config.branchPrefix || "automation/"}${runId}`;
    if (git(config.repositoryRoot, "branch", "--list", branch)) {
      git(config.repositoryRoot, "branch", "--delete", "--force", branch);
    }
  } catch (error) {
    throw new AutomationError("stale_cleanup_failed", {
      run_id: runId,
      worktree_path: worktreePath,
      cause: error instanceof AutomationError ? error.code : "unknown",
    });
  }
}

function result(status, summary, artifacts, nextActions = []) {
  return { status, summary, next_actions: nextActions, artifacts };
}

function execute(options, config) {
  const repositoryRoot = git(
    config.repositoryRoot,
    "rev-parse",
    "--show-toplevel",
  );
  if (resolve(repositoryRoot) !== resolve(config.repositoryRoot)) {
    throw new AutomationError("unexpected_repository_root");
  }
  if (pathInside(config.repositoryRoot, config.worktreeRoot)) {
    throw new AutomationError("worktree_root_must_be_external");
  }
  if (pathInside(config.repositoryRoot, config.receiptRoot)) {
    throw new AutomationError("receipt_root_must_be_external");
  }

  const baseRef = `${config.remote}/${config.baseBranch}`;
  git(
    config.repositoryRoot,
    "fetch",
    "--no-tags",
    config.remote,
    config.baseBranch,
  );
  git(config.repositoryRoot, "rev-parse", "--verify", baseRef);
  if (options.execute) verifyInternalConfigTrust(config, baseRef);

  const unknownDirtyPaths = dirtyPaths(config.repositoryRoot).filter(
    (path) =>
      !matchesScope(path, config.allowedPaths) &&
      !matchesScope(path, config.ignoredDirtyPaths),
  );
  if (unknownDirtyPaths.length > 0) {
    throw new AutomationError("unknown_dirty_paths", {
      paths: unknownDirtyPaths,
    });
  }

  const remoteReconciliation = options.execute
    ? reconcileExpiredRemoteArtifacts(config)
    : [];
  const unknownRemoteArtifacts = remoteReconciliation.filter(
    (item) => item.state === "unknown",
  );
  if (unknownRemoteArtifacts.length > 0) {
    throw new AutomationError("remote_cleanup_unknown", {
      artifacts: unknownRemoteArtifacts,
    });
  }

  const relation = repositoryRelation(config.repositoryRoot, baseRef);
  if (relation.state === "diverged") {
    throw new AutomationError("local_and_remote_diverged", {
      local_head: relation.head,
      remote_head: relation.base,
    });
  }
  const manifestBefore = sourceManifest(config, baseRef, relation);
  wait(config.snapshotStabilityDelayMs);
  const manifestStable = sourceManifest(config, baseRef, relation);
  if (manifestIdentity(manifestBefore) !== manifestIdentity(manifestStable)) {
    throw new AutomationError("source_changed_during_snapshot");
  }

  mkdirSync(config.worktreeRoot, { recursive: true });
  const worktreePath = join(config.worktreeRoot, options.runId);
  if (existsSync(worktreePath)) {
    throw new AutomationError("worktree_path_exists", {
      worktree_path: worktreePath,
    });
  }

  const artifacts = {
    run_id: options.runId,
    config_path: config.configPath,
    repository_root: config.repositoryRoot,
    base_ref: baseRef,
    base_sha: git(config.repositoryRoot, "rev-parse", baseRef),
    source_relation: relation.state,
    source_head_sha: manifestStable.source_head_sha,
    worktree_path: worktreePath,
    manifest_sha256: manifestIdentity(manifestStable),
    changed: false,
    changed_paths: [],
    remote_reconciliation: remoteReconciliation,
    cleanup_status: "not_started",
  };
  let worktreeAdded = false;
  let primaryResult;

  try {
    git(
      config.repositoryRoot,
      "worktree",
      "add",
      "--detach",
      worktreePath,
      baseRef,
    );
    worktreeAdded = true;
    copyManifest(config, manifestStable, worktreePath);
    const manifestAfter = sourceManifest(config, baseRef, relation);
    if (manifestIdentity(manifestStable) !== manifestIdentity(manifestAfter)) {
      throw new AutomationError("source_changed_during_copy");
    }
    git(worktreePath, "add", "-A", "--", ...config.allowedPaths);
    applyManifestGitModes(manifestStable, worktreePath);
    git(worktreePath, "diff", "--cached", "--check");
    artifacts.changed_paths = splitNull(
      gitNull(worktreePath, "diff", "--cached", "--name-only", "-z"),
    ).sort();
    artifacts.changed = artifacts.changed_paths.length > 0;
    const forbiddenPaths = forbiddenSnapshotPaths(
      config,
      artifacts.changed_paths,
    );
    if (forbiddenPaths.length > 0) {
      throw new AutomationError("forbidden_snapshot_path", {
        paths: forbiddenPaths,
      });
    }
    const secretPaths = secretPatternPaths(
      worktreePath,
      artifacts.changed_paths,
    );
    if (secretPaths.length > 0) {
      throw new AutomationError("secret_pattern_detected", {
        paths: secretPaths,
      });
    }
    runValidationCommands(config, worktreePath);
    if (options.execute && artifacts.changed) {
      verifyGitHubGates(config, worktreePath, artifacts);
      completeGitHubFlow(config, worktreePath, artifacts);
      primaryResult = result("verified", "merge_verified", artifacts);
    } else if (options.execute) {
      primaryResult = result("verified", "no_changes", artifacts);
    } else {
      primaryResult = result(
        "verified",
        "isolated_snapshot_validated",
        artifacts,
        [
          "Run --execute only with separately authorized provider settings and credentials.",
        ],
      );
    }
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "snapshot_failed";
    primaryResult = result("blocked", code, {
      ...artifacts,
      error_details: error instanceof AutomationError ? error.details : {},
    });
  } finally {
    if (worktreeAdded) {
      try {
        git(
          config.repositoryRoot,
          "worktree",
          "remove",
          "--force",
          worktreePath,
        );
        git(config.repositoryRoot, "worktree", "prune", "--expire", "now");
        artifacts.cleanup_status = "removed";
      } catch {
        artifacts.cleanup_status = "cleanup_pending";
      }
    } else {
      artifacts.cleanup_status = "not_created";
    }
    if (artifacts.branch) {
      try {
        git(
          config.repositoryRoot,
          "branch",
          "--delete",
          "--force",
          artifacts.branch,
        );
        artifacts.local_branch_cleanup = "deleted";
      } catch {
        artifacts.local_branch_cleanup = "cleanup_pending";
      }
    }
  }
  primaryResult.artifacts.cleanup_status = artifacts.cleanup_status;
  if (artifacts.local_branch_cleanup) {
    primaryResult.artifacts.local_branch_cleanup =
      artifacts.local_branch_cleanup;
  }
  if (
    primaryResult.status === "verified" &&
    (artifacts.cleanup_status !== "removed" ||
      artifacts.local_branch_cleanup === "cleanup_pending")
  ) {
    primaryResult.status = "blocked";
    primaryResult.summary = "cleanup_pending";
    primaryResult.next_actions = [
      "Reconcile the exact worktree and local branch receipt before retrying.",
    ];
  }
  return primaryResult;
}

let config;
let options;
let finalResult;
let exitCode = EXIT_OK;
let lockPath = null;
let activePath = null;
let activeCreated = false;

try {
  options = parseArgs(process.argv.slice(2));
  config = loadConfig(options.config);
  lockPath = acquireRunLock(config, options.runId);
  activePath = createActiveReceipt(config, options.runId);
  activeCreated = true;
  finalResult = execute(options, config);
  if (finalResult.status !== "verified") exitCode = EXIT_BLOCKED;
  finalResult.artifacts.receipt_path = writeReceipt(
    config,
    options.runId,
    finalResult,
  );
  // The active marker is intentionally removed only after the final receipt
  // has been durably created.  A crash or write failure leaves it behind and
  // forces the next invocation to reconcile instead of duplicating a run.
  removeActiveReceipt(config, options.runId);
} catch (error) {
  const code =
    error instanceof AutomationError ? error.code : "automation_failed";
  if (finalResult) {
    finalResult = result("blocked", "final_receipt_write_failed", {
      ...finalResult.artifacts,
      error_details: {
        cause: code,
        ...(error instanceof AutomationError ? error.details : {}),
      },
    });
  } else {
    finalResult = result("blocked", code, {
      run_id: options?.runId || null,
      error_details:
        error instanceof AutomationError
          ? error.details
          : {
              error_code: error?.code || null,
              error_message: error?.message || String(error),
            },
    });
  }
  exitCode = EXIT_BLOCKED;
  // Duplicate active/final receipts are a hard admission failure; do not
  // create a second final receipt for the same run id.  For failures after
  // our own active marker was created, retain that marker until a final
  // receipt write succeeds.
  if (
    config &&
    options?.runId &&
    (activeCreated ||
      (!existsSync(activeReceiptPath(config, options.runId)) &&
        !existsSync(finalReceiptPath(config, options.runId))))
  ) {
    try {
      finalResult.artifacts.receipt_path = writeReceipt(
        config,
        options.runId,
        finalResult,
      );
      if (activeCreated && activePath) {
        removeActiveReceipt(config, options.runId);
      }
    } catch {
      finalResult.artifacts.receipt_path = null;
    }
  }
} finally {
  // Lock cleanup is independent of the active/final receipt lifecycle.  If
  // final receipt persistence failed, the active receipt remains as the
  // durable reconciliation marker while the mutex is released.
  if (lockPath) rmSync(lockPath, { force: true });
}

process.stdout.write(`${JSON.stringify(finalResult)}\n`);
process.exitCode = exitCode;
