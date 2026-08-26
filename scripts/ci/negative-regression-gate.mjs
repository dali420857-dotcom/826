#!/usr/bin/env node

/**
 * Project-local adapter for the shared negative-regression verifier contract.
 *
 * This file intentionally does not scan source files.  The authoritative
 * verifier is selected by a JSON argv value through the configured environment
 * variable, but it must exactly match a trusted wrapper allowlist in the gate
 * config.  That keeps the nested repository runnable in an independent
 * checkout without silently creating a second implementation or executing an
 * arbitrary CI command.
 * With no active decisions the gate is explicitly advisory and exits zero.
 * Active decisions require a verifier command; otherwise the gate is blocked
 * (exit code 2) instead of claiming that enforcement occurred.
 */

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const GATE_SCHEMA = "dali.device-cloud-control.negative-regression-gate/v1";
const MANIFEST_SCHEMA = "negative-decision/v1";
const VERIFIER_RESULT_SCHEMA = "negative-regression-result/v1";
const CATEGORIES = ["files", "symbols", "routes", "dependencies"];
const EXIT = Object.freeze({ VERIFIED: 0, VIOLATION: 1, BLOCKED: 2 });
const TRUSTED_RUNTIMES = new Set(["node"]);

class GateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message) {
  throw new GateError(code, message);
}

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    fail(`${label}_unreadable`, `cannot read ${label}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${label}_invalid_json`, `${label} JSON is invalid: ${error.message}`);
  }
}

function normalizeRelative(value, field) {
  if (typeof value !== "string") {
    fail("invalid_target", `${field} must be a string`);
  }
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    fail("invalid_file_target", `${field} must be a non-empty relative path`);
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.includes("..")) {
    fail("parent_file_target", `${field} must stay inside the supplied root`);
  }
  const result = parts.join("/");
  if (!result || result === ".") {
    fail("invalid_file_target", `${field} must be a non-empty relative path`);
  }
  return result;
}

function normalizeText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    fail("invalid_target", `${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseTargetMap(value, field) {
  if (value === undefined || value === null) {
    return Object.fromEntries(CATEGORIES.map((category) => [category, []]));
  }
  if (!isObject(value)) {
    fail("invalid_target_map", `${field} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !CATEGORIES.includes(key));
  if (unknown.length > 0) {
    fail(
      "unknown_constraint_type",
      `${field} has unsupported keys: ${unknown.join(", ")}`,
    );
  }
  return Object.fromEntries(
    CATEGORIES.map((category) => {
      const rawTargets = value[category] ?? [];
      if (!Array.isArray(rawTargets)) {
        fail("invalid_targets", `${field}.${category} must be an array`);
      }
      const targets = rawTargets.map((target, index) =>
        category === "files"
          ? normalizeRelative(target, `${field}.${category}[${index}]`)
          : normalizeText(target, `${field}.${category}[${index}]`),
      );
      return [category, [...new Set(targets)]];
    }),
  );
}

function targetCount(targetMap) {
  return CATEGORIES.reduce(
    (count, category) => count + targetMap[category].length,
    0,
  );
}

function decisionId(decision, index) {
  const hasId = Object.hasOwn(decision, "id");
  const hasDecisionId = Object.hasOwn(decision, "decision_id");
  const id = hasDecisionId ? decision.decision_id : decision.id;
  if (typeof id !== "string" || !id.trim()) {
    fail("invalid_decision_id", `decisions[${index}].id must be non-empty`);
  }
  if (hasId && hasDecisionId && decision.id !== decision.decision_id) {
    fail("conflicting_decision_id", `decisions[${index}] has conflicting ids`);
  }
  return id.trim();
}

