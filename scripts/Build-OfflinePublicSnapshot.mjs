#!/usr/bin/env node

/**
 * Assemble the already-acquired public mirror into a local-only preview.
 *
 * This module deliberately has no network-capable imports. It reads the
 * WebCopy export, the static manifest, and anonymous runtime request indexes;
 * it never replays requests, copies storage state, or imports the product
 * source tree.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_HOST = "konk.cc";
const DEFAULT_INPUT_DIR = resolve(
  process.cwd(),
  "artifacts",
  "authorized-mirror",
);
const DEFAULT_OUTPUT_DIR = join(DEFAULT_INPUT_DIR, "offline-preview");
const DEFAULT_MANIFEST_PATH = join(DEFAULT_INPUT_DIR, "manifest.json");
const DEFAULT_RUNTIME_DIR = join(DEFAULT_INPUT_DIR, "runtime");
const DEFAULT_ORIGIN = "http://konk.cc";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HTML_EXTENSIONS = new Set([".htm", ".html"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".htm",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
]);
const STATIC_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".eot",
  ".gif",
  ".html",
  ".htm",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".mjs",
  ".mp3",
  ".mp4",
  ".png",
  ".svg",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
]);
export const DEFAULT_OPTIONS = Object.freeze({
  inputDir: DEFAULT_INPUT_DIR,
  outputDir: DEFAULT_OUTPUT_DIR,
  manifestPath: DEFAULT_MANIFEST_PATH,
  runtimeDir: DEFAULT_RUNTIME_DIR,
  runtimeStaticDir: undefined,
  webcopyDir: undefined,
  cleanOutput: true,
});

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function normalizeRelativePath(value) {
  const normalized = toPosix(value).replace(/^\.\//, "");
  if (!normalized || normalized === ".") return "";
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "..")) return null;
  return segments.join("/");
}

function pathInside(root, candidate, code = "INVALID_PATH") {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${requirementSeparator()}`) ||
    isAbsolute(relativePath)
  ) {
    throw policyError(code, `path must remain inside ${resolvedRoot}`);
  }
  return resolvedCandidate;
}

function requirementSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

function assertInputPath(inputDir, candidate, code = "INVALID_SOURCE") {
  return pathInside(inputDir, candidate, code);
}

function isTextFile(path) {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function isLikelyStaticPath(path) {
  return STATIC_EXTENSIONS.has(extname(path).toLowerCase());
}

function canonicalUrl(rawUrl, baseUrl = `${DEFAULT_ORIGIN}/`) {
  let url;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
  if (
    url.username ||
    url.password ||
    url.hostname.toLowerCase() !== TARGET_HOST
  )
    return null;
  url.hash = "";
  return url;
}

function urlKey(url) {
  const normalized = url instanceof URL ? url : canonicalUrl(url);
  if (!normalized) return null;
  const pathname = normalized.pathname || "/";
  return `${normalized.hostname.toLowerCase()}${pathname}${normalized.search}`;
}

function urlPathKey(url) {
  const normalized = url instanceof URL ? url : canonicalUrl(url);
  if (!normalized) return null;
  return `${normalized.hostname.toLowerCase()}${normalized.pathname || "/"}`;
}

function stripQueryAndHash(rawReference) {
  const reference = rawReference.trim();
  const hashIndex = reference.indexOf("#");
  const hash = hashIndex >= 0 ? reference.slice(hashIndex) : "";
  const queryIndex =
    hashIndex >= 0 ? reference.indexOf("?") : reference.indexOf("?");
  const query =
    queryIndex >= 0 && (hashIndex < 0 || queryIndex < hashIndex)
      ? reference.slice(queryIndex, hashIndex >= 0 ? hashIndex : undefined)
      : "";
  return { query, hash };
}

function htmlPathForWebCopy(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === null) return null;
  if (!normalized) return "index.html";
  if (HTML_EXTENSIONS.has(extname(normalized).toLowerCase()))
    return normalized.replace(/\.htm$/i, ".html");
  return normalized;
}

function mapPathToRoute(localPath) {
  const normalized = normalizeRelativePath(localPath);
  if (!normalized) return "/";
  if (normalized === "index.html") return "/";
  if (normalized.endsWith("/index.html"))
    return `/${normalized.slice(0, -"index.html".length)}`;
  return `/${normalized}`;
}

function addUrlMapping(urlMap, rawUrl, localPath) {
  const url = canonicalUrl(rawUrl);
  const normalizedPath = normalizeRelativePath(localPath);
  if (!url || normalizedPath === null) return;
  const target = normalizedPath || "index.html";
  const mapped = { localPath: target, url: url.href };
  const exactKey = urlKey(url);
  const pathKey = urlPathKey(url);
  if (exactKey) urlMap.exact.set(exactKey, mapped);
  if (pathKey) urlMap.path.set(pathKey, mapped);
}

function addLocalPathMappings(urlMap, localPath) {
  const normalizedPath = normalizeRelativePath(localPath);
  if (normalizedPath === null) return;
  const route = mapPathToRoute(normalizedPath);
  addUrlMapping(urlMap, `${DEFAULT_ORIGIN}${route}`, normalizedPath);
  if (route.endsWith("/"))
    addUrlMapping(
      urlMap,
      `${DEFAULT_ORIGIN}${route.slice(0, -1)}`,
      normalizedPath,
    );
}

function lookupLocalPath(urlMap, url) {
  const normalized = canonicalUrl(url);
  if (!normalized) return null;
  return (
    urlMap.exact.get(urlKey(normalized))?.localPath ||
    urlMap.path.get(urlPathKey(normalized))?.localPath ||
    null
  );
}

function safeOutputPath(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized === null || !normalized)
    throw policyError(
      "UNSAFE_OUTPUT_PATH",
      "output path is not a safe relative path",
    );
  return pathInside(
    root,
    join(root, ...normalized.split("/")),
    "UNSAFE_OUTPUT_PATH",
  );
}

async function ensureDirectoryFor(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError)
      throw policyError("INVALID_JSON", `invalid JSON: ${path}`);
    throw error;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function walkFiles(root) {
  const files = [];
  async function walk(current, relativePrefix = "") {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativePrefix
        ? join(relativePrefix, entry.name)
        : entry.name;
      const absolutePath = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: toPosix(relativePath),
        });
      }
    }
  }
  await walk(root);
  return files;
}

async function findLatestWebCopyDir(inputDir) {
  const toolRunsDir = join(inputDir, "tool-runs");
  if (!(await exists(toolRunsDir)))
    throw policyError(
      "INVALID_SOURCE",
      `missing WebCopy tool directory: ${toolRunsDir}`,
    );
  const entries = await readdir(toolRunsDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^webcopy-/i.test(entry.name)) continue;
    const absolutePath = join(toolRunsDir, entry.name);
    const details = await stat(absolutePath);
    candidates.push({ absolutePath, name: entry.name, mtime: details.mtimeMs });
  }
  candidates.sort(
    (left, right) =>
      right.mtime - left.mtime || right.name.localeCompare(left.name),
  );
  if (!candidates.length)
    throw policyError("INVALID_SOURCE", "no WebCopy output was found");
  return candidates[0].absolutePath;
}

async function findLatestRuntimeStaticDir(inputDir) {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^runtime-static-/i.test(entry.name)) continue;
    const absolutePath = join(inputDir, entry.name);
    const details = await stat(absolutePath);
    candidates.push({ absolutePath, name: entry.name, mtime: details.mtimeMs });
  }
  candidates.sort(
    (left, right) =>
      right.mtime - left.mtime || right.name.localeCompare(left.name),
  );
  return candidates[0]?.absolutePath;
}

function makeUrlMap() {
  return { exact: new Map(), path: new Map() };
}

function addManifestMappings(urlMap, manifest) {
  for (const item of manifest?.artifacts || []) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.local_path !== "string" || typeof item.url !== "string")
      continue;
    const normalized = htmlPathForWebCopy(item.local_path);
    if (normalized) addUrlMapping(urlMap, item.url, normalized);
  }
  for (const item of manifest?.records || []) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.local_path !== "string" || typeof item.url !== "string")
      continue;
    const normalized = htmlPathForWebCopy(item.local_path);
    if (normalized) addUrlMapping(urlMap, item.url, normalized);
  }
}

function sourceBaseUrl(localPath) {
  const normalized = normalizeRelativePath(localPath);
  if (!normalized) return `${DEFAULT_ORIGIN}/`;
  if (normalized === "index.html") return `${DEFAULT_ORIGIN}/`;
  if (normalized.endsWith("/index.html"))
    return `${DEFAULT_ORIGIN}/${normalized.slice(0, -"index.html".length)}`;
  return `${DEFAULT_ORIGIN}/${normalized}`;
}

function isReferenceThatCanBeRewritten(rawReference) {
  const reference = rawReference.trim();
  return Boolean(
    reference &&
    !/^(?:data|javascript|mailto|tel|blob):/i.test(reference) &&
    !reference.startsWith("#"),
  );
}

function relativeAssetPath(sourceLocalPath, targetLocalPath, suffix = "") {
  const sourceDir = dirname(toPosix(sourceLocalPath));
  const target = toPosix(targetLocalPath);
  let result = toPosix(relative(sourceDir, target));
  if (!result) result = basename(target);
  if (!result.startsWith(".")) return `${result}${suffix}`;
  return `${result}${suffix}`;
}

function addUnresolvedReference(unresolved, item) {
  const identity = `${item.file || ""}|${item.reference || item.url || ""}|${item.kind || ""}`;
  if (!unresolved.some((entry) => entry.identity === identity))
    unresolved.push({ identity, ...item });
}

function rewriteReference(
  rawReference,
  sourceUrl,
  sourceLocalPath,
  urlMap,
  unresolved,
  filePath,
  stats,
  trackUnresolved = true,
) {
  const reference = rawReference.trim();
  if (!isReferenceThatCanBeRewritten(reference)) return rawReference;
  const targetUrl = canonicalUrl(reference, sourceUrl);
  if (!targetUrl) return rawReference;
  const targetPath = lookupLocalPath(urlMap, targetUrl);
  if (!targetPath) {
    if (trackUnresolved) {
      const pathName = targetUrl.pathname || "/";
      addUnresolvedReference(unresolved, {
        kind: pathName.startsWith("/api/") ? "api" : "unresolved_reference",
        file: filePath,
        reference,
        url: targetUrl.href,
      });
    }
    return rawReference;
  }
  const { hash } = stripQueryAndHash(reference);
  if (stats) stats.rewritten += 1;
  return relativeAssetPath(sourceLocalPath, targetPath, hash);
}

function rewriteHtml(
  text,
  sourceUrl,
  sourceLocalPath,
  urlMap,
  unresolved,
  filePath,
  stats,
) {
  const attributePattern =
    /(\b(?:href|src|poster|data-src)\s*=\s*)(["'])(.*?)(\2)/gis;
  let rewritten = text.replace(
    attributePattern,
    (_match, prefix, quote, value, closingQuote) =>
      `${prefix}${quote}${rewriteReference(
        value,
        sourceUrl,
        sourceLocalPath,
        urlMap,
        unresolved,
        filePath,
        stats,
      )}${closingQuote}`,
  );
  const srcsetPattern = /(\bsrcset\s*=\s*)(["'])(.*?)(\2)/gis;
  rewritten = rewritten.replace(
    srcsetPattern,
    (_match, prefix, quote, value, closingQuote) => {
      const candidates = value.split(",").map((candidate) => {
        const match = candidate.trim().match(/^(\S+)(\s+.*)?$/s);
        if (!match) return candidate;
        return `${rewriteReference(
          match[1],
          sourceUrl,
          sourceLocalPath,
          urlMap,
          unresolved,
          filePath,
          stats,
        )}${match[2] || ""}`;
      });
      return `${prefix}${quote}${candidates.join(",")}${closingQuote}`;
    },
  );
  return rewritten;
}

function rewriteCss(
  text,
  sourceUrl,
  sourceLocalPath,
  urlMap,
  unresolved,
  filePath,
  stats,
) {
  return text.replace(
    /(url|@import)\s*\(\s*(["']?)([^)"']+)(\2)\s*\)/gi,
    (_match, functionName, quote, value, closingQuote) =>
      `${functionName}(${quote}${rewriteReference(
        value,
        sourceUrl,
        sourceLocalPath,
        urlMap,
        unresolved,
        filePath,
        stats,
      )}${closingQuote})`,
  );
}

function rewriteJavaScript(
  text,
  sourceUrl,
  sourceLocalPath,
  urlMap,
  unresolved,
  filePath,
  stats,
) {
  return text.replace(
    /(["'])(https?:\/\/konk\.cc[^"']+|\/[^"']+|\.\.?\/[^"']+)(\1)/gi,
    (_match, quote, value, closingQuote) =>
      `${quote}${rewriteReference(
        value,
        sourceUrl,
        sourceLocalPath,
        urlMap,
        unresolved,
        filePath,
        stats,
        false,
      )}${closingQuote}`,
  );
}

function rewriteText(text, localPath, urlMap, unresolved, stats) {
  const sourceUrl = sourceBaseUrl(localPath);
  const extension = extname(localPath).toLowerCase();
  if (HTML_EXTENSIONS.has(extension))
    return rewriteHtml(
      text,
      sourceUrl,
      localPath,
      urlMap,
      unresolved,
      localPath,
      stats,
    );
  if (extension === ".css")
    return rewriteCss(
      text,
      sourceUrl,
      localPath,
      urlMap,
      unresolved,
      localPath,
      stats,
    );
  if (extension === ".js" || extension === ".mjs")
    return rewriteJavaScript(
      text,
      sourceUrl,
      localPath,
      urlMap,
      unresolved,
      localPath,
      stats,
    );
  return text;
}

function redactRuntimeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  for (const [key] of url.searchParams) {
    url.searchParams.set(key, "<redacted>");
  }
  url.hash = "";
  return url.href;
}

function runtimeRequestFiles(runtimeDir) {
  return readdir(join(runtimeDir, "requests"), { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(runtimeDir, "requests", entry.name))
        .sort(),
    )
    .catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
}

function resourceIsStatic(request) {
  const resourceType = String(request.resource_type || "").toLowerCase();
  if (
    ["document", "stylesheet", "script", "image", "font", "media"].includes(
      resourceType,
    )
  )
    return true;
  return isLikelyStaticPath(new URL(request.url).pathname);
}

function isSuccessStatus(status) {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

async function copyFileBytes(sourcePath, outputRoot, localPath) {
  const outputPath = safeOutputPath(outputRoot, localPath);
  await ensureDirectoryFor(outputPath);
  const bytes = await readFile(sourcePath);
  await writeFile(outputPath, bytes);
  return { outputPath, bytes };
}

function makeFileRecord(localPath, sourcePath, sourceKind, bytes) {
  return {
    path: localPath,
    source: toPosix(sourcePath),
    source_kind: sourceKind,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function parseRuntimeRequests(runtimeDir) {
  const requests = [];
  const paths = await runtimeRequestFiles(runtimeDir);
  for (const path of paths) {
    const value = await readJson(path, null);
    for (const request of value?.requests || []) {
      if (
        !request ||
        typeof request !== "object" ||
        typeof request.url !== "string"
      )
        continue;
      requests.push({
        ...request,
        source_index: toPosix(relative(runtimeDir, path)),
        url: redactRuntimeUrl(request.url),
      });
    }
  }
  return requests;
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[++index];
    if (argument === "--input") options.inputDir = resolve(next());
    else if (argument === "--webcopy") options.webcopyDir = resolve(next());
    else if (argument === "--runtime") options.runtimeDir = resolve(next());
    else if (argument === "--runtime-static")
      options.runtimeStaticDir = resolve(next());
    else if (argument === "--manifest") options.manifestPath = resolve(next());
    else if (argument === "--output") options.outputDir = resolve(next());
    else if (argument === "--no-clean") options.cleanOutput = false;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw policyError("INVALID_OPTION", `unknown option: ${argument}`);
  }
  return options;
}

function safeError(error) {
  return {
    code: error?.code || "ASSEMBLY_ERROR",
    message: error instanceof Error ? error.message : "offline assembly failed",
  };
}

export async function buildOfflinePublicSnapshot(inputOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...inputOptions };
  const inputDir = resolve(options.inputDir);
  const outputDir = resolve(
    inputOptions.outputDir ||
      (inputOptions.inputDir
        ? join(inputDir, "offline-preview")
        : options.outputDir),
  );
  const manifestPath = resolve(
    inputOptions.manifestPath ||
      (inputOptions.inputDir
        ? join(inputDir, "manifest.json")
        : options.manifestPath),
  );
  const runtimeDir = resolve(
    inputOptions.runtimeDir ||
      (inputOptions.inputDir ? join(inputDir, "runtime") : options.runtimeDir),
  );
  const startedAt = new Date().toISOString();

  if (!(await exists(inputDir)))
    throw policyError(
      "INVALID_SOURCE",
      `input directory does not exist: ${inputDir}`,
    );
  assertInputPath(inputDir, manifestPath);
  assertInputPath(inputDir, runtimeDir);
  if (
    outputDir === inputDir ||
    outputDir.startsWith(`${inputDir}${requirementSeparator()}`) === false
  )
    throw policyError(
      "INVALID_OUTPUT",
      "offline preview must be inside the local input directory",
    );
  const webcopyDir = resolve(
    options.webcopyDir || (await findLatestWebCopyDir(inputDir)),
  );
  assertInputPath(inputDir, webcopyDir);
  if (!(await exists(webcopyDir)))
    throw policyError(
      "INVALID_SOURCE",
      `WebCopy directory does not exist: ${webcopyDir}`,
    );
  const runtimeStaticDir = options.runtimeStaticDir
    ? resolve(options.runtimeStaticDir)
    : await findLatestRuntimeStaticDir(inputDir);
  if (runtimeStaticDir) {
    assertInputPath(inputDir, runtimeStaticDir);
    if (!(await exists(runtimeStaticDir)))
      throw policyError(
        "INVALID_SOURCE",
        `runtime static directory does not exist: ${runtimeStaticDir}`,
      );
  }
  if (
    outputDir === webcopyDir ||
    outputDir.startsWith(`${webcopyDir}${requirementSeparator()}`) ||
    (runtimeStaticDir &&
      (outputDir === runtimeStaticDir ||
        outputDir.startsWith(`${runtimeStaticDir}${requirementSeparator()}`)))
  ) {
    throw policyError(
      "INVALID_OUTPUT",
      "offline preview cannot overwrite an acquisition source",
    );
  }

  const manifest = await readJson(manifestPath, {});
  const runtimeStaticManifest = runtimeStaticDir
    ? await readJson(join(runtimeStaticDir, "manifest.json"), {})
    : {};
  const runtimeRequests = await parseRuntimeRequests(runtimeDir);
  const urlMap = makeUrlMap();
  const unresolved = [];
  const rewriteStats = { rewritten: 0 };
  const fileRecords = [];
  const copied = new Set();

  addManifestMappings(urlMap, manifest);
  addManifestMappings(urlMap, runtimeStaticManifest);

  if (options.cleanOutput) {
    await rm(outputDir, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });

  const webcopyFiles = await walkFiles(webcopyDir);
  for (const source of webcopyFiles) {
    const localPath = htmlPathForWebCopy(source.relativePath);
    if (
      !localPath ||
      localPath.startsWith("hts-cache/") ||
      localPath.includes("/hts-cache/") ||
      ["tool.log", "webcopy-origin.txt", "hts-log.txt"].includes(
        basename(localPath),
      )
    )
      continue;
    addLocalPathMappings(urlMap, localPath);
  }
  for (const source of webcopyFiles) {
    const localPath = htmlPathForWebCopy(source.relativePath);
    if (
      !localPath ||
      localPath.startsWith("hts-cache/") ||
      localPath.includes("/hts-cache/") ||
      ["tool.log", "webcopy-origin.txt", "hts-log.txt"].includes(
        basename(localPath),
      )
    )
      continue;
    safeOutputPath(outputDir, localPath);
    addLocalPathMappings(urlMap, localPath);
    const bytes = await readFile(source.absolutePath);
    const outputBytes = isTextFile(localPath)
      ? Buffer.from(
          rewriteText(
            bytes.toString("utf8"),
            localPath,
            urlMap,
            unresolved,
            rewriteStats,
          ),
        )
      : bytes;
    const outputPath = safeOutputPath(outputDir, localPath);
    await ensureDirectoryFor(outputPath);
    await writeFile(outputPath, outputBytes);
    copied.add(localPath);
    fileRecords.push(
      makeFileRecord(localPath, source.relativePath, "webcopy", outputBytes),
    );
  }

  const staticArtifactCandidates = [];
  for (const item of manifest?.artifacts || []) {
    if (!item || typeof item.local_path !== "string") continue;
    const localPath = htmlPathForWebCopy(item.local_path);
    if (!localPath) continue;
    staticArtifactCandidates.push({
      localPath,
      sourcePath: join(inputDir, ...localPath.split("/")),
      sourceKind: "static-manifest",
      url: typeof item.url === "string" ? item.url : null,
    });
    if (item.url) addUrlMapping(urlMap, item.url, localPath);
  }
  for (const candidate of staticArtifactCandidates) {
    if (
      copied.has(candidate.localPath) ||
      !(await exists(candidate.sourcePath))
    )
      continue;
    const { bytes } = await copyFileBytes(
      candidate.sourcePath,
      outputDir,
      candidate.localPath,
    );
    copied.add(candidate.localPath);
    addLocalPathMappings(urlMap, candidate.localPath);
    fileRecords.push(
      makeFileRecord(
        candidate.localPath,
        candidate.sourcePath,
        candidate.sourceKind,
        bytes,
      ),
    );
  }

  if (runtimeStaticDir) {
    for (const item of runtimeStaticManifest?.artifacts || []) {
      if (!item || typeof item.local_path !== "string") continue;
      const localPath = htmlPathForWebCopy(item.local_path);
      if (!localPath) continue;
      const candidate = {
        localPath,
        sourcePath: join(runtimeStaticDir, ...localPath.split("/")),
        sourceKind: "runtime-static-manifest",
      };
      if (item.url) addUrlMapping(urlMap, item.url, localPath);
      if (copied.has(localPath) || !(await exists(candidate.sourcePath)))
        continue;
      const { bytes } = await copyFileBytes(
        candidate.sourcePath,
        outputDir,
        candidate.localPath,
      );
      copied.add(candidate.localPath);
      addLocalPathMappings(urlMap, candidate.localPath);
      fileRecords.push(
        makeFileRecord(
          candidate.localPath,
          candidate.sourcePath,
          candidate.sourceKind,
          bytes,
        ),
      );
    }
  }

  for (const request of runtimeRequests) {
    const method = String(request.method || "GET").toUpperCase();
    const requestUrl = canonicalUrl(request.url);
    if (!requestUrl) {
      addUnresolvedReference(unresolved, {
        kind: "out_of_scope_runtime_request",
        url: request.url,
        source_index: request.source_index,
      });
      continue;
    }
    if (!SAFE_METHODS.has(method)) {
      addUnresolvedReference(unresolved, {
        kind: "unsafe_method",
        method,
        url: request.url,
        status: request.status,
        source_index: request.source_index,
      });
      continue;
    }
    const targetLocalPath = lookupLocalPath(urlMap, requestUrl);
    const staticRequest = resourceIsStatic(request);
    if (isSuccessStatus(request.status) && staticRequest && targetLocalPath)
      continue;
    if (staticRequest) {
      addUnresolvedReference(unresolved, {
        kind: isSuccessStatus(request.status)
          ? "unresolved_static"
          : "missing_static",
        url: request.url,
        status: request.status,
        resource_type: request.resource_type,
        source_index: request.source_index,
      });
    } else {
      addUnresolvedReference(unresolved, {
        kind: "api",
        url: request.url,
        status: request.status,
        resource_type: request.resource_type,
        source_index: request.source_index,
      });
    }
  }

  const runtimeGapPath = "runtime-gaps.json";
  const runtimeGaps = unresolved.map((entry) =>
    Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== "identity"),
    ),
  );
  const runtimeGapBytes = Buffer.from(
    `${JSON.stringify(
      {
        schema_version: "ecc.offline-public-runtime-gaps.v1",
        network_access: false,
        credentials_copied: false,
        api_calls_replayed: false,
        gaps: runtimeGaps,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(safeOutputPath(outputDir, runtimeGapPath), runtimeGapBytes);
  fileRecords.push(
    makeFileRecord(
      runtimeGapPath,
      "generated",
      "assembly-metadata",
      runtimeGapBytes,
    ),
  );

  const completedAt = new Date().toISOString();
  const snapshotManifest = {
    schema_version: "ecc.offline-public-snapshot.v1",
    status: "success",
    started_at: startedAt,
    completed_at: completedAt,
    source: {
      base: toPosix(relative(inputDir, webcopyDir)),
      static_manifest: toPosix(relative(inputDir, manifestPath)),
      runtime_indexes: toPosix(relative(inputDir, runtimeDir)),
      runtime_static: runtimeStaticDir
        ? toPosix(relative(inputDir, runtimeStaticDir))
        : null,
    },
    policy: {
      network_access: false,
      network_requests: 0,
      source_mode: "local-only",
      base_export: "webcopy",
      same_origin_asset_rewrite: true,
      credentials_copied: false,
      cookies_copied: false,
      tokens_copied: false,
      api_calls_replayed: false,
      product_source_imported: false,
      external_mutations: false,
    },
    counts: {
      files: fileRecords.length,
      bytes: fileRecords.reduce((total, record) => total + record.bytes, 0),
      rewritten_references: rewriteStats.rewritten,
      runtime_gaps: runtimeGaps.length,
    },
    files: fileRecords.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    runtime_gaps: runtimeGaps,
    next_actions: [
      "Review runtime-gaps.json before implementing any API or interaction behavior.",
      "Keep this snapshot outside src/ product code until clean-room implementation is reviewed.",
    ],
  };
  const manifestBytes = Buffer.from(
    `${JSON.stringify(snapshotManifest, null, 2)}\n`,
  );
  await writeFile(
    safeOutputPath(outputDir, "snapshot-manifest.json"),
    manifestBytes,
  );

  const relativeOutput = toPosix(relative(process.cwd(), outputDir));
  return {
    status: "success",
    summary: {
      message:
        "Offline public snapshot assembled from local WebCopy and acquired artifacts.",
      output: relativeOutput,
      base_export: toPosix(relative(inputDir, webcopyDir)),
      files: fileRecords.length,
      bytes: fileRecords.reduce((total, record) => total + record.bytes, 0),
      runtime_gaps: runtimeGaps.length,
      network_requests: 0,
    },
    next_actions: snapshotManifest.next_actions,
    artifacts: {
      output_dir: outputDir,
      manifest: join(outputDir, "snapshot-manifest.json"),
      runtime_gaps: join(outputDir, runtimeGapPath),
      pages: fileRecords
        .filter((record) =>
          HTML_EXTENSIONS.has(extname(record.path).toLowerCase()),
        )
        .map((record) => record.path),
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      JSON.stringify({
        status: "success",
        summary:
          "Build a local-only preview from existing acquisition artifacts.",
        next_actions: ["Run without --help to assemble the snapshot."],
        artifacts: {},
      }),
    );
    return;
  }
  try {
    console.log(
      JSON.stringify(await buildOfflinePublicSnapshot(options), null, 2),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "error",
          summary: safeError(error),
          next_actions: [
            "Fix the local source path or manifest, then rerun the offline assembler.",
          ],
          artifacts: {},
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
