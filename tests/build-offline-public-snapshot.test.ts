import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildOfflinePublicSnapshot } from "../scripts/Build-OfflinePublicSnapshot.mjs";

const tempDirectories: string[] = [];

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "offline-public-snapshot-"));
  tempDirectories.push(root);
  const inputDir = join(root, "authorized-mirror");
  const webcopyDir = join(inputDir, "tool-runs", "webcopy-fixture");
  const runtimeDir = join(inputDir, "runtime");
  const outputDir = join(inputDir, "offline-preview");

  await mkdir(join(webcopyDir, "img"), { recursive: true });
  await mkdir(join(webcopyDir, "tgcloud_pc"), { recursive: true });
  await mkdir(join(inputDir, "img"), { recursive: true });
  await mkdir(join(runtimeDir, "requests"), { recursive: true });

  await writeFile(
    join(webcopyDir, "index.htm"),
    '<a href="/tgcloud_pc">app</a><link rel="stylesheet" href="./site.css"><img src="/img/logo.png"><script src="./config.js"></script>',
  );
  await writeFile(
    join(webcopyDir, "site.css"),
    'body{background:url("/img/logo.png")} .icon{background:url(./img/icon.svg)}',
  );
  await writeFile(join(webcopyDir, "img", "logo.png"), Buffer.from([1, 2, 3]));
  await writeFile(
    join(webcopyDir, "tgcloud_pc", "index.htm"),
    "<main>app</main>",
  );

  await writeFile(
    join(inputDir, "manifest.json"),
    JSON.stringify({
      schema_version: "ecc.authorized-public-static-manifest.v1",
      status: "success",
      artifacts: [
        {
          kind: "resource",
          url: "http://konk.cc/img/logo.png",
          local_path: "img/logo.png",
          bytes: 3,
        },
        {
          kind: "resource",
          url: "http://konk.cc/img/icon.svg",
          local_path: "img/icon.svg",
          bytes: 0,
        },
      ],
    }),
  );
  await writeFile(
    join(inputDir, "img", "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );
  await writeFile(
    join(runtimeDir, "requests", "root.json"),
    JSON.stringify({
      schema_version: "ecc.authorized-anonymous-runtime-requests.v1",
      seed: "http://konk.cc/",
      requests: [
        {
          method: "GET",
          url: "http://konk.cc/img/icon.svg",
          resource_type: "image",
          status: 200,
        },
        {
          method: "GET",
          url: "http://konk.cc/api/config?token=%3Credacted%3E",
          resource_type: "xhr",
          status: 200,
        },
        {
          method: "POST",
          url: "http://konk.cc/api/write",
          resource_type: "xhr",
          status: 405,
        },
      ],
    }),
  );

  return { inputDir, webcopyDir, runtimeDir, outputDir };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("offline public snapshot assembly", () => {
  it("assembles only local files and never calls the network", async () => {
    const fixture = await makeFixture();
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async () => {
      networkCalls += 1;
      throw new Error("network must not be used by offline assembly");
    }) as typeof fetch;

    try {
      const envelope = await buildOfflinePublicSnapshot(fixture);
      expect(envelope.status).toBe("success");
      expect(envelope.summary.network_requests).toBe(0);
      expect(networkCalls).toBe(0);

      const index = await readFile(
        join(fixture.outputDir, "index.html"),
        "utf8",
      );
      expect(index).toContain('href="tgcloud_pc/index.html"');
      expect(index).toContain('href="site.css"');
      expect(index).toContain('src="img/logo.png"');
      expect(index).toContain('src="./config.js"');
      expect(
        await readFile(join(fixture.outputDir, "img", "icon.svg"), "utf8"),
      ).toContain("<svg");

      const manifest = JSON.parse(
        await readFile(
          join(fixture.outputDir, "snapshot-manifest.json"),
          "utf8",
        ),
      );
      expect(manifest.policy.network_access).toBe(false);
      expect(manifest.policy.credentials_copied).toBe(false);
      expect(manifest.policy.api_calls_replayed).toBe(false);
      expect(manifest.runtime_gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: "http://konk.cc/api/config?token=%3Credacted%3E",
            kind: "api",
          }),
        ]),
      );
      expect(manifest.runtime_gaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "unsafe_method", method: "POST" }),
        ]),
      );
      expect(await readdir(fixture.outputDir)).not.toContain("api");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a base directory outside the configured local input", async () => {
    const fixture = await makeFixture();
    await expect(
      buildOfflinePublicSnapshot({
        ...fixture,
        webcopyDir: join(fixture.inputDir, "..", "outside"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SOURCE" });
  });
});
