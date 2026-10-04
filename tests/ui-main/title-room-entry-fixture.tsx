/** SYNTHETIC title/Router UI only. No game, Runtime bytes or relay is loaded.
 * The real room owner deliberately receives an unavailable test Host response. */
import {StrictMode, useLayoutEffect, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter, useLocation} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {HelpProvider, GlobalHelpPanel} from '../../app/components/HelpPanel';
import {NavigationDraftProvider} from '../../app/components/NavigationDrafts';
import {GameSettingsProvider} from '../../app/components/GameSettingsProvider';
import {LocaleProvider} from '../../app/components/LocaleProvider';
import {PlayerSurfaceProvider} from '../../app/runtime/PlayerToolsSurface';
import {TitleRoomEntry, useTitleRoomEntry} from '../../app/components/TitleRoomEntry';
import {DocumentRequestProvider} from '../../app/components/DocumentRequestProvider';
import {parseMultiplayerRoomRoute} from '../../app/services/multiplayer-room-route';
import {createMultiplayerRoom} from '../../app/services/multiplayer-room.client';
import type {RuntimeSnapshot, RuntimeService} from '../../app/services/runtime.client';
import type {RuntimeEventMessage} from '../../src/contracts/runtime-protocol.mts';
import {parseRuntimeInboundMessage, isRuntimeResponseMessage} from '../../src/contracts/runtime-protocol.mts';
import '../../app/styles.css';

let snapshot: RuntimeSnapshot = Object.freeze({phase: 'running', epoch: 7, game: 'th09', runtimeVariant: 'normal', ready: true, launched: true, firstFrame: true,
  fileOperationBusy: false, generationId: 'synthetic', codeGeneration: null, source: null, spectator: false, error: null, saveError: null,
  saveUnavailable: false, closeError: null, saveRoot: null, scoreFile: null, configFiles: [], runtimeInfo: {}, netplayTiming: null, progress: null, frameHealth: null, audioHealth: null, exit: null});
const listeners = new Set<() => void>(), events = new Set<(event: RuntimeEventMessage) => void>();
const calls = {cancel: 0, close: 0, roomChanges: 0, sockets: 0};
// The title component consumes only this bounded port; lifecycle integration is
// separately exercised with the real Runtime service in runtime-service.mjs.
const runtimePort: Pick<RuntimeService, 'getSnapshot' | 'subscribe' | 'subscribeEvents' | 'postInput' | 'close'> = {
  getSnapshot: () => snapshot,
  subscribe(callback) {listeners.add(callback);return () => {listeners.delete(callback);};},
  subscribeEvents(callback) {events.add(callback);return () => {events.delete(callback);};},
  postInput(command) {if (command === 'network-cancel') calls.cancel++;return true;},
  async close() {calls.close++;return false;},
};
const runtime = runtimePort as RuntimeService;
const room = createMultiplayerRoom({baseUrl: 'https://synthetic.invalid/', fetchImpl: async () => new Response(null, {status: 404}),
  createSocket() {calls.sockets++;throw Error('This UI fixture must never connect a relay');}});
let lastRoom: string | null = null;
function Harness() {
  const location = useLocation(), entry = useTitleRoomEntry(runtime), roomSnapshot = useSyncExternalStore(room.subscribe, room.getSnapshot);
  useLayoutEffect(() => {
    const selected = parseMultiplayerRoomRoute(location.pathname, location.search, entry.snapshot?.source?.epoch);
    entry.controller?.setRoute(selected); room.setRoute(selected);
    const key = selected && `${selected.productId}:${selected.roomCode}`; if (key !== lastRoom) {lastRoom = key;calls.roomChanges++;}
  }, [location, entry.controller, entry.snapshot?.source]);
  return <><main><h1>Synthetic native title entry</h1><p data-title-owner>{entry.controller ? 'Ready' : 'Loading'}</p><p data-route>{location.pathname}{location.search}</p>
    <iframe id="synthetic-title-frame" title="Synthetic retained title" srcDoc="<!doctype html><html><body><button>Title menu</button></body></html>"/>
  </main><TitleRoomEntry controller={entry.controller} snapshot={entry.snapshot} roomController={room} roomSnapshot={roomSnapshot} runtime={runtime}/></>;
}
window.__titleRoomFixture = {
  request(epoch = snapshot.epoch!) {
    const event = parseRuntimeInboundMessage({protocol: 'eagler-touhou/1', game: 'th09', epoch, event: 'network-request'}, 'th09', epoch);
    if (event && !isRuntimeResponseMessage(event) && event.event !== 'thprac-session') for (const callback of events) callback(event);
  },
  replace() {snapshot = Object.freeze({...snapshot, epoch: snapshot.epoch! + 1});for (const callback of listeners) callback();},
  inspect: () => ({...calls, epoch: snapshot.epoch, room: room.getSnapshot().route?.roomCode ?? null}),
};
const router = createBrowserRouter([{path: '*', element: <DocumentRequestProvider><LocaleProvider><PlayerSurfaceProvider><GameSettingsProvider storage={null}><NavigationDraftProvider><HelpProvider><Harness/><GlobalHelpPanel/></HelpProvider></NavigationDraftProvider></GameSettingsProvider></PlayerSurfaceProvider></LocaleProvider></DocumentRequestProvider>}]);
void router.navigate('/play/th09?uiLocale=en', {replace: true}).then(() => createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>));
declare global {interface Window {__titleRoomFixture: {request(epoch?: number): void; replace(): void; inspect(): {cancel: number; close: number; roomChanges: number; sockets: number; epoch: number | null; room: string | null}}}}
