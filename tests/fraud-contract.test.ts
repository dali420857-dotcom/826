import { describe, expect, it } from "vitest";
import { LocalApiError, fetchFraudOverview } from "../src/adapters/local-api";

describe("local fraud overview contract", () => {
  it("parses a fresh readback and its audit envelope", async () => {
    const response = await fetchFraudOverview("success");

    expect(response.status).toBe("success");
    expect(response.data?.signals).toHaveLength(3);
    expect(response.audit.capability).toBe("inspect_fraud_overview");
    expect(response.artifacts).toMatchObject({ source: "local-fixture" });
  });

  it("keeps an empty window as a valid successful response", async () => {
    const response = await fetchFraudOverview("empty");

    expect(response.status).toBe("success");
    expect(response.data?.signals).toEqual([]);
    expect(response.next_actions).toHaveLength(1);
  });

  it("marks stale data as a warning fallback", async () => {
    const response = await fetchFraudOverview("fallback");

    expect(response.status).toBe("warning");
    expect(response.data?.freshness).toBe("stale");
    expect(response.artifacts).toMatchObject({ mutations_allowed: false });
    expect(response.audit.decision).toBe("fallback");
  });

  it("maps policy denial to a typed error without leaking transport details", async () => {
    await expect(fetchFraudOverview("permission-denied")).rejects.toMatchObject<
      Partial<LocalApiError>
    >({
      code: "PERMISSION_DENIED",
      message: "Observation scope is not approved for this session.",
    });
  });

  it("stops after the bounded timeout", async () => {
    const started = Date.now();
    await expect(fetchFraudOverview("timeout")).rejects.toMatchObject<
      Partial<LocalApiError>
    >({
      code: "TIMEOUT",
    });

    expect(Date.now() - started).toBeLessThan(1_300);
  }, 2_500);
});
