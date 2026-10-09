import {gameIdForProduct, type ProductId} from '../../src/contracts/product-catalog.mts';
import {updatePackageForLaunch, type LaunchUpdateChoice} from './game-launch-job.client';
import type {ResourceManagerController} from './resources.client';
export interface EntryBackgroundUpdate {productId: string; expectedPublishedRevision: string}
export interface EntryPackageUpdateHooks {
  preparePackageUpdate?(productId: ProductId, signal: AbortSignal, current: () => boolean): Promise<EntryBackgroundUpdate | null>;
  onPreparedPackageUpdate?(update: EntryBackgroundUpdate, epoch: number, generationId: string): void;
}

/** Main asks only about an already-known catalog update. The existing Resource
 * Manager owns the mutation, and update failure retains the installed current. */
export async function prepareEntryPackageUpdate({productId, owner, choose, signal, current, onFailure}: {
  productId: ProductId; owner: ResourceManagerController | null;
  choose: ((source: 'local' | 'remote' | null, current: () => boolean, signal: AbortSignal) => Promise<LaunchUpdateChoice>) | null;
  signal: AbortSignal; current(): boolean; onFailure?(error: unknown): void;
}): Promise<EntryBackgroundUpdate | null> {
  const game = gameIdForProduct(productId), inspection = owner?.getSnapshot().inspections[game];
  if (!current() || signal.aborted || !owner || !choose || !inspection?.updateAvailable || !inspection.generationId || !inspection.publishedRevision) return null;
  const choice = await choose(inspection.source, current, signal);
  if (signal.aborted || !current()) throw new DOMException('Package update request was cancelled', 'AbortError');
  if (choice === 'background') return {productId: game, expectedPublishedRevision: inspection.publishedRevision};
  if (choice !== 'update-now') return null;
  try {
    await updatePackageForLaunch(owner, {productId: game, expectedGenerationId: inspection.generationId,
      expectedPublishedRevision: inspection.publishedRevision, signal});
  } catch (error) {
    if (signal.aborted || !current()) throw new DOMException('Package update request was cancelled', 'AbortError');
    onFailure?.(error);
  }
  return null;
}