function validateRegistry(document) {
  if (!isObject(document)) {
    fail("invalid_manifest", "registry root must be an object");
  }
  if (document.schema_version !== MANIFEST_SCHEMA) {
    fail("unsupported_schema", `schema_version must be ${MANIFEST_SCHEMA}`);
  }
  if (!Array.isArray(document.decisions)) {
    fail("invalid_decisions", "decisions must be an array");
  }
  parseTargetMap(document.tombstone_allowlist, "tombstone_allowlist");

  const seen = new Set();
  let activeDecisions = 0;
  let historicalDecisions = 0;
  for (const [index, rawDecision] of document.decisions.entries()) {
    if (!isObject(rawDecision)) {
      fail("invalid_decision", `decisions[${index}] must be an object`);
    }
    const id = decisionId(rawDecision, index);
    if (seen.has(id)) {
      fail("duplicate_decision_id", `duplicate decision id: ${id}`);
    }
    seen.add(id);
    if (typeof rawDecision.status !== "string") {
      fail("invalid_decision_status", `decisions[${index}].status is required`);
    }
    const status = rawDecision.status.toLowerCase();
    if (!["active", "historical", "tombstone"].includes(status)) {
      fail(
        "invalid_decision_status",
        `decisions[${index}].status must be active, historical, or tombstone`,
      );
    }
    parseTargetMap(
      rawDecision.tombstone_allowlist,
      `decisions[${index}].tombstone_allowlist`,
    );
    if (status === "active") {
      if (!Object.hasOwn(rawDecision, "forbidden")) {
        fail(
          "missing_forbidden",
          `decisions[${index}] active decision needs forbidden`,
        );
      }
      const forbidden = parseTargetMap(
        rawDecision.forbidden,
        `decisions[${index}].forbidden`,
      );
      if (targetCount(forbidden) === 0) {
        fail(
          "empty_forbidden",
          `decisions[${index}].forbidden needs at least one constraint`,
        );
      }
      activeDecisions += 1;
    } else {
      if (Object.hasOwn(rawDecision, "forbidden")) {
        fail(
          "historical_forbidden",
          `decisions[${index}] historical/tombstone decisions use tombstone_allowlist`,
        );
      }
      historicalDecisions += 1;
    }
  }
  return { activeDecisions, historicalDecisions };
}

function parseArgs(argv) {
  const args = {
    config: "config/negative-regression-gate.json",
    root: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--config" || option === "--root") {
      const value = argv[index + 1];
      if (!value) fail("missing_argument", `${option} needs a value`);
      args[option.slice(2)] = value;
      index += 1;
      continue;
    }
    fail("unknown_argument", `unsupported argument: ${option}`);
  }
  return args;
}

function ensureInsideRoot(root, candidate, field) {
  const relativePath = relative(root, candidate);
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    fail("path_outside_root", `${field} must stay inside root`);
  }
}

function validateTrustedWrappers(value) {
  if (!Array.isArray(value)) {
    fail(
      "invalid_trusted_wrappers",
      "verifier.trusted_wrappers must be an array",
    );
  }
  const ids = new Set();
  const paths = new Set();
  return value.map((entry, index) => {
    if (!isObject(entry)) {
      fail(
        "invalid_trusted_wrapper",
        `trusted_wrappers[${index}] must be an object`,
      );
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      fail(
        "invalid_trusted_wrapper",
        `trusted_wrappers[${index}].id must be non-empty`,
      );
    }
    const id = entry.id.trim();
    if (ids.has(id))
      fail("duplicate_trusted_wrapper", `duplicate wrapper id: ${id}`);
    ids.add(id);
    if (!Array.isArray(entry.argv) || entry.argv.length !== 2) {
      fail(
        "invalid_trusted_wrapper",
        `trusted_wrappers[${index}].argv must be exactly [runtime, relative-wrapper-path]`,
      );
    }
    const [runtime, wrapperPathValue] = entry.argv;
    if (typeof runtime !== "string" || !TRUSTED_RUNTIMES.has(runtime)) {
      fail(
        "invalid_trusted_wrapper",
        `trusted_wrappers[${index}] runtime must be the approved node runtime`,
      );
    }
    if (
      typeof wrapperPathValue !== "string" ||
      !wrapperPathValue.trim() ||
      wrapperPathValue.trim().startsWith("-")
    ) {
      fail(
        "invalid_trusted_wrapper",
        `trusted_wrappers[${index}] wrapper path must not be an interpreter option`,
      );
    }
    const wrapperPath = normalizeRelative(
      wrapperPathValue,
      `trusted_wrappers[${index}].argv[1]`,
    );
    if (paths.has(wrapperPath)) {
      fail(
        "duplicate_trusted_wrapper",
        `duplicate wrapper path: ${wrapperPath}`,
      );
    }
    paths.add(wrapperPath);
    return { id, runtime, wrapperPath, argv: [runtime, wrapperPath] };
  });
}

