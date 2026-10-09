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
import {RoomSettingsPolicyProvider} from '../../app/components/RoomSettingsPolicy';
import {createMultiplayerRoom} from '../../app/services/multiplayer-room.client';
import {normalizeMultiplayerLobbySnapshot} from '../../src/launcher/multiplayer-lobby-snapshot.mts';
import {multiplayerConfigForProduct} from '../../src/contracts/product-catalog.mts';
import {parseMultiplayerRoomRoute} from '../../app/services/multiplayer-room-route';
import {createRoomPanelClock} from './room-panels-clock';
import '../../app/styles.css';
/* Keep route diagnostics and the identity-preserving iframe in the DOM while
 * presenting the room as the actual full-screen route it represents. */
const fixtureStyle = document.createElement('style');
fixtureStyle.textContent = '#main-content { display: none; }';
document.head.append(fixtureStyle);
const populated = new URLSearchParams(location.search).get('populated') === '1';
const restricted = new URLSearchParams(location.search).get('restricted') === '1';
let joins = 0, leaves = 0, sockets = 0, requests = 0, holdNext = false;
const held: Array<() => void> = [], copied: string[] = [];
let copyMode: 'missing' | 'reject' | 'fail' = 'missing';
const roomClock = createRoomPanelClock();
const room = createMultiplayerRoom({baseUrl: 'https://synthetic.invalid/', timers: roomClock, now: roomClock.now, random: () => 0, fetchImpl: async () => {requests++;return new Response(null, {status: 404});},
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
  const policy = snapshot.route && multiplayerConfigForProduct(snapshot.route.productId);
  const displayRoom = populated && policy ? normalizeMultiplayerLobbySnapshot({playerCount: 2, difficulty: 1, visibility: 'public', disableCheatMovement: restricted, inputDelay: 2, phase: 'lobby',
    seats: [{clientId: 'synthetic_host_123', name: 'Sample host', loadout: 0, ready: true, resource: {status: 'ready', stage: 'package', percent: 100}, controlMode: 'normal'},
      {clientId: 'synthetic_guest_456', name: 'Sample guest', loadout: 1, ready: false, resource: {status: 'preparing', stage: 'package', percent: 65}, controlMode: 'touch'}],
    spectators: [{clientId: 'synthetic_viewer_789', name: 'Sample viewer'}]}, {localClientId: 'synthetic_host_123', playerCounts: policy.playerCounts, difficulties: policy.difficulties, loadouts: policy.loadouts}) : null;
  const display = displayRoom ? {...snapshot, connection: 'connected' as const, room: displayRoom, clientId: 'synthetic_host_123', displayName: 'Sample host', nameLocked: true,
    runtimeAvailable: true, preparation: {status: 'ready' as const, stage: 'package' as const, percent: 100}, error: null} : {...snapshot, error: null};
  return <RoomSettingsPolicyProvider productId={display.route?.productId ?? null} movementRestricted={display.room?.disableCheatMovement === true && display.room.localSeat != null}><main id="main-content" tabIndex={-1}><h1>Synthetic room controls</h1><p data-room-route className="max-w-full break-all">{location.pathname}{location.search}{location.hash}</p>
    <iframe id="retained-room-frame" title="Synthetic retained frame" srcDoc="<!doctype html><html><body>Empty identity marker</body></html>"/>
  </main>{snapshot.route && <MultiplayerRoomView controller={room} snapshot={display}/>}<GlobalHelpPanel/></RoomSettingsPolicyProvider>;
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
  async advanceRoomTime(milliseconds: number) {roomClock.advance(milliseconds);await Promise.resolve();},
  inspect() {return {joins, leaves, sockets, requests, held: held.length, copied: [...copied], roomCode: room.getSnapshot().route?.roomCode ?? null};},
};
void router.navigate(initial, {replace: true}).then(() => createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>));
declare global {interface Window {__roomPanelsFixture: {
  holdNext(): void; release(): void; navigate(to: string | number): ReturnType<typeof router.navigate>; copyMode(mode: 'missing' | 'reject' | 'fail'): void; advanceRoomTime(milliseconds: number): Promise<void>;
  inspect(): {joins: number; leaves: number; sockets: number; requests: number; held: number; copied: string[]; roomCode: string | null};
}}}
