import {appendRttSample, compactNetplayPeerStatus, describeNetplayConnection, selectedRtcPair, type NetplayConnectionView} from '../../src/launcher/runtime-diagnostics-model.mts';
import type {ProductId} from '../../src/contracts/product-catalog.mts';
import {RuntimeSessionSupersededError, type RuntimeService} from '../services/runtime';
import {readRuntimeNetplay, type RuntimeNetplaySnapshot, type RuntimePeerTransport, type RuntimePeerQuality} from './gameplay-network/native-snapshot';
import {formatNetplayDiagnostics, type NetplayDisplayContext} from './gameplay-network/diagnostic-lines';

export interface GameplayNetworkContext extends NetplayDisplayContext {
  product: ProductId; spectator: boolean; replayViewer: boolean;
}
export interface GameplayNetworkSnapshot {
  connection: Readonly<NetplayConnectionView> | null;
  returnToRoom: boolean;
  calibrationEligible: boolean;
  playerStatusVisible: boolean;
  playerStatus: readonly {text: string; title?: string}[];
  diagnostics: Readonly<Record<string, string>>;
}
export interface GameplayNetworkOptions {
  runtime: Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'getMidiEventContext'>;
  context(): GameplayNetworkContext;
  english(): boolean;
  translate(key: string, params?: Record<string, string | number>): string;
  timers: Pick<Window, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>;
  now?: () => number;
}
/** Original main gameplay path and telemetry owner. Room signalling probes are
 * deliberately not accepted as evidence that game input channels are ready. */
