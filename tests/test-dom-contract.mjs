/** The default DOM is a Framework SPA; legacy selector-ID ownership is retired.
 * This validates its boot resources. Interactive DOM behavior belongs to UI CI. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
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
