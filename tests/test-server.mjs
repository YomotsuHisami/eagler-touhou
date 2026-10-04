import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(project, "..");
const port = await allocateLoopbackPort();
const fixtureName = `server-policy-${randomUUID()}.data`;
const fixturePath = resolve(project, "tests", fixtureName);
const artworkDirectory = await mkdtemp(resolve(tmpdir(), "eagler-server-artwork-"));
const artworkFixture = Buffer.from("host-owned-card-artwork");
await writeFile(resolve(artworkDirectory, "th06-card.webp"), artworkFixture);
const child = spawn(process.execPath, [resolve(project, "scripts", "serve.mjs"), String(port), root], {
  cwd: project,
  env: { ...process.env, EAGLER_TOUHOU_ARTWORK_DIR: artworkDirectory },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const serverReady = waitForServerReady(child);

try {
  // Large enough to exercise Brotli without relying on a sibling Runtime
  // build. The extension intentionally exercises the mutable Runtime-DATA
  // cache policy owned by serve.mjs.
  await writeFile(fixturePath, Buffer.alloc(32 * 1024, 0x45));
  await serverReady;
  const url = `http://127.0.0.1:${port}/tests/${fixtureName}?v=test`;
  const response = await fetch(url, { method: "HEAD", headers: { "Accept-Encoding": "br" } });
  if (!response.ok) throw new Error(`server fixture request failed: ${response.status}`);
  const rootResponse = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
  if (rootResponse.status !== 200) throw new Error(`root application failed: ${rootResponse.status}`);
  for (const legacyPath of ["/eagler-touhou", "/eagler-touhou/"]) {
    const legacyResponse = await fetch(`http://127.0.0.1:${port}${legacyPath}`, { redirect: "manual" });
    if (legacyResponse.status !== 302 || legacyResponse.headers.get("location") !== "/") {
      throw new Error(`legacy mount redirect failed: ${legacyPath} -> ${legacyResponse.status} ${legacyResponse.headers.get("location")}`);
    }
  }
  const legacyManifest = await fetch(`http://127.0.0.1:${port}/eagler-touhou/host-manifest.json`);
  if (!legacyManifest.ok || !/^application\/json\b/i.test(legacyManifest.headers.get("content-type") || "")) {
    throw new Error("legacy Service Worker clients cannot reach the current Host Manifest");
  }
  const retirementWorker = await fetch(`http://127.0.0.1:${port}/eagler-touhou/app-shell-sw.js`);
  const retirementSource = await retirementWorker.text();
  if (!retirementWorker.ok || !/javascript/i.test(retirementWorker.headers.get("content-type") || "") ||
      retirementWorker.headers.get("cache-control") !== "no-store" ||
      retirementWorker.headers.get("service-worker-allowed") !== "/eagler-touhou/" ||
      !retirementSource.includes("registration.unregister()")) {
    throw new Error("legacy Service Worker retirement route is invalid");
  }
  const moduleResponse = await fetch(`http://127.0.0.1:${port}/legacy/legacy-game-pack.mjs`, { method: "HEAD" });
  if (!moduleResponse.ok || !/^text\/javascript\b/i.test(moduleResponse.headers.get("content-type") || "")) {
    throw new Error(`ES module MIME is invalid: ${moduleResponse.status} ${moduleResponse.headers.get("content-type")}`);
  }
  const indexHtml = await rootResponse.text();
  const entry = indexHtml.match(/<script\b[^>]*\bsrc="([^"<>]+)"[^>]*>/)?.[1];
  if (!entry || !entry.startsWith('/assets/')) throw new Error('Framework entry asset missing');
  const generatedModuleResponse = await fetch(new URL(entry, `http://127.0.0.1:${port}/`), { method: "HEAD" });
  const retiredEntry = await fetch(`http://127.0.0.1:${port}/assets/launcher/app.mjs`, { method: "HEAD" });
  if (retiredEntry.status !== 404) throw new Error('retired Launcher entry must not be published');
  if (!generatedModuleResponse.ok || !/^text\/javascript\b/i.test(generatedModuleResponse.headers.get("content-type") || "")) {
    throw new Error(`generated ES module mapping is invalid: ${generatedModuleResponse.status} ${generatedModuleResponse.headers.get("content-type")}`);
  }
  const webManifestResponse = await fetch(`http://127.0.0.1:${port}/site.webmanifest`, { method: "HEAD" });
  if (!webManifestResponse.ok || !/^application\/manifest\+json\b/i.test(webManifestResponse.headers.get("content-type") || "")) {
    throw new Error(`Web App Manifest MIME is invalid: ${webManifestResponse.status} ${webManifestResponse.headers.get("content-type")}`);
  }
  const brandFontResponse = await fetch(`http://127.0.0.1:${port}/assets/fonts/touhou98.woff2`, { method: "HEAD" });
  if (!brandFontResponse.ok || !/^font\/woff2\b/i.test(brandFontResponse.headers.get("content-type") || "")) {
    throw new Error(`Touhou98 font MIME is invalid: ${brandFontResponse.status} ${brandFontResponse.headers.get("content-type")}`);
  }
  const artworkResponse = await fetch(`http://127.0.0.1:${port}/assets/th06-card.webp`);
  if (!artworkResponse.ok || !Buffer.from(await artworkResponse.arrayBuffer()).equals(artworkFixture)) {
    throw new Error("development server did not serve the explicit external Host artwork input");
  }
  for (const font of ["yatra-one-latin.woff2", "chill-round-gothic-site-medium.woff2", "chill-round-gothic-site-bold.woff2", "chill-round-gothic-site-heavy.woff2", "unifont-site.woff2"]) {
    const siteFontResponse = await fetch(`http://127.0.0.1:${port}/assets/fonts/${font}`, { method: "HEAD" });
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
  console.log(JSON.stringify({ root: 200, moduleMime: "text/javascript", brandFontMime: "font/woff2", siteFontMime: "font/woff2", compression: "br", cache: "must-revalidate", conditional: 304 }));
} finally {
  await stopChild(child);
  await rm(fixturePath, { force: true });
  await rm(artworkDirectory, { recursive: true, force: true });
}

function allocateLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        rejectPort(new Error("failed to allocate loopback server port"));
        return;
      }
      const selectedPort = address.port;
      probe.close(error => error ? rejectPort(error) : resolvePort(selectedPort));
    });
  });
}