function validateConfig(config) {
  if (!isObject(config))
    fail("invalid_gate_config", "gate config must be an object");
  if (config.schema_version !== GATE_SCHEMA) {
    fail("unsupported_gate_schema", `schema_version must be ${GATE_SCHEMA}`);
  }
  if (typeof config.registry !== "string" || !config.registry.trim()) {
    fail(
      "invalid_registry_path",
      "gate config registry must be a relative path",
    );
  }
  const registry = normalizeRelative(config.registry, "gate config registry");
  if (config.mode !== "advisory_until_authoritative_verifier") {
    fail(
      "invalid_gate_mode",
      "gate config mode must be advisory_until_authoritative_verifier",
    );
  }
  if (!isObject(config.verifier)) {
    fail("invalid_verifier_contract", "gate config verifier must be an object");
  }
  if (
    typeof config.verifier.command_env !== "string" ||
    !config.verifier.command_env.trim()
  ) {
    fail("invalid_verifier_contract", "verifier.command_env must be non-empty");
  }
  if (config.verifier.protocol !== "argv-json-v1") {
    fail("invalid_verifier_contract", "verifier.protocol must be argv-json-v1");
  }
  if (config.verifier.required_for_active_decisions !== true) {
    fail(
      "invalid_verifier_contract",
      "verifier.required_for_active_decisions must be true",
    );
  }
  const trustedWrappers = validateTrustedWrappers(
    config.verifier.trusted_wrappers,
  );
  return {
    registry,
    commandEnv: config.verifier.command_env.trim(),
    trustedWrappers,
  };
}

function emit({
  status,
  result,
  root,
  registry,
  summary,
  errors = [],
  verifierExitCode,
}) {
  const envelope = {
    schema_version: `${GATE_SCHEMA}-result`,
    status,
    result,
    root,
    registry,
    summary,
    errors,
  };
  if (verifierExitCode !== undefined)
    envelope.verifier_exit_code = verifierExitCode;
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function resolveTrustedWrapper(command, wrappers, root) {
  if (
    !Array.isArray(command) ||
    command.length !== 2 ||
    command.some((part) => typeof part !== "string" || !part)
  ) {
    fail(
      "untrusted_verifier_command",
      "verifier command must exactly match an allowlisted [runtime, wrapper-path]",
    );
  }
  const [runtime, wrapperArgument] = command;
  if (!TRUSTED_RUNTIMES.has(runtime) || wrapperArgument.startsWith("-")) {
    fail(
      "untrusted_verifier_command",
      "verifier command runtime/path is not trusted",
    );
  }
  const wrapperPath = resolve(root, wrapperArgument);
  ensureInsideRoot(root, wrapperPath, "verifier wrapper");
  const relativeWrapperPath = wrapperPath
    .slice(root.length + 1)
    .replaceAll("\\", "/");
  const trusted = wrappers.find(
    (candidate) =>
      candidate.runtime === runtime &&
      candidate.wrapperPath === relativeWrapperPath,
  );
  if (!trusted) {
    fail(
      "untrusted_verifier_command",
      "verifier command does not match a configured trusted wrapper",
    );
  }
  try {
    if (!statSync(wrapperPath).isFile()) {
      fail(
        "trusted_wrapper_missing",
        `trusted wrapper is not a file: ${trusted.wrapperPath}`,
      );
    }
  } catch (error) {
    fail(
      "trusted_wrapper_missing",
      `trusted wrapper cannot be read: ${error.message}`,
    );
  }
  return { trusted, wrapperPath };
}

function sanitizedEnvironment() {
  const environment = {};
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (typeof process.env[key] === "string" && process.env[key]) {
      environment[key] = process.env[key];
    }
  }
  return environment;
}

