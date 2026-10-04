import {ensureLauncherBuild} from '../launcher-build.mjs';
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));

let ready;
export async function loadCompiledContract(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid compiled contract name: ${name}`);
  await (ready ??= ensureLauncherBuild());
  const cached = resolve(project, ".cache", "build", "browser", "assets", "contracts", `${name}.mjs`);
  const published = resolve(project, "assets", "contracts", `${name}.mjs`);
  return import(pathToFileURL(existsSync(cached) ? cached : published).href);
}
