import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(project, "..");
const port = 30000 + Math.floor(Math.random() * 10000);
const nginxConfig = await readFile(resolve(project, "deploy", "nginx-eagler-touhou.conf"), "utf8");
if (!nginxConfig.includes("absolute_redirect off;")) throw new Error("nginx redirects must remain relative behind private-port mirrors");
if (!nginxConfig.includes('location ~* "\\.[a-f0-9]{24}\\.zip$" {')) throw new Error("nginx content-hash ZIP regex must stay quoted and syntactically valid");
if (!nginxConfig.includes("woff|woff2|ttc|otf")) throw new Error("nginx versioned runtime-font cache rule must include OTF");
if (!nginxConfig.includes("return 302 /eagler-touhou/;") || !nginxConfig.includes("return 301 /eagler-touhou$1;")) {
  throw new Error("nginx canonical redirects must stay path-relative");
}
const child = spawn(process.execPath, [resolve(project, "scripts", "serve.mjs"), String(port), root], {
  cwd: project, stdio: "ignore", windowsHide: true,
});

try {
  const url = `http://127.0.0.1:${port}/th06-eagler/build-web-eagler-thprac-test/th06.data?v=test`;
  let response;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { response = await fetch(url, { method: "HEAD", headers: { "Accept-Encoding": "br" } }); break; }
    catch { await new Promise(resolveDelay => setTimeout(resolveDelay, 50)); }
  }
  if (!response?.ok) throw new Error("server did not start");
  const directory = await fetch(`http://127.0.0.1:${port}/eagler-touhou`, { redirect: "manual" });
  if (directory.status !== 308 || directory.headers.get("location") !== "/eagler-touhou/") {
    throw new Error(`directory redirect failed: ${directory.status} ${directory.headers.get("location")}`);
  }
  const moduleResponse = await fetch(`http://127.0.0.1:${port}/eagler-touhou/game-data-import.js`, { method: "HEAD" });
  if (!moduleResponse.ok || !/^text\/javascript\b/i.test(moduleResponse.headers.get("content-type") || "")) {
    throw new Error(`ES module MIME is invalid: ${moduleResponse.status} ${moduleResponse.headers.get("content-type")}`);
  }
  const iconResponse = await fetch(`http://127.0.0.1:${port}/eagler-touhou/assets/th06.ico`, { method: "HEAD" });
  if (!iconResponse.ok || !/^image\/x-icon\b/i.test(iconResponse.headers.get("content-type") || "")) {
    throw new Error(`TH06 icon MIME is invalid: ${iconResponse.status} ${iconResponse.headers.get("content-type")}`);
  }
  const brandFontResponse = await fetch(`http://127.0.0.1:${port}/eagler-touhou/assets/fonts/touhou98.woff2`, { method: "HEAD" });
  if (!brandFontResponse.ok || !/^font\/woff2\b/i.test(brandFontResponse.headers.get("content-type") || "")) {
    throw new Error(`Touhou98 font MIME is invalid: ${brandFontResponse.status} ${brandFontResponse.headers.get("content-type")}`);
  }
  for (const font of ["yatra-one-latin.woff2", "chill-round-gothic-site-medium.woff2", "chill-round-gothic-site-bold.woff2", "chill-round-gothic-site-heavy.woff2", "unifont-site.woff2"]) {
    const siteFontResponse = await fetch(`http://127.0.0.1:${port}/eagler-touhou/assets/fonts/${font}`, { method: "HEAD" });
    if (!siteFontResponse.ok || !/^font\/woff2\b/i.test(siteFontResponse.headers.get("content-type") || "")) {
      throw new Error(`site font MIME is invalid for ${font}: ${siteFontResponse.status} ${siteFontResponse.headers.get("content-type")}`);
    }
  }
  if (response.headers.get("content-encoding") !== "br") throw new Error("Brotli was not negotiated");
  const cacheControl = response.headers.get("cache-control") || "";
  if (!cacheControl.includes("must-revalidate") || cacheControl.includes("immutable")) {
    throw new Error(`local runtime resource cache policy is unsafe: ${cacheControl}`);
  }
  const tag = response.headers.get("etag");
  if (!tag) throw new Error("ETag missing");
  const conditional = await fetch(url, { method: "HEAD", headers: { "If-None-Match": tag } });
  if (conditional.status !== 304) throw new Error(`expected 304, got ${conditional.status}`);
  console.log(JSON.stringify({ directory: 308, moduleMime: "text/javascript", iconMime: "image/x-icon", brandFontMime: "font/woff2", siteFontMime: "font/woff2", compression: "br", cache: "must-revalidate", conditional: 304 }));
} finally {
  child.kill();
}
