/** CI-only protocol peer. This is never evidence of a working native engine. */
import {HOST_PROTOCOL} from '../../src/contracts/product-catalog.mts';
const epoch = Number(new URL(location.href).searchParams.get('runtimeEpoch'));
const envelope = {protocol: HOST_PROTOCOL, game: 'th08', epoch};
if (!Number.isSafeInteger(epoch) || epoch < 1 || parent === window) throw Error('Expected a hosted synthetic epoch');
const emit = (value: Record<string, unknown>) => parent.postMessage({...envelope, ...value}, location.origin);
const globals = window as unknown as Record<string, unknown>;
const transport = {peers: new Map(), relay: {readyState: 0}};
globals.__th08PeerTransport = transport;
globals.__eaglerNetplayTransport = 'relay';
globals.Module = {eaglerOptions: {}};
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const data = event.data;
  if (data?.syntheticAction === 'first-frame') {emit({event: 'first-frame'}); return;}
  if (data?.syntheticAction === 'gameplay-path') {transport.relay.readyState = 1; return;}
  if (data?.syntheticAction === 'error') {emit({event: 'error', error: 'Synthetic first-frame failure'}); return;}
  if (data?.syntheticAction === 'stale') {emit({event: 'first-frame', epoch: epoch - 1}); return;}
  if (!data || data.protocol !== envelope.protocol || data.game !== envelope.game || data.epoch !== epoch) return;
  parent.postMessage({syntheticPreflightTrace: true, command: data.command, options: data.options}, location.origin);
  if (data.command === 'configure') globals.Module = {eaglerOptions: data.options};
  if (data.request) emit({request: data.request, ok: true});
});
emit({event: 'ready'});
