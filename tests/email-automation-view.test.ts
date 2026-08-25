import { describe, expect, it } from "vitest";
import { getRouteEntry } from "../src/shared/route-registry";

describe("retired email automation UI", () => {
  it("is not exposed by the DALI console route registry", () => {
    expect(getRouteEntry("/email_automation")).toBeUndefined();
  });
});
