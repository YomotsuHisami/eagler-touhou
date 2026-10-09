import {gameIdForProduct, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {validateHostManifest} from '../../src/contracts/host-manifest.mts';
import {RELEASE_CATALOG_FILE} from '../../src/contracts/release-catalog.mts';
import {prepareRuntimeLaunch} from '../../src/launcher/runtime-launch.mts';
import {checkPublishedCancelled, loadPublishedCatalog, publishedDependencies, publishedIO, type Th06SampleOptions} from './sample-launch.client';
import {GameDataAcquisitionError} from './game-data-acquisition';
import type {MultiplayerResourceProgress} from '../../src/launcher/multiplayer-lobby-snapshot.mts';

/** The waiting room installs the base only. Language/music/settings belong to
 * Check game or the server's Start event, never to the Ready control. */
export async function prepareMultiplayerRoomResources(options: Th06SampleOptions & {
  productId: MultiplayerProductId; progress(value: MultiplayerResourceProgress): void;
}): Promise<void> {
  const game = gameIdForProduct(options.productId), deps = publishedDependencies(options);
  options.progress({status: 'preparing', stage: 'package', percent: null});
  let installed = await deps.readCurrent(game);
  if (!installed.generation) {
    try {
      const catalog = await loadPublishedCatalog(options, options.baseUrl);
      checkPublishedCancelled(options.signal);
      if (!catalog?.games[game]) throw new Error(`${game.toUpperCase()}: no installed DATA or published Game Package`);
      await deps.install(game, {catalog, catalogUrl: new URL(RELEASE_CATALOG_FILE, options.baseUrl).href,
        addComponents: [], fetchImpl: options.fetchImpl, signal: options.signal,
        onProgress: value => options.progress({status: 'preparing', stage: 'package', percent: value.total ? Math.round(value.completed / value.total * 100) : null})});
      installed = await deps.readCurrent(game);
      checkPublishedCancelled(options.signal);
      if (!installed.generation) throw new Error('The Game Package was not persisted');
    } catch (error) {
      checkPublishedCancelled(options.signal);
      throw new GameDataAcquisitionError(error instanceof Error ? error.message : String(error), {cause: error});
    }
  }
  checkPublishedCancelled(options.signal);
  options.progress({status: 'preparing', stage: 'runtime', percent: null});
  // Main deliberately skips no-store executable prefetch without an active
  // worker: it would download the same Runtime again when the game starts.
  let worker: ServiceWorker | null = null;
  try {worker = typeof navigator !== 'undefined' ? (await navigator.serviceWorker?.getRegistration(options.baseUrl))?.active ?? null : null;} catch {}
  checkPublishedCancelled(options.signal);
  if (worker) {
    const host = validateHostManifest(await publishedIO(options, [])(new URL('host-manifest.json', options.baseUrl).href, 'metadata', response => response.json()));
    const runtime = host.games[game]?.multiplayerRuntime;
    if (runtime && host.shared.runtimeManifest) await prepareRuntimeLaunch(runtime, {baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, worker});
  }
  checkPublishedCancelled(options.signal);
}
