import {finalizeUiArtifact} from '../../scripts/finalize-ui-artifact.mjs';
import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {assembleUiPublication} from '../../lib/ui-publication.mjs';
import {createSyntheticPublicationBase,put} from './fixtures.mjs';
const root=resolve('.cache/ui-publication-browser');
await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
const {source}=await createSyntheticPublicationBase(join(root,'base'));
for(const [name,mount,artifact] of [['root','/','.cache/build/ui-main/client'],['nested','/nested-launcher/','.cache/build/ui-main-nested/client']]){
 for(const version of ['a','b']){
  const ui=join(root,`${name}-ui-${version}`);await cp(resolve(artifact),ui,{recursive:true});
  await put(ui,'assets/publication-fixture-version.txt',version);
  await finalizeUiArtifact(ui);
  await assembleUiPublication({sourceRoot:source,uiRoot:ui,outputRoot:join(root,`${name}-${version}`),mountPath:mount});
 }
}
await writeFile(join(root,'fixture.json'),JSON.stringify({syntheticOnly:true,root:'/',nested:'/nested-launcher/'}));
console.log('Prepared synthetic root/nested publication A/B fixtures; no browser or upload');