function waitForServerReady(processHandle, timeoutMs = 30_000) {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      processHandle.stdout?.off("data", onStdout);
      processHandle.stderr?.off("data", onStderr);
      processHandle.off("error", onError);
      processHandle.off("exit", onExit);
      if (error) rejectReady(error);
      else resolveReady();
    };
    const diagnostics = message => new Error([
      message,
      stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
      stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
    ].filter(Boolean).join("\n"));
    const onStdout = chunk => {
      stdout += chunk.toString();
      if (stdout.includes(`eagler-touhou: http://127.0.0.1:${port}/`)) finish();
    };
    const onStderr = chunk => { stderr += chunk.toString(); };
    const onError = error => finish(diagnostics(`server process failed to start: ${error.message}`));
    const onExit = (code, signal) => finish(diagnostics(`server exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    const timer = setTimeout(() => finish(diagnostics(`server did not become ready within ${timeoutMs} ms`)), timeoutMs);
    processHandle.stdout?.on("data", onStdout);
    processHandle.stderr?.on("data", onStderr);
    processHandle.once("error", onError);
    processHandle.once("exit", onExit);
    void (async () => {
      while (!settled) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, {
            method: "HEAD",
            cache: "no-store",
          });
          if (response.ok) {
            finish();
            return;
          }
        } catch {}
        await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
      }
    })();
  });
}

async function stopChild(processHandle, timeoutMs = 5_000) {
  if (processHandle.exitCode != null || processHandle.signalCode != null) return;
  const exited = new Promise(resolveExit => processHandle.once("exit", resolveExit));
  processHandle.kill();
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise(resolveTimeout => setTimeout(() => resolveTimeout(false), timeoutMs)),
  ]);
  if (!stopped && processHandle.exitCode == null && processHandle.signalCode == null) {
    processHandle.kill("SIGKILL");
    await Promise.race([
      exited,
      new Promise(resolveTimeout => setTimeout(resolveTimeout, timeoutMs)),
    ]);
  }
}
