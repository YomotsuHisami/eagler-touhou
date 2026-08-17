import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createThcrapClient, downloadThcrapPack } from "../integrations/thcrap.mjs";

const API_PREFIX = "/api/thcrap";
const GAME_ID = /^th(?:06|07)$/;
const LANGUAGE_ID = /^lang_[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const ASSET_FILE = /^[a-f0-9]{24}(?:\.[a-z0-9]+)?$/;
const JSON_TYPES = new Set(["jdiff", "table"]);

const MIME = new Map([
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"]
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertId(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`invalid ${label}`);
  return value;
}

function assertInside(base, target) {
  if (target !== base && !target.startsWith(base + sep)) throw new Error("cache path escaped its root");
  return target;
}

function validateJsonTree(value, depth = 0) {
  if (depth > 16) throw new TypeError("thcrap JSON nesting is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("thcrap JSON contains a non-finite number");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new TypeError("thcrap JSON array is too large");
    for (const item of value) validateJsonTree(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") throw new TypeError("thcrap JSON contains an unsupported value");
  const entries = Object.entries(value);
  if (entries.length > 20000) throw new TypeError("thcrap JSON object is too large");
  for (const [key, item] of entries) {
    if (!key || key.length > 240 || key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new TypeError("thcrap JSON contains an unsafe key");
    }
    validateJsonTree(item, depth + 1);
  }
}

function processResource(resource) {
  if (!resource || !(resource.bytes instanceof Uint8Array)) throw new TypeError("invalid downloaded thcrap resource");
  if (!JSON_TYPES.has(resource.kind)) {
    return { bytes: resource.bytes, extension: extname(resource.path).toLowerCase() || ".bin", format: resource.kind };
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resource.bytes));
  } catch (error) {
    throw new TypeError(`${resource.path}: invalid UTF-8 JSON (${error.message})`);
  }
  validateJsonTree(parsed);
  const bytes = new TextEncoder().encode(`${JSON.stringify(parsed)}\n`);
  return { bytes, extension: ".json", format: resource.kind === "jdiff" ? "thcrap-jdiff/1" : "thcrap-table/1" };
}

async function atomicWrite(path, bytes) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

function jsonResponse(response, statusCode, value, headers = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
    ...headers
  });
  response.end(bytes);
}

export class ThcrapService {
  constructor({
    repository,
    fetchImpl = globalThis.fetch,
    cacheRoot = resolve(tmpdir(), "eagler-touhou-thcrap-cache"),
    maxAgeMs = 15 * 60 * 1000,
    now = Date.now,
    resourceProcessor = processResource,
    packProcessor = null
  } = {}) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new TypeError("invalid thcrap cache age");
    if (typeof resourceProcessor !== "function") throw new TypeError("thcrap resource processor is required");
    if (packProcessor !== null && typeof packProcessor !== "function") throw new TypeError("invalid thcrap pack processor");
    this.client = createThcrapClient({ repository, fetchImpl });
    this.fetchImpl = fetchImpl;
    this.cacheRoot = resolve(cacheRoot);
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    this.resourceProcessor = resourceProcessor;
    this.packProcessor = packProcessor;
    this.memory = new Map();
    this.inflight = new Map();
    this.languages = null;
  }

  async listLanguages() {
    if (this.languages && this.now() - this.languages.checkedAt < this.maxAgeMs) return this.languages.value;
    const value = await this.client.discoverLanguages();
    this.languages = { checkedAt: this.now(), value };
    return value;
  }

  async buildManifest(game, language) {
    const gameId = assertId(game, GAME_ID, "game id");
    const languageId = assertId(language, LANGUAGE_ID, "language id");
    const pack = await this.client.resolveLanguage(languageId, gameId);
    const sourceRevision = sha256(JSON.stringify(pack.assets.map(({ path, crc32 }) => [path, crc32]))).slice(0, 24);
    const cached = this.memory.get(`${gameId}/${languageId}`);
    if (cached && cached.sourceRevision === sourceRevision) {
      cached.checkedAt = this.now();
      return cached.manifest;
    }

    const downloaded = await downloadThcrapPack(pack, { fetchImpl: this.fetchImpl, concurrency: 6 });
    const directory = assertInside(this.cacheRoot, resolve(this.cacheRoot, gameId, languageId));
    const assetsDirectory = assertInside(this.cacheRoot, resolve(directory, "assets"));
    await mkdir(assetsDirectory, { recursive: true });

    const processedResources = this.packProcessor
      ? await this.packProcessor(downloaded.resources)
      : await Promise.all(downloaded.resources.map(async resource => ({
          ...resource,
          ...(await this.resourceProcessor(resource))
        })));
    if (!Array.isArray(processedResources)) throw new TypeError("thcrap pack processor returned invalid resources");

    const assets = [];
    for (const processed of processedResources) {
      if (!processed || !(processed.bytes instanceof Uint8Array)) {
        throw new TypeError(`${processed?.path || "unknown"}: processor returned invalid bytes`);
      }
      const digest = sha256(processed.bytes);
      const file = `${digest.slice(0, 24)}${processed.extension}`;
      const target = assertInside(assetsDirectory, resolve(assetsDirectory, file));
      try {
        const info = await stat(target);
        if (!info.isFile() || info.size !== processed.bytes.length) await atomicWrite(target, processed.bytes);
      } catch {
        await atomicWrite(target, processed.bytes);
      }
      assets.push({
        sourcePath: processed.path,
        targetPath: processed.targetPath || processed.mountPath,
        format: processed.format,
        bytes: processed.bytes.length,
        sha256: digest,
        url: `${API_PREFIX}/${gameId}/${languageId}/assets/${file}`
      });
    }

    const manifest = {
      schema: "eagler-touhou/thcrap-runtime-pack/1",
      game: gameId,
      language: languageId,
      title: pack.title,
      repository: pack.repository,
      sourceRevision,
      dependencies: pack.dependencies,
      runtimeReady: assets.every(asset => !asset.format.startsWith("thcrap-")),
      assets
    };
    await atomicWrite(resolve(directory, "manifest.json"), new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
    this.memory.set(`${gameId}/${languageId}`, { checkedAt: this.now(), sourceRevision, manifest });
    return manifest;
  }

  async getManifest(game, language) {
    const gameId = assertId(game, GAME_ID, "game id");
    const languageId = assertId(language, LANGUAGE_ID, "language id");
    const key = `${gameId}/${languageId}`;
    const cached = this.memory.get(key);
    if (cached && this.now() - cached.checkedAt < this.maxAgeMs) return cached.manifest;
    if (!this.inflight.has(key)) {
      this.inflight.set(key, this.buildManifest(gameId, languageId).finally(() => this.inflight.delete(key)));
    }
    return this.inflight.get(key);
  }

  async getAsset(game, language, file) {
    const gameId = assertId(game, GAME_ID, "game id");
    const languageId = assertId(language, LANGUAGE_ID, "language id");
    const assetFile = assertId(file, ASSET_FILE, "asset id");
    const path = assertInside(this.cacheRoot, resolve(this.cacheRoot, gameId, languageId, "assets", assetFile));
    const info = await stat(path);
    if (!info.isFile()) throw new Error("asset is not a file");
    return { path, info, contentType: MIME.get(extname(path).toLowerCase()) || "application/octet-stream" };
  }
}

