import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getRouteEntry } from "../src/shared/route-registry";

describe("retired email automation UI", () => {
  it("is not exposed by the DALI console route registry", () => {
    expect(getRouteEntry("/email_automation")).toBeUndefined();
  });

  it("keeps the removed SFC marked as retired", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "826-Emailautosave",
        "production",
        "frontend",
        "EmailAutomationConsole.vue",
      ),
      "utf8",
    );

    expect(source).toContain("RETIREMENT MARKER");
    expect(source).toContain("retired/disabled");
  });
});
