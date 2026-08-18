import { describe, expect, it } from "vitest";
import {
  identityFixtureIds,
  identityFixtureSchema,
  identityFixtures,
} from "../../../src/core/fixtures/identity";

describe("identity route fixtures", () => {
  it("contains one typed fixture for every identity surface", () => {
    expect(Object.keys(identityFixtures).sort()).toEqual(
      [...identityFixtureIds].sort(),
    );

    for (const id of identityFixtureIds) {
      expect(identityFixtureSchema.parse(identityFixtures[id]).page_id).toBe(
        id,
      );
    }
  });

  it("keeps credential and remote mutation boundaries explicit", () => {
    expect(identityFixtures.login.description_zh_cn).toContain("不收集真实");
    expect(identityFixtures["user-info"].metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label_zh_cn: "凭证", value: "无" }),
      ]),
    );
    expect(identityFixtures["reset-password"].supports_dry_run).toBe(true);
    expect(identityFixtures["reset-password"].description_zh_cn).toContain(
      "不接受真实密码",
    );
  });
});
