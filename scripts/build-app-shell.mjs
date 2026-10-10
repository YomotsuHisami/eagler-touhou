#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {frontendSelection, reactFrontendArtifactDirectory, readReactFrontendArtifact} from "../lib/react-frontend-artifact.mjs";
import {resolveRuntimeGenerationWorkerSource} from "../lib/contracts-build.mjs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppShell } from "../lib/app-shell-build.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(values) {
  const result = { check: false, output: null };
  for (const value of values) {
    if (value === "--check") result.check = true;
    else if (value.startsWith("--output=")) result.output = resolve(value.slice("--output=".length));
    else throw new Error("usage: node scripts/build-app-shell.mjs [--check] [--output=PATH]");
  }
  if (result.check && result.output) throw new Error("--check and --output cannot be combined");
  return result;
}

const args = parseArgs(process.argv.slice(2));
const output = args.check ? null : (args.output || resolve(project, "dist", "app-shell", "app-shell-sw.js"));
let buildOptions = {quiet: true, globDirectory: project, swDest: output};
if (frontendSelection() === "react") {
  const artifact = await readReactFrontendArtifact({directory: reactFrontendArtifactDirectory({project}), expectedMountPath: process.env.EAGLER_REACT_MOUNT_PATH});
  if (!artifact.appShell) throw new Error("The selected React artifact has App Shell disabled; build an explicitly isolated App Shell artifact before generating its worker");
  buildOptions = {...buildOptions, globDirectory: artifact.root, shellFiles: artifact.shellFiles,
    workerContractSource: await readFile(await resolveRuntimeGenerationWorkerSource({project}), "utf8")};
}
const result = await buildAppShell(buildOptions);
console.log(`App Shell Workbox: ${result.buildId} - ${result.count} files - ${result.size} bytes${args.check ? " (source verified)" : ` -> ${output}`}`);
