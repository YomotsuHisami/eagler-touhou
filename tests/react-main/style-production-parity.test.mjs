/** Frozen main optimized CSS output, before the shared pure helper extraction. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import {createHash} from 'node:crypto';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';import {launcherStyleSources,buildLauncherStyleOutputs} from '../../lib/launcher-optimization.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
test('canonical style partition retains frozen main production bytes and critical-font policy',async()=>{
 const source=await readFile(resolve(root,'public/styles.css'),'utf8'),fonts=await readFile(resolve(root,'public/ui-fonts.css'),'utf8');
 const styles=launcherStyleSources(source,fonts);
 for(const[k,filename,expected]of[['shell','styles.css','17d953214002f46c1d86895465c42f1625e5223bb58f508af624aeb7241f4fdd'],['features','features.css','baaf2946ac3dc6ca777be5bdccd08a676148cc4570c04eb58a330f4d539ba3ab']]){
  const result=await build({stdin:{contents:styles[k],resolveDir:resolve(root,'public'),sourcefile:filename,loader:'css'},outfile:resolve(root,'.cache',filename),bundle:true,minify:true,external:['*.woff2','*.webp','*.png','*.svg','*.jpg'],write:false,logLevel:'silent'});
  assert.equal(createHash('sha256').update(result.outputFiles[0].contents).digest('hex'),expected,filename);
 }
 assert.match(styles.shell,/chill-round-gothic-site-medium-critical\.woff2/);
 assert.doesNotMatch(styles.shell,/chill-round-gothic-site-(?:medium|bold)\.woff2/);
 assert.doesNotMatch(styles.shell,/chill-round-gothic-site-.*-deferred\.woff2/);
});
test('stale partition markers fail instead of silently changing CSS cascade',()=>{assert.throws(()=>launcherStyleSources('body{}',''),/split markers are stale/);});

test('standalone page CSS shares exact original production artifacts',async()=>{
 const outputs=await buildLauncherStyleOutputs({project:root,outputDirectory:resolve(root,'.cache/standalone-style-proof')});
 assert.deepEqual(outputs.map(file=>file.path.split(/[\\/]/).at(-1)),['styles.css','features.css','touch-guide.css']);
 for(const file of outputs){
  const expected=/[/\\]styles\.css$/.test(file.path)?'17d953214002f46c1d86895465c42f1625e5223bb58f508af624aeb7241f4fdd':file.path.endsWith('touch-guide.css')?'c205a923d1ad5b439fbd5d8dc0237766bfdcc528c321aae4bd840ce8f8e90407':'baaf2946ac3dc6ca777be5bdccd08a676148cc4570c04eb58a330f4d539ba3ab';
  assert.equal(createHash('sha256').update(file.contents).digest('hex'),expected);
 }
});
