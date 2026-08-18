import { describe, expect, it } from "vitest";
import {
  getOperationsFixture,
  operationsFixtures,
} from "../../../src/core/fixtures/operations";

describe("operations typed fixtures", () => {
  it("covers each operations route with representative local records", () => {
    expect(Object.keys(operationsFixtures)).toEqual(
      expect.arrayContaining([
        "proxy-manager",
        "source-manager",
        "device-manager",
        "ip-manager",
        "service-manager",
      ]),
    );

    for (const fixture of Object.values(operationsFixtures)) {
      expect(fixture.page_id).toContain("-manager");
      expect(fixture.records.length).toBeGreaterThan(0);
      expect(fixture.records.every((record) => record.id.length > 0)).toBe(
        true,
      );
      expect(new Date(fixture.records[0].updated_at).toString()).not.toBe(
        "Invalid Date",
      );
    }
  });

  it("returns undefined instead of inventing an unknown resource", () => {
    expect(getOperationsFixture("not-an-operations-page")).toBeUndefined();
  });
});
