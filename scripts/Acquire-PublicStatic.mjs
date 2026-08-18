#!/usr/bin/env node

// Node.js v24 provides a stable browser-compatible global fetch API.
// Source: https://nodejs.org/download/release/v24.16.0/docs/api/globals.html#fetch
// Files are written with node:fs/promises.
// Source: https://nodejs.org/download/release/v24.16.0/docs/api/fs.html#promises-api

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_HOST = "konk.cc";
const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "artifacts",
  "authorized-mirror",
);
const DEFAULT_SEEDS = ["http://konk.cc/", "http://konk.cc/tgcloud_pc/"];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const SENSITIVE_QUERY_KEY =
  /(?:token|auth|password|secret|session|cookie|key)/i;
const STATIC_ASSET_EXTENSION =
  /\.(?:js|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp3|mp4|webm)(?:\?.*)?$/i;

export const DEFAULT_OPTIONS = Object.freeze({
  seeds: DEFAULT_SEEDS,
  outputDir: DEFAULT_OUTPUT_DIR,
  maxRequests: 120,
  maxDepth: 4,
  maxResourceBytes: 12 * 1024 * 1024,
  maxTotalBytes: 120 * 1024 * 1024,
  maxRedirects: 3,
  delayMs: 350,
  timeoutMs: 20_000,
  userAgent: "Codex-PublicStatic/1.0 (authorized public acquisition)",
});

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeHost(host) {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function isAllowedUrl(rawUrl, allowedHosts) {
  let url;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  if (url.username || url.password) return false;
  if (url.port && !new Set(["80", "443"]).has(url.port)) return false;
  const hosts =
    allowedHosts instanceof Set ? allowedHosts : new Set(allowedHosts);
  return hosts.has(normalizeHost(url.hostname));
}

function canonicalUrl(rawUrl, baseUrl, allowedHosts) {
  let url;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }
  if (!isAllowedUrl(url, allowedHosts)) return null;
  for (const [key, value] of url.searchParams) {
    if (SENSITIVE_QUERY_KEY.test(key) || SENSITIVE_QUERY_KEY.test(value))
      return null;
  }
  url.hash = "";
  if (!url.pathname) url.pathname = "/";
  return url.href;
}

function addReference(references, rawReference, baseUrl, allowedHosts) {
  const reference = rawReference.trim();
  if (!reference || /^(?:data|javascript|mailto|tel):/i.test(reference)) return;
  const normalized = canonicalUrl(reference, baseUrl, allowedHosts);
  if (normalized && !references.includes(normalized))
    references.push(normalized);
}

export function discoverReferences(
  text,
  baseUrl,
  allowedHosts = new Set([TARGET_HOST]),
) {
  const references = [];
  const attributePattern =
    /\b(?:href|src|poster|data-src)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of text.matchAll(attributePattern)) {
    addReference(references, match[2], baseUrl, allowedHosts);
  }

  const srcsetPattern = /\bsrcset\s*=\s*(["'])(.*?)\1/gi;
  for (const match of text.matchAll(srcsetPattern)) {
    for (const candidate of match[2].split(",")) {
      addReference(
        references,
        candidate.trim().split(/\s+/)[0],
        baseUrl,
        allowedHosts,
      );
    }
  }
  return references;
}

export function discoverCssReferences(
  text,
  baseUrl,
  allowedHosts = new Set([TARGET_HOST]),
) {
  const references = [];
  const cssPattern = /(?:url|@import)\s*\(\s*["']?([^)"']+)["']?\s*\)/gi;
  for (const match of text.matchAll(cssPattern)) {
    addReference(references, match[1], baseUrl, allowedHosts);
  }
  return references;
}

export function discoverJsReferences(
  text,
  baseUrl,
  allowedHosts = new Set([TARGET_HOST]),
) {
  const references = [];
  const assetPattern = /["']((?:\.{0,2}\/|\/)[^"']+)["']/g;
  for (const match of text.matchAll(assetPattern)) {
    if (STATIC_ASSET_EXTENSION.test(match[1])) {
      addReference(references, match[1], baseUrl, allowedHosts);
    }
  }
  return references;
}

export function parseRobots(text) {
  const disallowed = [];
  let appliesToWildcard = false;
  let groupStarted = false;
  let sawDirective = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      appliesToWildcard = false;
      groupStarted = false;
      sawDirective = false;
      continue;
    }

    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (sawDirective) {
        appliesToWildcard = false;
        sawDirective = false;
      }
      groupStarted = true;
      appliesToWildcard = appliesToWildcard || value === "*";
      continue;
    }

    if (!groupStarted) continue;
    sawDirective = true;
    if (key === "disallow" && appliesToWildcard && value)
      disallowed.push(value);
  }

  return [...new Set(disallowed)];
}

