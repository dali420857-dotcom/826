import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getRouteEntry } from "../src/shared/route-registry";

describe("retired email automation UI", () => {
  it("is not exposed by the DALI console route registry", () => {
    expect(getRouteEntry("/email_automation")).toBeUndefined();
  });

  const consolePath = join(
    process.cwd(),
    "826-Emailautosave",
    "production",
    "frontend",
    "EmailAutomationConsole.vue",
  );

  it.skipIf(!existsSync(consolePath))(
    "keeps the removed SFC marked as retired",
    () => {
      const source = readFileSync(consolePath, "utf8");

      expect(source).toContain("RETIREMENT MARKER");
      expect(source).toContain("retired/disabled");
    },
  );
});
