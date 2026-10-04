import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';

/** Child management pages retain their product's existing Runtime owner. */
export function productManagementRoute(pathname: string): string | null {
  const match = /^\/play\/([^/]+)(?:\/(resources|replays|saves))?\/?$/.exec(pathname);
  return match && isProductId(match[1]) && productEnabledForBuild(match[1], false) ? match[1] : null;
}
export function leavesProductManagement(current: string, next: string): boolean {
  if (current === next) return false;
  const product = productManagementRoute(current);
  return product === null || product !== productManagementRoute(next);
}

/** Keep room identity and locale while leaving transient overlays behind. */
export function productManagementSearch(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of ['panel','touchLayout','lobbyDialog','roomPanel']) params.delete(key);
  const value = params.toString();
  return value ? `?${value}` : '';
}
