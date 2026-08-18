import { describe, expect, it } from "vitest";
import {
  runInspectMockPage,
  runLocalDryRun,
} from "../src/agent-control/capabilities";
import { localScenarios } from "../src/core/contracts/local";
import { routeRegistry } from "../src/core/mock/route-registry";

describe("generic page mock contract", () => {
  it("registers every public route with a fixture key", () => {
    expect(new Set(routeRegistry.map((entry) => entry.path))).toEqual(
      new Set([
        "/login",
        "/index",
        "/preventing_fraud",
        "/user_info",
        "/reset_password",
        "/account_tatistics",
        "/intelligence",
        "/proxy_manager",
        "/source_manager",
        "/device_manager",
        "/ip_manager",
        "/service_manager",
        "/task_manager",
        "/group_send_msg",
        "/pull_group",
        "/screen_data",
        "/position",
        "/group_adv",
        "/build_group",
        "/collect",
        "/position_collect",
        "/work_order",
      ]),
    );
  });

  it("serves every route through the generic local response envelope", async () => {
    for (const entry of routeRegistry) {
      const response = await runInspectMockPage({
        pageId: entry.fixture_key,
        scenario: "success",
      });

      expect(response.status).toBe("success");
      expect(response.data?.page_id).toBe(entry.fixture_key);
      expect(response.audit.capability).toBe(`inspect_${entry.fixture_key}`);
      expect(response.artifacts).toMatchObject({
        source: "local-fixture",
        scenario: "success",
      });
    }
  });

  it("keeps all required scenarios typed and reachable for a core page", async () => {
    for (const scenario of localScenarios.filter(
      (value) =>
        value !== "timeout" &&
        value !== "error" &&
        value !== "permission-denied",
    )) {
      const response = await runInspectMockPage({
        pageId: "device-manager",
        scenario,
      });
      expect(response.artifacts.scenario).toBe(scenario);
    }

    await expect(
      runInspectMockPage({ pageId: "device-manager", scenario: "error" }),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });

    await expect(
      runInspectMockPage({
        pageId: "device-manager",
        scenario: "permission-denied",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("returns dry-run receipts that never claim a mutation", () => {
    const receipt = runLocalDryRun({
      pageId: "task-manager",
      actionId: "task-manager-preview",
      scenario: "success",
      role: "operator",
    });

    expect(receipt.dry_run).toBe(true);
    expect(receipt.mutation_applied).toBe(false);
    expect(receipt.readback).toBe("local-simulation");
    expect(receipt.audit).toMatchObject({
      dry_run: true,
      mutation_applied: false,
      readback: "local-simulation",
    });
    expect(receipt.audit.actor).toBe("demo-operator");
  });

  it("rejects unknown actions and roles outside the route contract", () => {
    expect(() =>
      runLocalDryRun({
        pageId: "task-manager",
        actionId: "not-registered",
        scenario: "success",
        role: "operator",
      }),
    ).toThrow("route contract");

    expect(() =>
      runLocalDryRun({
        pageId: "task-manager",
        actionId: "task-manager-preview",
        scenario: "success",
        role: "viewer",
      }),
    ).toThrow("route contract");
  });
});