export function robotsAllows(urlString, disallowedPaths) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  const path = `${url.pathname}${url.search}`;
  return !disallowedPaths.some((prefix) => path.startsWith(prefix));
}

function extensionForContentType(contentType) {
  const type = (contentType || "").split(";", 1)[0].trim().toLowerCase();
  return (
    {
      "text/html": ".html",
      "application/xhtml+xml": ".html",
      "text/css": ".css",
      "text/javascript": ".js",
      "application/javascript": ".js",
      "application/json": ".json",
      "image/svg+xml": ".svg",
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/avif": ".avif",
      "font/woff": ".woff",
      "font/woff2": ".woff2",
      "application/font-woff": ".woff",
      "application/vnd.ms-fontobject": ".eot",
    }[type] || ""
  );
}

function safePathSegment(segment) {
  const cleaned = Array.from(segment, (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint < 32 || /[<>:"|?*]/.test(character) ? "_" : character;
  }).join("");
  if (cleaned === "." || cleaned === ".." || !cleaned) return "_";
  return cleaned.replace(/\.\./g, "_");
}

export function localPathForUrl(rawUrl, contentType = "") {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname || "/");
  } catch {
    pathname = url.pathname || "/";
  }

  const segments = pathname.split("/").filter(Boolean).map(safePathSegment);
  const lastSegment = segments.at(-1) || "";
  const hasExtension = Boolean(lastSegment && /\.[^./]+$/.test(lastSegment));
  const isDirectory = pathname.endsWith("/") || !hasExtension;
  const contentExtension = extensionForContentType(contentType);
  let pathSegments = segments;

  if (isDirectory) {
    pathSegments = [...segments, `index${contentExtension || ".html"}`];
  } else if (contentExtension && !hasExtension) {
    pathSegments = [
      ...segments.slice(0, -1),
      `${lastSegment}${contentExtension}`,
    ];
  }

  let localPath = pathSegments.join("/") || "index.html";
  if (url.search) {
    const suffix = createHash("sha256")
      .update(url.search)
      .digest("hex")
      .slice(0, 12);
    const extension = localPath.match(/\.[^./]+$/)?.[0] || "";
    localPath = `${localPath.slice(0, localPath.length - extension.length)}__q_${suffix}${extension}`;
  }
  return localPath;
}

function artifactPath(outputRoot, localPath) {
  const root = resolve(outputRoot);
  const target = resolve(root, ...localPath.split("/"));
  const relativePath = relative(root, target);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw policyError(
      "UNSAFE_OUTPUT_PATH",
      "URL-derived path escaped the artifact root",
    );
  }
  return target;
}

