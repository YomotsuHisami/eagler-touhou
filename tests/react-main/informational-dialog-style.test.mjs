/** Authored CSS cascade proof, not browser geometry/rendering. Resolve the real
 * legacy and shared shell selectors, media, specificity and shorthand resets
 * against equivalent DOM. Motion declarations are intentionally replaced by
 * the common WAAPI policy; all other declarations retain the pinned gate.
 * Native top-layer/backdrop painting remains untested. */
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import postcss from 'postcss';
import {JSDOM} from 'jsdom';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {authoredSourcesPlugin} from './authored-sources.mjs';
const project = fileURLToPath(new URL('../../', import.meta.url));
const pinned = path => execFileSync('git', ['show', `edee9633e5e3ee79cd2e1aa334f84f6caf755090:${path}`], {cwd: project, encoding: 'utf8'});
const read = path => readFileSync(resolve(project, path), 'utf8');
const oldCss = pinned('public/styles.css'), newCss = read('app/components/notices/informational-dialog.css');
const legacy = /\.(?:apple-refresh-(?:dialog|window)|donation-(?:dialog|window)|multiplayer-guide-(?:dialog|window))\b/;
function rules(css, filter) {
  const result=[];
  postcss.parse(css).walkRules(rule => {
    const media=[];for(let p=rule.parent;p?.type!=='root';p=p.parent){if(p.name!=='media')return;media.push(p.params);}
    for(const selector of rule.selectors)if(filter.test(selector))result.push({selector,media,declarations:rule.nodes.filter(n=>n.type==='decl'),specificity:specificity(selector)});
  });return result;
}
// These shell selectors use only classes, attributes, types and :where. Fail
// closed if that grammar changes instead of guessing at :is/:has specificity.
function specificity(selector){
  const value=selector.replace(/:where\([^()]*\)/g,'');
  assert.doesNotMatch(value,/:(?:is|has|not|nth)[\w-]*\(/);
  const ids=(value.match(/#[\w-]+/g)||[]).length;
  const classes=(value.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):(?!:)[\w-]+/g)||[]).length;
  const types=(value.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g,'').match(/[a-z][\w-]*/gi)||[]).length+(value.match(/::[\w-]+/g)||[]).length;
  return ids*10000+classes*100+types;
}
const originalRules=rules(oldCss,legacy),sharedRules=rules(newCss,/\.informational-(?:dialog|window)/);
let directory,api,dom;
before(async()=>{
  directory=await mkdtemp(resolve(project,'.cache/informational-css-'));
  const outfile=resolve(directory,'components.mjs');
  await build({absWorkingDir:project,stdin:{resolveDir:project,loader:'ts',contents:`
    export * from './app/components/notices/AppleRefreshDialog.tsx';
    export * from './app/components/notices/DonationDialog.tsx';
    export * from './app/components/notices/MultiplayerGuideDialog.tsx';
    export * from './app/i18n.tsx';
  `},bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',outfile,logLevel:'silent',plugins:[authoredSourcesPlugin(project)]});
  api=await import(pathToFileURL(outfile).href);dom=new JSDOM('<!doctype html><body></body>');
});
after(async()=>{dom?.window.close();if(directory)await rm(directory,{recursive:true,force:true});});
function mediaMatches(query,mode){return query.split(',').some(branch=>branch.split(/\s+and\s+/).every(part=>{
  const match=part.trim().match(/^\((max-width|hover|pointer|prefers-reduced-motion):\s*([^)]*)\)$/);assert.ok(match,`unhandled media ${part}`);
  const [,feature,value]=match;
  return feature==='max-width'?mode.width<=Number.parseInt(value):feature==='hover'?mode.hover===value:feature==='pointer'?mode.pointer===value:mode.reduce===(value==='reduce');
}));}
function matches(node,selector,backdrop){
  if(selector.includes('::backdrop')!==backdrop)return false;
  return node.matches(selector.replaceAll('::backdrop','').replace(/:(hover|focus-visible|active)/g,'[data-probe-state~="$1"]'));
}
function expand(prop,value){
  // Expand actual overlapping shorthand families so final guide border:0 and
  // mobile animation-duration compete with their original longhands correctly.
  if(prop==='animation'){
    if(value==='none')return {'animation-name':'none','animation-duration':'0s','animation-timing-function':'ease','animation-fill-mode':'none'};
    const parts=value.match(/^(\S+) (\S+) (cubic-bezier\([^)]*\)) (\S+)$/);assert.ok(parts,value);
    return {'animation-name':parts[1],'animation-duration':parts[2],'animation-timing-function':parts[3],'animation-fill-mode':parts[4]};
  }
  if(/^border(?:-(?:top|right|bottom|left))?$/.test(prop)){
    const style=dom.window.document.createElement('div').style;style.setProperty(prop,value);
    const sides=prop==='border'?['top','right','bottom','left']:[prop.slice(7)];
    return Object.fromEntries(sides.flatMap(side=>['width','style','color'].map(part=>{const p=`border-${side}-${part}`;return [p,style.getPropertyValue(p)];})));
  }
  return {[prop]:value};
}
function resolved(source,node,mode,backdrop=false,variables={}){
  const winners=new Map();let order=0;
  for(const rule of source){if(!rule.media.every(query=>mediaMatches(query,mode))||!matches(node,rule.selector,backdrop))continue;
    for(const declaration of rule.declarations){const value=declaration.value.replace(/var\((--informational-[\w-]+)\)/g,(_,name)=>{assert.ok(name in variables,name);return variables[name];});
      for(const [prop,expanded] of Object.entries(expand(declaration.prop,value))){const rank=[declaration.important?1:0,rule.specificity,++order],old=winners.get(prop);
        if(!old||rank[0]>old.rank[0]||rank[0]===old.rank[0]&&(rank[1]>old.rank[1]||rank[1]===old.rank[1]&&rank[2]>old.rank[2]))winners.set(prop,{rank,value:expanded});
      }
    }
  }
  return Object.fromEntries([...winners].filter(([prop])=>!prop.startsWith('animation')&&!['transform-origin','will-change'].includes(prop)).map(([prop,{value}])=>[prop,value]).sort(([a],[b])=>a.localeCompare(b)));
}
const modes=[
  ['desktop',{width:1200,hover:'hover',pointer:'fine',reduce:false}],
  ['compact780',{width:780,hover:'hover',pointer:'fine',reduce:false}],
  ['mobile600',{width:600,hover:'hover',pointer:'fine',reduce:false}],
  ['coarse',{width:1200,hover:'hover',pointer:'coarse',reduce:false}],
  ['no-hover',{width:1200,hover:'none',pointer:'fine',reduce:false}],
  ['less-motion',{width:1200,hover:'hover',pointer:'fine',reduce:false,less:true}],
  ['reduced',{width:1200,hover:'hover',pointer:'fine',reduce:true}],
  ['mobile-reduced-less',{width:320,hover:'none',pointer:'coarse',reduce:true,less:true}],
];
for(const [name,id,props] of [
  ['AppleRefreshDialog','appleRefreshDialog',{}],
  ['DonationDialog','donationDialog',{assetUrl:x=>x,onArtworkUnavailable(){}}],
  ['MultiplayerGuideDialog','mpGuideDialog',{gameId:'th07'}],
])test(`${name}: non-motion shell declarations equal canonical main in all states/media`,()=>{
  const baseline=new dom.window.DOMParser().parseFromString(pinned('public/index.html'),'text/html').querySelector('#'+id);
  const markup=renderToStaticMarkup(React.createElement(api.LocaleProvider,{locale:'zh-CN'},React.createElement(api[name],{open:false,onCloseRequest(){},...props})));
  const holder=dom.window.document.createElement('div');holder.innerHTML=markup;const actual=holder.querySelector('#'+id);
  assert.equal(actual.matches('.apple-refresh-dialog,.donation-dialog,.multiplayer-guide-dialog'),false);
  assert.equal(actual.firstElementChild.matches('.apple-refresh-window,.donation-window,.multiplayer-guide-window'),false);
  const variables=Object.fromEntries(Array.from(actual.style).map(prop=>[prop,actual.style.getPropertyValue(prop)]));
  for(const [modeName,mode] of modes)for(const state of ['closed','open','closing'])for(const interaction of ['', 'hover','focus-visible','active']){
    const fixture=dom.window.document.createElement('div');fixture.className=mode.less?'less-motion':'';fixture.append(baseline,actual);
    for(const dialog of [baseline,actual]){dialog.toggleAttribute('open',state!=='closed');dialog.classList.toggle('closing',state==='closing');dialog.querySelector('button').setAttribute('data-probe-state',interaction);}
    const targets=[['dialog',baseline,actual,false],['backdrop',baseline,actual,true],...['article','header','h1','button'].map(tag=>[tag,baseline.querySelector(tag),actual.querySelector(tag),false])];
    for(const [target,before,after,backdrop] of targets)assert.deepEqual(resolved(sharedRules,after,mode,backdrop,variables),resolved(originalRules,before,mode,backdrop),`${modeName}/${state}/${interaction||'idle'}/${target}`);
  }
});
test('one generic style/lifecycle owner retains canonical CSS and domain-only callers',()=>{
  assert.equal(read('public/styles.css'),oldCss);
  for(const name of ['AppleRefreshDialog','DonationDialog','MultiplayerGuideDialog']){
    const source=read(`app/components/notices/${name}.tsx`);
    assert.doesNotMatch(source,/<dialog\b|useMainDialog\(|onCancel=|onAnimationEnd=|setTimeout\(/);
    assert.doesNotMatch(source,legacy);
  }
  assert.doesNotMatch(newCss,legacy);
  assert.doesNotMatch(newCss,/animation(?:-[\w-]+)?\s*:|--informational-(?:shell|window|exit)/,'Animation belongs to the shared completion adapter');
  assert.match(read('app/components/notices/InformationalDialog.tsx'),/import '\.\/informational-dialog\.css'/);
});
