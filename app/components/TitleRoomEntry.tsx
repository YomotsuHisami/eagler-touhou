import {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useLocation, useNavigate} from 'react-router';
import type {RuntimeService} from '../services/runtime.client';
import type {TitleRoomEntryController, TitleRoomEntrySnapshot} from '../services/title-room-entry.client';
import {parseMultiplayerRoomRoute} from '../services/multiplayer-room-route';
import type {MultiplayerRoomController, MultiplayerRoomSnapshot} from '../services/multiplayer-room.client';
import {useRuntimeFrame} from '../runtime/RuntimeHost';
import {AnimatedDialog} from './AnimatedDialog';
import {MultiplayerRoomView} from './MultiplayerRoom';
import {GameSettings} from './GameSettings';
import {useLocale} from './LocaleProvider';

const none = () => () => {}, empty = () => null;
const roomKeys = ['titleRoom', 'mpRoom', 'room', 'fromLobby', 'lobbyAction', 'lobbyPlayers', 'lobbyDifficulty', 'lobbyVisibility', 'lobbyDisableCheatMovement', 'roomOptions'];
function withoutRoom(search: string) {const query = new URLSearchParams(search); for (const key of roomKeys) query.delete(key); return query;}

/** One receipt beside the existing room owner; all addresses remain Router-owned. */
export function useTitleRoomEntry(runtime: RuntimeService | null) {
  const location = useLocation(), navigate = useNavigate();
  const current = useRef({location, navigate}); current.current = {location, navigate};
  const retained = useRef<{runtime: RuntimeService; controller: TitleRoomEntryController} | null>(null), epoch = useRef(0);
  const opening = useRef<{epoch: number; originKey: string; displayed: boolean} | null>(null);
  const [controller, setController] = useState<TitleRoomEntryController | null>(null);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  useLayoutEffect(() => {
    const effect = ++epoch.current;
    let cancelled = false;
    if (!runtime) return;
    void import('../services/title-room-entry.client').then(({createTitleRoomEntry}) => {
      if (cancelled) return;
      if (retained.current?.runtime !== runtime) {retained.current?.controller.dispose(); retained.current = null;}
      const owner = retained.current?.controller ?? createTitleRoomEntry({runtime,
        onRequest(source) {
          const {location: currentLocation, navigate: go} = current.current;
          if (!new RegExp(`^/play/${source.game}(?:/(?:resources|replays|saves))?/?$`).test(currentLocation.pathname)) {owner.dismiss(); return;}
          opening.current = {epoch: source.epoch, originKey: currentLocation.key, displayed: false};
          const query = withoutRoom(currentLocation.search); query.delete('panel'); query.delete('touchLayout'); query.set('titleRoom', String(source.epoch));
          void go({pathname: currentLocation.pathname, search: query.toString(), hash: currentLocation.hash});
        },
        async onRetired(request) {
          const {location: currentLocation, navigate: go} = current.current;
          const query = new URLSearchParams(currentLocation.search); query.delete('titleRoom'); query.delete('roomOptions');
          await go({pathname: `/play/${request.productId}`, search: query.toString(), hash: currentLocation.hash}, {replace: true});
        },
      });
      retained.current = {runtime, controller: owner}; setController(owner);
    });
    return () => {cancelled = true; queueMicrotask(() => {
      if (epoch.current !== effect) return;
      retained.current?.controller.dispose(); retained.current = null;
    });};
  }, [runtime]);
  useLayoutEffect(() => {
    if (!controller) return;
    const source = controller.getSnapshot().source, query = new URLSearchParams(location.search);
    if (source) {
      const matches = query.get('titleRoom') === String(source.epoch) && new RegExp(`^/play/${source.game}(?:/(?:resources|replays|saves))?/?$`).test(location.pathname);
      if (matches) {if (opening.current) opening.current.displayed = true;}
      else if (!controller.getSnapshot().retiring && (opening.current?.displayed || location.key !== opening.current?.originKey)) controller.dismiss();
    } else if (query.has('titleRoom')) {
      // A dismissed/replaced epoch never reopens from browser Forward/reload.
      void navigate({pathname: location.pathname, search: withoutRoom(location.search).toString(), hash: location.hash}, {replace: true, state: location.state});
    }
  }, [controller, snapshot, location, navigate]);
  return {controller, snapshot};
}

