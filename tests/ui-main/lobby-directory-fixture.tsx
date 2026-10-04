/** Source-owned synthetic directory rows and forms. No real service, relay,
 * Host, package, Runtime, user room names or account data are used. */
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter, useLocation} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {LocaleProvider} from '../../app/components/LocaleProvider';
import {LauncherShell} from '../../app/components/LauncherShell';
import {LobbyDirectorySurface} from '../../app/components/LobbyDirectory';
import {PlayerSurfaceProvider} from '../../app/runtime/PlayerToolsSurface';
import {MotionPreferenceProvider} from '../../app/components/MotionPreferenceProvider';
import type {LobbyDirectoryController, LobbyDirectorySnapshot, LobbyRoom} from '../../app/services/lobby-directory.client';
import {isMultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import '../../app/styles.css';
let commands = 0;
const unused = () => {commands++;};
const controller: LobbyDirectoryController = {
  subscribe: () => () => {}, getSnapshot: () => {throw Error('Synthetic view receives an explicit snapshot');},
  setActive: unused, refresh: unused, retry: unused, networkChanged: unused, dispose: unused,
  releaseMembership: () => {commands++;return false;},
  createRoomIntent: () => {commands++;throw Error('This visual fixture never creates a room');},
  joinRoomIntent: () => {commands++;throw Error('This visual fixture never joins a room');},
};
function DirectoryEvidence() {
  const location = useLocation(), query = new URLSearchParams(location.search), requested = query.get('game');
  const product = requested && isMultiplayerProductId(requested) ? requested : 'th06mp';
  const rooms: LobbyRoom[] = query.get('empty') === '1' ? [] : [
    {product, code: '4321', capacity: 2, players: 1, ready: 1, difficulty: 1, spectators: 1, phase: 'lobby', joinable: true, disableCheatMovement: false,
      seats: [{initial: 'A', ready: true, online: true, controlMode: 'normal'}, null]},
    {product, code: '5234', capacity: 2, players: 2, ready: 1, difficulty: 2, spectators: 0, phase: 'lobby', joinable: false, disableCheatMovement: true,
      seats: [{initial: 'B', ready: true, online: true, controlMode: 'touch'}, {initial: 'C', ready: false, online: false, controlMode: 'normal'}]},
    {product, code: '6042', capacity: 2, players: 2, ready: 2, difficulty: 0, spectators: 2, phase: 'playing', joinable: false, disableCheatMovement: false,
      seats: [{initial: 'D', ready: true, online: true, controlMode: 'normal'}, {initial: 'E', ready: true, online: true, controlMode: 'cheat'}]},
  ];
  const snapshot: LobbyDirectorySnapshot = {active: true, connection: 'live', diagnosticRelayUrl: null, products: ['th06mp', 'th07mp', 'th08mp', 'th09mp', 'th10mp'],
    selectedProduct: product, loadedProduct: product, rooms, total: rooms.length, mine: null, supportsRecovery: true, recovering: false, notice: null, error: null};
  return <LobbyDirectorySurface controller={controller} snapshot={snapshot}/>;
}
const router = createBrowserRouter([{path: '*', element: <LocaleProvider><MotionPreferenceProvider><PlayerSurfaceProvider><LauncherShell><DirectoryEvidence/></LauncherShell></PlayerSurfaceProvider></MotionPreferenceProvider></LocaleProvider>}]);
const initial = new URLSearchParams(location.search).get('initial') ?? '/lobby?uiLocale=en&game=th06mp';
window.__directoryEvidence = {inspect: () => ({commands, sourceOwned: true}), navigate: to => router.navigate(to)};
void router.navigate(initial, {replace: true}).then(() => createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router}/></StrictMode>));
declare global {interface Window {__directoryEvidence: {inspect(): {commands: number; sourceOwned: boolean}; navigate(to: string): ReturnType<typeof router.navigate>}}}
