/** SYNTHETIC title/Router/control transport only. No game, Runtime bytes or
 * live relay. Personal-seat UI uses an explicit confirmed synthetic seat. */
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
const host={schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'web-release',
  shared:{resourceMode:'hosted',vanillaFont:'shared/msgothic.ttc',unicodeFont:'shared/unifont.otf',netplayRelay:'wss://synthetic.invalid/netplay'},
  games:{th09:{runtime:'runtime/th09/th09.html',multiplayerRuntime:'runtime/th09/multiplayer/th09.html',
    gameData:{path:'th09.data',bytes:3,sha256:'a'.repeat(64),version:`sha256-${'a'.repeat(64)}`,layout:`sha256-${'b'.repeat(64)}`},music:{midi:{files:['01.mid']}},languages:[],languageOptions:[{id:'ja',pack:null}]}}};
class TitleSocket {
  private events=new EventTarget();
  readyState=0;
  addEventListener(type:'open'|'error',listener:()=>void):void;
  addEventListener(type:'message',listener:(event:{data:unknown})=>void):void;
  addEventListener(type:'close',listener:(event:{code:number})=>void):void;
  addEventListener(type:string,listener:Function) {this.events.addEventListener(type,listener as EventListener);}
  constructor(url:string) {const clientId=new URL(url).searchParams.get('lobby');queueMicrotask(()=>{
    this.readyState=1;this.events.dispatchEvent(new Event('open'));this.events.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'state',room:{playerCount:2,difficulty:1,visibility:'public',phase:'lobby',startSerial:0,inputDelay:0,settingsVersion:1,seats:[{clientId,name:'Synthetic host',loadout:0,ready:false},null],spectators:[]}})}));
  });}
  send() {} close(){this.readyState=3;}
}
const room = createMultiplayerRoom({baseUrl: 'https://synthetic.invalid/', fetchImpl: async () => Response.json(host),
  createSocket(url) {calls.sockets++;return new TitleSocket(url);}});
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
