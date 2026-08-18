import { describe, expect, it } from "vitest";
import {
  createLocalResponseSchema,
  isDryRunAudit,
  LocalAuditSchema,
  type LocalResponse,
} from "../src/core/contracts/local";
import {
  createDemoSession,
  roleCanAccess,
  type DemoRole,
} from "../src/stores/demo-session";
import { getRouteEntry, ROUTE_REGISTRY } from "../src/shared/route-registry";
import { z } from "zod";

describe("shared local contracts", () => {
  it("validates a generic response envelope without coupling to page data", () => {
    const schema = createLocalResponseSchema(z.object({ count: z.number() }));
    const response: LocalResponse<{ count: number }> = {
      status: "success",
      summary: "Local fixture loaded.",
      next_actions: ["Continue local review."],
      artifacts: { source: "local-fixture" },
      audit: {
        event_id: "audit-foundation",
        timestamp: "2026-08-15T18:00:00.000Z",
        actor: "demo-operator",
        capability: "inspect_foundation",
        resource_scope: "local-fixture",
        decision: "allowed",
      },
      data: { count: 1 },
    };

    expect(schema.parse(response).data).toEqual({ count: 1 });
  });

  it("recognises only the explicit local dry-run receipt", () => {
    const audit = LocalAuditSchema.parse({
      event_id: "audit-dry-run",
      timestamp: "2026-08-15T18:00:00.000Z",
      actor: "demo-operator",
      capability: "simulate_change",
      resource_scope: "local-fixture",
      decision: "allowed",
      dry_run: true,
      mutation_applied: false,
      readback: "local-simulation",
    });

    expect(isDryRunAudit(audit)).toBe(true);
  });
});

describe("deterministic demo session", () => {
  it("creates role-specific sessions without persistence", () => {
    const roles: DemoRole[] = ["operator", "viewer", "reviewer"];
    expect(roles.map((role) => createDemoSession(role).role)).toEqual(roles);
    expect(createDemoSession("operator")).toEqual(
      createDemoSession("operator"),
    );
    expect(createDemoSession("operator")).not.toHaveProperty("token");
  });

  it("uses the local role hierarchy for page visibility", () => {
    expect(roleCanAccess("viewer", "viewer")).toBe(true);
    expect(roleCanAccess("viewer", "operator")).toBe(false);
    expect(roleCanAccess("reviewer", "operator")).toBe(true);
  });
});

describe("public route registry", () => {
  it("contains every observed public path exactly once", () => {
    const paths = ROUTE_REGISTRY.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/login",
        "/index",
        "/preventing_fraud",
        "/proxy_manager",
        "/user_info",
        "/reset_password",
        "/source_manager",
        "/device_manager",
        "/ip_manager",
        "/task_manager",
        "/group_send_msg",
        "/pull_group",
        "/screen_data",
        "/service_manager",
        "/position",
        "/account_tatistics",
        "/intelligence",
        "/group_adv",
        "/build_group",
        "/collect",
        "/position_collect",
        "/work_order",
      ]),
    );
  });

  it("keeps route metadata queryable by path", () => {
    expect(getRouteEntry("/preventing_fraud")).toMatchObject({
      fixture_key: "preventing-fraud",
      required_role: "viewer",
      supports_dry_run: false,
    });
  });
});
