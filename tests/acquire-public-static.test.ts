import { describe, expect, it } from "vitest";
import {
  discoverReferences,
  discoverJsReferences,
  isAllowedUrl,
  localPathForUrl,
  parseRobots,
} from "../scripts/Acquire-PublicStatic.mjs";

describe("public static acquisition policy", () => {
  const allowedHosts = new Set(["konk.cc"]);

  it("allows only the authorized public host and web protocols", () => {
    expect(isAllowedUrl("http://konk.cc/tgcloud_pc/", allowedHosts)).toBe(true);
    expect(isAllowedUrl("https://konk.cc/assets/app.js", allowedHosts)).toBe(
      true,
    );
    expect(isAllowedUrl("https://example.com/app.js", allowedHosts)).toBe(
      false,
    );
    expect(isAllowedUrl("file:///C:/secret.txt", allowedHosts)).toBe(false);
    expect(isAllowedUrl("http://user:pass@konk.cc/", allowedHosts)).toBe(false);
  });

  it("honors wildcard robots disallow rules", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private\n");
    expect(rules).toEqual(["/private"]);
  });

  it("discovers same-origin HTML and asset references without form submission", () => {
    const html = `
      <a href="/tgcloud_pc/">app</a>
      <script src="./app.js"></script>
      <img srcset="/a.png 1x, /b.png 2x" />
      <form action="/login" method="post"></form>
      <a href="https://example.com/escape">external</a>
    `;
    expect(discoverReferences(html, "http://konk.cc/")).toEqual([
      "http://konk.cc/tgcloud_pc/",
      "http://konk.cc/app.js",
      "http://konk.cc/a.png",
      "http://konk.cc/b.png",
    ]);
  });

  it("discovers static assets in JavaScript without following API or token strings", () => {
    const javascript = `
      const chunk = "/assets/js/9022.eaa6e706.js";
      const css = './assets/css/9022.4ad8bedd.css';
      const api = "/api/user/index";
      const token = "/assets/app.js?token=secret";
      const external = "https://example.com/file.js";
    `;
    expect(
      discoverJsReferences(javascript, "http://konk.cc/tgcloud_pc/"),
    ).toEqual([
      "http://konk.cc/assets/js/9022.eaa6e706.js",
      "http://konk.cc/tgcloud_pc/assets/css/9022.4ad8bedd.css",
    ]);
  });

  it("keeps URL-derived output paths inside the artifact root", () => {
    expect(localPathForUrl("http://konk.cc/../secret", "text/html")).toBe(
      "secret/index.html",
    );
    expect(
      localPathForUrl("http://konk.cc/assets/app.js?v=1", "text/javascript"),
    ).toMatch(/^assets[\\/]app__q_[a-f0-9]{12}\.js$/);
  });
});
