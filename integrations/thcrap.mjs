export const THCRAP_DEFAULT_REPOSITORY = "https://srv.thpatch.net/";
export const THCRAP_SUPPORTED_GAMES = Object.freeze(["th06", "th07"]);

const LANGUAGE_ID = /^lang_[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const GAME_ID = /^th(?:06|07)$/;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function normalizeRoot(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new TypeError("thcrap repository must use HTTP(S)");
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function assertLanguageId(value) {
  if (typeof value !== "string" || !LANGUAGE_ID.test(value)) {
    throw new TypeError(`invalid thcrap language id: ${value}`);
  }
  return value;
}

function assertGameId(value) {
  if (typeof value !== "string" || !GAME_ID.test(value)) {
    throw new TypeError(`unsupported game id: ${value}`);
  }
  return value;
}

function assertPatchPath(value, game) {
  if (typeof value !== "string" || value.length > 240 || value.includes("\\") || value.startsWith("/")) {
    throw new TypeError(`invalid thcrap path: ${value}`);
  }
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === "..") || parts[0] !== game) {
    throw new TypeError(`thcrap path escapes ${game}: ${value}`);
  }
  return value;
}

function assertAssetPath(value) {
  if (typeof value !== "string" || !value || value.length > 240 || value.includes("\\") || value.startsWith("/")) {
    throw new TypeError(`invalid thcrap path: ${value}`);
  }
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new TypeError(`invalid thcrap path: ${value}`);
  return value;
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return assertObject(await response.json(), label);
}

