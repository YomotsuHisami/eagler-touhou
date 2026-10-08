import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent} from 'react';
import {createPortal} from 'react-dom';
import {gameIdForProduct, isMultiplayerProductId, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {QUICK_CHAT_ROWS} from '../../src/contracts/multiplayer-quick-chat.mts';
import {useLocale} from '../components/LocaleProvider';
import {useGamePreferences} from '../components/GameSettingsProvider';
import {useMotionPreference} from '../components/MotionPreferenceProvider';
import {useMultiplayerRoom} from '../components/MultiplayerRoomProvider';
import {usePlayerSurface} from './PlayerToolsSurface';
import {createMultiplayerQuickChatState, multiplayerQuickChatRuntimeMatches, type QuickChatContext} from '../services/multiplayer-quick-chat.client';
import type {MultiplayerRoomController, MultiplayerRoomSnapshot} from '../services/multiplayer-room.client';
import type {RuntimeLauncherControlContext, RuntimeSnapshot} from '../services/runtime.client';
import {useRuntimeService, useRuntimeSnapshot} from './RuntimeHost';
import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import './multiplayer-quick-chat.css';

const emptySeats: NonNullable<QuickChatContext['seats']> = Object.freeze([]);

/** Player-surface chat uses the existing room controller and Runtime; it never owns either one. */
export default function MultiplayerQuickChat() {
  const {controller, snapshot: room} = useMultiplayerRoom();
  const runtimeService = useRuntimeService(), runtime = useRuntimeSnapshot();
  if (!room) return null;
  const route = room.route;
  const productId: MultiplayerProductId | null = route && isMultiplayerProductId(route.productId) ? route.productId : null;
  if (!productId) return null;
  return <MultiplayerQuickChatForProduct productId={productId} controller={controller} roomState={room}
    runtimeService={runtimeService} runtime={runtime}/>;
}

function MultiplayerQuickChatForProduct({productId, controller, roomState, runtimeService, runtime}: {
  productId: MultiplayerProductId;
  controller: MultiplayerRoomController | null;
  roomState: MultiplayerRoomSnapshot;
  runtimeService: ReturnType<typeof useRuntimeService>;
  runtime: ReturnType<typeof useRuntimeSnapshot>;
}) {
  const {t} = useLocale();
  const playerSurface = usePlayerSurface();
  const {settings} = useGamePreferences(productId);
  const {reducedMotion} = useMotionPreference();
  const launcherContext = runtimeService?.getLauncherControlContext() ?? null;
  return <MultiplayerQuickChatView productId={productId} controller={controller} roomState={roomState} runtime={runtime}
    launcherContext={launcherContext} language={settings?.language ?? ''} lessMotion={reducedMotion}
    surfaceElement={playerSurface?.element ?? null} text={t}/>;
}

type QuickChatController = Pick<MultiplayerRoomController, 'sendQuickChat' | 'subscribeQuickChat'>;
type QuickChatRuntime = Pick<RuntimeSnapshot, 'launched' | 'ready' | 'runtimeVariant' | 'epoch'> | null;
type QuickChatLauncherContext = Pick<RuntimeLauncherControlContext, 'epoch' | 'game' | 'runtimeVariant' | 'options'> | null;
type QuickChatTextKey = 'chat.players' | 'chat.prompt' | 'chat.mute' | 'chat.unmute' | 'chat.back';
type QuickChatText = (key: QuickChatTextKey) => string;

/** Controlled presentation seam for synthetic coverage; production passes the root-owned ports. */
export function MultiplayerQuickChatView({productId, controller, roomState, runtime, launcherContext, language, lessMotion, surfaceElement, text}: {
  productId: MultiplayerProductId;
  controller: QuickChatController | null;
  roomState: MultiplayerRoomSnapshot;
  runtime: QuickChatRuntime;
  launcherContext: QuickChatLauncherContext;
  language: string;
  lessMotion: boolean;
  surfaceElement: HTMLElement | null;
  text: (key: UiMessageKey) => string;
}) {
  const [chat] = useState(() => createMultiplayerQuickChatState());
  const lifecycle = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const logPosition = useRef<{top: number; following: boolean} | null>(null);
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot, chat.getSnapshot);
  const route = roomState.route;
  const room = roomState.room;
  const runtimeMatches = multiplayerQuickChatRuntimeMatches({
    launched: runtime?.launched === true, ready: runtime?.ready === true, runtimeVariant: runtime?.runtimeVariant,
    runtimeEpoch: runtime?.epoch ?? null, launcherVariant: launcherContext?.runtimeVariant,
    launcherEpoch: launcherContext?.epoch ?? null, launcherGame: launcherContext?.game ?? null,
    expectedGame: gameIdForProduct(productId), replayViewer: launcherContext?.options.replayViewer === true,
    netplayUrl: launcherContext?.options.netplayUrl, roomId: route ? `${productId}-${route.roomCode}` : '', serial: roomState.startSerial,
  });
  const visible = runtimeMatches && !!route && route.productId === productId && !!room && room.phase === 'running';
  const roomKey = visible && route ? `${route.productId}-${route.roomCode}` : '';
  const context: QuickChatContext = {
    visible, room: roomKey, sessionSerial: roomState.sessionSerial, serial: roomState.startSerial,
    localSeat: visible ? room?.localSeat ?? null : null,
    seats: visible ? room?.seats.map(seat => seat ? {clientId: seat.clientId, name: seat.name} : null) ?? emptySeats : emptySeats,
    connected: visible && roomState.connection === 'connected',
    language, lessMotion,
  };

  useLayoutEffect(() => {chat.update(context);}, [chat, visible, roomKey, roomState.sessionSerial, roomState.startSerial, roomState.connection,
    room?.localSeat, room?.seats, language, lessMotion]);
  useLayoutEffect(() => {
    const previous = logPosition.current, log = logRef.current;
    if (!previous || !log) return;
    log.scrollTop = previous.following ? log.scrollHeight : previous.top;
    logPosition.current = null;
  }, [snapshot.entries, snapshot.muted]);
  const rememberLogPosition = () => {
    const log = logRef.current;
    if (log) logPosition.current = {top: log.scrollTop, following: log.scrollHeight - log.clientHeight - log.scrollTop <= 4};
  };
  useEffect(() => {
    if (!controller) return;
    return controller.subscribeQuickChat(event => {rememberLogPosition(); chat.receive(event);});
  }, [controller, chat]);
  useEffect(() => {
    const ticket = ++lifecycle.current;
    return () => queueMicrotask(() => {if (lifecycle.current === ticket) chat.dispose();});
  }, [chat]);

  if (!visible || !surfaceElement) return null;
  const activeContext = snapshot.context;
  const muted = new Set(snapshot.muted);
  const entries = snapshot.entries.filter(entry => !muted.has(entry.clientId));
  const label = (phrase: {zh: string; en: string}) => language === 'en' || language === 'lang_en' ? phrase.en : phrase.zh;
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return createPortal(<section className="mp-quick-chat" aria-label={text('chat.players')}
    onPointerDownCapture={event => {event.preventDefault(); event.stopPropagation();}}
    onMouseDownCapture={event => {event.preventDefault(); event.stopPropagation();}}
    onKeyDown={event => {event.stopPropagation(); if (event.key === 'Escape') chat.close();}}
    onKeyUp={stop} onPointerMove={stop} onPointerUp={stop} onPointerCancel={stop}
    onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onTouchCancel={stop}>
    <button type="button" className="mp-quick-chat-prompt" disabled={!activeContext?.connected}
      aria-expanded={snapshot.pickerOpen || snapshot.muteOpen} onClick={() => chat.togglePicker()}>{text('chat.prompt')}</button>
    {snapshot.pickerOpen && !snapshot.muteOpen && <div className="mp-quick-chat-picker">
      {QUICK_CHAT_ROWS.map((phrases, rowIndex) => <div key={rowIndex} className={`mp-quick-chat-row${phrases.length === 2 ? ' paired' : ''}`}>
        {phrases.map(phrase => <button key={phrase.id} type="button" className="mp-quick-chat-phrase" data-phrase={phrase.id}
          title={label(phrase)} disabled={activeContext?.localSeat == null || !activeContext?.connected}
          onClick={() => {chat.send(phrase.id, id => controller?.sendQuickChat(id) ?? false);}}>{label(phrase)}</button>)}
      </div>)}
      <button type="button" className="mp-quick-chat-mute" aria-expanded={snapshot.muteOpen} onClick={() => chat.toggleMute()}>{text('chat.mute')}</button>
    </div>}
    {snapshot.muteOpen && <div className="mp-quick-chat-picker mp-quick-chat-mute-list">
      {activeContext?.seats.flatMap((seat, index) => {
        if (!seat || index === activeContext.localSeat) return [];
        const isMuted = muted.has(seat.clientId);
        return [<button key={seat.clientId} type="button" className="mp-quick-chat-mute-member" aria-pressed={isMuted}
          onClick={() => {rememberLogPosition(); chat.setMuted(seat.clientId, !isMuted);}}>P{index + 1} {seat.name} · {text(isMuted ? 'chat.unmute' : 'chat.mute')}</button>];
      })}
      <button type="button" className="mp-quick-chat-mute" onClick={() => chat.toggleMute()}>{text('chat.back')}</button>
    </div>}
    <div ref={logRef} className="mp-quick-chat-log" role="log" aria-live="polite">
      {entries.map(entry => <p key={entry.id} className={entry.fading ? 'is-expiring' : undefined} title={`P${entry.seat + 1} ${entry.name}: ${label(entry.phrase)}`}>
        <strong>P{entry.seat + 1} {entry.name}</strong>: {label(entry.phrase)}
      </p>)}
    </div>
  </section>, surfaceElement);
}
