/** Explicit UI-only data. Never use this file for publication or gameplay evidence. */
import { PRODUCT_GAMES } from './contracts/product-catalog.mjs';
export function localPreviewFixture(){
  const hash='a'.repeat(64);
  return {
    host:{schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'local-ui-fixture',
      shared:{testBuild:true,localPreviewUiOnly:true,resourceMode:'hosted',vanillaFont:'shared/not-installed.otf',unicodeFont:'shared/not-installed.otf'},
      games:Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([id,product])=>[id,{
        runtime:product.runtime,multiplayerRuntime:product.multiplayerRuntime,
        gameData:{path:product.package.dataTarget.slice(1),bytes:1,sha256:hash,version:`sha256-${hash}`,layout:`sha256-${hash}`},
        music:{midi:{files:[]}},features:{thprac:product.features.thprac}
      }]))},
    catalog:{schema:'eagler-touhou/release-catalog/1',games:{}}
  };
}