function extension(path) {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

export function classifyThcrapAsset(path) {
  if (/\.jdiff$/i.test(path)) return "jdiff";
  if (/\.(?:png|jpg|jpeg)$/i.test(path)) return "image";
  if (/\.js$/i.test(path)) return "table";
  return "binary";
}

export function createThcrapClient({
  repository = THCRAP_DEFAULT_REPOSITORY,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  const repositoryUrl = normalizeRoot(repository);

  async function discoverLanguages() {
    const repo = await fetchJson(fetchImpl, new URL("repo.js", repositoryUrl), "thcrap repo.js");
    const patches = assertObject(repo.patches, "thcrap repo.js patches");
    return Object.entries(patches)
      .filter(([id]) => LANGUAGE_ID.test(id))
      .map(([id, entry]) => ({
        id,
        title: typeof entry === "string" ? entry : (entry && typeof entry.title === "string" ? entry.title : id)
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function resolveLanguage(language, game) {
    const id = assertLanguageId(language);
    const gameId = assertGameId(game);
    const repositoryRoots = new Map([
      ["thpatch", repositoryUrl],
      ["nmlgc", new URL(repositoryUrl).hostname === "srv.thpatch.net"
        ? "https://mirrors.thpatch.net/nmlgc/" : repositoryUrl]
    ]);
    const visited = new Set();
    const ordered = [];
    async function visit(reference, inheritedRepo = "thpatch") {
      if (reference === "base_tsa" || reference === "base_tasofro") reference = `nmlgc/${reference}`;
      const slash = reference.indexOf("/");
      const prefix = slash >= 0 ? reference.slice(0, slash) : "";
      const explicitRepo = slash >= 0;
      const repo = explicitRepo ? prefix : inheritedRepo;
      const patchId = explicitRepo ? reference.slice(slash + 1) : reference;
      if (!/^[a-z0-9_][a-z0-9_-]*$/i.test(repo) ||
          !/^[a-z0-9_][a-z0-9_-]*(?:\/[a-z0-9_][a-z0-9_-]*)*$/i.test(patchId)) {
        throw new TypeError(`invalid thcrap dependency: ${reference}`);
      }
      const key = `${repo}/${patchId}`;
      if (visited.has(key)) return;
      visited.add(key);
      let root = repositoryRoots.get(repo);
      if (!root) {
        root = `https://mirrors.thpatch.net/${repo}/`;
        const metadata = await fetchJson(fetchImpl, new URL("repo.js", root), `${repo}/repo.js`);
        if (metadata.id !== repo) throw new Error(`${repo}/repo.js returned id ${metadata.id}`);
        repositoryRoots.set(repo, root);
      }
      const patchRoot = new URL(`${patchId}/`, root);
      const [patch, files] = await Promise.all([
        fetchJson(fetchImpl, new URL("patch.js", patchRoot), `${key}/patch.js`),
        fetchJson(fetchImpl, new URL("files.js", patchRoot), `${key}/files.js`)
      ]);
      const leafId = patchId.slice(patchId.lastIndexOf("/") + 1);
      if (patch.id !== leafId) throw new Error(`${key}/patch.js returned id ${patch.id}`);
      for (const dependency of Array.isArray(patch.dependencies) ? patch.dependencies : []) {
        if (typeof dependency === "string") await visit(dependency, repo);
      }
      ordered.push({ repo, patchId, patch, files, patchRoot });
    }
    await visit(id);

    const assetMap = new Map();
    const mergeAssets = [];
    for (let sourceOrder = 0; sourceOrder < ordered.length; sourceOrder++) {
      const item = ordered[sourceOrder];
      for (const [rawPath, crc] of Object.entries(item.files)) {
      const isSharedThemes = rawPath === "themes.js";
      const isStringDefs = rawPath === "stringdefs.js";
      const isGameAsset = rawPath.startsWith(`${gameId}/`);
      const isRootGameOptions = rawPath === `${gameId}.js`;
      const isFont = Object.hasOwn(item.patch.fonts || {}, rawPath);
      const isGlobalOptions = rawPath === "global.js" && Object.keys(item.patch.fonts || {}).length > 0;
      if (!isGameAsset && !isSharedThemes && !isStringDefs && !isRootGameOptions && !isFont && !isGlobalOptions) continue;
      // A language patch can contain thcrap-only executable tables such as
      // stringlocs/binhacks. They cannot be interpreted by the native port and
      // must not make an otherwise complete runtime pack look half-supported.
      // stringdefs.js is different: it is the data table consumed by
      // thcrap's strings/ascii hooks, so keep it for deterministic compilation
      // into the native/Web runtime localization pack.
      if (isGameAsset && /\.js$/i.test(rawPath) &&
          !new RegExp(`^${gameId}/(?:spells|stages|musiccmt|stringdefs|${gameId})\\.js$`, "i").test(rawPath)) continue;
      const path = isGameAsset ? assertPatchPath(rawPath, gameId) : assertAssetPath(rawPath);
      if (!Number.isInteger(crc) || crc < 0 || crc > 0xffffffff) continue;
      const url = new URL(path, item.patchRoot);
      url.searchParams.set("crc32", crc.toString(16).padStart(8, "0"));
      if (isStringDefs) {
        mergeAssets.push({
          game: gameId,
          path,
          mountPath: `/thcrap/${gameId}/_source/stringdefs/${String(sourceOrder).padStart(3, "0")}.js`,
          url: url.href,
          crc32: crc >>> 0,
          kind: "table",
          extension: ".js",
          patch: `${item.repo}/${item.patchId}`,
          sourceRole: "stringdefs",
          sourceOrder
        });
        continue;
      }
      const mountPath = isSharedThemes ? `/thcrap/${gameId}/themes.js` :
        (isRootGameOptions || isGlobalOptions) ? `/thcrap/${gameId}/${gameId}.js` :
        isFont ? `/thcrap/${gameId}/fonts/${path}` : `/thcrap/${path}`;
      const asset = {game:gameId,path,mountPath,url:url.href,crc32:crc>>>0,
        kind:classifyThcrapAsset(path),extension:extension(path),patch:`${item.repo}/${item.patchId}`,
        providesFonts:Object.keys(item.patch.fonts || {}).length > 0,
        fontFiles:Object.keys(item.patch.fonts || {}),isGlobalOptions};
      const previous = assetMap.get(mountPath);
      if (!previous || asset.isGlobalOptions || (!previous.isGlobalOptions && (asset.providesFonts || !previous.providesFonts))) {
        assetMap.set(mountPath, asset);
      }
      }
    }
    const assets = [...assetMap.values(), ...mergeAssets].sort((a, b) =>
      a.mountPath.localeCompare(b.mountPath) || (a.sourceOrder ?? -1) - (b.sourceOrder ?? -1));
    const leaf = ordered.at(-1);
    return {
      schema: "eagler-touhou/thcrap-pack/1",
      repository: repositoryUrl,
      language: id,
      title: typeof leaf.patch.title === "string" ? leaf.patch.title : id,
      game: gameId,
      dependencies: ordered.map(item => `${item.repo}/${item.patchId}`),
      assets
    };
  }

  return Object.freeze({ repository: repositoryUrl, discoverLanguages, resolveLanguage });
}

let crcTable;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const table = getCrcTable();
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export async function downloadThcrapPack(pack, {
  fetchImpl = globalThis.fetch,
  concurrency = 4,
  onProgress = () => {}
} = {}) {
  assertObject(pack, "thcrap pack");
  if (!Array.isArray(pack.assets)) throw new TypeError("thcrap pack assets must be an array");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new TypeError("concurrency must be an integer between 1 and 12");
  }

  let next = 0;
  let completed = 0;
  const resources = new Array(pack.assets.length);
  const fetchAsset = async asset => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetchImpl(asset.url, { cache: attempt === 1 ? "force-cache" : "no-store" });
        if (!response.ok) {
          const error = new Error(`${asset.path}: HTTP ${response.status}`);
          if (response.status !== 429 && response.status < 500) error.retryable = false;
          lastError = error;
        } else {
          return new Uint8Array(await response.arrayBuffer());
        }
      } catch (error) {
        if (error?.retryable === false) throw error;
        lastError = error;
      }
      if (lastError?.retryable === false) throw lastError;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
    throw new Error(`${asset.path}: failed after 3 attempts (${asset.url})`, { cause: lastError });
  };
  const worker = async () => {
    while (next < pack.assets.length) {
      const index = next++;
      const asset = pack.assets[index];
      const bytes = await fetchAsset(asset);
      const actual = crc32(bytes);
      if (actual !== asset.crc32) {
        throw new Error(`${asset.path}: CRC32 ${actual.toString(16).padStart(8, "0")} != ${asset.crc32.toString(16).padStart(8, "0")}`);
      }
      resources[index] = { ...asset, bytes };
      onProgress({ completed: ++completed, total: pack.assets.length, path: asset.path, bytes: bytes.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pack.assets.length) }, worker));
  return { ...pack, resources };
}
