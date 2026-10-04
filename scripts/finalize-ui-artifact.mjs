import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {UI_ARTIFACT_SCHEMA,UI_ARTIFACT_FILE,uiArtifactFiles,uiArtifactHash,readUiArtifact} from '../lib/ui-artifact.mjs';
import {createUiDeploymentContract} from './ui-deployment-contract.mjs';
export async function finalizeUiArtifact(root){
 const config=JSON.parse(await readFile(resolve(root,'ui-build.json'),'utf8'));
 const navigation=JSON.parse(await readFile(resolve(root,'ui-navigation.json'),'utf8'));
 const contract=createUiDeploymentContract({patterns:navigation.patterns,mountPath:config.mountPath});
 const bundled=await build({stdin:{contents:`import {uiNavigationFallback} from './scripts/ui-deployment-contract.mjs';self.__EAGLER_UI_NAVIGATION_FALLBACK=(request,scopeUrl)=>uiNavigationFallback(request,{contract:${JSON.stringify(contract)},scopeUrl});`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser',target:'es2020'});
 const identity={schema:UI_ARTIFACT_SCHEMA,mountPath:contract.mountPath,files:await uiArtifactFiles(root),workerPrelude:bundled.outputFiles[0].text};
 await writeFile(resolve(root,UI_ARTIFACT_FILE),JSON.stringify({artifactId:uiArtifactHash(JSON.stringify(identity)),...identity},null,2)+'\n');
 return readUiArtifact(root);
}
