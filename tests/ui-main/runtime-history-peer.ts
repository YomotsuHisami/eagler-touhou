/** SYNTHETIC ONLY: exact-envelope command peer, without a game, WASM or IDBFS. */
import {HOST_PROTOCOL} from '../../src/contracts/product-catalog.mts';
const url = new URL(location.href);
const epoch = Number(url.searchParams.get('runtimeEpoch'));
const game = 'th11';
const envelope = {protocol: HOST_PROTOCOL, game, epoch};
const status = document.getElementById('status');
if (!status || !Number.isSafeInteger(epoch) || epoch <= 0 || parent === window) throw new Error('Synthetic peer requires a hosted test epoch');
const emit = (data: Record<string, unknown>) => parent.postMessage({...data, ...envelope}, location.origin);
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data.protocol !== HOST_PROTOCOL || data.game !== game || data.epoch !== epoch) return;
  if (!['configure', 'launch', 'sync'].includes(String(data.command))) return;
  emit({request: data.request, ok: true});
  if (data.command === 'launch') emit({event: 'first-frame'});
});

if (url.searchParams.get('bootstrapFailure') === '1') {
  status.textContent = 'Synthetic bootstrap failure';
  emit({event: 'error', error: 'Synthetic complete-code-generation bootstrap failure'});
} else if (url.searchParams.get('pauseReady') === '1') {
  status.textContent = 'Synthetic readiness intentionally paused';
} else {
  const host = parent as Window & {__eaglerPrepareManagedRuntimeDataV1?: (request: {
    game: string; generation: string; epoch: number;
  }) => Promise<{buffer: ArrayBuffer}>};
  const data = await host.__eaglerPrepareManagedRuntimeDataV1?.({game, epoch, generation: url.searchParams.get('gameGeneration') ?? ''});
  if (!data || data.buffer.byteLength !== 2) throw new Error('Synthetic managed DATA bridge failed');
  status.textContent = 'Synthetic protocol peer ready, no game or persistence';
  emit({event: 'ready'});
}
