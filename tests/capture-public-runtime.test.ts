import { describe, expect, it } from "vitest";
import {
  isAllowedRuntimeRequest,
  redactRuntimeUrl,
} from "../scripts/Capture-PublicRuntime.mjs";

describe("anonymous public runtime policy", () => {
  const allowedHosts = new Set(["konk.cc"]);

  it("allows same-host safe reads only", () => {
    expect(
      isAllowedRuntimeRequest(
        "http://konk.cc/tgcloud_pc/",
        "GET",
        allowedHosts,
      ),
    ).toBe(true);
    expect(
      isAllowedRuntimeRequest(
        "https://konk.cc/api/common/config_init?system=tgcloud",
        "POST",
        allowedHosts,
      ),
    ).toBe(false);
    expect(
      isAllowedRuntimeRequest("https://example.com/track", "GET", allowedHosts),
    ).toBe(false);
  });

  it("redacts query values before persisting runtime request indexes", () => {
    expect(redactRuntimeUrl("http://konk.cc/path?token=secret&x=1")).toBe(
      "http://konk.cc/path?token=%3Credacted%3E&x=%3Credacted%3E",
    );
  });
});
