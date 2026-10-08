import {useLayoutEffect, useRef} from 'react';
import {isMultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {usePreferencesStore} from './GameSettingsProvider';
import {useGameLaunchJob} from './GameLaunchProvider';
import {useMultiplayerReplay} from './MultiplayerReplayProvider';
import {useTouchLayoutSnapshot} from './TouchLayoutProvider';
import {useFilePreparation} from './FilePreparationProvider';
import {useResourceManager} from './ResourceManagerProvider';
import {productRuntimeFileIdentity} from '../services/file-preparation.client';

/** File views reuse the exact same preparation services and iframe as Start.
 * A file-only session prepares native file access without starting gameplay. */
export function FilePreparationBridge() {
  const {controller: bridge} = useFilePreparation(), {controller: ordinary} = useGameLaunchJob();
  const {controller: multiplayer} = useMultiplayerReplay(), preferences = usePreferencesStore();
  const {controller: resources} = useResourceManager(), layout = useTouchLayoutSnapshot();
  const ports = useRef({ordinary, multiplayer, preferences, resources, layout});
  ports.current = {ordinary, multiplayer, preferences, resources, layout};
  useLayoutEffect(() => {
    if (!bridge || !ordinary || !multiplayer || !preferences) return;
    return bridge.registerPreparer(async (productId, signal) => {
      const current = ports.current;
      const job = isMultiplayerProductId(productId) ? current.multiplayer : current.ordinary;
      if (!job || !current.preferences) throw new Error('The game file preparation service is not ready');
      const cancelled = () => {if (signal.aborted) throw new DOMException('File preparation cancelled', 'AbortError');};
      cancelled();
      if (current.resources) await current.resources.inspect(productId);
      // Metadata feeds the existing root preferences owner after its React
      // commit. Snapshot it only once the current catalog has been delivered.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      cancelled();
      current.preferences.loadProduct(productId);
      const settings = current.preferences.getSnapshot(productId);
      if (!settings) throw new Error('Game settings are not available');
      const fileSettings = {...settings, music: 'none' as const, language: 'ja'};
      const pending = isMultiplayerProductId(productId)
        ? current.multiplayer!.prepare(productId, fileSettings, current.layout?.saved ?? null)
        : current.ordinary!.prepare(productId, fileSettings, current.layout?.saved ?? null, 'keep-current');
      const selection = job.getSnapshot().selection;
      const cancel = () => {if (job.getSnapshot().selection === selection) job.cancel();};
      signal.addEventListener('abort', cancel, {once: true});
      if (signal.aborted) cancel();
      try {
        const result = await pending; cancelled();
        if (result.epoch === null) throw new Error('The prepared file Runtime has no epoch');
        return {identity: productRuntimeFileIdentity(productId), epoch: result.epoch};
      } finally {signal.removeEventListener('abort', cancel);}
    });
  }, [bridge, ordinary, multiplayer, preferences]);
  return null;
}
