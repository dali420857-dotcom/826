import { describe, expect, it } from "vitest";
import {
  HermesResearchRequestSchema,
  hermesResearchCoordinatorCapability,
  validateHermesResearchReceipt,
} from "../src/agent-control/hermes-research";

describe("Hermes research coordinator contract", () => {
  it("keeps the coordinator diagnostic, bounded, and non-mutating", () => {
    expect(hermesResearchCoordinatorCapability).toMatchObject({
      id: "coordinate_hermes_research",
      classification: "diagnostics",
      mutating: false,
      dry_run: true,
      max_parallel_children: 3,
      max_depth: 1,
    });
  });

  it("defaults research requests to the bounded child limit", () => {
    expect(
      HermesResearchRequestSchema.parse({
        objective: "Compare two primary sources.",
        scope: ["local documentation"],
        authorization: "local_only",
      }),
    ).toMatchObject({
      evidence_requirements: [],
      max_parallel_children: 3,
    });
  });

  it("accepts a contract-only warning receipt", () => {
    const receipt = validateHermesResearchReceipt({
      status: "warning",
      summary: "Hermes runtime is not live; no delegation was attempted.",
      next_actions: ["Keep the result local until the endpoint is verified."],
      artifacts: { source: "local-preflight" },
      run_id: "hermes-preflight-test",
      evidence_refs: [".codex/config.toml"],
      provenance: {
        source: "local-preflight",
        collected_at: "2026-08-15T00:00:00.000Z",
      },
      adapter_status: "contract_only_not_live",
      mutation_applied: false,
      external_mutations: false,
      credentials_accessed: false,
      network_requests: false,
    });

    expect(receipt.adapter_status).toBe("contract_only_not_live");
    expect(receipt.external_mutations).toBe(false);
  });

  it("rejects a receipt that claims a mutation", () => {
    expect(() =>
      validateHermesResearchReceipt({
        status: "success",
        summary: "Invalid receipt.",
        next_actions: [],
        artifacts: {},
        run_id: "bad-receipt",
        evidence_refs: [],
        provenance: { source: "test", collected_at: "now" },
        adapter_status: "loopback_verified",
        mutation_applied: true,
        external_mutations: false,
        credentials_accessed: false,
        network_requests: false,
      }),
    ).toThrow();
  });
});
