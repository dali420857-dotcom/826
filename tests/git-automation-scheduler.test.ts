import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20_000 });

const REGISTER_SCRIPT = resolve(
  "scripts/git-automation/Register-DailyGitAutomationTask.ps1",
);
const INVOKE_SCRIPT = resolve(
  "scripts/git-automation/Invoke-DailyGitAutomation.ps1",
);
const temporaryRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository(withSchedule: boolean) {
  const root = mkdtempSync(join(tmpdir(), "git-automation-scheduler-"));
  temporaryRoots.push(root);
  const origin = join(root, "origin.git");
  const repository = join(root, "repository");
  const childConfigPath = join(root, "repository.json");
  const configPath = join(root, "fleet.json");

  git(root, "init", "--bare", origin);
  git(root, "clone", origin, repository);
  git(repository, "config", "user.name", "Scheduler Test");
  git(repository, "config", "user.email", "scheduler@example.invalid");
  git(repository, "switch", "-c", "main");
  writeFileSync(join(repository, "README.md"), "scheduler test\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "-m", "initial");
  git(repository, "push", "-u", "origin", "main");

  if (withSchedule) {
    mkdirSync(join(repository, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(repository, ".github", "workflows", "automation.yml"),
      [
        "name: duplicate schedule guard",
        "on:",
        "  schedule:",
        '    - cron: "0 1 * * *"',
        "",
      ].join("\n"),
    );
  }

  writeFileSync(
    childConfigPath,
    JSON.stringify({ enabled: true, repositoryRoot: repository }, null, 2),
  );
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        enabled: true,
        repositories: [{ id: "repository", configPath: childConfigPath }],
      },
      null,
      2,
    ),
  );
  return { root, repository, configPath };
}

function invoke(configPath: string, ...args: string[]) {
  return spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      REGISTER_SCRIPT,
      "-ConfigPath",
      configPath,
      ...args,
    ],
    { encoding: "utf8" },
  );
}

function createFleetInvocationFixture() {
  const root = mkdtempSync(join(tmpdir(), "git-automation-fleet-"));
  temporaryRoots.push(root);
  const repositories: Array<{
    id: string;
    repository: string;
    configPath: string;
  }> = [];

  for (const [index, id] of ["blocked", "verified"].entries()) {
    const origin = join(root, `${id}.origin.git`);
    const repository = join(root, id);
    const configPath = join(root, `${id}.json`);
    git(root, "init", "--bare", origin);
    git(root, "clone", origin, repository);
    git(repository, "config", "user.name", "Fleet Test");
    git(repository, "config", "user.email", "fleet@example.invalid");
    git(repository, "switch", "-c", "main");
    writeFileSync(join(repository, "README.md"), `${id}\n`);
    git(repository, "add", "README.md");
    git(repository, "commit", "-m", "initial");
    git(repository, "push", "-u", "origin", "main");

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          enabled: index === 1,
          repositoryRoot: repository,
          remote: "origin",
          baseBranch: "main",
          branchPrefix: "automation/",
          worktreeRoot: join(root, `${id}-worktrees`),
          receiptRoot: join(root, `${id}-receipts`),
          allowedPaths: ["README.md"],
          ignoredDirtyPaths: [],
          forbiddenExtensions: [],
          snapshotStabilityDelayMs: 0,
          lockStaleMinutes: 120,
          remoteCleanup: { enabled: false, ttlHours: 48 },
          deployment: {
            mode: "not_applicable",
            reason: "scheduler fixture has no deployment target",
          },
          github: {
            command: "gh",
            prefixArgs: [],
            repository: `test/${id}`,
            qualityWorkflow: "quality.yml",
            requiredChecks: [],
            mergeMethod: "merge",
            qualityRunPollAttempts: 1,
            qualityRunPollIntervalMs: 0,
            mergePollAttempts: 1,
            mergePollIntervalMs: 0,
          },
          validationCommands: [],
        },
        null,
        2,
      ),
    );
    repositories.push({ id, repository, configPath });
  }

  const configPath = join(root, "fleet.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        enabled: true,
        repositories: repositories.map(
          ({ id, configPath: childConfigPath }) => ({
            id,
            configPath: childConfigPath,
          }),
        ),
      },
      null,
      2,
    ),
  );
  return { root, configPath, repositories };
}

