import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GitHub quality contract", () => {
  it("keeps the required root check independent of local agent bootstrap files", () => {
    const workflow = readFileSync(
      resolve(".github/workflows/quality.yml"),
      "utf8",
    );

    expect(workflow).toContain("name: quality / root");
    expect(workflow).not.toContain("Verify-Baseline.ps1");
    expect(workflow).not.toContain("quality / outreach");
    expect(workflow.indexOf("Verify repository sync gate")).toBeLessThan(
      workflow.indexOf("Install root dependencies"),
    );
    expect(workflow).toContain(
      "prettier --check --end-of-line auto scripts/ci/sync.mjs",
    );
  });

  it("requires only the stable root check across the automation fleet", () => {
    const configDirectory = resolve("config/git-automation");
    const configs = readdirSync(configDirectory)
      .filter((name) => name.endsWith(".json"))
      .map((name) =>
        JSON.parse(readFileSync(join(configDirectory, name), "utf8")),
      );

    for (const config of configs) {
      expect(config.github.requiredChecks).toEqual(["quality / root"]);
    }
  });
});