export function createThcrapHttpHandler(options = {}) {
  const service = options.service || new ThcrapService(options);
  return async function handleThcrap(request, response, url) {
    if (!url.pathname.startsWith(`${API_PREFIX}/`) && url.pathname !== `${API_PREFIX}/languages`) return false;
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return true;
    }
    try {
      if (url.pathname === `${API_PREFIX}/languages`) {
        const languages = await service.listLanguages();
        if (request.method === "HEAD") {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" }); response.end();
        } else jsonResponse(response, 200, { schema: "eagler-touhou/thcrap-languages/1", languages }, { "Cache-Control": "public, max-age=300" });
        return true;
      }
      const manifestMatch = /^\/api\/thcrap\/(th(?:06|07))\/(lang_[a-z0-9]+(?:-[a-z0-9]+)*)\/manifest\.json$/i.exec(url.pathname);
      if (manifestMatch) {
        const manifest = await service.getManifest(manifestMatch[1], manifestMatch[2]);
        const headers = { "Cache-Control": "public, max-age=300", ETag: `"${manifest.sourceRevision}"` };
        if (request.headers["if-none-match"] === headers.ETag) { response.writeHead(304, headers); response.end(); }
        else if (request.method === "HEAD") { response.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8" }); response.end(); }
        else jsonResponse(response, 200, manifest, headers);
        return true;
      }
      const assetMatch = /^\/api\/thcrap\/(th(?:06|07))\/(lang_[a-z0-9]+(?:-[a-z0-9]+)*)\/assets\/([a-f0-9]{24}(?:\.[a-z0-9]+)?)$/i.exec(url.pathname);
      if (assetMatch) {
        const asset = await service.getAsset(assetMatch[1], assetMatch[2], assetMatch[3]);
        response.writeHead(200, {
          "Content-Type": asset.contentType,
          "Content-Length": asset.info.size,
          "Cache-Control": "public, max-age=31536000, immutable"
        });
        if (request.method === "HEAD") response.end();
        else {
          const { createReadStream } = await import("node:fs");
          createReadStream(asset.path).pipe(response);
        }
        return true;
      }
      jsonResponse(response, 404, { error: "unknown thcrap endpoint" });
    } catch (error) {
      const invalid = error instanceof TypeError && /^invalid /.test(error.message);
      const payload = { error: error instanceof Error ? error.message : String(error) };
      if (url.searchParams.get("debug") === "1" && error instanceof Error) {
        payload.stack = error.stack || error.message;
        if (error.cause != null) payload.cause = error.cause instanceof Error
          ? { name: error.cause.name, message: error.cause.message, stack: error.cause.stack }
          : String(error.cause);
      }
      jsonResponse(response, invalid ? 400 : 502, payload, { "Cache-Control": "no-store" });
    }
    return true;
  };
}
