#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_HOST = "konk.cc";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "artifacts",
  "authorized-mirror",
  "runtime",
);
const DEFAULT_SEEDS = [
  "http://konk.cc/",
  "http://konk.cc/tgcloud_pc/",
  "http://konk.cc/customer/",
];

export const DEFAULT_OPTIONS = Object.freeze({
  seeds: DEFAULT_SEEDS,
  outputDir: DEFAULT_OUTPUT_DIR,
  timeoutMs: 30_000,
  waitMs: 1_000,
  userAgent: "Codex-PublicRuntime/1.0 (authorized anonymous capture)",
});

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeHost(host) {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function isAllowedRuntimeRequest(rawUrl, method, allowedHosts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const hosts =
    allowedHosts instanceof Set ? allowedHosts : new Set(allowedHosts);
  return (
    ALLOWED_PROTOCOLS.has(url.protocol) &&
    !url.username &&
    !url.password &&
    (!url.port || new Set(["80", "443"]).has(url.port)) &&
    hosts.has(normalizeHost(url.hostname)) &&
    SAFE_METHODS.has(String(method).toUpperCase())
  );
}

export function redactRuntimeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "<invalid-url>";
  }
  const keys = [...new Set([...url.searchParams.keys()])];
  url.search = keys
    .map(
      (key) => `${encodeURIComponent(key)}=${encodeURIComponent("<redacted>")}`,
    )
    .join("&");
  url.hash = "";
  return url.href;
}

function sanitizeMessage(value) {
  return String(value)
    .replace(
      /((?:token|authorization|cookie|password|secret|session)[\w-]*\s*[=:]\s*)[^&\s,;}]+/gi,
      "$1<redacted>",
    )
    .slice(0, 500);
}

function safeArtifactPath(root, localPath) {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...localPath.split("/"));
  const relativePath = relative(resolvedRoot, target);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw policyError(
      "UNSAFE_OUTPUT_PATH",
      "runtime artifact escaped the output root",
    );
  }
  return target;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function seedPathName(seed) {
  const url = new URL(seed);
  const path = url.pathname.replace(/^\/+|\/+$/g, "") || "root";
  return path.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function validateSeeds(seeds) {
  const allowedHosts = new Set([TARGET_HOST]);
  const normalized = [];
  for (const seed of seeds) {
    let url;
    try {
      url = new URL(seed);
    } catch {
      throw policyError("INVALID_SCOPE", `invalid seed URL: ${seed}`);
    }
    if (!isAllowedRuntimeRequest(url.href, "GET", allowedHosts)) {
      throw policyError(
        "INVALID_SCOPE",
        `seed is outside authorized host: ${seed}`,
      );
    }
    url.hash = "";
    if (!normalized.includes(url.href)) normalized.push(url.href);
  }
  if (!normalized.length)
    throw policyError("INVALID_SCOPE", "at least one seed is required");
  return { allowedHosts, seeds: normalized };
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS, seeds: [] };
  let sawSeed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[++index];
    if (argument === "--seed") {
      const value = next();
      if (!value) throw policyError("INVALID_OPTION", "--seed requires a URL");
      options.seeds.push(value);
      sawSeed = true;
    } else if (argument === "--output") {
      const value = next();
      if (!value)
        throw policyError("INVALID_OPTION", "--output requires a directory");
      options.outputDir = resolve(value);
    } else if (argument === "--timeout-ms") {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 1_000 || value > 120_000) {
        throw policyError(
          "INVALID_OPTION",
          "--timeout-ms must be 1000..120000",
        );
      }
      options.timeoutMs = value;
    } else if (argument === "--wait-ms") {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 0 || value > 60_000) {
        throw policyError("INVALID_OPTION", "--wait-ms must be 0..60000");
      }
      options.waitMs = value;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw policyError("INVALID_OPTION", `unknown option: ${argument}`);
    }
  }
  if (!sawSeed) options.seeds = [...DEFAULT_SEEDS];
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/Capture-PublicRuntime.mjs [options]",
    "  --seed <url>       repeatable anonymous same-host seed",
    "  --output <dir>     runtime artifact directory",
    "  --timeout-ms <n>   per-page timeout, 1000..120000",
    "  --wait-ms <n>      post-load settle time, 0..60000",
  ].join("\n");
}