function emitBlocked({
  root,
  registry,
  summary,
  code,
  message,
  verifierExitCode,
}) {
  emit({
    status: "blocked",
    result: "blocked",
    root,
    registry,
    summary,
    errors: [{ code, message }],
    verifierExitCode,
  });
  return EXIT.BLOCKED;
}

function parseVerifierEnvelope(stdout, expectedRoot, expectedManifest) {
  const output = typeof stdout === "string" ? stdout.trim() : "";
  if (!output) {
    fail(
      "invalid_verifier_envelope",
      "trusted verifier returned no JSON envelope",
    );
  }
  let envelope;
  try {
    envelope = JSON.parse(output);
  } catch (error) {
    fail(
      "invalid_verifier_envelope",
      `trusted verifier JSON is invalid: ${error.message}`,
    );
  }
  if (!isObject(envelope)) {
    fail(
      "invalid_verifier_envelope",
      "trusted verifier envelope must be an object",
    );
  }
  if (envelope.schema_version !== VERIFIER_RESULT_SCHEMA) {
    fail(
      "invalid_verifier_envelope",
      `trusted verifier schema_version must be ${VERIFIER_RESULT_SCHEMA}`,
    );
  }
  if (
    !["verified", "failed", "blocked"].includes(envelope.status) ||
    !["pass", "fail", "blocked", "invalid"].includes(envelope.result)
  ) {
    fail(
      "invalid_verifier_envelope",
      "trusted verifier status/result is invalid",
    );
  }
  if (envelope.root !== expectedRoot) {
    fail(
      "mismatched_verifier_envelope",
      "trusted verifier root does not match the requested root",
    );
  }
  const declaredManifest = envelope.manifest ?? envelope.registry;
  if (declaredManifest !== expectedManifest) {
    fail(
      "mismatched_verifier_envelope",
      "trusted verifier manifest/registry does not match the requested registry",
    );
  }
  return envelope;
}

