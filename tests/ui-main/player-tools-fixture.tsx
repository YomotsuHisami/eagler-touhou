/** CI-only synthetic DOM evidence. The single iframe stays empty. Fullscreen,
 * clipboard, downloads and telemetry are injected; no real Runtime or network. */
import {StrictMode, useEffect, useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter, Link, useLocation} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {MotionConfig} from 'motion/react';
import {LocaleProvider} from '../../app/components/LocaleProvider';
import {HelpProvider, GlobalHelpPanel} from '../../app/components/HelpPanel';
import {PlayerToolsForService} from '../../app/runtime/PlayerTools';
import {PlayerSurfaceProvider, usePlayerSurface} from '../../app/runtime/PlayerToolsSurface';
import type {RuntimeService, RuntimeSnapshot} from '../../app/services/runtime.client';
import '../../app/styles.css';

let frame: HTMLIFrameElement | null = null, firstFrame: HTMLIFrameElement | null = null, firstDocument: Document | null = null;
let fullscreenElement: Element | null = null, mode: 'success' | 'deny' | 'hold' = 'success';
let pendingFullscreen: (() => void) | null = null, pendingCopy: (() => void) | null = null;
let copyMode: 'success' | 'deny' | 'hold' = 'success';
const calls = {nativeEnter: 0, parentEnter: 0, requests: 0, exits: 0, locks: 0, unlocks: 0, copies: [] as string[], downloads: 0, urls: [] as string[], revoked: [] as string[], inputs: [] as unknown[]};
let state: RuntimeSnapshot = Object.freeze({phase: 'running', game: 'th06', runtimeVariant: 'normal', epoch: 1, generationId: 'synthetic', codeGeneration: null,
  source: null, ready: true, launched: true, firstFrame: true, spectator: false, error: null, saveError: null, saveUnavailable: false, closeError: null,
  fileOperationBusy: false, saveRoot: null, scoreFile: null, configFiles: [], runtimeInfo: {renderer: 'Synthetic renderer', architecture: 'wasm32'},
  netplayTiming: null, progress: null, frameHealth: {fps: 60, maxGapMs: 17}, audioHealth: {backend: 'worklet', minQueuedMs: 50, underruns: 0}, exit: null});
