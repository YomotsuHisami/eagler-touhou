/** CI-only full room -> captured plan -> real Runtime owner lifecycle.
 * The one iframe is a synthetic protocol peer; no relay, WASM, retail DATA or
 * persistence is used. Browser cases must not be reported as native acceptance. */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter, useLocation} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {LocaleProvider} from '../../app/components/LocaleProvider';
import {NavigationDraftProvider} from '../../app/components/NavigationDrafts';
import {GameSettingsProvider} from '../../app/components/GameSettingsProvider';
import {HelpProvider} from '../../app/components/HelpPanel';
import {PlayerSurfaceProvider} from '../../app/runtime/PlayerToolsSurface';
import {MultiplayerRoomView} from '../../app/components/MultiplayerRoom';
import {createMultiplayerRoom, type RoomSocket} from '../../app/services/multiplayer-room.client';
import {createMultiplayerLaunch} from '../../app/services/multiplayer-launch.client';
import {createRuntimeService, type RuntimePlan, type RuntimeService} from '../../app/services/runtime.client';
import {parseMultiplayerRoomRoute} from '../../app/services/multiplayer-room-route';
import {DEFAULT_GAME_OPTIONS} from '../../src/launcher/game-preferences.mts';
import type {PreferencesSnapshot} from '../../app/services/preferences.client';
import {RuntimeControlsForService} from '../../app/runtime/RuntimeControls';
import '../../app/styles.css';
const none = () => () => {}, empty = () => null;
const localId = 'synthetic_host_123', sent: Record<string, unknown>[] = [], traces: {command: string; options?: Record<string, unknown>}[] = [];
const makeRoom = (phase = 'lobby', serial = 0) => ({playerCount: 2, difficulty: 1, visibility: 'public', disableCheatMovement: false, phase, startSerial: serial,
  inputDelay: 0, adonisMode: 1, inputDelayAuto: false, predictionReserve: 2, settingsVersion: 1,
  seats: [{clientId: localId, name: 'Synthetic host', loadout: 0, ready: phase !== 'lobby'}, {clientId: 'synthetic_guest_456', name: 'Synthetic guest', loadout: 1, ready: phase !== 'lobby'}], spectators: []});
let socket: SyntheticSocket | null = null;
class SyntheticSocket implements RoomSocket {
  readyState = 1;
  listeners = new Map<string, Array<(event: never) => void>>();
  addEventListener(type: string, listener: (event: never) => void) {this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);}
  send(data: string) {sent.push(JSON.parse(data));}
  close() {this.readyState = 3;}
  message(value: unknown) {for (const listener of this.listeners.get('message') ?? []) listener({data: JSON.stringify(value)} as never);}
}
const host = {schema: 'eagler-touhou/host-manifest/1', protocol: 'eagler-touhou/1', profile: 'web-release', shared: {resourceMode: 'hosted', runtimeManifest: 'runtime-manifest.json', vanillaFont: 'font.ttf', unicodeFont: 'font.otf', netplayRelay: 'wss://synthetic.invalid/netplay'}, games: {th08: {runtime: 'runtime/th08/th08.html', multiplayerRuntime: 'runtime/th08/multiplayer/th08.html', gameData: {path: 'th08.dat', bytes: 2, sha256: 'a'.repeat(64), version: `sha256-${'a'.repeat(64)}`, layout: `sha256-${'b'.repeat(64)}`}, music: {midi: {files: []}}}}};
let preferences: PreferencesSnapshot = {productId: 'th08mp', preferenceId: 'th08', shareSingleplayerSettings: true, persistence: 'session', options: {...DEFAULT_GAME_OPTIONS}, language: 'ja', languages: [{id: 'ja', title: '日本語'}], music: 'none', musicPreference: 'none', musicPreferenceExplicit: true, musicModes: ['none'], features: {thprac: false, focusHitbox: false}};
const plan: RuntimePlan = {game: 'th08', runtimeVariant: 'multiplayer', publishedRuntime: true, entry: '/__ui_tests__/multiplayer-preflight-peer.html', configure: {music: 'none', options: {touchEnabled: false}},
  generation: {id: 'synthetic-preflight-package', game: 'th08', descriptor: {schema: 'eagler-touhou/package/1', game: 'th08', revision: 'synthetic', runtimeRequirement: {protocol: 'eagler-touhou/1', target: 'th08', dataFile: 'game-data'}, files: {'game-data': {source: 'th08.dat', target: '/th08.dat', bytes: 2, revision: 'synthetic'}}, base: {files: ['game-data']}, components: {}}, files: {'game-data': {objectId: 'synthetic-memory-only', revision: 'synthetic'}}}};
