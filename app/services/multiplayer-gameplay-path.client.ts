import {multiplayerConfigForProduct, multiplayerProductIdForGame} from '../../src/contracts/product-catalog.mts';
import {describeNetplayConnection, type NetplayConnectionPeerState} from '../../src/launcher/runtime-diagnostics-model.mts';
import type {RuntimeService} from './runtime.client';
import type {RoomLaunchRequest} from './multiplayer-room.client';

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
const read = (target: object | null, key: PropertyKey) => {try {return target ? (target as Record<PropertyKey, unknown>)[key] : undefined;} catch {return undefined;}};
const cancelled = () => new DOMException('Multiplayer startup was replaced or cancelled', 'AbortError');
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {reject(cancelled()); return;}
    const abort = () => {clearTimeout(timer); reject(cancelled());};
    const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, ms);
    signal.addEventListener('abort', abort, {once: true});
  });
}

export function roomLaunchCoverRequired(device: {userAgent: string; maxTouchPoints: number}): boolean {
  return !(/iPhone|iPad|iPod/i.test(device.userAgent) || device.maxTouchPoints > 1 && /Macintosh/i.test(device.userAgent));
}
/** Same allowlisted native transport that main reads. No probe or transport is created. */
export function readMultiplayerConnection(runtime: Pick<RuntimeService,'getSnapshot'|'getInputContext'>) {
  const snapshot=runtime.getSnapshot(), context=runtime.getInputContext();
  if(!snapshot.game||snapshot.runtimeVariant!=='multiplayer'||!snapshot.ready||!snapshot.launched||context.epoch!==snapshot.epoch)return null;
  const product=multiplayerProductIdForGame(snapshot.game),policy=product&&multiplayerConfigForProduct(product);
  if(!policy)return null;
  const target=context.target,module=record(read(target,'Module')),options=record(read(module,'eaglerOptions'));
  const peer=record(read(target,policy.peerTransportGlobal)),peers=record(peer?.peers);
  if(options?.netplayMode!=='lan'||options.replayViewer||!peer||!peers||typeof peers.get!=='function'||typeof read(peers,Symbol.iterator)!=='function')return null;
  return {epoch:snapshot.epoch,peerState:peer as NetplayConnectionPeerState,failed:peer.failed===true,error:typeof peer.error==='string'?peer.error:'',
    spectator:snapshot.spectator||read(target,'__eaglerNetplaySpectator')===true,transport:read(target,'__eaglerNetplayTransport'),path:read(target,'__eaglerNetplayPath'),
    playerCount:options.netplayPlayerCount,localPlayer:options.netplayPlayer};
}

/** Main's first-frame -> actual gameplay path gate. Room probe RTT is never
 * accepted here. This reads the same native transport without owning it. */
export async function waitForMultiplayerGameplayPath({runtime, request, epoch, signal, current,
  now = () => performance.now(), wait = pause, timeoutMs = 120_000}: {
  runtime: Pick<RuntimeService, 'getSnapshot' | 'getInputContext'>;
  request: RoomLaunchRequest; epoch: number; signal: AbortSignal; current(): boolean;
  now?(): number; wait?(ms: number, signal: AbortSignal): Promise<void>; timeoutMs?: number;
}): Promise<void> {
  const policy = multiplayerConfigForProduct(request.productId)!;
  const deadline = now() + timeoutMs;
  while (!signal.aborted && current()) {
    const snapshot = runtime.getSnapshot(), context = runtime.getInputContext();
    if (snapshot.epoch !== epoch || !snapshot.launched || context.epoch !== epoch) throw cancelled();
    const target = context.target, module = record(read(target, 'Module')), options = record(read(module, 'eaglerOptions'));
    const peer = record(read(target, policy.peerTransportGlobal)), peers = record(peer?.peers);
    if (options?.netplayMode === 'lan' && peer && peers && typeof peers.get === 'function' && typeof read(peers, Symbol.iterator) === 'function') {
      if (peer.failed === true) throw new Error(typeof peer.error === 'string' ? peer.error : '联机游戏链路不可用。');
      const view = describeNetplayConnection({peerState: peer as NetplayConnectionPeerState,
        spectator: request.options.netplaySpectator, playerCount: request.options.netplayPlayerCount,
        localPlayer: request.options.netplayPlayer, transport: read(target, '__eaglerNetplayTransport'),
        path: read(target, '__eaglerNetplayPath'), webSocketOpenState: 1});
      if (view.hidden) return;
    }
    if (now() >= deadline) throw new Error('等待实际联机游戏链路超时，请返回房间重试。');
    await wait(250, signal);
  }
  throw cancelled();
}
