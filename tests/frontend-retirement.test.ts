import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const retirementMarkers = [
  "index.html",
  "src/main.ts",
  "src/App.vue",
  "src/views/ProductHomeView.vue",
  "src/README.md",
] as const;

describe("retired DALI console frontend", () => {
  it("keeps the browser and Vue entrypoints marked retired", () => {
    for (const relativePath of retirementMarkers) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");

      expect(source, relativePath).toContain("RETIREMENT MARKER");
      expect(source, relativePath).toContain("retired/disabled");
    }
  });

  it("documents the current browser-to-view mapping and replacement gap", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "docs",
        "architecture",
        "README.md",
      ),
      "utf8",
    );

    expect(source).toContain("http://127.0.0.1:5173/#/index");
    expect(source).toContain("src/views/ProductHomeView.vue");
    expect(source).toContain("尚未選定替代前端");
  });
});
