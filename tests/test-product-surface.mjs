/** Product surface membership is a Catalog + actual Host contract. Framework
 * DOM rendering is separately covered in the current UI SSR/browser tests. */
import assert from 'node:assert/strict';
import * as catalog from '../lib/contracts/product-catalog.mjs';
import {uiPublicationProducts} from '../scripts/ui-deployment-contract.mjs';
import {FRONTEND_UI_ARTIFACT} from '../lib/frontend-manifest.mjs';
const host={shared:{testBuild:false},games:Object.fromEntries(Object.entries(catalog.PRODUCT_GAMES).map(([id,game])=>[id,{runtime:`runtime/${id}/${id}.html`,...(game.multiplayerRuntime?{multiplayerRuntime:`runtime/${id}/multiplayer/${id}.html`}:{})}]))};
const all=uiPublicationProducts(host,catalog);
assert.deepEqual(all,catalog.PRODUCT_IDS.filter(id=>catalog.productEnabledForBuild(id,false)));
assert.equal(new Set(all).size,all.length);
for(const id of all){const game=catalog.gameIdForProduct(id);assert.ok(host.games[game]);assert.ok(catalog.PRODUCT_GAMES[game].title);if(catalog.isMultiplayerProductId(id))assert.ok(host.games[game].multiplayerRuntime);}
for(const game of Object.keys(host.games)){
 const one=uiPublicationProducts({shared:host.shared,games:{[game]:host.games[game]}},catalog);
 assert.ok(one.every(id=>catalog.gameIdForProduct(id)===game));
 const solo=uiPublicationProducts({shared:host.shared,games:{[game]:{runtime:host.games[game].runtime}}},catalog);
 assert.ok(solo.every(id=>!catalog.isMultiplayerProductId(id)));
}
assert.deepEqual(uiPublicationProducts({shared:{testBuild:false},games:{}},catalog),[]);
assert.deepEqual(uiPublicationProducts({...host,shared:{testBuild:true}},catalog),catalog.PRODUCT_IDS.filter(id=>catalog.productEnabledForBuild(id,true)));
assert.equal(all.includes('th20'),false,'hidden products are not made available merely by Host bytes');
assert.equal(FRONTEND_UI_ARTIFACT.publishedFiles.some(path=>path==='app.js'||path.startsWith('assets/launcher/')),false);
console.log(JSON.stringify({productSurface:'PASS',products:all.length,owner:'Product Catalog + Host availability'}));
