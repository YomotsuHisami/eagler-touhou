import {compactRendererLabel, describeBrowserEnvironment, type BrowserEnvironmentInput} from '../../src/launcher/runtime-diagnostics-model.mts';
import {parseMeasuredNetplayTiming} from '../../src/contracts/netplay-timing.mts';
import type {NetworkActivitySnapshot} from '../../src/launcher/network-activity.mts';
import type {RuntimeSnapshot} from './runtime.client';

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown, limit = 256) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, limit) : null;
const choice = (value: unknown, allowed: readonly string[]) => typeof value === 'string' && allowed.includes(value) ? value : null;
const bool = (value: unknown) => typeof value === 'boolean' ? value : null;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const read = (value: object, name: string) => {try {return (value as Record<string, unknown>)[name];} catch {return undefined;}};

/** Allowlisted native values only. The caller must establish the current frame
 * and epoch identity. Never open a relay, data channel, stats loop or rAF clock. */
export function readPlayerNativeDiagnostics(target: object | null, multiplayer: boolean) {
  if (!target || !multiplayer) return null;
  const value = (name: string) => read(target, name);
  const module = record(value('Module')), options = module ? record(read(module, 'eaglerOptions')) : null;
  if (!options || read(options, 'netplayMode') !== 'lan') return null;
  const entries = (name: string, fields: readonly string[]) => {
    const rows = value(name);
    return Array.isArray(rows) ? rows.slice(0, 3).flatMap(raw => {
      const row = record(raw);if (!row) return [];
      return [Object.fromEntries(fields.map(key => [key, key === 'path' ? choice(read(row, key), ['direct', 'turn', 'relay', 'rtc', 'connecting'])
        : key === 'protocol' ? choice(read(row, key), ['udp', 'tcp', 'UDP', 'TCP'])
          : key === 'family' ? choice(read(row, key), ['IPv4', 'IPv6', 'ipv4', 'ipv6']) : number(read(row, key))]))];
    }) : [];
  };
  return Object.freeze({
    mode: 'lan', active: bool(value('__eaglerNetplayLanActive')), spectator: bool(value('__eaglerNetplaySpectator')),
    transport: choice(value('__eaglerNetplayTransport'), ['rtc', 'relay', 'spectator', 'connecting']), path: choice(value('__eaglerNetplayPath'), ['direct', 'turn', 'relay', 'rtc', 'connecting']),
    inputDelay: number(value('__eaglerNetplayInputDelayFrames')), frame: number(value('__eaglerNetplayLanFrame')),
    confirmed: typeof value('__eaglerNetplayLanConfirmed') === 'number' && Number(value('__eaglerNetplayLanConfirmed')) >= 0 && Number(value('__eaglerNetplayLanConfirmed')) < 0xffffffff ? number(value('__eaglerNetplayLanConfirmed')) : null, rollback: number(value('__eaglerNetplayLanRollback')),
    resimulated: number(value('__eaglerNetplayLanResimulated')), advantage: number(value('__eaglerNetplayLanFrameAdvantage')),
    pacing: number(value('__eaglerNetplayLanPacingScale')),
    // IP addresses, SDP, room URLs, credentials and arbitrary Runtime objects are excluded.
    rtcPaths: entries('__eaglerNetplayRtcPaths', ['peer', 'path', 'protocol', 'family']),
    peers: entries('__eaglerNetplayLanPeers', ['player', 'frame', 'gap', 'predicted', 'rollbacks']),
  });
}
export type PlayerNativeDiagnostics = ReturnType<typeof readPlayerNativeDiagnostics>;