async function capturePage(browser, seed, options, allowedHosts, outputRoot) {
  const context = await browser.newContext({
    storageState: undefined,
    serviceWorkers: "block",
    userAgent: options.userAgent,
  });
  const blockedRequests = [];
  const requests = [];
  const consoleMessages = [];
  const pageErrors = [];
  const requestRecords = new Map();

  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method();
    const requestUrl = request.url();
    if (isAllowedRuntimeRequest(requestUrl, method, allowedHosts)) {
      const headers = Object.fromEntries(
        Object.entries(request.headers()).filter(
          ([name]) =>
            !["cookie", "authorization", "proxy-authorization"].includes(
              name.toLowerCase(),
            ),
        ),
      );
      await route.continue({ headers });
      return;
    }
    blockedRequests.push({
      method,
      url: redactRuntimeUrl(requestUrl),
      reason: "scope_or_method",
    });
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  page.on("request", (request) => {
    const record = {
      method: request.method(),
      url: redactRuntimeUrl(request.url()),
      resource_type: request.resourceType(),
      status: null,
      failure: null,
    };
    requests.push(record);
    requestRecords.set(request, record);
  });
  page.on("response", (response) => {
    const record = requestRecords.get(response.request());
    if (record) record.status = response.status();
  });
  page.on("requestfailed", (request) => {
    const record = requestRecords.get(request);
    if (record)
      record.failure = sanitizeMessage(
        request.failure()?.errorText || "request failed",
      );
  });
  page.on("console", (message) => {
    consoleMessages.push({
      type: message.type(),
      text: sanitizeMessage(message.text()),
    });
  });
  page.on("pageerror", (error) => {
    pageErrors.push(sanitizeMessage(error.message));
  });

  let navigationError = null;
  let finalUrl = seed;
  let title = "";
  let html = "";
  let bodyText = "";
  try {
    await page.goto(seed, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForTimeout(options.waitMs);
    finalUrl = page.url();
    title = await page.title();
    html = await page.content();
    bodyText = await page.locator("body").innerText();
  } catch (error) {
    navigationError = sanitizeMessage(
      error instanceof Error ? error.message : "navigation failed",
    );
    try {
      finalUrl = page.url();
      title = await page.title();
      html = await page.content();
      bodyText = await page.locator("body").innerText();
    } catch {
      // The page may have been closed after a blocked navigation.
    }
  }

  const slug = seedPathName(seed);
  const htmlPath = `pages/${slug}.html`;
  const screenshotPath = `screenshots/${slug}.png`;
  const requestsPath = `requests/${slug}.json`;
  const htmlTarget = safeArtifactPath(outputRoot, htmlPath);
  const screenshotTarget = safeArtifactPath(outputRoot, screenshotPath);
  const requestsTarget = safeArtifactPath(outputRoot, requestsPath);
  await mkdir(dirname(htmlTarget), { recursive: true });
  await mkdir(dirname(screenshotTarget), { recursive: true });
  await mkdir(dirname(requestsTarget), { recursive: true });
  await writeFile(htmlTarget, html, "utf8");
  await page.screenshot({ path: screenshotTarget, fullPage: true });
  await writeJson(requestsTarget, {
    schema_version: "ecc.authorized-anonymous-runtime-requests.v1",
    seed,
    final_url: redactRuntimeUrl(finalUrl),
    requests,
    blocked_requests: blockedRequests,
    credentials_accessed: false,
    request_bodies_saved: false,
    response_bodies_saved: false,
  });

  const cookieCount = (await context.cookies()).length;
  await context.close();
  return {
    seed,
    final_url: redactRuntimeUrl(finalUrl),
    title,
    body_text_length: bodyText.length,
    html_bytes: Buffer.byteLength(html, "utf8"),
    cookies_observed: cookieCount,
    requests: requests.length,
    blocked_requests: blockedRequests.length,
    console_messages: consoleMessages,
    page_errors: pageErrors,
    navigation_error: navigationError,
    artifacts: {
      html: htmlPath,
      screenshot: screenshotPath,
      requests: requestsPath,
    },
  };
}

export async function capturePublicRuntime(inputOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...inputOptions };
  const { allowedHosts, seeds } = validateSeeds(options.seeds);
  const outputRoot = resolve(options.outputDir);
  await mkdir(outputRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const pages = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const seed of seeds) {
      pages.push(
        await capturePage(browser, seed, options, allowedHosts, outputRoot),
      );
    }
  } finally {
    await browser?.close();
  }

  const warnings = pages.filter(
    (page) =>
      page.navigation_error || page.page_errors.length || page.blocked_requests,
  );
  const status = warnings.length ? "warning" : "success";
  const manifest = {
    schema_version: "ecc.authorized-anonymous-runtime-manifest.v1",
    status,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    authorization: {
      evidence:
        "The user explicitly authorized this public acquisition in the current task.",
      host: TARGET_HOST,
      seeds,
    },
    policy: {
      same_host_only: true,
      safe_methods_only: [...SAFE_METHODS],
      storage_state: "fresh context; no imported cookies or sessions",
      cookies_saved: false,
      credential_headers_stripped: true,
      request_bodies_saved: false,
      response_bodies_saved: false,
      external_mutations: false,
    },
    pages,
  };
  const manifestPath = safeArtifactPath(outputRoot, "runtime-manifest.json");
  await writeJson(manifestPath, manifest);
  return {
    status,
    summary: `Captured ${pages.length} anonymous public runtime pages from ${TARGET_HOST}.`,
    next_actions: [
      "Review the sanitized DOM, screenshots, and request indexes.",
      "Build the interaction matrix from public controls; do not replay protected sessions or write requests.",
    ],
    artifacts: {
      root: outputRoot,
      manifest: manifestPath,
      pages: pages.length,
      warnings: warnings.length,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(helpText());
    return {
      status: "success",
      summary: "Help displayed.",
      next_actions: [],
      artifacts: {},
    };
  }
  const result = await capturePublicRuntime(options);
  console.log(JSON.stringify(result));
  if (result.status === "error") process.exitCode = 1;
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        status: "error",
        summary: "Anonymous public runtime capture stopped.",
        next_actions: [
          "Review the bounded runtime policy and error, then rerun only within the authorized host.",
        ],
        artifacts: {
          error: {
            code: error?.code || "RUNTIME_CAPTURE_ERROR",
            message: sanitizeMessage(error?.message || "capture failed"),
          },
        },
      }),
    );
    process.exitCode = 1;
  });
}