function verifierEnvelopeMatchesExit(envelope, exitCode) {
  const expected = {
    [EXIT.VERIFIED]: ["verified", "pass"],
    [EXIT.VIOLATION]: ["failed", "fail"],
    [EXIT.BLOCKED]: ["blocked", "blocked"],
  }[exitCode];
  return (
    expected !== undefined &&
    envelope.status === expected[0] &&
    envelope.result === expected[1]
  );
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch (error) {
    fail("invalid_root", `root cannot be read: ${error.message}`);
  }
  if (!rootStat.isDirectory()) fail("invalid_root", "root must be a directory");

  const configPath = resolve(root, args.config);
  ensureInsideRoot(root, configPath, "gate config");
  const contract = validateConfig(readJson(configPath, "gate config"));
  const registryPath = resolve(root, contract.registry);
  ensureInsideRoot(root, registryPath, "registry");
  const registrySummary = validateRegistry(readJson(registryPath, "registry"));
  const summary = {
    active_decisions: registrySummary.activeDecisions,
    historical_decisions: registrySummary.historicalDecisions,
    enforcement: registrySummary.activeDecisions > 0 ? "required" : "advisory",
  };

  if (registrySummary.activeDecisions === 0) {
    emit({
      status: "partial",
      result: "advisory",
      root,
      registry: contract.registry,
      summary,
    });
    return EXIT.VERIFIED;
  }

  const rawCommand = process.env[contract.commandEnv];
  if (!rawCommand) {
    return emitBlocked({
      root,
      registry: contract.registry,
      summary,
      code: "authoritative_verifier_missing",
      message: `environment variable ${contract.commandEnv} is not set`,
    });
  }
  let command;
  try {
    command = JSON.parse(rawCommand);
  } catch (error) {
    return emitBlocked({
      root,
      registry: contract.registry,
      summary,
      code: "invalid_verifier_command",
      message: `${contract.commandEnv} must contain a JSON argv array`,
    });
  }
  let trusted;
  try {
    trusted = resolveTrustedWrapper(command, contract.trustedWrappers, root);
  } catch (error) {
    const gateError =
      error instanceof GateError
        ? error
        : new GateError("untrusted_verifier_command", error.message);
    return emitBlocked({
      root,
      registry: contract.registry,
      summary,
      code: gateError.code,
      message: gateError.message,
    });
  }

  const child = spawnSync(
    process.execPath,
    [trusted.wrapperPath, "--manifest", registryPath, "--root", root],
    {
      cwd: root,
      encoding: "utf8",
      env: sanitizedEnvironment(),
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (child.error || child.status === null) {
    return emitBlocked({
      root,
      registry: contract.registry,
      summary,
      code: "authoritative_verifier_unreadable",
      message:
        child.error?.message ??
        "authoritative verifier did not return an exit code",
    });
  }
  if (![EXIT.VERIFIED, EXIT.VIOLATION, EXIT.BLOCKED].includes(child.status)) {
    emit({
      status: "blocked",
      result: "invalid",
      root,
      registry: contract.registry,
      summary,
      errors: [
        {
          code: "unsupported_verifier_exit_code",
          message: `authoritative verifier returned unsupported exit code ${child.status}`,
        },
      ],
      verifierExitCode: child.status,
    });
    return EXIT.BLOCKED;
  }
  let verifierEnvelope;
  try {
    verifierEnvelope = parseVerifierEnvelope(child.stdout, root, registryPath);
  } catch (error) {
    const gateError =
      error instanceof GateError
        ? error
        : new GateError("invalid_verifier_envelope", error.message);
    return emitBlocked({
      root,
      registry: contract.registry,
      summary,
      code: gateError.code,
      message: gateError.message,
      verifierExitCode: child.status,
    });
  }
  if (!verifierEnvelopeMatchesExit(verifierEnvelope, child.status)) {
    return emitBlocked({
      root,
      registry: contract.registry,
      summary,
      code: "verifier_exit_envelope_mismatch",
      message: "trusted verifier status/result does not match its exit code",
      verifierExitCode: child.status,
    });
  }
  if (child.status === EXIT.VERIFIED) {
    emit({
      status: "verified",
      result: "pass",
      root,
      registry: contract.registry,
      summary: { ...summary, enforcement: "verified" },
      verifierExitCode: child.status,
    });
  } else if (child.status === EXIT.VIOLATION) {
    emit({
      status: "failed",
      result: "fail",
      root,
      registry: contract.registry,
      summary: { ...summary, enforcement: "violation" },
      verifierExitCode: child.status,
    });
  } else {
    emit({
      status: "blocked",
      result: "blocked",
      root,
      registry: contract.registry,
      summary,
      verifierExitCode: child.status,
    });
  }
  return child.status;
}

try {
  process.exitCode = run();
} catch (error) {
  const root = resolve(process.cwd());
  const gateError =
    error instanceof GateError
      ? error
      : new GateError("unexpected_error", error.message);
  emit({
    status: "blocked",
    result: "invalid",
    root,
    registry: "",
    summary: {},
    errors: [{ code: gateError.code, message: gateError.message }],
  });
  process.exitCode = EXIT.BLOCKED;
}