export function createPlayerDiagnosticReport({runtime, network, native = null, browser = {}, scheduling = null, capturedAt = new Date().toISOString()}: {
  runtime: RuntimeSnapshot; network: NetworkActivitySnapshot; native?: PlayerNativeDiagnostics; browser?: BrowserEnvironmentInput; scheduling?: PlayerSchedulingSnapshot | null; capturedAt?: string;
}) {
  const environment = describeBrowserEnvironment(browser), renderer = text(runtime.runtimeInfo.renderer);
  const frame = {fps: number(runtime.frameHealth?.fps), maxGapMs: number(runtime.frameHealth?.maxGapMs), frameMs: number(runtime.frameHealth?.frameMs)};
  const audio = {queuedMs: number(runtime.audioHealth?.queuedMs), minQueuedMs: number(runtime.audioHealth?.minQueuedMs), backend: text(runtime.audioHealth?.backend, 32),
    underruns: number(runtime.audioHealth?.underruns), robust: bool(runtime.audioHealth?.robust)};
  const bad = !!renderer && /SwiftShader|llvmpipe|software raster/i.test(renderer) ||
    audio.underruns !== null && audio.underruns > 0 || audio.minQueuedMs !== null && audio.minQueuedMs < 5 || frame.maxGapMs !== null && frame.maxGapMs >= 80;
  const warn = audio.minQueuedMs !== null && audio.minQueuedMs < 20 || frame.maxGapMs !== null && frame.maxGapMs >= 35;
  return Object.freeze({
    schema: 'eagler-touhou/player-diagnostics/1', capturedAt,
    measurement: 'Native Runtime telemetry, separate browser scheduling samples and a point-in-time Launcher transfer snapshot. Missing values are unmeasured. Not physical-device acceptance.',
    session: {game: runtime.game, runtimeVariant: runtime.runtimeVariant ?? null, epoch: runtime.epoch, phase: runtime.phase,
      launched: runtime.launched, ready: runtime.ready, firstFrame: runtime.firstFrame, spectator: runtime.spectator},
    browser: {name: environment.browser === '未知' ? null : environment.browser, platform: text(browser.userAgentDataPlatform ?? browser.platform), userAgent: text(browser.userAgent, 512)},
    frame, audio, browserScheduling: {hostRafHz: number(scheduling?.hostRafHz), childRafHz: number(scheduling?.childRafHz)},
    renderer: {name: renderer, compact: compactRendererLabel(renderer), architecture: text(runtime.runtimeInfo.architecture), version: text(runtime.runtimeInfo.version)},
    health: bad ? 'bad' : warn ? 'warn' : [...Object.values(frame), ...Object.values(audio)].some(value => value !== null) ? 'reported' : 'unmeasured',
    network: {count: number(network.count), loaded: number(network.loaded), total: number(network.total),
      active: network.active.slice(0, 32).map(task => ({kind: text(task.kind, 48), phase: text(task.phase, 48), loaded: number(task.loaded), total: number(task.total)})),
      native: runtime.runtimeVariant === 'multiplayer' ? native : null,
      timing: runtime.runtimeVariant === 'multiplayer' ? parseMeasuredNetplayTiming(runtime.netplayTiming) : null},
  });
}
export type PlayerDiagnosticReport = ReturnType<typeof createPlayerDiagnosticReport>;
export const playerDiagnosticReportText = (report: PlayerDiagnosticReport) => JSON.stringify(report, null, 2);

export interface PlayerReportTransferPorts {
  copy?(text: string): Promise<void>;
  createUrl(text: string): string;
  revokeUrl(url: string): void;
}
/** Only a current open report can receive a clipboard completion. Object URLs
 * live until replacement/dismissal; no revocation race with a download click. */
export function createPlayerReportTransfer(ports: PlayerReportTransferPorts) {
  const listeners = new Set<() => void>();
  let disposed = false, ticket = 0, key: string | null = null, url: string | null = null;
  let state: {readonly status: 'idle' | 'copying' | 'copied' | 'failed'; readonly error: string | null} = Object.freeze({status: 'idle', error: null});
  function update(status: typeof state.status, error: string | null = null) {if (disposed) return;state = Object.freeze({status, error});for (const listener of [...listeners]) listener();}
  function clearUrl() {if (url !== null) {ports.revokeUrl(url);url = null;}}
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    setReport(nextKey: string | null) {if (key === nextKey) return;key = nextKey;ticket++;clearUrl();update('idle');},
    async copy(contents: string) {
      if (disposed || key === null || state.status === 'copying') return false;
      const attempt = ++ticket;update('copying');
      try {
        if (!ports.copy) throw new Error('Clipboard API unavailable');
        await ports.copy(contents);
        if (disposed || attempt !== ticket) return false;
        update('copied');return true;
      } catch (error) {if (!disposed && attempt === ticket) update('failed', error instanceof Error ? error.message : String(error));return false;}
    },
    download(contents: string) {
      if (disposed || key === null) return null;
      clearUrl();url = ports.createUrl(contents);return url;
    },
    dispose() {if (disposed) return;ticket++;clearUrl();disposed = true;listeners.clear();},
  });
}