export function createGameplayNetwork(options: GameplayNetworkOptions) {
  const {runtime, timers} = options, now = options.now ?? (() => performance.now());
  const listeners = new Set<() => void>();
  let disposed = false, epoch = runtime.getSnapshot().epoch, document = runtime.getMidiEventContext()?.document;
  let connectionTransport: RuntimePeerTransport | null = null, connectedOnce = false;
  let qualityTransport: RuntimePeerTransport | null = null, qualitySerial = 0, sampling = false;
  const quality = {peers: new Map<number, RuntimePeerQuality>(), confirmed: null as number | null, confirmedAt: null as number | null};
  let snapshot: Readonly<GameplayNetworkSnapshot> = Object.freeze({connection: null, returnToRoom: false, calibrationEligible: false, playerStatusVisible: false, playerStatus: [], diagnostics: {}});
  const waits = new Set<{timer: number | null; reject(error: Error): void}>();
  function resetQuality(transport: RuntimePeerTransport | null = null) {
    qualitySerial++; qualityTransport = transport; sampling = false;
    quality.peers.clear(); quality.confirmed = quality.confirmedAt = null;
  }
  function read(): RuntimeNetplaySnapshot | null {
    const token = runtime.getMidiEventContext();
    if (!token || token.epoch !== runtime.getSnapshot().epoch) return null;
    const context = options.context();
    return readRuntimeNetplay(token.target, {...context, netplay: {spectator: context.spectator}});
  }
  function playerRows(net: RuntimeNetplaySnapshot, context: GameplayNetworkContext) {
    const count = Math.max(2, Math.min(3, Number(context.playerCount) || 2));
    const local = Math.max(0, Math.min(count - 1, Number(context.player) || 0));
    const paths = new Map(net.rtcPaths.filter(entry => Number.isInteger(Number(entry.peer)) && Number(entry.peer) >= 0 && Number(entry.peer) < count).map(entry => [Number(entry.peer), entry]));
    const rows: {text: string; title?: string}[] = [];
    for (let peerId = 0; peerId < count; peerId++) {
      if (peerId === local) continue;
      const peer = net.peerState?.peers.get(peerId), pcState = String(peer?.pc?.connectionState || peer?.pc?.iceConnectionState || '');
      const ready = peer?.inputOpen === true && peer?.controlOpen === true;
      let connected: boolean | undefined;
      if (net.transport === 'relay') connected = Number(net.peerState?.relay?.readyState) === 1 ? true : undefined;
      else if (ready || pcState === 'connected' || pcState === 'completed') connected = true;
      else if (['disconnected', 'failed', 'closed'].includes(pcState) || net.failed) connected = false;
      const path = paths.get(peerId), route = net.transport === 'relay' ? 'relay' : path?.path || (net.path === 'mixed' ? 'rtc' : net.path), sample = quality.peers.get(peerId);
      const row: {text: string; title?: string} = {text: compactNetplayPeerStatus({player: peerId, route, rttMs: sample?.rttMs, variationMs: sample?.variationMs, connected})};
      if (sample?.rttMs != null) row.title = `P${peerId + 1} ${[String(route || 'rtc'), path?.protocol, path?.family].filter(Boolean).join('/')} · RTT ${Math.round(sample.rttMs)}ms` + (sample.variationMs != null ? ` · variation ${Math.round(sample.variationMs)}ms` : '');
      rows.push(row);
    }
    return rows;
  }
  function refresh() {
    if (disposed) return;
    const state = runtime.getSnapshot(), token = runtime.getMidiEventContext();
    if (epoch !== state.epoch || document !== token?.document) {
      epoch = state.epoch; document = token?.document; connectionTransport = null; connectedOnce = false; resetQuality();
    }
    const net = read(), context = options.context();
    let connection: NetplayConnectionView | null = null;
    if (net && !context.replayViewer && net.peerState) {
      if (!net.spectator && connectionTransport !== net.peerState) {connectionTransport = net.peerState; connectedOnce = false;}
      connection = describeNetplayConnection({english: options.english(), spectator: net.spectator, failed: net.failed, error: net.error, transport: net.transport, path: net.path, peerState: net.peerState, playerCount: context.playerCount, localPlayer: context.player, connectedOnce, webSocketOpenState: 1});
      connectedOnce = connection.connectedOnce;
    }
    const visible = !!net && state.launched && !context.replayViewer && !net.spectator;
    snapshot = Object.freeze({connection, calibrationEligible: !!net?.peerState && !context.replayViewer && !net.failed && !net.spectator && !net.peerState.disconnected && !net.peerState.isRecovering?.(), returnToRoom: !!net && !net.spectator && !!connection && !connection.hidden && (!!connection.ended || connection.reconnecting), playerStatusVisible: visible,
      playerStatus: visible && net ? playerRows(net, context) : [], diagnostics: net ? formatNetplayDiagnostics(net, context, quality, now, options.translate) : {}});
    for (const listener of listeners) listener();
  }
  async function sampleQuality() {
    if (disposed || !runtime.getSnapshot().launched) return;
    const net = read(), transport = net?.peerState;
    if (!net || net.transport !== 'rtc' || !transport?.peers) {if (qualityTransport) resetQuality(); return;}
    if (qualityTransport !== transport) resetQuality(transport);
    if (sampling) return;
    sampling = true; const id = qualitySerial, token = runtime.getMidiEventContext();
    const current = () => !disposed && id === qualitySerial && runtime.getSnapshot().epoch === token?.epoch && runtime.getMidiEventContext()?.document === token?.document && read()?.peerState === transport;
    try {
      const seen = new Set<number>();
      for (const [peerId, peer] of transport.peers) {
        if (!peer?.pc || typeof peer.pc.getStats !== 'function') continue;
        seen.add(peerId); const stats = await peer.pc.getStats(); if (!current()) return;
        const pair = selectedRtcPair(stats), rttMs = Number(pair?.currentRoundTripTime) * 1000;
        let sample = quality.peers.get(peerId);
        if (!sample) {sample = {samples: [], rttMs: null, variationMs: null, connectionState: '', iceState: ''}; quality.peers.set(peerId, sample);}
        sample.connectionState = String(peer.pc.connectionState || ''); sample.iceState = String(peer.pc.iceConnectionState || '');
        if (Number.isFinite(rttMs) && rttMs >= 0) Object.assign(sample, appendRttSample(sample.samples, rttMs));
      }
      if (current()) for (const peerId of quality.peers.keys()) if (!seen.has(peerId)) quality.peers.delete(peerId);
    } catch { /* Original next sample reconciles disappeared peers. */ }
    finally {if (id === qualitySerial) sampling = false;}
  }
  function waitForGameplayPath(context: {isCurrent(): boolean}, timeoutMs = 120_000): Promise<void> {
    const token = runtime.getMidiEventContext(), deadline = now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const wait = {timer: null as number | null, reject}; waits.add(wait);
      const finish = (error?: Error) => {if (wait.timer !== null) timers.clearTimeout(wait.timer); waits.delete(wait); if (error) reject(error); else resolve();};
      const poll = () => {
        if (disposed || !context.isCurrent() || !runtime.getSnapshot().launched || !token || runtime.getSnapshot().epoch !== token.epoch || runtime.getMidiEventContext()?.document !== token.document) {finish(new RuntimeSessionSupersededError()); return;}
        if (now() >= deadline) {finish(new Error(options.translate('room.gameplayPathTimeout'))); return;}
        const net = read(), state = options.context();
        if (net?.failed) {finish(new Error(net.error || options.translate('room.unavailable'))); return;}
        if (net?.peerState && describeNetplayConnection({spectator: net.spectator, failed: net.failed, error: net.error, transport: net.transport, path: net.path, peerState: net.peerState, playerCount: state.playerCount, localPlayer: state.player, webSocketOpenState: 1}).hidden) {finish(); return;}
        wait.timer = timers.setTimeout(poll, 250);
      }; poll();
    });
  }
  const unsubscribe = runtime.subscribe(refresh);
  const displayTimer = timers.setInterval(() => {if (runtime.getSnapshot().launched) refresh();}, 250);
  const qualityTimer = timers.setInterval(() => {void sampleQuality();}, 1000);
  refresh();
  return {
    getSnapshot: () => snapshot, subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    refresh, readNativeSnapshot: read, sampleQuality, waitForGameplayPath,
    dispose() {disposed = true; resetQuality(); unsubscribe(); timers.clearInterval(displayTimer); timers.clearInterval(qualityTimer); for (const wait of waits) {if (wait.timer !== null) timers.clearTimeout(wait.timer); wait.reject(new RuntimeSessionSupersededError());} waits.clear(); listeners.clear();},
  };
}
