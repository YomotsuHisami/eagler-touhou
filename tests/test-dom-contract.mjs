/** The default DOM is a Framework SPA; legacy selector-ID ownership is retired.
 * This validates its boot resources. Interactive DOM behavior belongs to UI CI. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {transform} from 'esbuild';
import {FRONTEND_PACKAGE_FILES,FRONTEND_UI_ARTIFACT,resolveFrontendPackageSource} from '../lib/frontend-manifest.mjs';
const html=await readFile(resolveFrontendPackageSource('index.html'),'utf8'),document=parse(html),counts=new Map(),resources=[];
function visit(node){if(node.tagName){counts.set(node.tagName,(counts.get(node.tagName)||0)+1);const attrs=Object.fromEntries((node.attrs||[]).map(item=>[item.name,item.value]));
 if(node.tagName==='script' && attrs.src)resources.push(attrs.src);
 if(node.tagName==='link' && ['modulepreload','stylesheet'].includes(attrs.rel))resources.push(attrs.href);}
 for(const child of node.childNodes||[])visit(child);}
visit(document);
assert.equal(counts.get('html'),1);assert.equal(counts.get('body'),1);
assert.match(html,/name="viewport"/);assert.match(html,/window\.__reactRouterContext/);
assert.ok(resources.length>2);
for(const url of resources){assert.ok(url.startsWith(FRONTEND_UI_ARTIFACT.mountPath+'assets/'),url);assert.ok(FRONTEND_PACKAGE_FILES.includes(url.split('#')[0].slice(FRONTEND_UI_ARTIFACT.mountPath.length)),url);}
assert.doesNotMatch(html,/(?:src|import)\s*[=(]?\s*["'][^"']*(?:app\.js|assets\/launcher\/)/);
assert.equal(resolveFrontendPackageSource('en.html'),resolveFrontendPackageSource('index.html'));
assert.equal(resolveFrontendPackageSource('lobby.html'),resolveFrontendPackageSource('index.html'));
for(const path of ['/','/lobby','/play/:productId','/play/:productId/resources','/play/:productId/replays','/play/:productId/saves'])assert.ok(FRONTEND_UI_ARTIFACT.navigation.patterns.includes(path),path);
console.log('Framework DOM boot graph, aliases and route ownership: PASS');

// Informational pages are retained standalone outputs. Their resource closure
// must stay valid after stripping the obsolete launcher's 267 KB stylesheet.
const transformed=await transform(await readFile(resolveFrontendPackageSource('styles.css'),'utf8'),{loader:'css'});
assert.deepEqual(transformed.warnings,[],'informational CSS must parse without dropped rules');
const infoCss=transformed.code;
const selectors=new Set([...infoCss.matchAll(/(?:^|[{}])\s*([^{}]+)\{/g)].map(match=>match[1].replace(/\s+/g,'')));
const variables=new Set([...infoCss.matchAll(/(--[a-z-]+)\s*:/g)].map(match=>match[1]));
const usedVariables=new Set([...infoCss.matchAll(/var\((--[a-z-]+)/g)].map(match=>match[1]));
for(const match of infoCss.matchAll(/url\(["']?([^"')]+)["']?\)/g))assert.ok(FRONTEND_PACKAGE_FILES.includes(match[1]),`informational font is missing: ${match[1]}`);
for(const name of usedVariables)assert.ok(variables.has(name),`informational style variable is missing: ${name}`);
for(const selector of ['*',':root','html,body','body','.markdown-blockquote','.markdown-blockquote>:first-child','.markdown-blockquote>:last-child'])assert.ok(selectors.has(selector),selector);
assert.doesNotMatch(infoCss,/\.game\b|\.player\b|\.tools\b|\.touch-|\.mp-|#mp|lobby-options/,'informational styles must not carry an unused launcher renderer');
for(const path of ['about.html','faq.html']){
 const page=parse(await readFile(resolveFrontendPackageSource(path),'utf8'));const sheets=[];
 function resources(node){const attrs=Object.fromEntries((node.attrs||[]).map(item=>[item.name,item.value]));
  if(node.tagName==='link' && attrs.rel==='stylesheet')sheets.push(attrs.href);
  assert.ok(!(node.tagName==='script'&&attrs.src),'informational page must not bootstrap the retired renderer');
  for(const child of node.childNodes||[])resources(child);
 }
 resources(page);assert.deepEqual(sheets,['styles.css','about.css'],path);
 for(const sheet of sheets)assert.ok(FRONTEND_PACKAGE_FILES.includes(sheet),`${path}: missing ${sheet}`);
}
console.log('Standalone informational styles and resource closure: PASS');
