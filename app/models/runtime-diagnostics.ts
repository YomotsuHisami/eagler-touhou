import {compactDiagnosticText, compactRendererLabel, runtimeDiagnosticsVisibleByDefault} from '../../src/launcher/runtime-diagnostics-model.mts';
import type {RuntimeDiagnosticState} from '../../src/launcher/app-types.mts';
import type {RuntimeService} from '../services/runtime';

const preferenceKey = 'eagler-touhou-runtime-diagnostics-v1';
export interface RuntimeDiagnosticsSnapshot {
  enabled: boolean; visible: boolean; severity: '' | 'warn' | 'bad';
  browser: string; audio: string; renderer: string; frame: string;
}
export interface RuntimeDiagnosticsOptions {
  runtime: Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'subscribeEvents' | 'getMidiEventContext'>;
  browser: () => string;
  testBuild: () => boolean;
  frameLimit60: () => boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  translate(key: string, params?: Record<string, string | number>): string;
  window: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame' | 'setInterval' | 'clearInterval' | 'addEventListener' | 'removeEventListener'>;
  frame: Pick<HTMLIFrameElement, 'contentWindow'>;
  now?: () => number;
}
/** Main app2244–2312/2399–2420/2720–2749. Native messages arrive only through
 * the authenticated Runtime owner; this model never reads filesystem state. */
