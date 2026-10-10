import {componentFileIds} from '../../package/package-generation.mjs';
import type {GameId} from '../../src/contracts/product-catalog.mts';
import type {CurrentPackageGeneration, InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';
import type {GamePreparationInput, PreparedGamePlan} from './game-preparation';
import {preparationErrorText, type PackageAcquisition} from './package-acquisition';
import type {RuntimeService} from './runtime';
import {oggMusic} from './game-resources';

// One document-lived acquisition owner gets one progressive worker per game.
// A replaced Runtime waits for its predecessor's current object transaction,
// then resumes its own epoch; no second Runtime stream or private store exists.
const workers = new WeakMap<PackageAcquisition, Map<GameId, Promise<void>>>();
function sameBase(a: InstalledPackageGeneration, b: InstalledPackageGeneration) {
  return a.game === b.game && JSON.stringify(a.descriptor) === JSON.stringify(b.descriptor) &&
    a.descriptor.base.files.every(id => JSON.stringify(a.files[id]) === JSON.stringify(b.files[id]));
}
export async function startPreparedGameBackground({input, prepared, epoch, deferredUpdate}: {
  input: GamePreparationInput & {runtime: RuntimeService}; prepared: PreparedGamePlan; epoch: number;
  deferredUpdate: CurrentPackageGeneration | null;
}): Promise<void> {
  const {acquisition, runtime, translate: t} = input, game = prepared.plan.game;
  const loaded = prepared.plan.generation, resources = prepared.plan.resourceGeneration ?? loaded;
  const current = () => {const snapshot = runtime.getSnapshot(); return snapshot.epoch === epoch && snapshot.launched && snapshot.game === game;};
  const currentOgg = () => current() && runtime.getSnapshot().music === 'ogg';
  const backgroundUpdate = deferredUpdate ? acquisition.startBackgroundUpdate(deferredUpdate, {
    productId: input.productId, music: prepared.music, language: input.settings.language,
  }).catch(error => {input.onBackgroundError?.(error);}) : Promise.resolve();
  if (!loaded || !resources || !oggMusic(prepared.music) || !currentOgg()) {await backgroundUpdate; return;}
  const ids = componentFileIds(resources.descriptor, 'ogg'), installed = ids.slice(2).filter(id => !!resources.files[id]?.objectId);
  const local = (async () => {
    if (!installed.length) return;
    try {
      await runtime.extendOggResources(epoch, resources, installed);
    } catch (error) {
      if (currentOgg()) {
        if (input.onLocalMusicFailure) input.onLocalMusicFailure(error);
        else input.onWarning?.(t('transfer.localOggPartialFailed', {reason: preparationErrorText(error)}));
      }
    }
  })();
  let slots = workers.get(acquisition); if (!slots) {slots = new Map(); workers.set(acquisition, slots);}
  const ownerSlots = slots;
  const progressive = (async () => {
    const predecessor = ownerSlots.get(game);
    if (predecessor) {try {await predecessor;} catch {} if (!currentOgg()) return;}
    const catalog = acquisition.getMetadata().releaseCatalog;
    if (catalog?.games[game]?.revision !== loaded.descriptor.revision || !currentOgg()) return;
    let generation = resources;
    const task = (async () => {
      // A previous worker may have completed an object after its Runtime closed.
      const latest = await acquisition.readCurrent(game);
      if (!currentOgg()) return;
      if (latest.generation && sameBase(loaded, latest.generation)) generation = latest.generation;
      for (const id of ids.slice(2).filter(id => !resources.files[id]?.objectId)) {
        if (!currentOgg()) return;
        try {
          if (!generation.files[id]?.objectId) {
            const result = await acquisition.installPublished(game, {catalog, catalogUrl: acquisition.catalogUrl,
              addFileIds: [id], preserveLocalSource: true, fetchImpl: acquisition.getPackageFetch(game)});
            generation = result.generation;
            // The transaction intentionally finishes when close happens mid-fetch.
            await acquisition.refreshInstalled(game);
          }
          if (!generation.files[id]?.objectId) throw new Error(t('package.objectNotPersisted'));
          if (!currentOgg()) return;
          if (!sameBase(loaded, generation)) throw new Error(t('runtime.offlineReplaced'));
          // Main 5858 attaches newly downloaded files without claiming the
          // local-at-launch OGG progress surface; network activity owns these.
          await runtime.extendOggResources(epoch, generation, [id], {localProgress: false});
        } catch (error) {
          input.onBackgroundError?.(error);
          if (currentOgg()) input.onWarning?.(t('music.backgroundInterrupted', {reason: preparationErrorText(error)}));
          return;
        }
      }
    })().finally(() => {if (ownerSlots.get(game) === task) ownerSlots.delete(game);});
    ownerSlots.set(game, task); await task;
  })();
  // These are observable completion handles, never part of the launch barrier.
  await Promise.all([backgroundUpdate, local, progressive]);
}