async function readBodyLimited(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw policyError(
      "MAX_RESOURCE_BYTES",
      `resource exceeds ${maxBytes} bytes`,
    );
  }

  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes)
        throw policyError(
          "MAX_RESOURCE_BYTES",
          `resource exceeds ${maxBytes} bytes`,
        );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function sleep(ms) {
  if (ms > 0)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseNumber(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw policyError(
      "INVALID_OPTION",
      `${name} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return number;
}

export function parseArgs(argv) {
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
    } else if (argument === "--max-requests") {
      options.maxRequests = parseNumber(next(), "--max-requests", 1, 500);
    } else if (argument === "--max-depth") {
      options.maxDepth = parseNumber(next(), "--max-depth", 0, 12);
    } else if (argument === "--delay-ms") {
      options.delayMs = parseNumber(next(), "--delay-ms", 0, 60_000);
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = parseNumber(next(), "--timeout-ms", 1_000, 120_000);
    } else if (argument === "--max-resource-mb") {
      options.maxResourceBytes =
        parseNumber(next(), "--max-resource-mb", 1, 100) * 1024 * 1024;
    } else if (argument === "--max-total-mb") {
      options.maxTotalBytes =
        parseNumber(next(), "--max-total-mb", 1, 1_000) * 1024 * 1024;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw policyError("INVALID_OPTION", `unknown option: ${argument}`);
    }
  }
  if (!sawSeed) options.seeds = [...DEFAULT_SEEDS];
  return options;
}

function validateSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw policyError("INVALID_SCOPE", "at least one seed URL is required");
  }
  const allowedHosts = new Set([TARGET_HOST]);
  const normalizedSeeds = [];
  for (const seed of seeds) {
    const normalized = canonicalUrl(seed, undefined, allowedHosts);
    if (!normalized)
      throw policyError(
        "INVALID_SCOPE",
        `seed is outside authorized host: ${seed}`,
      );
    if (!normalizedSeeds.includes(normalized)) normalizedSeeds.push(normalized);
  }
  return { allowedHosts, seeds: normalizedSeeds };
}

function decodeBody(body, contentType) {
  const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim() || "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeError(error) {
  return {
    code: error?.code || "FETCH_ERROR",
    message: error instanceof Error ? error.message : "request failed",
  };
}

export async function acquirePublicStatic(inputOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...inputOptions };
  const startedAt = new Date().toISOString();
  const { allowedHosts, seeds } = validateSeeds(options.seeds);
  const outputRoot = resolve(options.outputDir);
  await mkdir(outputRoot, { recursive: true });

  const authorization = {
    schema_version: "ecc.authorized-public-static-acquisition.v1",
    authorized_by: "user_instruction",
    evidence:
      "The user explicitly authorized this public static acquisition in the current task.",
    scope: {
      origins: ["http://konk.cc", "https://konk.cc"],
      host: TARGET_HOST,
      seeds,
    },
    constraints: [
      "GET only",
      "same authorized host only",
      "no cookies, sessions, tokens, or authorization headers",
      "no form submission or external mutation",
      "robots.txt is honored",
      "bounded requests, depth, rate, resource size, and total size",
    ],
    created_at: startedAt,
  };
  const authorizationPath = artifactPath(outputRoot, "authorization.json");
  await writeJson(authorizationPath, authorization);

  const records = [];
  const artifacts = [];
  const storedArtifactPaths = new Map();
  const queue = [];
  const seen = new Set();
  const state = { lastRequestAt: 0, requestCount: 0, totalBytes: 0 };
  let stopReason = null;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function")
    throw policyError("FETCH_UNAVAILABLE", "global fetch is unavailable");

  const fetchUrl = async (rawUrl, { ignoreRobots = false } = {}) => {
    let current = new URL(rawUrl);
    const redirects = [];
    for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
      if (!isAllowedUrl(current, allowedHosts)) {
        throw policyError(
          "SCOPE_BLOCKED",
          "request or redirect left the authorized host",
        );
      }
      if (!ignoreRobots && !robotsAllows(current.href, robotsDisallowed)) {
        throw policyError(
          "ROBOTS_DISALLOWED",
          "robots.txt disallows this path",
        );
      }

      const waitFor = options.delayMs - (Date.now() - state.lastRequestAt);
      await sleep(Math.max(0, waitFor));
      state.lastRequestAt = Date.now();
      state.requestCount += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      let response;
      try {
        response = await fetchImpl(current.href, {
          method: "GET",
          redirect: "manual",
          headers: {
            Accept:
              "text/html, text/css, application/javascript, image/*, font/*, */*;q=0.1",
            "User-Agent": options.userAgent,
          },
          signal: controller.signal,
        });
      } catch (error) {
        throw policyError(
          "FETCH_ERROR",
          error instanceof Error ? error.message : "request failed",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location)
          throw policyError(
            "INVALID_REDIRECT",
            "redirect response has no location",
          );
        const nextUrl = new URL(location, current);
        redirects.push({
          from: current.href,
          to: nextUrl.href,
          status: response.status,
        });
        if (hop === options.maxRedirects)
          throw policyError("MAX_REDIRECTS", "redirect limit exceeded");
        current = nextUrl;
        continue;
      }

      const remaining = options.maxTotalBytes - state.totalBytes;
      if (remaining <= 0)
        throw policyError("MAX_TOTAL_BYTES", "total byte limit reached");
      const maxBytes = Math.min(options.maxResourceBytes, remaining);
      const body = await readBodyLimited(response, maxBytes);
      return {
        requestedUrl: rawUrl,
        finalUrl: current.href,
        response,
        body,
        redirects,
      };
    }
    throw policyError("MAX_REDIRECTS", "redirect limit exceeded");
  };

  let robotsDisallowed = [];
  try {
    const robotsUrl = `http://${TARGET_HOST}/robots.txt`;
    const robots = await fetchUrl(robotsUrl, { ignoreRobots: true });
    const robotsType = robots.response.headers.get("content-type") || "";
    const robotsText = decodeBody(robots.body, robotsType);
    robotsDisallowed = robots.response.ok ? parseRobots(robotsText) : [];
    records.push({
      kind: "robots",
      url: robotsUrl,
      final_url: robots.finalUrl,
      status: robots.response.status,
      content_type: robotsType,
      bytes: robots.body.byteLength,
      disallow: robotsDisallowed,
    });
    if (robots.response.ok) {
      const localPath = "robots.txt";
      const target = artifactPath(outputRoot, localPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, robots.body);
      artifacts.push({
        kind: "robots",
        url: robotsUrl,
        local_path: localPath,
        bytes: robots.body.byteLength,
        sha256: createHash("sha256").update(robots.body).digest("hex"),
      });
      state.totalBytes += robots.body.byteLength;
    }
  } catch (error) {
    records.push({
      kind: "robots",
      url: `http://${TARGET_HOST}/robots.txt`,
      status: "error",
      error: safeError(error),
    });
    stopReason = "robots_fetch_failed";
  }

  const enqueue = (rawUrl, depth, discoveredFrom) => {
    if (depth > options.maxDepth) return;
    const normalized = canonicalUrl(rawUrl, undefined, allowedHosts);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    queue.push({ url: normalized, depth, discoveredFrom });
  };
  for (const seed of seeds) enqueue(seed, 0, null);

  while (
    queue.length &&
    state.requestCount < options.maxRequests &&
    !stopReason
  ) {
    const item = queue.shift();
    if (!robotsAllows(item.url, robotsDisallowed)) {
      records.push({
        kind: "resource",
        url: item.url,
        depth: item.depth,
        status: "skipped",
        reason: "robots_disallowed",
      });
      continue;
    }

    let result;
    try {
      result = await fetchUrl(item.url);
    } catch (error) {
      const safe = safeError(error);
      records.push({
        kind: "resource",
        url: item.url,
        depth: item.depth,
        status: "error",
        error: safe,
      });
      if (["MAX_TOTAL_BYTES", "MAX_RESOURCE_BYTES"].includes(safe.code))
        stopReason = safe.code.toLowerCase();
      continue;
    }

    const contentType =
      result.response.headers.get("content-type") || "application/octet-stream";
    const record = {
      kind: "resource",
      url: item.url,
      final_url: result.finalUrl,
      depth: item.depth,
      discovered_from: item.discoveredFrom,
      status: result.response.status,
      content_type: contentType,
      redirects: result.redirects,
      bytes: result.body.byteLength,
    };

    if (result.response.ok) {
      const localPath = localPathForUrl(result.finalUrl, contentType);
      record.local_path = localPath;
      record.sha256 = createHash("sha256").update(result.body).digest("hex");
      const duplicateOf = storedArtifactPaths.get(localPath);
      if (duplicateOf) {
        record.stored = false;
        record.duplicate_of = duplicateOf;
      } else {
        const target = artifactPath(outputRoot, localPath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, result.body);
        storedArtifactPaths.set(localPath, result.finalUrl);
        artifacts.push({
          kind: "resource",
          url: result.finalUrl,
          local_path: localPath,
          content_type: contentType,
          bytes: result.body.byteLength,
          sha256: record.sha256,
        });
        state.totalBytes += result.body.byteLength;
      }

      const lowerType = contentType.toLowerCase();
      const text =
        lowerType.includes("text/html") ||
        lowerType.includes("text/css") ||
        lowerType.includes("javascript")
          ? decodeBody(result.body, contentType)
          : null;
      if (text && item.depth < options.maxDepth) {
        const discovered = lowerType.includes("text/css")
          ? discoverCssReferences(text, result.finalUrl, allowedHosts)
          : lowerType.includes("javascript")
            ? discoverJsReferences(text, result.finalUrl, allowedHosts)
            : discoverReferences(text, result.finalUrl, allowedHosts);
        for (const reference of discovered)
          enqueue(reference, item.depth + 1, result.finalUrl);
      }
    }

    records.push(record);
  }

  if (!stopReason && queue.length) stopReason = "request_limit";
  if (state.requestCount >= options.maxRequests && queue.length)
    stopReason = "request_limit";

  const completedAt = new Date().toISOString();
  const warnings = records.filter(
    (record) => record.status === "error" || record.status === "skipped",
  );
  const status = stopReason || warnings.length ? "warning" : "success";
  const manifest = {
    schema_version: "ecc.authorized-public-static-manifest.v1",
    status,
    started_at: startedAt,
    completed_at: completedAt,
    authorization,
    policy: {
      method: "GET",
      same_origin_only: true,
      allowed_host: TARGET_HOST,
      credentials_sent: false,
      form_submissions: false,
      external_mutations: false,
      robots_honored: true,
      max_requests: options.maxRequests,
      max_depth: options.maxDepth,
      delay_ms: options.delayMs,
      max_resource_bytes: options.maxResourceBytes,
      max_total_bytes: options.maxTotalBytes,
    },
    stop_reason: stopReason,
    counts: {
      requests: state.requestCount,
      records: records.length,
      artifacts: artifacts.length,
      warnings: warnings.length,
      total_bytes: state.totalBytes,
    },
    robots: { disallow: robotsDisallowed },
    records,
    artifacts,
    discovery: {
      html_and_css_references: true,
      javascript_static_asset_references: true,
      javascript_reference_execution: false,
      runtime_or_authenticated_surface: "not captured in static phase",
    },
  };
  const manifestPath = artifactPath(outputRoot, "manifest.json");
  await writeJson(manifestPath, manifest);

  return {
    status,
    summary: `Captured ${artifacts.length} public static artifacts (${state.totalBytes} bytes) from ${TARGET_HOST}.`,
    next_actions: [
      "Review manifest.json and the local artifact files.",
      "Use the authorized browser/runtime phase for JavaScript-created routes, dialogs, drawers, and interactions.",
    ],
    artifacts: {
      root: outputRoot,
      manifest: manifestPath,
      authorization: authorizationPath,
      artifact_count: artifacts.length,
      total_bytes: state.totalBytes,
      stop_reason: stopReason,
    },
  };
}

function helpText() {
  return [
    "Usage: node scripts/Acquire-PublicStatic.mjs [options]",
    "  --seed <url>          repeatable same-host seed (default: konk.cc root and /tgcloud_pc/)",
    "  --output <dir>        artifact directory (default: artifacts/authorized-mirror)",
    "  --max-requests <n>    request cap, 1-500 (default: 120)",
    "  --max-depth <n>       discovery depth, 0-12 (default: 4)",
    "  --delay-ms <n>        minimum delay between requests (default: 350)",
    "  --timeout-ms <n>      per-request timeout (default: 20000)",
    "  --max-resource-mb <n> per-resource cap (default: 12)",
    "  --max-total-mb <n>    total artifact cap (default: 120)",
  ].join("\n");
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
  const result = await acquirePublicStatic(options);
  console.log(JSON.stringify(result));
  if (result.status === "error") process.exitCode = 1;
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const result = {
      status: "error",
      summary: "Public static acquisition stopped before completion.",
      next_actions: [
        "Review the error and scope limits, then rerun only with explicit authorization.",
      ],
      artifacts: { error: safeError(error) },
    };
    console.error(JSON.stringify(result));
    process.exitCode = 1;
  });
}
