import {validateUiPublicationMarker} from '../lib/ui-frontend.mjs';
import { RUNTIME_MANIFEST_FILE, RUNTIME_GENERATION_FILE, RUNTIME_GENERATION_SCHEMA, RUNTIME_PROTOCOL,
  validateRuntimeManifest, canonicalRuntimePayload, parseRuntimeGenerationPath, runtimeGenerationBase } from "../lib/contracts/runtime-generations.mjs";
import { createHash } from "node:crypto";
import { validatePackageDescriptor } from "../package/package-descriptor.mjs";
import { assertLanguagePublicationConsistency } from "../lib/language-publication-contract.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { RESOURCE_MODE_EXTERNAL, RESOURCE_MODE_HOSTED, RESOURCE_MODE_IMPORT, normalizeResourceMode } from "../lib/contracts/resource-mode.mjs";
import { assertAppShellContract } from "../lib/app-shell-policy.mjs";
import { RELEASE_CATALOG_FILE, releaseCatalogEntryUrl, validateReleaseCatalog } from "../lib/contracts/release-catalog.mjs";
import { HOST_MANIFEST_FILE, validateHostManifest } from "../lib/contracts/host-manifest.mjs";
import { validateExternalResourceFinalUrl, validateExternalResourceRedirect } from "../lib/external-resource-routing.mjs";

if (!process.argv[2]) throw new Error("usage: node scripts/verify-deployed-site.mjs URL");
const base = new URL(process.argv[2]);
if (!base.pathname.endsWith("/")) base.pathname += "/";

async function download(url, purpose) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "error" });
      if (!response.ok) throw new Error(`${purpose}: HTTP ${response.status} ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { response, bytes };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 500));
    }
  }
  throw new Error(`${purpose}: ${lastError?.message || lastError}`);
}

async function verifyVersionedAsset(path, version, expected, immutable = true) {
  const url = new URL(path, base);
  url.searchParams.set("v", version);
  try {
    const { response, bytes } = await download(url, `${path}?v=${version}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== expected.bytes) failures.push(`${path}?v=${version}: bytes ${bytes.length} != ${expected.bytes}`);
    if (sha256 !== expected.sha256) failures.push(`${path}?v=${version}: sha256 ${sha256} != ${expected.sha256}`);
    const cacheControl = response.headers.get("cache-control") || "";
    if (immutable && !/immutable/i.test(cacheControl)) failures.push(`${path}?v=${version}: cache-control is not immutable (${cacheControl || "missing"})`);
    if (!immutable && !/(?:no-cache|no-store|max-age=0)/i.test(cacheControl)) {
      failures.push(`${path}?v=${version}: HTML is not revalidated (${cacheControl || "missing"})`);
    }
  } catch (error) {
    failures.push(String(error?.message || error));
  }
}

async function verifyExactReference(url, expected, requireImmutable = false) {
  try {
    const { response, bytes } = await download(url, url.href);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== expected.bytes) failures.push(`${url.href}: bytes ${bytes.length} != ${expected.bytes}`);
    if (sha256 !== expected.sha256) failures.push(`${url.href}: sha256 ${sha256} != ${expected.sha256}`);
    if (requireImmutable && !/immutable/i.test(response.headers.get("cache-control") || "")) {
      failures.push(`${url.href}: cache-control is not immutable (${response.headers.get("cache-control") || "missing"})`);
    }
  } catch (error) {
    failures.push(String(error?.message || error));
  }
}

const manifestUrl = new URL("deployment.json", base);
const { bytes: manifestBytes } = await download(manifestUrl, "deployment manifest");
const deployment = JSON.parse(new TextDecoder().decode(manifestBytes));
if (deployment.format !== "eagler-touhou-deployment/1" || !Array.isArray(deployment.files)) {
  throw new Error("invalid deployment manifest");
}

