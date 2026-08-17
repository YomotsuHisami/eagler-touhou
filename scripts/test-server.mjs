import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(project, "..");
const port = 30000 + Math.floor(Math.random() * 10000);
const child = spawn(process.execPath, [resolve(project, "scripts", "serve.mjs"), String(port), root], {
  cwd: project, stdio: "ignore", windowsHide: true,
});

try {
  const url = `http://127.0.0.1:${port}/th06-eagler/build-web-eagler-default/th06.data?v=test`;
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
  if (response.headers.get("content-encoding") !== "br") throw new Error("Brotli was not negotiated");
  const cacheControl = response.headers.get("cache-control") || "";
  if (!cacheControl.includes("must-revalidate") || cacheControl.includes("immutable")) {
    throw new Error(`local runtime resource cache policy is unsafe: ${cacheControl}`);
  }
  const tag = response.headers.get("etag");
  if (!tag) throw new Error("ETag missing");
  const conditional = await fetch(url, { method: "HEAD", headers: { "If-None-Match": tag } });
  if (conditional.status !== 304) throw new Error(`expected 304, got ${conditional.status}`);
  console.log(JSON.stringify({ directory: 308, compression: "br", cache: "must-revalidate", conditional: 304 }));
} finally {
  child.kill();
}
