import { describe, expect, it } from "vitest";
import {
  TASK_FIXTURES,
  taskFixtureKeys,
} from "../../../src/core/fixtures/tasks";

describe("task-domain fixtures", () => {
  it("covers every task route with a typed local fixture", () => {
    expect(Object.keys(TASK_FIXTURES).sort()).toEqual(
      [...taskFixtureKeys].sort(),
    );

    for (const key of taskFixtureKeys) {
      const fixture = TASK_FIXTURES[key];
      expect(fixture.page_id).toBe(key);
      expect(fixture.source).toBe("local-fixture");
      expect(fixture.freshness).toBe("fresh");
      expect(fixture.title_zh_cn.length).toBeGreaterThan(0);
      expect(fixture.metrics).toHaveLength(4);
      expect(fixture.records).toHaveLength(3);
    }
  });

  it("uses non-mutating actions with the local dry-run contract", () => {
    for (const key of taskFixtureKeys) {
      for (const action of TASK_FIXTURES[key].actions) {
        expect(action.id).toContain(key);
        expect(action.destructive).toBe(false);
        expect(action.capability).toMatch(/^simulate_/);
      }
    }
  });
});
