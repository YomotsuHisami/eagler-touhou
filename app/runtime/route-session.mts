import {isProductId, productEnabledForBuild} from '../../src/contracts/product-catalog.mts';

/** Child management pages retain their product's existing Runtime owner. */
export function productManagementRoute(pathname: string): string | null {
  const match = /^\/play\/([^/]+)(?:\/(resources|replays))?\/?$/.exec(pathname);
  return match && isProductId(match[1]) && productEnabledForBuild(match[1], false) ? match[1] : null;
}
export function leavesProductManagement(current: string, next: string): boolean {
  if (current === next) return false;
  const product = productManagementRoute(current);
  return product === null || product !== productManagementRoute(next);
}
