import { createHash } from "node:crypto";

const base = new URL(process.argv[2] || "http://127.0.0.1/");
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

const gamesResult = results.get("eagler-touhou/games.json");
if (!gamesResult) failures.push("eagler-touhou/games.json: unavailable");
else {
  const games = JSON.parse(new TextDecoder().decode(gamesResult.bytes));
  for (const key of ["vanillaFont", "unicodeFont"]) {
    if (typeof games.shared?.[key] !== "string") {
      failures.push(`shared ${key} reference missing`);
      continue;
    }
    const url = new URL(games.shared[key], new URL("eagler-touhou/", base));
    const path = url.pathname.slice(base.pathname.length).replace(/^\//, "");
    const entry = inventory.get(path);
    if (!entry) failures.push(`shared ${key} missing from manifest: ${path}`);
    else await verifyExactReference(url, entry, true);
  }
  for (const game of ["th06", "th07"]) {
    const runtime = games.games?.[game]?.runtime;
    const runtimeUrl = typeof runtime === "string" ? new URL(runtime, new URL("eagler-touhou/", base)) : null;
    const runtimeVersion = runtimeUrl?.searchParams.get("v");
    const htmlResult = results.get(`games/${game}/${game}.html`);
    const html = htmlResult && new TextDecoder().decode(htmlResult.bytes);
    if (!runtimeUrl || !runtimeVersion || !html) {
      failures.push(`${game}: invalid runtime entry`);
      continue;
    }
    const scriptPattern = new RegExp(`<script\\b[^>]*\\bsrc=["']?${game}\\.js\\?v=${runtimeVersion}(?:["'\\s>])`, "i");
    if (!scriptPattern.test(html)) failures.push(`${game}: runtime script does not share version ${runtimeVersion}`);
    const runtimePath = `games/${game}/${game}.html`;
    const runtimeEntry = inventory.get(runtimePath);
    if (runtimeEntry) await verifyVersionedAsset(runtimePath, runtimeVersion, runtimeEntry, false);
    for (const extension of ["js", "wasm", "data"]) {
      const path = `games/${game}/${game}.${extension}`;
      const entry = inventory.get(path);
      if (!entry) failures.push(`${game}: ${extension} missing from manifest`);
      else await verifyVersionedAsset(path, runtimeVersion, entry);
    }
    for (const [mode, pack] of Object.entries(games.games?.[game]?.music || {})) {
      if (!Array.isArray(pack.files) || !pack.files.length) continue;
      for (const file of pack.files) {
        const url = new URL(`${pack.base}${file}`, new URL("eagler-touhou/", base));
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
      const url = new URL(pack.url, new URL("eagler-touhou/", base));
      const path = url.pathname.slice(base.pathname.length).replace(/^\//, "");
      const entry = inventory.get(path);
      if (!entry) failures.push(`${game}: language pack missing from manifest: ${path}`);
      else await verifyExactReference(url, entry, true);
    }
  }
}


for (const htmlPath of ["eagler-touhou/index.html", "eagler-touhou/about.html"]) {
  const htmlResult = results.get(htmlPath);
  if (!htmlResult) continue;
  const html = new TextDecoder().decode(htmlResult.bytes);
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
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
    await verifyExactReference(url, entry, url.searchParams.has("v") && !path.endsWith(".html"));
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
