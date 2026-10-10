#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendSelection } from "../lib/react-frontend-artifact.mjs";
import { inspectHostWorkspace } from "../lib/host-workspace.mjs";
import { assertSupportedNode, ensureNodeDependencies } from "./lib/node-environment.mjs";
import { run } from "./lib/process.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const values = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) throw new Error(`unexpected argument: ${raw}`);
    const split = raw.indexOf("=");
    if (split > 2) values[raw.slice(2, split)] = raw.slice(split + 1);
    else values[raw.slice(2)] = true;
  }
  return values;
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "cmd"; args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    command = "open"; args = [url];
  } else {
    command = "xdg-open"; args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", () => {});
    child.unref();
  } catch {
    // Browser opening is a convenience only; the printed URL is authoritative.
  }
}

const args = parseArgs(process.argv.slice(2));
const hostRoot = resolve(String(args.root || projectRoot));
const music = String(args.music || "midi,ogg");
const python = String(args.python || process.env.PYTHON || "python");
const buildOnly = !!args["build-only"];
const noOpen = !!args["no-open"];
const bind = String(args.bind || "127.0.0.1");
const port = Number.parseInt(String(args.port || "8130"), 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid --port=${args.port}`);

assertSupportedNode();
const siteUrl = args["site-url"];
frontendSelection();
console.log("[Build] Validating self-host inputs and configuration");
await inspectHostWorkspace(hostRoot, { music });
await ensureNodeDependencies(projectRoot);
const { resolveHostFrontend } = await import("./lib/site-builder.mjs");
await resolveHostFrontend({ projectRoot, siteUrl, serve: !buildOnly });
const { buildHostedSite } = await import("./lib/site-builder.mjs");
const { layout } = await buildHostedSite({ projectRoot, hostRoot, music, python, siteUrl });
await run(process.execPath, [
  resolve(projectRoot, "scripts", "inspect-host.mjs"),
  `--root=${hostRoot}`, `--music=${music}`, "--post-build=1",
], { cwd: projectRoot });

if (buildOnly) process.exit(0);
if (bind === "0.0.0.0" || bind === "::") {
  console.warn("[Host] The built-in HTTP server is intended for trusted local/LAN use; use your normal HTTPS web server/CDN for public hosting.");
}
const displayHost = ["0.0.0.0", "::"].includes(bind) ? "127.0.0.1" : bind;
const url = `http://${displayHost}:${port}/`;
console.log(`[Host] Serving verified site: ${url}`);
if (!noOpen && ["127.0.0.1", "localhost", "::1"].includes(bind)) openBrowser(url);
await run(process.execPath, [resolve(projectRoot, "scripts", "serve-static.mjs"), layout.site, String(port)], {
  cwd: projectRoot,
  env: { EAGLER_TOUHOU_HOST: bind },
});
