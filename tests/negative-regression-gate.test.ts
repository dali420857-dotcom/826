import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(testFile), "..");
const adapterPath = join(
  projectRoot,
  "scripts",
  "ci",
  "negative-regression-gate.mjs",
);

function writeFixture(
  registry: Record<string, unknown>,
  gateOverrides: Record<string, unknown> = {},
  wrapperSource = "",
) {
  const root = mkdtempSync(join(tmpdir(), "negative-regression-gate-"));
  mkdirSync(join(root, "config"));
  const trustedWrappers = wrapperSource
    ? [{ id: "fixture", argv: ["node", "scripts/ci/verifier-wrapper.mjs"] }]
    : [];
  const baseVerifier = {
    command_env: "NEGATIVE_REGRESSION_VERIFIER_COMMAND",
    protocol: "argv-json-v1",
    required_for_active_decisions: true,
    trusted_wrappers: trustedWrappers,
  };
  const overrideVerifier = (gateOverrides.verifier ?? {}) as Record<
    string,
    unknown
  >;
  writeFileSync(
    join(root, "config", "negative-decisions.json"),
    JSON.stringify(registry),
  );
  writeFileSync(
    join(root, "config", "negative-regression-gate.json"),
    JSON.stringify({
      schema_version: "dali.device-cloud-control.negative-regression-gate/v1",
      mode: "advisory_until_authoritative_verifier",
      registry: "config/negative-decisions.json",
      verifier: { ...baseVerifier, ...overrideVerifier },
      ...gateOverrides,
    }),
  );
  if (wrapperSource) {
    mkdirSync(join(root, "scripts", "ci"), { recursive: true });
    writeFileSync(
      join(root, "scripts", "ci", "verifier-wrapper.mjs"),
      wrapperSource,
    );
  }
  return root;
}

function runGate(root: string, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [
      adapterPath,
      "--config",
      "config/negative-regression-gate.json",
      "--root",
      root,
    ],
    { encoding: "utf8", env: { ...process.env, ...env } },
  );
  const output = result.stdout.trim();
  return {
    exitCode: result.status,
    result: output ? (JSON.parse(output) as Record<string, unknown>) : null,
  };
}

