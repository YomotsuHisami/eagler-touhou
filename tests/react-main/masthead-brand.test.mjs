/** Mounted subtitle timing/ownership checks; visual motion is checked in IAB. */
import test,{before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {authoredSourcesPlugin} from './authored-sources.mjs';
import {installMountedDom} from './mounted-dom-environment.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
let env,React,createRoot,api,work,root;
before(async()=>{
 env=installMountedDom();React=await import('react');({createRoot}=await import('react-dom/client'));
 work=await mkdtemp(resolve(project,'.cache/masthead-brand-'));const output=resolve(work,'actual.mjs');
 await build({absWorkingDir:project,stdin:{resolveDir:project,loader:'tsx',contents:`export * from './app/components/launcher/MastheadBrand.tsx';export * from './app/components/launcher/SiteFooter.tsx';`},outfile:output,bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',logLevel:'silent',plugins:[authoredSourcesPlugin(project)]});
 api=await import(pathToFileURL(output).href);
});
afterEach(async()=>{if(root)await React.act(()=>root.unmount());root=null;env.document.body.replaceChildren();assert.deepEqual(env.errors.splice(0),[]);});
after(async()=>{env.close();await rm(work,{recursive:true,force:true});});
const node=selector=>env.document.querySelector(selector);
const phase=()=>node('.brand').dataset.brandPhase;
const click=()=>React.act(()=>node('.brand-logo').click());
const advance=(context,ms)=>React.act(()=>context.mock.timers.tick(ms));
async function mount(extra={}){
 const container=env.document.createElement('header');env.document.body.append(container);root=createRoot(container);
 await React.act(()=>root.render(React.createElement(api.MastheadBrand,{interactive:true,lessMotion:false,updatedAge:{text:'Updated recently',title:'Release date',dateTime:'2026-10-13'},...extra})));
}
test('the tenth brand click raises the update text, shows the linked visit for two seconds, then restores the same age owner',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});context.mock.method(globalThis,'matchMedia',()=>({matches:false}));await mount();const age=node('#brandUpdateAge');
 for(let i=0;i<9;i++)await click();assert.equal(phase(),'normal');assert.equal(age.getAttribute('aria-hidden'),'false');
 await click();assert.equal(phase(),'hide-status');await advance(context,280);assert.equal(phase(),'show-visit');
 const link=node('.brand-visit a');assert.equal(link.href,api.grass1337CreditHref);assert.equal(link.textContent,'Grass1337');assert.equal(link.target,'_blank');assert.equal(node('.brand-visit').hasAttribute('inert'),false);
 for(let i=0;i<10;i++)await click();await advance(context,2279);assert.equal(phase(),'show-visit','clicks during the visit do not restart it');
 await advance(context,1);assert.equal(phase(),'hide-visit');assert.equal(node('.brand-visit').hasAttribute('inert'),true);
 await advance(context,280);assert.equal(phase(),'restore-status');await advance(context,280);assert.equal(phase(),'normal');assert.equal(node('#brandUpdateAge'),age);assert.equal(age.textContent,'Updated recently');assert.equal(age.dateTime,'2026-10-13');
 for(let i=0;i<9;i++)await click();assert.equal(phase(),'normal');await click();assert.equal(phase(),'hide-status');
});
test('reduced motion keeps the two-second visit and unmount cancels its pending work',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});await mount({lessMotion:true});
 for(let i=0;i<10;i++)await click();await advance(context,0);assert.equal(phase(),'show-visit');
 await advance(context,1999);assert.equal(phase(),'show-visit');await advance(context,1);await advance(context,0);await advance(context,0);assert.equal(phase(),'normal');
 for(let i=0;i<10;i++)await click();await advance(context,0);await React.act(()=>root.unmount());root=null;await advance(context,10000);assert.deepEqual(env.errors,[]);
});
test('pre-session branding cannot trigger the visit and keeps real update metadata',async()=>{
 await mount({interactive:false});for(let i=0;i<10;i++)await click();assert.equal(phase(),'normal');assert.equal(node('.brand-logo').disabled,true);assert.equal(node('#brandUpdateAge').title,'Release date');assert.equal(node('.brand-visit').hasAttribute('inert'),true);
});
