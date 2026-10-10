import {validateHostManifest, type HostManifest} from '../../src/contracts/host-manifest.mts';
import {PRODUCT_GAMES, type GameId} from '../../src/contracts/product-catalog.mts';
/** Original app.mts5948–5983 fallback. No fabricated Package generation, no
 * managed-DATA query and no authority for a retail-memory engine to fetch DATA. */
export function directPreloadRuntimeUrl(plan: {
  game: GameId; runtimeVariant: 'normal' | 'multiplayer'; entry: string;
  directPreloadHost?: HostManifest;
}, baseUrl: string): URL {
  if (!plan.directPreloadHost) throw new Error('Direct preload requires validated Host authority');
  const host = validateHostManifest(plan.directPreloadHost), product = PRODUCT_GAMES[plan.game];
  const game = host.games[plan.game];
  if (host.shared.resourceMode !== 'hosted' || product.dataProvider !== 'emscripten-preload' || !game) throw new Error('Host does not authorize this preload Runtime');
  const declared = plan.runtimeVariant === 'multiplayer' ? game.multiplayerRuntime : game.runtime;
  if (!declared) throw new Error('Host does not declare this Runtime variant');
  const url = new URL(declared, baseUrl), requested = new URL(plan.entry, baseUrl), base = new URL(baseUrl);
  if (url.href !== requested.href || url.origin !== base.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Invalid direct preload Runtime source');
  url.searchParams.set('runtimeVariant', plan.runtimeVariant);
  url.searchParams.set('asset', game.gameData.version);
  if (typeof game.music.ogg?.version === 'string') url.searchParams.set('oggAsset', game.music.ogg.version);
  return url;
}