export const PLAYER_DIAGNOSTICS_STORAGE_KEY = 'eagler-touhou-runtime-diagnostics-v1';
export interface PlayerDiagnosticsStorage {getItem(key: string): string | null; setItem(key: string, value: string): void}
export function createPlayerDiagnosticsPreference() {
  let storage: PlayerDiagnosticsStorage | null = null;
  let state: {readonly preference: boolean | null; readonly persistence: 'unknown' | 'local' | 'session'} = Object.freeze({preference: null, persistence: 'unknown'});
  const listeners = new Set<() => void>();
  function update(preference: boolean | null, persistence: typeof state.persistence) {
    if (state.preference === preference && state.persistence === persistence) return;
    state = Object.freeze({preference, persistence});for (const listener of [...listeners]) listener();
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    hydrate(nextStorage: PlayerDiagnosticsStorage | null) {
      storage = nextStorage;
      try {const saved = storage?.getItem(PLAYER_DIAGNOSTICS_STORAGE_KEY);update(saved === '1' ? true : saved === '0' ? false : null, storage ? 'local' : 'session');}
      catch {update(state.preference, 'session');}
    },
    setEnabled(enabled: boolean) {
      let persistence: typeof state.persistence = 'session';
      try {if (storage) {storage.setItem(PLAYER_DIAGNOSTICS_STORAGE_KEY, enabled ? '1' : '0');persistence = 'local';}} catch {}
      update(enabled, persistence);
    },
  });
}
export interface PlayerFrameScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}
export interface PlayerSchedulingSnapshot {readonly hostRafHz: number | null; readonly childRafHz: number | null}
/** One diagnostic owner, not a gameplay clock. Browser frame callbacks only
 * count samples; a host window publishes at most once per 500ms. */
export function createPlayerSchedulingSampler(ports: {
  host: PlayerFrameScheduler; child: PlayerFrameScheduler | null; current(): boolean; now(): number;
}) {
  const listeners = new Set<() => void>();
  let state: PlayerSchedulingSnapshot = Object.freeze({hostRafHz: null, childRafHz: null});
  let running = false, disposed = false, serial = 0, hostToken: number | null = null, childToken: number | null = null;
  let hostStart = 0, childStart = 0, hostCount = 0, childCount = 0, childHz: number | null = null;
  function publish(next: PlayerSchedulingSnapshot) {state = Object.freeze(next);for (const listener of [...listeners]) listener();}
  function stop() {
    running = false;serial++;
    if (hostToken !== null) ports.host.cancelAnimationFrame(hostToken);
    if (childToken !== null) ports.child?.cancelAnimationFrame(childToken);
    hostToken = childToken = null;hostCount = childCount = 0;childHz = null;
    if (state.hostRafHz !== null || state.childRafHz !== null) publish({hostRafHz: null, childRafHz: null});
  }
  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    start() {
      if (running || disposed || !ports.current()) return;
      running = true;const epoch = ++serial;hostStart = childStart = ports.now();
      const valid = () => running && !disposed && epoch === serial && ports.current();
      const host: FrameRequestCallback = () => {
        if (epoch !== serial || disposed) return;
        hostToken = null;if (!valid()) {stop();return;}
        hostCount++;const now = ports.now(), elapsed = now - hostStart;
        if (elapsed >= 500) {publish({hostRafHz: hostCount * 1000 / elapsed, childRafHz: childHz});hostCount = 0;hostStart = now;}
        if (valid()) hostToken = ports.host.requestAnimationFrame(host);
      };
      const child: FrameRequestCallback = () => {
        if (epoch !== serial || disposed) return;
        childToken = null;if (!valid()) {stop();return;}
        childCount++;const now = ports.now(), elapsed = now - childStart;
        if (elapsed >= 500) {childHz = childCount * 1000 / elapsed;childCount = 0;childStart = now;}
        if (valid() && ports.child) childToken = ports.child.requestAnimationFrame(child);
      };
      hostToken = ports.host.requestAnimationFrame(host);
      try {childToken = ports.child?.requestAnimationFrame(child) ?? null;} catch {childToken = null;}
    },
    stop,
    dispose() {if (disposed) return;stop();disposed = true;listeners.clear();},
  });
}