const failures = [];
const results = new Map();
const inventory = new Map(deployment.files.map(item => [item.path, item]));
const concurrency = Math.min(6, Math.max(1, Number(process.env.EAGLER_VERIFY_CONCURRENCY) || 4));
let cursor = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < deployment.files.length) {
    const item = deployment.files[cursor++];
    if (typeof item.path !== "string" || item.path.includes("..") || item.path.startsWith("/")) {
      failures.push(`${item.path}: unsafe manifest path`);
      continue;
    }
    const url = new URL(item.path, base);
    try {
      const { response, bytes } = await download(url, item.path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.length !== item.bytes) failures.push(`${item.path}: bytes ${bytes.length} != ${item.bytes}`);
      if (sha256 !== item.sha256) failures.push(`${item.path}: sha256 ${sha256} != ${item.sha256}`);
      results.set(item.path, {
        bytes,
        cacheControl: response.headers.get("cache-control") || "",
        contentType: response.headers.get("content-type") || "",
      });
    } catch (error) {
      failures.push(String(error?.message || error));
    }
  }
}));

const runtimeManifestResult = results.get(RUNTIME_MANIFEST_FILE);
if (deployment.appShell?.schema === "eagler-touhou/app-shell/2") {
  if (!runtimeManifestResult || !/(?:no-cache|no-store|max-age=0)/i.test(runtimeManifestResult.cacheControl)) {
    failures.push("Runtime Manifest is missing or not revalidated");
  } else try {
    const catalog = validateRuntimeManifest(JSON.parse(new TextDecoder().decode(runtimeManifestResult.bytes)));
    if (createHash("sha256").update(runtimeManifestResult.bytes).digest("hex") !== deployment.appShell.runtimeManifest?.sha256) {
      failures.push("Runtime Manifest differs from deployment contract");
    }
    for (const group of catalog.groups) for (const descriptor of [group.current, ...group.previous]) {
      if (createHash("sha256").update(canonicalRuntimePayload(descriptor.entry, descriptor.files)).digest("hex") !== descriptor.generation) {
        failures.push(`Runtime generation identity mismatch: ${group.root}`);
      }
      const basePath = runtimeGenerationBase(group.root, descriptor.generation);
      const sidecar = results.get(basePath + RUNTIME_GENERATION_FILE);
      if (!sidecar) failures.push(`Runtime descriptor missing: ${basePath}`);
      else {
        const raw = JSON.parse(new TextDecoder().decode(sidecar.bytes));
        if (raw.schema !== RUNTIME_GENERATION_SCHEMA || raw.protocol !== RUNTIME_PROTOCOL || raw.root !== group.root ||
            raw.generation !== descriptor.generation || canonicalRuntimePayload(raw.entry, raw.files) !== canonicalRuntimePayload(descriptor.entry, descriptor.files)) {
          failures.push(`Runtime descriptor mismatch: ${basePath}`);
        }
      }
      for (const file of descriptor.files) {
        const entry = inventory.get(basePath + file.path);
        if (!entry || entry.bytes !== file.bytes || entry.sha256 !== file.sha256) failures.push(`Runtime file not in deployment: ${basePath}${file.path}`);
      }
    }
  } catch (error) { failures.push(String(error)); }
}
for (const [path, result] of results) if (parseRuntimeGenerationPath(path)) {
  if (!/immutable/i.test(result.cacheControl)) failures.push(`${path}: immutable Runtime must have immutable cache policy`);
  if (/\.wasm$/.test(path) && !/^application\/wasm(?:;|$)/i.test(result.contentType)) failures.push(`${path}: incorrect Wasm MIME`);
  if (/\.m?js$/.test(path) && !/^(?:text|application)\/javascript(?:;|$)/i.test(result.contentType)) failures.push(`${path}: incorrect module MIME`);
  if (/\.css$/.test(path) && !/^text\/css(?:;|$)/i.test(result.contentType)) failures.push(`${path}: incorrect stylesheet MIME`);
}