export function createRuntimeDiagnostics(options: RuntimeDiagnosticsOptions) {
  const {runtime, window: win} = options, now = options.now ?? (() => performance.now());
  const listeners = new Set<() => void>();
  let preference: boolean | null = null;
  try {const saved = options.storage?.getItem(preferenceKey); if (saved === '1' || saved === '0') preference = saved === '1';} catch {}
  let epoch = runtime.getSnapshot().epoch, serial = 0, disposed = false;
  let timer: number | null = null, hostFrame: number | null = null, childFrame: number | null = null;
  let child: Window | null = null, activeEpoch: number | null = null;
  const initial = (): RuntimeDiagnosticState => ({fps: null, maxGapMs: null, hostRafHz: null, childRafHz: null, minQueuedMs: null, backend: '', underruns: 0, robust: false, renderer: ''});
  let data = initial(), snapshot: Readonly<RuntimeDiagnosticsSnapshot>;
  function render() {
    if (disposed) return;
    const state = runtime.getSnapshot(), t = options.translate;
    const hz = (value: number | null) => value !== null && Number.isFinite(value) ? Math.round(value) : '--';
    const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
    const software = /SwiftShader|llvmpipe|software raster/i.test(data.renderer);
    const bad = software || data.underruns > 0 || (finite(data.minQueuedMs) && data.minQueuedMs < 5) || (finite(data.maxGapMs) && data.maxGapMs >= 80);
    const warn = !bad && ((finite(data.minQueuedMs) && data.minQueuedMs < 20) || (finite(data.maxGapMs) && data.maxGapMs >= 35));
    const audio = [finite(data.minQueuedMs) ? `${Math.max(0, Math.round(data.minQueuedMs))}ms` : '--', data.backend === 'worklet' ? 'AW' : data.backend === 'script' ? 'SP' : '', data.robust ? t('diagnostics.audioRobust') : '', data.underruns > 0 ? t('diagnostics.audioUnderruns', {count: data.underruns}) : ''].filter(Boolean).join(' ');
    const frame = [t('diagnostics.frameShort', {hz: hz(data.hostRafHz), age: ''}), `C${hz(data.childRafHz)}`, `P${hz(data.fps)}`, `gap ${finite(data.maxGapMs) ? `${Math.round(data.maxGapMs)}ms` : '--'}`, `lock ${options.frameLimit60() ? '60' : 'off'}`].join(' - ');
    snapshot = Object.freeze({enabled: preference ?? options.testBuild(), visible: runtimeDiagnosticsVisibleByDefault(options.testBuild(), state.launched, preference), severity: bad ? 'bad' : warn ? 'warn' : '', browser: compactDiagnosticText(t('diagnostics.browser', {value: options.browser()})), audio: compactDiagnosticText(t('diagnostics.audio', {value: audio})), renderer: compactDiagnosticText(t('diagnostics.graphics', {value: compactRendererLabel(data.renderer)})), frame: compactDiagnosticText(frame)});
    for (const listener of listeners) listener();
  }
  function stopProbe() {
    serial++; activeEpoch = null;
    if (timer !== null) win.clearInterval(timer);
    if (hostFrame !== null) win.cancelAnimationFrame(hostFrame);
    if (childFrame !== null) {try {child?.cancelAnimationFrame(childFrame);} catch { /* A retired document may no longer be same-origin. */ }}
    timer = hostFrame = childFrame = null; child = null;
  }
  function startProbe() {
    const state = runtime.getSnapshot();
    if (!state.launched || !state.firstFrame || activeEpoch === state.epoch) return;
    stopProbe(); const context = runtime.getMidiEventContext(); const target = options.frame.contentWindow;
    if (!context || !target?.requestAnimationFrame) return;
    const id = serial; activeEpoch = state.epoch; child = target;
    let hostStart = now(), childStart = hostStart, hosts = 0, children = 0;
    const current = () => !disposed && id === serial && runtime.getSnapshot().launched && options.frame.contentWindow === target && runtime.getMidiEventContext()?.document === context.document && runtime.getSnapshot().epoch === context.epoch;
    const host = () => {if (!current()) return; const time = now(); hosts++; if (time - hostStart >= 500) {data.hostRafHz = hosts * 1000 / (time - hostStart); hosts = 0; hostStart = time;} hostFrame = win.requestAnimationFrame(host);};
    const nested = () => {if (!current()) return; const time = now(); children++; if (time - childStart >= 500) {data.childRafHz = children * 1000 / (time - childStart); children = 0; childStart = time;} childFrame = target.requestAnimationFrame(nested);};
    hostFrame = win.requestAnimationFrame(host); childFrame = target.requestAnimationFrame(nested);
    timer = win.setInterval(() => {if (current()) render(); else stopProbe();}, 500);
  }
  const unsubscribe = runtime.subscribe(() => {
    const state = runtime.getSnapshot();
    if (state.epoch !== epoch) {epoch = state.epoch; stopProbe(); data = initial();}
    if (!state.launched) stopProbe(); else startProbe();
    render();
  });
  const unsubscribeEvents = runtime.subscribeEvents(message => {
    if (message.event === 'runtime-info' && typeof message.renderer === 'string') data.renderer = message.renderer;
    if (message.event === 'frame-health') {data.fps = Number.isFinite(Number(message.fps)) ? Number(message.fps) : null; data.maxGapMs = Number.isFinite(Number(message.maxGapMs)) ? Number(message.maxGapMs) : null;}
    if (message.event === 'audio-health') {data.minQueuedMs = Number.isFinite(Number(message.minQueuedMs)) ? Number(message.minQueuedMs) : null; data.backend = message.backend === 'worklet' ? 'worklet' : message.backend === 'script' ? 'script' : ''; data.underruns = Math.max(0, Number(message.underruns) || 0); data.robust = !!message.robust;}
    if (message.event === 'first-frame') startProbe();
    render();
  });
  const storageChanged = (event: Event) => {const change = event as StorageEvent; if (change.key !== preferenceKey) return; preference = change.newValue === '1' ? true : change.newValue === '0' ? false : null; render();};
  win.addEventListener('storage', storageChanged); render(); startProbe();
  return {
    getSnapshot: () => snapshot, subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    refresh: render,
    toggle() {preference = !(preference ?? options.testBuild()); try {options.storage?.setItem(preferenceKey, preference ? '1' : '0');} catch {} render();},
    dispose() {disposed = true; stopProbe(); unsubscribe(); unsubscribeEvents(); win.removeEventListener('storage', storageChanged); listeners.clear();},
  };
}
