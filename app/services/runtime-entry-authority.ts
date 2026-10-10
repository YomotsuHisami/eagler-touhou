import {validateHostManifest, type HostManifest} from '../../src/contracts/host-manifest.mts';
import {createLocalProductManifest, type GameId} from '../../src/contracts/product-catalog.mts';
/** Main5639–5655 uses immutable code only when the actual Host advertises it.
 * Otherwise the validated Host or unchanged built-in catalog supplies the live
 * same-origin entry. Installed DATA is still independently generation-pinned. */
export function liveRuntimeEntryAuthorized(plan: {
  game: GameId; runtimeVariant: 'normal' | 'multiplayer'; entry: string;
  runtimeHost?: HostManifest; developmentRuntimeHost?: HostManifest;
  localCatalogRuntime?: boolean;
}, baseUrl: string): boolean {
  try {
    const supplied = plan.runtimeHost ?? plan.developmentRuntimeHost;
    const manifest = supplied ? validateHostManifest(supplied) : plan.localCatalogRuntime ? createLocalProductManifest() : null;
    if (!manifest || ('runtimeManifest' in manifest.shared && manifest.shared.runtimeManifest)) return false;
    const game = manifest.games[plan.game];
    if (!game) return false;
    const declared = plan.runtimeVariant === 'multiplayer' ? ('multiplayerRuntime' in game ? game.multiplayerRuntime : undefined) : game.runtime;
    if (typeof declared !== 'string' || !declared) return false;
    const entry = new URL(plan.entry, baseUrl), base = new URL(baseUrl);
    return entry.href === new URL(declared, baseUrl).href && entry.origin === base.origin &&
      ['https:', 'http:'].includes(entry.protocol) && !entry.username && !entry.password && !entry.hash;
  } catch {return false;}
}