const releaseCatalogResult = results.get(RELEASE_CATALOG_FILE);
const hostManifestResult = results.get(HOST_MANIFEST_FILE);
const legacyGamePackResult = results.get("legacy/legacy-game-pack.mjs");
const migrationResult = results.get("migrate.html");
const indexResult = results.get("index.html");
const appShellWorkerResult = results.get("app-shell-sw.js");
let uiPublication=null;
if(deployment.uiPublication){
 try{const raw=results.get('ui-publication.json');if(!raw)throw Error('React UI publication marker unavailable');uiPublication=validateUiPublicationMarker(JSON.parse(new TextDecoder().decode(raw.bytes)));if(uiPublication.mountPath!==base.pathname)throw Error('Deployed UI build mount differs from verified URL');}
 catch(error){failures.push(String(error.message||error));}
 if(!indexResult || !new TextDecoder().decode(indexResult.bytes).includes('window.__reactRouterContext'))failures.push('Framework SPA entry unavailable');
}else{
 const appResult=results.get('app.js'),appModuleResult=results.get('assets/launcher/app.mjs');
 if(!indexResult)failures.push('index.html: unavailable');
 if(!appResult || !new TextDecoder().decode(appResult.bytes).includes('import "./assets/launcher/app.mjs";'))failures.push('Legacy Launcher facade unavailable');
 if(!appModuleResult || !new TextDecoder().decode(appModuleResult.bytes).includes('host-manifest-origin-migration-policy/1'))failures.push('Legacy migration policy unavailable');
}
if (!migrationResult) failures.push("migrate.html: unavailable");
else {
  const migrationHtml = new TextDecoder().decode(migrationResult.bytes);
  if (!/^text\/html\b/i.test(migrationResult.contentType)) failures.push(`migrate.html: invalid MIME ${migrationResult.contentType || "missing"}`);
  if (!/(?:no-cache|no-store|max-age=0|must-revalidate)/i.test(migrationResult.cacheControl)) failures.push(`migrate.html: must be revalidated (${migrationResult.cacheControl || "missing"})`);
  if (!migrationHtml.includes('const PROTOCOL = "eagler-touhou/origin-migration/1";') ||
      !migrationHtml.includes('source.protocol = "http:";') ||
      !migrationHtml.includes('function prepareSourceLink()') ||
      !migrationHtml.includes('source.searchParams.set("handoff", token);') ||
      !migrationHtml.includes('location.href = sourceLink.href;')) {
    failures.push("migrate.html: HTTPS -> HTTP migration entry contract missing");
  }
  if (/<script\b[^>]+src=/i.test(migrationHtml) || /<link\b[^>]+stylesheet/i.test(migrationHtml)) {
    failures.push("migrate.html: migration page is not self-contained");
  }
}
if (!legacyGamePackResult) failures.push("legacy/legacy-game-pack.mjs: unavailable");
else if (!/^(?:text|application)\/javascript\b/i.test(legacyGamePackResult.contentType)) {
  failures.push(`legacy/legacy-game-pack.mjs: invalid module MIME ${legacyGamePackResult.contentType || "missing"}`);
}
if (!releaseCatalogResult) failures.push(`${RELEASE_CATALOG_FILE}: unavailable`);
else if (!hostManifestResult) failures.push(`${HOST_MANIFEST_FILE}: unavailable`);
else {
  let catalog;
  try { catalog = validateReleaseCatalog(JSON.parse(new TextDecoder().decode(releaseCatalogResult.bytes))); }
  catch (error) {
    failures.push(`${RELEASE_CATALOG_FILE}: ${error?.message || error}`);
    catalog = null;
  }
  let games;
  try { games = validateHostManifest(JSON.parse(new TextDecoder().decode(hostManifestResult.bytes))); }
  catch (error) {
    failures.push(`${HOST_MANIFEST_FILE}: ${error?.message || error}`);
    games = null;
  }
  if (!games || !catalog) {
    // Host Manifest validation already recorded the concrete failure.
  } else {
    if (!games.shared?.gameDataFallback) {
      console.warn("OPERATOR WARNING: deployed Host Manifest has no gameDataFallback; configure the fallback download link.");
    }
  if (!appShellWorkerResult) {
    failures.push("app-shell-sw.js: unavailable");
  } else {
    const worker = new TextDecoder().decode(appShellWorkerResult.bytes);
    try {
      assertAppShellContract(deployment.appShell, games, {requiredFiles:uiPublication ? [...uiPublication.uiBuild.files.filter(file=>file.path!=='ui-ownership.json').map(file=>file.path),'en.html','lobby.html','ui-publication.json'] : ['index.html','en.html','lobby.html','app.js']});
      if(uiPublication)validateUiPublicationMarker(uiPublication,{hostManifest:games});
      if (!worker.includes(deployment.appShell.buildId)) {
        failures.push("app-shell-sw.js: build id does not match deployment App Shell contract");
      }
      for (const path of deployment.appShell.entries) {
        if (path === "./") continue;
        if (!inventory.has(path)) failures.push(`App Shell contract references file outside deployment inventory: ${path}`);
      }
    } catch (error) {
      failures.push(`App Shell deployment contract invalid: ${error?.message || error}`);
    }
  }
  const declaredResourceMode = deployment.resourceMode || "hosted";
  const resourceMode = normalizeResourceMode(declaredResourceMode);
  if (!resourceMode) failures.push(`invalid resourceMode: ${declaredResourceMode}`);
  if (catalog.schema !== "eagler-touhou/release-catalog/1" || !catalog.games ||
      normalizeResourceMode(games.shared?.resourceMode || "hosted") !== resourceMode) {
    failures.push("Release Catalog / Host Manifest resource mode mismatch");
  }
  if (resourceMode === RESOURCE_MODE_IMPORT) {
    if (games.shared?.vanillaFont != null || games.shared?.unicodeFont != null) failures.push(`${resourceMode}: runtime font URL must be absent`);
    const payloads = [...inventory.keys()].filter(path => path.startsWith("games/") || path.startsWith("shared/"));
    const updates = deployment.runtimeUpdates || [];
    if (Object.keys(catalog.games).length || payloads.length || updates.length) {
      failures.push("import deployment exposes game resources, Runtime updates, or releases");
    }
  } else if (resourceMode === RESOURCE_MODE_EXTERNAL) {
    if (games.shared?.vanillaFont != null || games.shared?.unicodeFont != null) failures.push("external: runtime font URL must be absent");
    const payloads = [...inventory.keys()].filter(path => path.startsWith("games/") || path.startsWith("shared/"));
    if (payloads.length) failures.push("external deployment bundles game/shared payloads");
    const gameIds = Object.keys(games.games).sort();
    if (Object.keys(catalog.games).sort().join(",") !== gameIds.join(",")) {
      failures.push("external deployment does not publish every selected Package Descriptor");
    }
    for (const game of gameIds) {
      const descriptorHref = releaseCatalogEntryUrl(new URL(RELEASE_CATALOG_FILE, base).href, catalog, game);
      const descriptorPath = descriptorHref && new URL(descriptorHref).pathname.slice(base.pathname.length).replace(/^\//, "");
      const descriptorResult = descriptorPath && results.get(descriptorPath);
      if (!descriptorHref || !descriptorResult) {
        failures.push(`${game}: external Package Descriptor unavailable`);
        continue;
      }
      let descriptor;
      try { descriptor = validatePackageDescriptor(JSON.parse(new TextDecoder().decode(descriptorResult.bytes))); }
      catch (error) {
        failures.push(`${game}: invalid external Package Descriptor: ${error?.message || error}`);
        continue;
      }
      try { assertLanguagePublicationConsistency(game, games.games[game], descriptor); }
      catch (error) {
        failures.push(`${game}: ${error?.message || error}`);
        continue;
      }
      const languageByFile = new Map((descriptor.components?.language?.entries || [])
        .map(language => [language.file, games.games[game].languageOptions
          .find(option => option.id === language.id)]));
      for (const [fileId, file] of Object.entries(descriptor.files)) {
        if (!/^(?:games|shared)\//.test(file.source)) {
          failures.push(`${game}/${fileId}: Package source is outside redirect-owned routes`);
          continue;
        }
        const language = languageByFile.get(fileId);
        const route = new URL(language?.pack?.url || file.source, descriptorHref);
        if (language?.pack?.sha256) route.searchParams.set("v", language.pack.sha256);
        try {
          const redirect = await fetch(route, { method: "HEAD", cache: "no-store", redirect: "manual" });
          const location = redirect.headers.get("location");
          validateExternalResourceRedirect(route, { status: redirect.status, location });
          const response = await fetch(route, { method: "HEAD", cache: "no-store", redirect: "follow", headers: { Origin: base.origin } });
          if (!response.ok || response.url === route.href) throw new Error(`external HEAD failed: HTTP ${response.status}`);
          validateExternalResourceFinalUrl(route, response.url);
          const allowOrigin = response.headers.get("access-control-allow-origin");
          if (allowOrigin !== "*" && allowOrigin !== base.origin) throw new Error("external response does not allow Launcher origin");
          const contentLengthHeader = response.headers.get("content-length");
          if (language && contentLengthHeader == null) throw new Error("language response is missing Content-Length");
          if (contentLengthHeader != null) {
            const contentLength = Number(contentLengthHeader);
            if (!Number.isSafeInteger(contentLength) || contentLength !== file.bytes) {
              throw new Error(`Content-Length ${contentLengthHeader} != ${file.bytes}`);
            }
          }
          const range = await fetch(route, {
            method: "GET",
            cache: "no-store",
            redirect: "follow",
            headers: { Origin: base.origin, Range: "bytes=0-0" },
          });
          if (range.status !== 206) throw new Error(`Range GET returned HTTP ${range.status}, expected 206`);
          if (range.headers.get("content-range") !== `bytes 0-0/${file.bytes}`) {
            throw new Error(`invalid Content-Range: ${range.headers.get("content-range") || "missing"}`);
          }
          const exposed = (range.headers.get("access-control-expose-headers") || "").toLowerCase()
            .split(",").map(value => value.trim());
          if (!exposed.includes("content-range") && !exposed.includes("*")) {
            throw new Error("external response does not expose Content-Range");
          }
          if ((await range.arrayBuffer()).byteLength !== 1) throw new Error("Range GET did not return exactly one byte");
          if (language) {
            const full = await fetch(route, {
              method: "GET",
              cache: "no-store",
              redirect: "follow",
              headers: { Origin: base.origin, "Accept-Encoding": "identity" },
            });
            if (!full.ok) throw new Error(`language GET failed: HTTP ${full.status}`);
            const bytes = new Uint8Array(await full.arrayBuffer());
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            if (bytes.length !== file.bytes || sha256 !== String(file.sha256).toLowerCase()) {
              throw new Error("language GET identity mismatch");
            }
          }
        } catch (error) {
          failures.push(`${game}/${fileId}: ${error?.message || error}`);
        }
      }
    }
  } else if (resourceMode === RESOURCE_MODE_HOSTED) {
  for (const key of ["vanillaFont", "unicodeFont"]) {
    if (typeof games.shared?.[key] !== "string") {
      failures.push(`shared ${key} reference missing`);
      continue;
    }
    const url = new URL(games.shared[key], base);
    const path = url.pathname.slice(base.pathname.length).replace(/^\//, "");
    const entry = inventory.get(path);
    if (!entry) failures.push(`shared ${key} missing from manifest: ${path}`);
    else await verifyExactReference(url, entry);
  }
  const preloadGames = Object.keys(PRODUCT_GAMES).filter(game => PRODUCT_GAMES[game].dataProvider === "emscripten-preload");
  for (const game of preloadGames) {
    const runtime = games.games?.[game]?.runtime;
    const runtimeUrl = typeof runtime === "string" ? new URL(runtime, base) : null;
    const runtimeVersion = runtimeUrl?.searchParams.get("v");
    const runtimePath = runtimeUrl?.pathname.slice(base.pathname.length);
    const htmlResult = runtimePath && results.get(runtimePath);
    const html = htmlResult && new TextDecoder().decode(htmlResult.bytes);
    if (!runtimeUrl || !html || (games.shared?.runtimeManifest ? !parseRuntimeGenerationPath(runtimePath) : !runtimeVersion)) {
      failures.push(`${game}: invalid runtime entry`);
      continue;
    }
    const directory = runtimePath.slice(0, runtimePath.lastIndexOf("/") + 1);
    if (games.shared?.runtimeManifest) {
      for (const extension of ["html", "js", "wasm"]) {
        const path = directory + `${game}.${extension}`;
        const entry = inventory.get(path);
        if (!entry) failures.push(`${game}: ${extension} missing from immutable generation`);
        else await verifyExactReference(new URL(path, base), entry, true);
      }
    } else {
      const runtimeEntry = inventory.get(runtimePath);
      if (runtimeEntry) await verifyVersionedAsset(runtimePath, runtimeVersion, runtimeEntry, false);
      for (const extension of ["js", "wasm"]) {
        const path = directory + `${game}.${extension}`;
        const entry = inventory.get(path);
        if (!entry) failures.push(`${game}: ${extension} missing from manifest`);
        else await verifyVersionedAsset(path, runtimeVersion, entry);
      }
    }
    for (const [mode, pack] of Object.entries(games.games?.[game]?.music || {})) {
      if (!Array.isArray(pack.files) || !pack.files.length) continue;
      for (const file of pack.files) {
        const url = new URL(`${pack.base}${file}`, base);
        if (pack.version) url.searchParams.set("v", pack.version);
        const path = url.pathname.slice(base.pathname.length).replace(/^\//, "");
        const entry = inventory.get(path);
        if (!entry) failures.push(`${game}/${mode}: missing from manifest: ${path}`);
        else await verifyExactReference(url, entry);
      }
    }
    for (const language of games.games?.[game]?.languages || []) {
      const pack = language?.pack;
      if (!pack || typeof pack.url !== "string" || !Number.isInteger(pack.bytes) || !/^[a-f0-9]{16,64}$/i.test(pack.sha256 || "")) {
        failures.push(`${game}: invalid language pack entry: ${language?.id || "unknown"}`);
        continue;
      }
      const url = new URL(pack.url, base);
      const path = url.pathname.slice(base.pathname.length).replace(/^\//, "");
      const entry = inventory.get(path);
      if (!entry) failures.push(`${game}: language pack missing from manifest: ${path}`);
      else await verifyExactReference(url, entry, true);
    }
  }
  }
}
}


for (const htmlPath of ["index.html", "about.html"]) {
  const htmlResult = results.get(htmlPath);
  if (!htmlResult) continue;
  const html = new TextDecoder().decode(htmlResult.bytes);
  for (const tagMatch of html.matchAll(/<[^>]+>/g)) {
    for (const match of tagMatch[0].matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (!value || /^(?:data:|https?:|mailto:|#)/i.test(value)) continue;
      const url = new URL(value, new URL(htmlPath, base));
      const path = url.pathname.slice(base.pathname.length).replace(/^\//, "");
      const entry = inventory.get(path);
      if (!entry) {
        // Directory navigation links are not deployment files.
        if (!url.pathname.endsWith("/")) failures.push(`${htmlPath}: reference missing from manifest: ${value}`);
        continue;
      }
      await verifyExactReference(url, entry, !!parseRuntimeGenerationPath(path) || /[a-f0-9]{24}\.zip$/.test(path));
    }
  }
}

if (failures.length) throw new Error(`deployed site verification failed:\n${failures.join("\n")}`);
console.log(JSON.stringify({
  valid: true,
  base: base.href,
  files: deployment.files.length,
  bytes: deployment.files.reduce((sum, item) => sum + item.bytes, 0),
  generatedAt: deployment.generatedAt,
}));
