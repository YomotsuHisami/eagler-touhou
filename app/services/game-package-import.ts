import {gameIdForProduct, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {ResourceImportController, ResourceImportReview} from './resource-import.client';

export interface PersistentStoragePort {persist?: () => Promise<boolean>}
/** Ask the browser to protect an installed local package from eviction. This
 * is only an eviction-policy hint and must never delay or fail installation. */
export function requestPersistentStorageBestEffort(storage: PersistentStoragePort | null | undefined = browserStorage()) {
  try {
    const request = storage?.persist?.();
    if (request) void Promise.resolve(request).catch(() => {});
  } catch {}
}
function browserStorage(): PersistentStoragePort | null {
  try {return typeof navigator === 'undefined' ? null : navigator.storage;}
  catch {return null;}
}

/** Inspect the selected file and commit its verified Package installation in
 * one UI action. The review is an internal installer token, not a second
 * confirmation step in the launcher.
 */
export async function installSelectedGamePackage(
  controller: Pick<ResourceImportController, 'inspectImport' | 'confirm'>,
  productId: ProductId,
  file: File,
  requestPersistence: () => void = requestPersistentStorageBestEffort,
): Promise<void> {
  const review: ResourceImportReview = await controller.inspectImport(productId, file, file.name);
  if (review.kind !== 'import' || review.productId !== productId || review.gameId !== gameIdForProduct(productId)) {
    throw new Error('The selected package does not match this game.');
  }
  await controller.confirm(review.id);
  try {requestPersistence();} catch {}
}
