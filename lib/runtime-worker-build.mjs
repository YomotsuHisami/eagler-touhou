/** Maintainer-only compilation of the canonical protocol's classic SW form. */
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {writeFileAtomic} from './atomic-file.mjs';
export async function buildRuntimeWorkerContract({project,buildRoot}){
 const result=await build({entryPoints:[resolve(project,'src/contracts/runtime-generations.mts')],outfile:resolve(buildRoot,'assets/contracts/runtime-generations-worker.js'),bundle:true,format:'iife',globalName:'EaglerRuntimeGenerations',target:'es2022',logLevel:'warning',write:false});
 for(const output of result.outputFiles)await writeFileAtomic(output.path,output.contents);
}
