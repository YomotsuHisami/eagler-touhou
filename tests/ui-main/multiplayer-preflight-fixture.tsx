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
import {createPreflightRoomFixture, makePreflightRoom, preflightPlan, preflightCodeGeneration} from './multiplayer-preflight-model';
import {createMultiplayerLaunch} from '../../app/services/multiplayer-launch.client';
import {createRuntimeService, type RuntimeService} from '../../app/services/runtime.client';
import {parseMultiplayerRoomRoute} from '../../app/services/multiplayer-room-route';
import {DEFAULT_GAME_OPTIONS} from '../../src/launcher/game-preferences.mts';
import type {PreferencesSnapshot} from '../../app/services/preferences.client';
import {RuntimeControlsForService} from '../../app/runtime/RuntimeControls';
import '../../app/styles.css';
const none = () => () => {}, empty = () => null;
const traces: {command: string; options?: Record<string, unknown>}[] = [];
let preferences: PreferencesSnapshot = {productId: 'th08mp', preferenceId: 'th08', shareSingleplayerSettings: true, persistence: 'session', options: {...DEFAULT_GAME_OPTIONS}, language: 'ja', languages: [{id: 'ja', title: '日本語'}], music: 'none', musicPreference: 'none', musicPreferenceExplicit: true, musicModes: ['none'], features: {thprac: false, focusHitbox: false}};
const {room, sent, getSocket} = createPreflightRoomFixture({baseUrl: location.origin + '/'});
function Fixture() {
  const frame = useRef<HTMLIFrameElement>(null), [runtime, setRuntime] = useState<RuntimeService | null>(null);
  const roomState = useSyncExternalStore(room.subscribe, room.getSnapshot), runtimeState = useSyncExternalStore(runtime?.subscribe ?? none, runtime?.getSnapshot ?? empty), route = useLocation();
  useEffect(() => {
    const element = frame.current!, proxy = element.contentWindow, retains: string[] = [], releases: string[] = [];
    const owner = createRuntimeService({frame: element, baseUrl: location.origin + '/', timeouts: {firstFrame: 5000}, dependencies: {
      retainGeneration: async (_game, _generation, {leaseId}) => {retains.push(leaseId); return leaseId;}, releaseGeneration: async leaseId => {releases.push(leaseId);},
      readData: async () => ({buffer: new Uint8Array([1, 2]).buffer, bytes: 2, fileId: 'game-data'}), readResource: async () => {throw Error('No synthetic resource writes');},
      prepareCode: async entry => ({url: new URL(entry, location.origin).href, generation: preflightCodeGeneration, cached: false}),
    }});
    const launcher = createMultiplayerLaunch({baseUrl: location.origin + '/', runtimeService: owner, getPreferences: () => preferences,
      dependencies: {readCurrent: async () => ({installation: {game: 'th08', currentGeneration: preflightPlan.generation.id, pendingGeneration: null, source: 'local'}, generation: preflightPlan.generation})},
      confirmInputWarnings: async () => true, onRuntimeEnd: active => room.runtimeExited(active.serial), buildPlan: async () => structuredClone(preflightPlan)});
    const trace = (event: MessageEvent) => {if (event.source === element.contentWindow && event.origin === location.origin && event.data?.syntheticPreflightTrace) traces.push({command: event.data.command, options: event.data.options});};
    window.addEventListener('message', trace); room.setRuntimePort(launcher); setRuntime(owner);
    window.__multiplayerPreflightFixture = {
      firstFrame: () => element.contentWindow?.postMessage({syntheticAction: 'first-frame'}, location.origin),
      gameplayPath: () => element.contentWindow?.postMessage({syntheticAction: 'gameplay-path'}, location.origin),
      stale: () => element.contentWindow?.postMessage({syntheticAction: 'stale'}, location.origin),
      fail: () => element.contentWindow?.postMessage({syntheticAction: 'error'}, location.origin),
      close: () => owner.close(),
      navigate: to => router.navigate(to),
      changePreferences() {preferences = {...preferences, options: {...preferences.options, alwaysHitbox: !preferences.options.alwaysHitbox}}; room.invalidatePreparation();},
      start() {getSocket()?.message({type: 'start', serial: 1, room: makePreflightRoom('starting', 1)});},
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
  firstFrame(): void; gameplayPath(): void; stale(): void; fail(): void; close(): Promise<boolean>; navigate(to: string): ReturnType<typeof router.navigate>; changePreferences(): void; start(): void;
  inspect(): {room: ReturnType<typeof room.getSnapshot>; runtime: ReturnType<RuntimeService['getSnapshot']>; sameFrame: boolean; sameProxy: boolean; retains: number; releases: number; sent: Record<string, unknown>[]; traces: {command: string; options?: Record<string, unknown>}[]; historyLength: number; childUrl: string | undefined};
}}}
