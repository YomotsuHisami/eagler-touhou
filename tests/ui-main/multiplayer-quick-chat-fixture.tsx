/** Synthetic presentation only: no Runtime, room provider, iframe game, or relay. */
import {StrictMode, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PlayerSurfaceProvider, usePlayerSurface} from '../../app/runtime/PlayerToolsSurface';
import {MultiplayerQuickChatView} from '../../app/runtime/MultiplayerQuickChat';
import {QUICK_CHAT_PHRASES, quickChatPhrase} from '../../src/contracts/multiplayer-quick-chat.mts';
import type {MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import type {MultiplayerRoomSnapshot} from '../../app/services/multiplayer-room.client';
import type {RuntimeLauncherControlContext, RuntimeSnapshot} from '../../app/services/runtime.client';
import type {RoomQuickChatEvent} from '../../app/services/multiplayer-room.client';
import '../../app/styles.css';

type Identity = {room: string; roomCode: string; serial: number; sessionSerial: number};
let current: Identity = {room: 'th06mp-1234', roomCode: '1234', serial: 1, sessionSerial: 1};
const sent: Array<{room: string; serial: number; phraseId: string}> = [];
const listeners = new Set<(event: RoomQuickChatEvent) => void>();
const controller = {
  sendQuickChat(phraseId: string) {sent.push({room: current.room, serial: current.serial, phraseId}); return true;},
  subscribeQuickChat(listener: (event: RoomQuickChatEvent) => void) {listeners.add(listener); return () => listeners.delete(listener);},
};
const labels: Record<string, string> = {
  'chat.players': 'Player messages', 'chat.prompt': 'Tap for quick chat', 'chat.mute': 'Mute messages',
  'chat.unmute': 'Unmute messages', 'chat.back': 'Back to quick chat',
};

function Harness() {
  const surface = usePlayerSurface();
  const [identity, setIdentity] = useState(current);
  const productId: MultiplayerProductId = 'th06mp';
  const roomState = useMemo(() => ({sessionSerial: identity.sessionSerial, route: {productId, roomCode: identity.roomCode, search: ''},
    connection: 'connected', room: {phase: 'running', localSeat: 0, seats: [
      {clientId: 'local-client', name: 'Local Player'}, {clientId: 'peer-client', name: 'Peer Player'},
    ]}, startSerial: identity.serial} as unknown as MultiplayerRoomSnapshot), [identity]);
  const runtime = {launched: true, ready: true, runtimeVariant: 'multiplayer', epoch: 7} as RuntimeSnapshot;
  const launcherContext = {epoch: 7, game: 'th06', runtimeVariant: 'multiplayer', options: {
    replayViewer: false, netplayUrl: `https://relay.invalid/game?room=${encodeURIComponent(identity.room)}&run=${identity.serial}`,
  }} as unknown as RuntimeLauncherControlContext;
  function switchSession() {
    const next: Identity = {room: 'th06mp-5678', roomCode: '5678', serial: 2, sessionSerial: 2};
    current = next; setIdentity(next);
  }
  return <>
    <button type="button" data-switch-session onClick={switchSession}>Switch synthetic session</button>
    <button type="button" data-fullscreen onClick={() => {void surface?.element?.requestFullscreen();}}>Fullscreen player surface</button>
    <output data-current-session>{identity.room}:{identity.serial}</output>
    <iframe id="focus-sentinel" title="Empty Runtime focus sentinel" srcDoc="<!doctype html><html><body>Empty frame; no game code</body></html>" />
    <MultiplayerQuickChatView productId={productId} controller={controller} roomState={roomState} runtime={runtime}
      launcherContext={launcherContext} language="lang_en" lessMotion surfaceElement={surface?.element ?? null}
      text={key => labels[key] ?? key}/>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><PlayerSurfaceProvider><Harness/></PlayerSurfaceProvider></StrictMode>);

window.__quickChatFixture = {
  inspect() {return {sent: [...sent], entries: document.querySelectorAll('.mp-quick-chat-log p').length, fullscreen: !!document.fullscreenElement};},
  emit(phraseId: string) {
    const phrase = quickChatPhrase(phraseId);
    if (!phrase) throw Error('Fixture requires a canonical phrase id');
    const event: RoomQuickChatEvent = {room: current.room, sessionSerial: current.sessionSerial, serial: current.serial,
      seat: 1, clientId: 'peer-client', phrase};
    listeners.forEach(listener => listener(event));
  },
  emitStale() {
    const phrase = QUICK_CHAT_PHRASES[0];
    const event: RoomQuickChatEvent = {room: 'th06mp-1234', sessionSerial: 1, serial: 1, seat: 1, clientId: 'peer-client', phrase};
    listeners.forEach(listener => listener(event));
  },
};

declare global {
  interface Window {
    __quickChatFixture: {
      inspect(): {sent: Array<{room: string; serial: number; phraseId: string}>; entries: number; fullscreen: boolean};
      emit(phraseId: string): void;
      emitStale(): void;
    };
  }
}
