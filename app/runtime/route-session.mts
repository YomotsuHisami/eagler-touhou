import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';

/** Child management pages retain their product's existing Runtime owner. */
export function productManagementRoute(pathname: string): string | null {
  const match = /^\/play\/([^/]+)(?:\/(resources|replays|saves))?\/?$/.exec(pathname);
  return match && isProductId(match[1]) && productEnabledForBuild(match[1], true) ? match[1] : null;
}
export function leavesProductManagement(current: string, next: string): boolean {
  if (current === next) return false;
  const product = productManagementRoute(current);
  return product === null || product !== productManagementRoute(next);
}

interface PlayerLocation {key: string; pathname: string; search: string; hash: string; state?: unknown}
export interface PlayerHistoryReceipt {readonly productId: string; readonly originKey: string; readonly active: boolean}
/** Router state owns the extra Player layer, just as main's playerHistoryKey.
 * Its own push/replace must not invalidate the Start that opened it. */
export function playerHistoryReceipt(location: PlayerLocation): PlayerHistoryReceipt | null {
  const state = location.state as {uiPlayer?: Partial<PlayerHistoryReceipt>} | null;
  const receipt = state?.uiPlayer;
  return receipt && receipt.productId === productManagementRoute(location.pathname) && typeof receipt.originKey === 'string' && typeof receipt.active === 'boolean'
    ? receipt as PlayerHistoryReceipt : null;
}
export function playerIntentScope(location: PlayerLocation): string {
  return JSON.stringify([playerHistoryReceipt(location)?.originKey ?? location.key, location.pathname, location.search, location.hash]);
}
export function leavesPlayerHistory(current: PlayerLocation, next: PlayerLocation, action: string): boolean {
  return action === 'POP' && playerHistoryReceipt(current)?.active === true && playerHistoryReceipt(next)?.active !== true;
}

/** Keep room identity and locale while leaving transient overlays behind. */
export function productManagementSearch(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of ['panel','touchLayout','lobbyDialog','roomPanel']) params.delete(key);
  const value = params.toString();
  return value ? `?${value}` : '';
}