function withFixture(
  registry: Record<string, unknown>,
  callback: (root: string) => void,
  wrapperSource = "",
) {
  const root = writeFixture(registry, {}, wrapperSource);
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function wrapperSource(
  status: "verified" | "failed" | "blocked",
  result: "pass" | "fail" | "blocked",
  options: {
    root?: string;
    manifest?: string;
    requireSecretRedaction?: boolean;
  } = {},
) {
  const rootExpression = options.root ?? "args.root";
  const manifestExpression = options.manifest ?? "args.manifest";
  const redactionGuard = options.requireSecretRedaction
    ? `if (process.env.NEGATIVE_GATE_TEST_SECRET) process.exit(9);`
    : "";
  const exitCode = status === "verified" ? 0 : status === "failed" ? 1 : 2;
  return `
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
${redactionGuard}
console.log(JSON.stringify({schema_version: "negative-regression-result/v1", status: "${status}", result: "${result}", root: ${rootExpression}, manifest: ${manifestExpression}}));
process.exit(${exitCode});
`;
}

describe("negative-regression project adapter", () => {
  it("keeps the checked-in empty registry explicitly advisory", () => {
    const result = runGate(projectRoot);
    expect(result.exitCode).toBe(0);
    expect(result.result).toMatchObject({
      status: "partial",
      result: "advisory",
      summary: { active_decisions: 0, enforcement: "advisory" },
    });
  });

  it("blocks malformed registries before any verifier delegation", () => {
    withFixture(
      { schema_version: "negative-decision/v1", decisions: {} },
      (root) => {
        const result = runGate(root);
        expect(result.exitCode).toBe(2);
        expect(result.result).toMatchObject({
          status: "blocked",
          result: "invalid",
          errors: [{ code: "invalid_decisions" }],
        });
      },
    );
  });

  it("blocks active decisions when the authoritative verifier is absent", () => {
    withFixture(
      {
        schema_version: "negative-decision/v1",
        decisions: [
          {
            id: "REMOVE_EXAMPLE",
            status: "active",
            forbidden: { symbols: ["ExampleService"] },
          },
        ],
      },
      (root) => {
        const result = runGate(root, {
          NEGATIVE_REGRESSION_VERIFIER_COMMAND: "",
        });
        expect(result.exitCode).toBe(2);
        expect(result.result).toMatchObject({
          status: "blocked",
          result: "blocked",
          errors: [{ code: "authoritative_verifier_missing" }],
        });
      },
    );
  });

  it("propagates an authoritative active violation as exit code one", () => {
    withFixture(
      {
        schema_version: "negative-decision/v1",
        decisions: [
          {
            id: "REMOVE_EXAMPLE",
            status: "active",
            forbidden: { symbols: ["ExampleService"] },
          },
        ],
      },
      (root) => {
        const result = runGate(root, {
          NEGATIVE_REGRESSION_VERIFIER_COMMAND: JSON.stringify([
            "node",
            "scripts/ci/verifier-wrapper.mjs",
          ]),
        });
        expect(result.exitCode).toBe(1);
        expect(result.result).toMatchObject({
          status: "failed",
          result: "fail",
          verifier_exit_code: 1,
          summary: { enforcement: "violation" },
        });
      },
      wrapperSource("failed", "fail"),
    );
  });

  it("propagates an authoritative compliant result as verified", () => {
    withFixture(
      {
        schema_version: "negative-decision/v1",
        decisions: [
          {
            id: "REMOVE_EXAMPLE",
            status: "active",
            forbidden: { symbols: ["ExampleService"] },
          },
        ],
      },
      (root) => {
        const result = runGate(root, {
          NEGATIVE_REGRESSION_VERIFIER_COMMAND: JSON.stringify([
            "node",
            "scripts/ci/verifier-wrapper.mjs",
          ]),
        });
        expect(result.exitCode).toBe(0);
        expect(result.result).toMatchObject({
          status: "verified",
          result: "pass",
          verifier_exit_code: 0,
          summary: { enforcement: "verified" },
        });
      },
      wrapperSource("verified", "pass"),
    );
  });

  it("blocks arbitrary commands even when they exit zero", () => {
    withFixture(
      {
        schema_version: "negative-decision/v1",
        decisions: [
          {
            id: "REMOVE_EXAMPLE",
            status: "active",
            forbidden: { symbols: ["ExampleService"] },
          },
        ],
      },
      (root) => {
        const result = runGate(root, {
          NEGATIVE_REGRESSION_VERIFIER_COMMAND: JSON.stringify([
            "node",
            "-e",
            "process.exit(0)",
          ]),
        });
        expect(result.exitCode).toBe(2);
        expect(result.result).toMatchObject({
          status: "blocked",
          result: "blocked",
          errors: [{ code: "untrusted_verifier_command" }],
        });
      },
    );
  });

  it("requires a matching verifier envelope and sanitizes child environment", () => {
    withFixture(
      {
        schema_version: "negative-decision/v1",
        decisions: [
          {
            id: "REMOVE_EXAMPLE",
            status: "active",
            forbidden: { symbols: ["ExampleService"] },
          },
        ],
      },
      (root) => {
        const result = runGate(root, {
          NEGATIVE_REGRESSION_VERIFIER_COMMAND: JSON.stringify([
            "node",
            "scripts/ci/verifier-wrapper.mjs",
          ]),
          NEGATIVE_GATE_TEST_SECRET: "must-not-inherit",
        });
        expect(result.exitCode).toBe(0);
        expect(result.result).toMatchObject({
          status: "verified",
          result: "pass",
        });
      },
      wrapperSource("verified", "pass", { requireSecretRedaction: true }),
    );
  });

  it("blocks a verifier envelope with a mismatched root", () => {
    withFixture(
      {
        schema_version: "negative-decision/v1",
        decisions: [
          {
            id: "REMOVE_EXAMPLE",
            status: "active",
            forbidden: { symbols: ["ExampleService"] },
          },
        ],
      },
      (root) => {
        const result = runGate(root, {
          NEGATIVE_REGRESSION_VERIFIER_COMMAND: JSON.stringify([
            "node",
            "scripts/ci/verifier-wrapper.mjs",
          ]),
        });
        expect(result.exitCode).toBe(2);
        expect(result.result).toMatchObject({
          status: "blocked",
          result: "blocked",
          errors: [{ code: "mismatched_verifier_envelope" }],
        });
      },
      wrapperSource("verified", "pass", { root: '"wrong-root"' }),
    );
  });

  it("propagates an authoritative blocked result as exit code two", () => {
    withFixture(
      {
        schema_version: "negative-decision/v1",
        decisions: [
          {
            id: "REMOVE_EXAMPLE",
            status: "active",
            forbidden: { symbols: ["ExampleService"] },
          },
        ],
      },
      (root) => {
        const result = runGate(root, {
          NEGATIVE_REGRESSION_VERIFIER_COMMAND: JSON.stringify([
            "node",
            "scripts/ci/verifier-wrapper.mjs",
          ]),
        });
        expect(result.exitCode).toBe(2);
        expect(result.result).toMatchObject({
          status: "blocked",
          result: "blocked",
          verifier_exit_code: 2,
        });
      },
      wrapperSource("blocked", "blocked"),
    );
  });

  it("has baseline and CI wiring without introducing a second scanner", () => {
    const baseline = readFileSync(
      join(projectRoot, "scripts", "Verify-Baseline.ps1"),
      "utf8",
    );
    const workflow = readFileSync(
      join(projectRoot, ".github", "workflows", "quality.yml"),
      "utf8",
    );
    expect(
      existsSync(join(projectRoot, "config", "negative-decisions.json")),
    ).toBe(true);
    expect(baseline).toContain("negative-regression-gate.mjs");
    expect(baseline).toContain("Negative-regression gate");
    expect(workflow).toContain(
      "Verify project baseline and negative-regression gate",
    );
    expect(readFileSync(adapterPath, "utf8")).toContain(
      "does not scan source files",
    );
  });
});
