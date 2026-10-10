import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export async function loadCompiledContract(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid compiled contract name: ${name}`);
  const cached = resolve(project, ".cache", "build", "browser", "assets", "contracts", `${name}.mjs`);
  const published = resolve(project, "assets", "contracts", `${name}.mjs`);
  // Selected React source builds do not refresh the retired Launcher cache.
  // Its inherited bytes must never outrank the canonical current contracts.
  const selectedReactSource = process.env.EAGLER_FRONTEND === 'react' && existsSync(resolve(project, 'src/contracts/runtime-generations.mts'));
  if (!selectedReactSource && (existsSync(cached) || existsSync(published))) return import(pathToFileURL(existsSync(cached) ? cached : published).href);
  const {ensureContractsBuild} = await import('../contracts-build.mjs');
  const build = await ensureContractsBuild({project});
  return import(pathToFileURL(resolve(build.contractsDirectory, `${name}.mjs`)).href);
}
