import { createHash } from "node:crypto";

const [httpArg, httpsArg] = process.argv.slice(2);
if (!httpArg || !httpsArg) {
  throw new Error("Usage: node scripts/verify-origin-cutover.mjs http://host/ https://host/");
}

const httpBase = new URL(httpArg);
const httpsBase = new URL(httpsArg);
if (httpBase.protocol !== "http:" || httpsBase.protocol !== "https:") {
  throw new Error("migration cutover verifier requires one HTTP origin and one HTTPS origin");
}
if (httpBase.hostname !== httpsBase.hostname) {
  throw new Error(`migration origins must use the same hostname: ${httpBase.hostname} != ${httpsBase.hostname}`);
}

const migrationPath = "/eagler-touhou/migrate.html";
const contractNeedles = [
  'const PROTOCOL = "eagler-touhou/origin-migration/1";',
  'target.protocol = "https:";',
  'source.protocol = "http:";',
  'openHttp.href = source.href;',
  "从旧 HTTP 站开始迁移",
];

async function readMigration(base, label) {
  const url = new URL(migrationPath, base);
  const response = await fetch(url, { cache: "no-store", redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${label} migrate.html must remain directly reachable with HTTP 200, got ${response.status}${response.headers.get("location") ? ` -> ${response.headers.get("location")}` : ""}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!/^text\/html\b/i.test(contentType)) throw new Error(`${label} migrate.html has invalid MIME: ${contentType || "missing"}`);
  const cacheControl = response.headers.get("cache-control") || "";
  if (!/(?:no-cache|no-store|max-age=0|must-revalidate)/i.test(cacheControl)) {
    throw new Error(`${label} migrate.html must be revalidated, got Cache-Control: ${cacheControl || "missing"}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const html = new TextDecoder().decode(bytes);
  for (const needle of contractNeedles) {
    if (!html.includes(needle)) throw new Error(`${label} migrate.html contract missing: ${needle}`);
  }
  return {
    url: url.href,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    strictTransportSecurity: response.headers.get("strict-transport-security") || "",
  };
}

const http = await readMigration(httpBase, "HTTP");
const https = await readMigration(httpsBase, "HTTPS");
if (http.sha256 !== https.sha256 || http.bytes.length !== https.bytes.length) {
  throw new Error(`HTTP/HTTPS migrate.html bytes differ: ${http.sha256} != ${https.sha256}`);
}
if (https.strictTransportSecurity) {
  throw new Error(`HTTPS sends Strict-Transport-Security during the migration window (${https.strictTransportSecurity}); this can make the old HTTP origin unreachable`);
}

console.log(JSON.stringify({
  valid: true,
  hostname: httpBase.hostname,
  http: http.url,
  https: https.url,
  bytes: http.bytes.length,
  sha256: http.sha256,
  hsts: false,
}));