const listeners = new Set<() => void>();
const unavailable = () => {throw new Error('Synthetic player fixture has no Runtime or network');};
const service: RuntimeService = {
  subscribeEvents: () => () => {},
    getSnapshot: () => state, subscribe: callback => {listeners.add(callback);return () => {listeners.delete(callback);};},
  getInputContext: () => ({target: frame?.contentWindow ?? null, targetOrigin: location.origin, protocol: 'synthetic-only', game: 'th06', epoch: state.epoch ?? 0, ready: state.ready, launched: state.launched, spectator: state.spectator}),
  getLauncherControlContext: () => null, getMidiEventContext: () => null,
  getNetworkSnapshot: () => ({count: 0, loaded: 0, total: 0, active: []}), postInput: (command, payload) => {calls.inputs.push({command,...payload});return true;},
  prepare: unavailable, launch: unavailable, close: unavailable, sync: unavailable, send: unavailable, withFileSession: unavailable,
  cancel: unavailable, dispose: unavailable, disposeDetachedFrame: unavailable, extendOggResources: unavailable,
};
Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => fullscreenElement});
Object.defineProperty(document, 'exitFullscreen', {configurable: true, value: async () => {calls.exits++;fullscreenElement = null;document.dispatchEvent(new Event('fullscreenchange'));}});
Object.defineProperty(navigator, 'keyboard', {configurable: true, value: {lock: async () => {calls.locks++;}, unlock: () => {calls.unlocks++;}}});
Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async (value: string) => {
  calls.copies.push(value);if (copyMode === 'deny') throw new Error('Synthetic clipboard denied');if (copyMode === 'hold') await new Promise<void>(resolve => {pendingCopy = resolve;});
}}});
const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => {const url = createUrl(blob);calls.urls.push(url);return url;};
URL.revokeObjectURL = url => {calls.revoked.push(url);revokeUrl(url);};
HTMLAnchorElement.prototype.click = function () {if (this.download) {calls.downloads++;return;}};
function SyntheticScreen() {
  const runtime = useSyncExternalStore(service.subscribe, service.getSnapshot), frameRef = useRef<HTMLIFrameElement>(null);
  const surface = usePlayerSurface(), location = useLocation();
  const compact = new URLSearchParams(location.search).get('compact') === '1';
  useLayoutEffect(() => {frame = frameRef.current;firstFrame ??= frame;firstDocument ??= frame?.contentDocument ?? null;}, []);
  useEffect(() => {
    const nativeDocument = frameRef.current?.contentDocument;
    const native = (event: KeyboardEvent) => {if (event.code === 'Enter') calls.nativeEnter++;};
    const parent = (event: KeyboardEvent) => {if (event.code === 'Enter') calls.parentEnter++;};
    nativeDocument?.addEventListener('keydown', native);nativeDocument?.addEventListener('keyup', native);
    window.addEventListener('keydown', parent);window.addEventListener('keyup', parent);
    return () => {nativeDocument?.removeEventListener('keydown', native);nativeDocument?.removeEventListener('keyup', native);window.removeEventListener('keydown', parent);window.removeEventListener('keyup', parent);};
  }, []);
  useEffect(() => {
    const target = surface?.element;if (!target) return;
    Object.defineProperty(target, 'requestFullscreen', {configurable: true, value: async () => {
      calls.requests++;if (mode === 'deny') throw new Error('Synthetic fullscreen blocked');
      if (mode === 'hold') await new Promise<void>(resolve => {pendingFullscreen = resolve;});
      fullscreenElement = target;document.dispatchEvent(new Event('fullscreenchange'));
    }});
  }, [surface?.element]);
  return <HelpProvider runtimeFocus={{service, frame: frameRef}}><main id="main-content" tabIndex={-1} className="p-6 text-paper">
    <h1>Synthetic player tools: no game execution</h1>
    <div role="toolbar" aria-label="Synthetic player tools" className={compact ? 'fixed top-2 right-2 grid h-12 w-[104px] grid-cols-2 gap-2' : 'my-5 flex flex-wrap gap-2'}>
      <PlayerToolsForService service={service} frame={frameRef} snapshot={runtime} compact={compact} testBuild={new URLSearchParams(location.search).get('testBuild') === '1'}/><button type="button">Exit marker</button>
    </div>
    <iframe ref={frameRef} title="Synthetic empty Runtime frame" className="mt-20 h-28 w-60 border"/>
    <p data-testid="player-location">{location.pathname}{location.search}</p>
    <Link to={`${location.pathname}?uiLocale=en&step=other`} id="different-route">Different location</Link>
    <button id="other-focus" type="button">Another focus destination</button>
    <GlobalHelpPanel/>
  </main></HelpProvider>;
}
function Fixture() {return <LocaleProvider initialLocale="en"><MotionConfig reducedMotion="user"><PlayerSurfaceProvider><SyntheticScreen/></PlayerSurfaceProvider></MotionConfig></LocaleProvider>;}
window.__playerToolsFixture = {
  mode(value) {mode = value;}, copyMode(value) {copyMode = value;},
  resolveFullscreen() {pendingFullscreen?.();pendingFullscreen = null;}, resolveCopy() {pendingCopy?.();pendingCopy = null;},
  setSession(patch) {state = Object.freeze({...state, ...patch});for (const notify of listeners) notify();},
  escapeFullscreen() {fullscreenElement = null;document.dispatchEvent(new Event('fullscreenchange'));},
  inspect() {return {calls: structuredClone(calls), sameFrame: frame === firstFrame, sameDocument: frame?.contentDocument === firstDocument,
    fullscreen: fullscreenElement === document.querySelector('[data-player-surface]'), frameFocused: document.activeElement === frame,
    dialogInsideSurface: !!document.querySelector('[data-player-surface] [role="dialog"]')};},
};
declare global {interface Window {__playerToolsFixture: {
  mode(value: 'success' | 'deny' | 'hold'): void; copyMode(value: 'success' | 'deny' | 'hold'): void;
  resolveFullscreen(): void; resolveCopy(): void; setSession(patch: Partial<RuntimeSnapshot>): void; escapeFullscreen(): void;
  inspect(): {calls: typeof calls; sameFrame: boolean; sameDocument: boolean; fullscreen: boolean; frameFocused: boolean; dialogInsideSurface: boolean};
}}}
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={createBrowserRouter([{path: '*', Component: Fixture}])}/></StrictMode>);