const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:opacity-50';
export function TitleRoomEntry({controller, snapshot, roomController, roomSnapshot, runtime}: {
  controller: TitleRoomEntryController | null; snapshot: TitleRoomEntrySnapshot | null;
  roomController: MultiplayerRoomController | null; roomSnapshot: MultiplayerRoomSnapshot | null; runtime: RuntimeService | null;
}) {
  const {t} = useLocale(), location = useLocation(), navigate = useNavigate(), frame = useRuntimeFrame();
  const source = snapshot?.source, query = new URLSearchParams(location.search);
  const active = !!source && query.get('titleRoom') === String(source.epoch);
  const route = parseMultiplayerRoomRoute(location.pathname, location.search, source?.epoch);
  const inRoom = active && !!route && !!roomSnapshot?.route && roomSnapshot.route.productId === route.productId && roomSnapshot.route.roomCode === route.roomCode;
  const options = query.get('roomOptions') === '1';
  const [code, setCode] = useState(''), [error, setError] = useState<string | null>(null);
  const returnEpoch = useRef<number | null>(null), createButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {if (source) {returnEpoch.current = source.epoch; setCode(''); setError(null);}}, [source?.epoch]);
  function close() {
    if (snapshot?.retiring) return;
    void navigate({pathname: location.pathname, search: withoutRoom(location.search).toString(), hash: location.hash}, {replace: true, state: location.state});
  }
  function enter(created: boolean) {
    if (!source || !active || !controller || controller.getSnapshot().retiring) return;
    const selected = created ? String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 9000) : code.trim();
    if (!/^\d{4,8}$/.test(selected)) {setError(t('lobby.invalidCode')); return;}
    const next = withoutRoom(location.search); next.set('titleRoom', String(source.epoch)); next.set('mpRoom', selected); next.set('room', selected);
    next.set('fromLobby', '1'); next.set('lobbyAction', created ? 'create' : 'join');
    if (created) {next.set('lobbyPlayers', '2'); next.set('lobbyDifficulty', '1'); next.set('lobbyVisibility', 'public');}
    void navigate({pathname: location.pathname, search: next.toString(), hash: location.hash});
  }
  function closeOptions() {const next = new URLSearchParams(location.search); next.delete('roomOptions'); void navigate({pathname: location.pathname, search: next.toString(), hash: location.hash}, {replace: true});}
  return <AnimatedDialog open={active} onOpenChange={open => {if (!open) close();}} layout={inRoom ? 'fullscreen' : 'dialog'} layer={45}
    title={t('multiplayer.th09DialogTitle')} description={inRoom ? undefined : t('ui.multiplayer.intentHint')} initialFocus={createButton}
    onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => {if (snapshot?.retiring) event.preventDefault();}}
    onCloseAutoFocus={event => {
      if (runtime?.getSnapshot().epoch === returnEpoch.current && runtime.getSnapshot().launched) {event.preventDefault();frame?.current?.focus({preventScroll: true});}
    }}>
    {inRoom && roomController && roomSnapshot ? options && source ? <div className="mx-auto max-w-3xl p-6">
      <button type="button" className={button} onClick={closeOptions}>{t('react.routes.backRoom')}</button><GameSettings productId={source.productId}/>
    </div> : <MultiplayerRoomView controller={roomController} snapshot={roomSnapshot} embedded onLeave={close} managementPath={location.pathname} leaveLabel={t('action.close')}/>
      : <div className="grid gap-4">
        <button ref={createButton} type="button" className={button} onClick={() => enter(true)} disabled={!roomController}>{t('multiplayer.createRoom')}</button>
        <form className="grid gap-3" onSubmit={event => {event.preventDefault();enter(false);}}>
          <label className="grid gap-2 text-sm">{t('multiplayer.roomCode')}<input className="min-h-11 rounded-xl border border-line bg-background px-3 text-base" inputMode="numeric" autoComplete="off" required pattern="[0-9]{4,8}" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}/></label>
          <button type="submit" className={button} disabled={!roomController}>{t('multiplayer.joinRoom')}</button>
        </form>
        {error && <p role="alert" className="text-sm text-accent">{error}</p>}
        <button type="button" className={button} onClick={close}>{t('action.close')}</button>
      </div>}
    {snapshot?.retiring && <p role="status" className="px-6 py-3 text-sm">{t('react.runtime.savingWait')}</p>}
    {snapshot?.error && <p role="alert" className="px-6 py-3 text-sm text-accent">{snapshot.error}</p>}
  </AnimatedDialog>;
}