function invokeFleet(configPath: string, ...args: string[]) {
  const nodePath = process.execPath;
  const locator = process.platform === "win32" ? "where" : "which";
  const gitPath = execFileSync(locator, ["git"], { encoding: "utf8" })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!gitPath) throw new Error("git executable not found");
  return spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      INVOKE_SCRIPT,
      "-ConfigPath",
      configPath,
      "-NodePath",
      nodePath,
      "-GitPath",
      gitPath,
      "-GitHubCliPath",
      gitPath,
      ...args,
    ],
    { encoding: "utf8" },
  );
}

function currentTimeZoneId() {
  return execFileSync(
    "pwsh",
    ["-NoProfile", "-Command", "[TimeZoneInfo]::Local.Id"],
    { encoding: "utf8" },
  ).trim();
}

function invokeWithTaskSchedulerMock(
  configPath: string,
  root: string,
  ...args: string[]
) {
  const driverPath = join(root, "mock-scheduled-task.ps1");
  const logPath = join(root, "mock-scheduled-task.json");
  writeFileSync(
    driverPath,
    [
      "$ErrorActionPreference = 'Stop'",
      "function New-ScheduledTaskAction { param([string]$Execute, [string]$Argument) [pscustomobject]@{ Execute = $Execute; Arguments = $Argument } }",
      "function New-ScheduledTaskTrigger { param([switch]$Daily, [string]$At) [pscustomobject]@{ Daily = $Daily; At = $At } }",
      "function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable, [switch]$WakeToRun, [switch]$RunOnlyIfNetworkAvailable, [string]$MultipleInstances, [TimeSpan]$ExecutionTimeLimit) [pscustomobject]@{ StartWhenAvailable = $StartWhenAvailable; WakeToRun = $WakeToRun; RunOnlyIfNetworkAvailable = $RunOnlyIfNetworkAvailable; MultipleInstances = $MultipleInstances; ExecutionTimeLimit = $ExecutionTimeLimit } }",
      "function New-ScheduledTaskPrincipal { param([string]$UserId, [string]$LogonType, [string]$RunLevel) [pscustomobject]@{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel } }",
      "function New-ScheduledTask { param($Action, $Trigger, $Settings, $Principal, [string]$Description) $script:task = [pscustomobject]@{ Actions = @($Action); Triggers = @($Trigger); Settings = $Settings; Principal = $Principal; Description = $Description }; return $script:task }",
      "function Register-ScheduledTask { param([string]$TaskName, $InputObject, [switch]$Force) $script:registered = [pscustomobject]@{ TaskName = $TaskName; Actions = $InputObject.Actions; Settings = $InputObject.Settings; Principal = $InputObject.Principal }; Set-Content -LiteralPath $env:SCHEDULER_MOCK_LOG -Value ($script:registered | ConvertTo-Json -Depth 5) }",
      "function Get-ScheduledTask { param([string]$TaskName) return [pscustomobject]@{ TaskName = $script:registered.TaskName; Actions = $script:registered.Actions; Settings = $script:registered.Settings; Principal = $script:registered.Principal } }",
      "function Get-ScheduledTaskInfo { param([string]$TaskName) [pscustomobject]@{ NextRunTime = (Get-Date).AddDays(1); LastTaskResult = 0 } }",
      "& $env:SCHEDULER_REGISTER_SCRIPT -ConfigPath $env:SCHEDULER_CONFIG_PATH @args",
      "exit $LASTEXITCODE",
    ].join("\n"),
  );
  return {
    execution: spawnSync("pwsh", ["-NoProfile", "-File", driverPath, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        SCHEDULER_REGISTER_SCRIPT: REGISTER_SCRIPT,
        SCHEDULER_CONFIG_PATH: configPath,
        SCHEDULER_MOCK_LOG: logPath,
      },
    }),
    logPath,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("daily Git automation scheduler registration", () => {
  it("reports timezone and duplicate GitHub schedule readiness without writing", () => {
    const { configPath, repository } = createRepository(true);
    const statusBefore = git(
      repository,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    );

    const execution = invoke(configPath);

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    const plan = JSON.parse(execution.stdout);
    expect(plan).toMatchObject({
      status: "plan_only",
      executable: expect.any(String),
      readiness: {
        current_timezone_id: expect.any(String),
        required_timezone_id: "Pacific Standard Time",
        repository_count: 1,
      },
    });
    expect(isAbsolute(plan.executable)).toBe(true);
    for (const path of Object.values(plan.readiness.executables)) {
      expect(path === null || isAbsolute(path)).toBe(true);
    }
    expect(plan.arguments).toContain("-NodePath");
    expect(plan.arguments).toContain("-GitPath");
    expect(plan.arguments).toContain("-GitHubCliPath");
    expect(plan.readiness.conflicts).toContain(
      "github_schedule_enabled:repository",
    );
    expect(resolve(plan.readiness.repositories[0].repository_root)).toBe(
      resolve(repository),
    );
    expect(plan.readiness.repositories[0].github_schedule_enabled).toBe(true);
    expect(
      git(repository, "status", "--porcelain=v1", "--untracked-files=all"),
    ).toBe(statusBefore);
  });

  it("blocks -Register before Task Scheduler mutation when GitHub schedule is enabled", () => {
    const { configPath } = createRepository(true);

    const execution = invoke(configPath, "-Register");

    expect(execution.status).toBe(2);
    expect(execution.stderr).toBe("");
    const result = JSON.parse(execution.stdout);
    expect(result).toMatchObject({
      status: "blocked",
      readiness: { repository_count: 1 },
    });
    expect(result.readiness.conflicts).toContain(
      "github_schedule_enabled:repository",
    );
  });

  it("reports a deterministic timezone mismatch without registering", () => {
    const { configPath } = createRepository(false);

    const execution = invoke(
      configPath,
      "-RequiredTimeZoneId",
      "__codex_test_timezone__",
    );

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    const plan = JSON.parse(execution.stdout);
    expect(plan.readiness).toMatchObject({
      ready: false,
      required_timezone_id: "__codex_test_timezone__",
      repository_count: 1,
    });
    expect(plan.readiness.conflicts).toContain("host_timezone_mismatch");
  });

  it("blocks S4U registration as an unverified unattended credential context", () => {
    const { configPath } = createRepository(false);

    const execution = invoke(
      configPath,
      "-RequiredTimeZoneId",
      currentTimeZoneId(),
      "-LogonType",
      "S4U",
      "-Register",
    );

    expect(execution.status).toBe(2);
    expect(execution.stderr).toBe("");
    const result = JSON.parse(execution.stdout);
    expect(result.readiness.conflicts).toContain(
      "s4u_unattended_context_unverified",
    );
  });

  it.skipIf(process.platform !== "win32")(
    "verifies a mocked successful registration and readback contract",
    () => {
      const { configPath, root } = createRepository(false);

      const { execution, logPath } = invokeWithTaskSchedulerMock(
        configPath,
        root,
        "-RequiredTimeZoneId",
        currentTimeZoneId(),
        "-Register",
      );

      expect(execution.status).toBe(0);
      expect(execution.stderr).toBe("");
      const result = JSON.parse(execution.stdout);
      expect(result).toMatchObject({
        status: "registered",
        repository_count: 1,
        required_timezone_id: currentTimeZoneId(),
      });
      expect(isAbsolute(result.executable)).toBe(true);
      expect(result.arguments).toContain("-NodePath");
      expect(result.arguments).toContain("-GitPath");
      expect(result.arguments).toContain("-GitHubCliPath");
      const registered = JSON.parse(readFileSync(logPath, "utf8"));
      expect(registered.Actions[0].Execute).toBe(result.executable);
      expect(registered.Actions[0].Arguments).toBe(result.arguments);
      expect(registered.Principal.LogonType).toBe("Interactive");
      expect(registered.Settings.StartWhenAvailable.IsPresent).toBe(true);
      expect(registered.Settings.WakeToRun.IsPresent).toBe(true);
      expect(registered.Settings.RunOnlyIfNetworkAvailable.IsPresent).toBe(
        true,
      );
      expect(registered.Settings.MultipleInstances).toBe("IgnoreNew");
    },
  );
});

describe("fleet Git automation invocation", () => {
  it("runs every catalog entry in order and aggregates partial failure", () => {
    const { configPath } = createFleetInvocationFixture();

    const execution = invokeFleet(
      configPath,
      "-RunId",
      "fleet-test",
      "-DryRun",
    );

    expect(execution.status).toBe(2);
    expect(execution.stderr).toBe("");
    const aggregate = JSON.parse(execution.stdout);
    expect(aggregate).toMatchObject({
      status: "blocked",
      run_id: "fleet-test",
      repository_count: 2,
    });
    expect(aggregate.results).toHaveLength(2);
    expect(
      aggregate.results.map((result: { id: string }) => result.id),
    ).toEqual(["blocked", "verified"]);
    expect(
      aggregate.results.map((result: { status: string }) => result.status),
    ).toEqual(["blocked", "verified"]);
    const childRunIds = aggregate.results.map(
      (result: { run_id: string }) => result.run_id,
    );
    expect(new Set(childRunIds).size).toBe(2);
    for (const childRunId of childRunIds) {
      expect(childRunId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u);
    }
  });
});
