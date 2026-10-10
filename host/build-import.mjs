#!/usr/bin/env node
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

const args = parseArgs(process.argv.slice(2));
const hostRoot = resolve(String(args.root || projectRoot));
const music = String(args.music || "midi,ogg");
const python = String(args.python || process.env.PYTHON || "python");
if (args["test-build"] !== undefined && !["0", "1"].includes(args["test-build"])) throw new Error("--test-build must be 0 or 1");
const testBuild = args["test-build"] === "1";
const rebuildHostedBase = !!args["rebuild-hosted-base"];

assertSupportedNode();
const siteUrl = args["site-url"];
frontendSelection();
console.log("[Import] Validating self-host inputs and configuration");
await inspectHostWorkspace(hostRoot, { music });
await ensureNodeDependencies(projectRoot);
const { resolveHostFrontend } = await import("./lib/site-builder.mjs");
await resolveHostFrontend({ projectRoot, siteUrl });
const { buildImportArtifacts } = await import("./lib/site-builder.mjs");
await buildImportArtifacts({ projectRoot, hostRoot, music, python, rebuildHostedBase, testBuild, siteUrl });
await run(process.execPath, [
  resolve(projectRoot, "scripts", "inspect-host.mjs"),
  `--root=${hostRoot}`, `--music=${music}`, "--post-import=1",
], { cwd: projectRoot });