const room = createMultiplayerRoom({baseUrl: location.origin + '/', fetchImpl: async () => new Response(JSON.stringify(host)),
  createSocket: () => {const next = new SyntheticSocket(); socket = next; queueMicrotask(() => next.message({type: 'state', room: makeRoom()})); return next;},
  getMemberId: () => 'synthetic_member_123', identity: {loadDisplayName: () => 'Synthetic host', displayNameLocked: () => true, lobbyClientId: () => localId, storeDisplayNameOnce: () => ({stored: false, name: 'Synthetic host'})},
  sessions: {load: () => null, save() {}, clear() {}}, preferences: {load: () => ({shareSingleplayerSettings: true, preferredLoadout: 0}), persistPreferredLoadout() {}, persistShareSingleplayerSettings() {}},
  createNetwork: () => ({update() {}, reset() {}, receive: async () => {}, retry() {}, suspend() {}, minimumRtt: () => null,
    capabilities: () => ({supported: false, rtcAvailable: false, turnConfigured: false}), metric: () => ({rtt: null, jitter: null, state: 'unavailable', at: 0})}) as ReturnType<NonNullable<Parameters<typeof createMultiplayerRoom>[0]['createNetwork']>>,
});
function Fixture() {
  const frame = useRef<HTMLIFrameElement>(null), [runtime, setRuntime] = useState<RuntimeService | null>(null);
  const roomState = useSyncExternalStore(room.subscribe, room.getSnapshot), runtimeState = useSyncExternalStore(runtime?.subscribe ?? none, runtime?.getSnapshot ?? empty), route = useLocation();
  useEffect(() => {
    const element = frame.current!, proxy = element.contentWindow, retains: string[] = [], releases: string[] = [];
    const owner = createRuntimeService({frame: element, baseUrl: location.origin + '/', timeouts: {firstFrame: 5000}, dependencies: {
      retainGeneration: async (_game, _generation, {leaseId}) => {retains.push(leaseId); return leaseId;}, releaseGeneration: async leaseId => {releases.push(leaseId);},
      readData: async () => ({buffer: new Uint8Array([1, 2]).buffer, bytes: 2, fileId: 'game-data'}), readResource: async () => {throw Error('No synthetic resource writes');},
      prepareCode: async entry => ({url: new URL(entry, location.origin).href, generation: 'a'.repeat(64), cached: false}),
    }});
    const launcher = createMultiplayerLaunch({baseUrl: location.origin + '/', runtimeService: owner, getPreferences: () => preferences,
      confirmInputWarnings: async () => true, onRuntimeEnd: active => room.runtimeExited(active.serial), buildPlan: async () => structuredClone(plan)});
    const trace = (event: MessageEvent) => {if (event.source === element.contentWindow && event.origin === location.origin && event.data?.syntheticPreflightTrace) traces.push({command: event.data.command, options: event.data.options});};
    window.addEventListener('message', trace); room.setRuntimePort(launcher); setRuntime(owner);
    window.__multiplayerPreflightFixture = {
      firstFrame: () => element.contentWindow?.postMessage({syntheticAction: 'first-frame'}, location.origin),
      stale: () => element.contentWindow?.postMessage({syntheticAction: 'stale'}, location.origin),
      fail: () => element.contentWindow?.postMessage({syntheticAction: 'error'}, location.origin),
      close: () => owner.close(),
      navigate: to => router.navigate(to),
      changePreferences() {preferences = {...preferences, options: {...preferences.options, alwaysHitbox: !preferences.options.alwaysHitbox}}; room.invalidatePreparation();},
      start() {socket?.message({type: 'start', serial: 1, room: makeRoom('starting', 1)});},
      inspect: () => ({room: room.getSnapshot(), runtime: owner.getSnapshot(), sameFrame: frame.current === element, sameProxy: element.contentWindow === proxy, retains: retains.length, releases: releases.length, sent: structuredClone(sent), traces: structuredClone(traces), historyLength: history.length, childUrl: element.contentWindow?.location.href}),
    };
    return () => {window.removeEventListener('message', trace); room.dispose(); launcher.dispose(); if (!element.isConnected) owner.disposeDetachedFrame();};
  }, []);
  useEffect(() => {room.setRoute(parseMultiplayerRoomRoute(route.pathname, route.search));}, [route]);
  return <><main id="main-content"><p data-preflight-runtime-phase>{runtimeState?.phase ?? 'idle'}</p><iframe ref={frame} data-preflight-frame title="Synthetic multiplayer engine peer"/></main>
    {roomState.route && <MultiplayerRoomView controller={room} snapshot={roomState}/>}<RuntimeControlsForService service={runtime}/></>;
}
const router = createBrowserRouter([{path: '*', element: <LocaleProvider><PlayerSurfaceProvider><GameSettingsProvider storage={null}><NavigationDraftProvider><HelpProvider><Fixture/></HelpProvider></NavigationDraftProvider></GameSettingsProvider></PlayerSurfaceProvider></LocaleProvider>}]);
void router.navigate('/play/th08mp?uiLocale=en&mpRoom=1234&kept=a%2Bb#room', {replace: true}).then(() => createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>));
declare global {interface Window {__multiplayerPreflightFixture: {
  firstFrame(): void; stale(): void; fail(): void; close(): Promise<boolean>; navigate(to: string): ReturnType<typeof router.navigate>; changePreferences(): void; start(): void;
  inspect(): {room: ReturnType<typeof room.getSnapshot>; runtime: ReturnType<RuntimeService['getSnapshot']>; sameFrame: boolean; sameProxy: boolean; retains: number; releases: number; sent: Record<string, unknown>[]; traces: {command: string; options?: Record<string, unknown>}[]; historyLength: number; childUrl: string | undefined};
}}}
