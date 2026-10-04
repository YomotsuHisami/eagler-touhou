/** CI-only synthetic room UI. No game bytes, real Runtime, relay or browser
 * execution in local validation. The room owner receives a fixed unavailable Host. */
import {StrictMode, useLayoutEffect, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter, useLocation} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {LocaleProvider} from '../../app/components/LocaleProvider';
import {NavigationDraftProvider} from '../../app/components/NavigationDrafts';
import {GameSettingsProvider} from '../../app/components/GameSettingsProvider';
import {HelpProvider, GlobalHelpPanel} from '../../app/components/HelpPanel';
import {PlayerSurfaceProvider} from '../../app/runtime/PlayerToolsSurface';
import {MultiplayerRoomView} from '../../app/components/MultiplayerRoom';
import {createMultiplayerRoom} from '../../app/services/multiplayer-room.client';
import {parseMultiplayerRoomRoute} from '../../app/services/multiplayer-room-route';
import '../../app/styles.css';
let joins = 0, leaves = 0, sockets = 0, requests = 0, holdNext = false;
const held: Array<() => void> = [], copied: string[] = [];
let copyMode: 'missing' | 'reject' | 'fail' = 'missing';
const room = createMultiplayerRoom({baseUrl: 'https://synthetic.invalid/', fetchImpl: async () => {requests++;return new Response(null, {status: 404});},
  createSocket() {sockets++;throw Error('Synthetic fixture must never connect to a relay');}});
let identity: string | null = null;
Object.defineProperty(navigator, 'clipboard', {configurable: true, get: () => copyMode === 'missing' ? undefined : {writeText: async () => {throw Error('Synthetic Clipboard API rejected');}}});
Object.defineProperty(document, 'execCommand', {configurable: true, value: (command: string) => {
  if (command !== 'copy' || !(document.activeElement instanceof HTMLTextAreaElement)) throw Error('Expected selected fallback textarea');
  copied.push(document.activeElement.value);return copyMode !== 'fail';
}});
function Harness() {
  const location = useLocation(), snapshot = useSyncExternalStore(room.subscribe, room.getSnapshot);
  useLayoutEffect(() => {
    const selected = parseMultiplayerRoomRoute(location.pathname, location.search), next = selected && `${selected.productId}:${selected.roomCode}`;
    if (identity !== next) {if (identity) leaves++;if (next) joins++;identity = next;}
    room.setRoute(selected);
  }, [location]);
  return <><main id="main-content" tabIndex={-1}><h1>Synthetic room controls</h1><p data-room-route>{location.pathname}{location.search}{location.hash}</p>
    <iframe id="retained-room-frame" title="Synthetic retained frame" srcDoc="<!doctype html><html><body>Empty identity marker</body></html>"/>
  </main>{snapshot.route && <MultiplayerRoomView controller={room} snapshot={{...snapshot, error: null}}/>}<GlobalHelpPanel/></>;
}
const router = createBrowserRouter([{path: '*', element: <LocaleProvider><PlayerSurfaceProvider><GameSettingsProvider storage={null}><NavigationDraftProvider><HelpProvider><Harness/></HelpProvider></NavigationDraftProvider></GameSettingsProvider></PlayerSurfaceProvider></LocaleProvider>}], {
  dataStrategy: async ({request}) => {
    const query = new URL(request.url).searchParams;
    if (holdNext && (query.has('roomPanel') || query.has('roomOptions'))) {holdNext = false;await new Promise<void>(resolve => {held.push(resolve);});}
    return {};
  },
});
const initial = new URLSearchParams(location.search).get('initial') ?? '/play/th06mp?uiLocale=en&mpRoom=1234&room=1234&extra=a%2Bb#kept';
window.__roomPanelsFixture = {
  holdNext() {holdNext = true;}, release() {const release = held.shift();if (!release) throw Error('No held navigation');release();},
  navigate(to: string | number) {return typeof to === 'number' ? router.navigate(to) : router.navigate(to);},
  copyMode(mode: 'missing' | 'reject' | 'fail') {copyMode = mode;},
  inspect() {return {joins, leaves, sockets, requests, held: held.length, copied: [...copied], roomCode: room.getSnapshot().route?.roomCode ?? null};},
};
void router.navigate(initial, {replace: true}).then(() => createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>));
declare global {interface Window {__roomPanelsFixture: {
  holdNext(): void; release(): void; navigate(to: string | number): ReturnType<typeof router.navigate>; copyMode(mode: 'missing' | 'reject' | 'fail'): void;
  inspect(): {joins: number; leaves: number; sockets: number; requests: number; held: number; copied: string[]; roomCode: string | null};
}}}
