import {useEffect, useLayoutEffect, useRef} from 'react';
import type {RoomOwnerSnapshot, MultiplayerRoomService} from '../../services/multiplayer-room';
import {useLocale} from '../../i18n';
import {roomPresentation} from './presentation';
export function RoomPersonal({state, service, assetUrl, th09NetworkOverlayOpen, hidden}: {state: RoomOwnerSnapshot; service: MultiplayerRoomService; assetUrl(path: string): string; th09NetworkOverlayOpen: boolean; hidden: boolean}) {
  const {t} = useLocale(), {room, loadout, label} = roomPresentation(state, t)!;
  const input = useRef<HTMLInputElement>(null), latest = useRef(service); latest.current = service;
  const commit = () => {if (input.current) input.current.value = latest.current.setDisplayName(input.current.value);};
  useEffect(() => {const node = input.current; node?.addEventListener('change', commit); return () => node?.removeEventListener('change', commit);}, []);
  useLayoutEffect(() => {if (input.current && document.activeElement !== input.current) input.current.value = state.displayName;}, [state.displayName]);
  const arrow = (id: string, previous: boolean) => <button id={id} type="button" aria-label={t(previous ? 'multiplayer.previousCharacter' : 'multiplayer.nextCharacter')} onClick={() => service.changeLoadout(previous ? -1 : 1)}><img className="room-icon" src={assetUrl(previous ? 'assets/room-caret-left.svg' : 'assets/room-caret-right.svg')} alt=""/></button>;
  return <div className="mp-room-body" data-room-panel="personal" hidden={hidden}>
    <label className="mp-name-editor" id="mpNameEditor"><span>{t('multiplayer.name')}</span><input ref={input} id="mpDisplayName" type="text" maxLength={12} autoComplete="off" placeholder={t('multiplayer.namePlaceholder')} aria-label={t('multiplayer.nameAria')} title={t('multiplayer.nameEditableHint')} defaultValue={state.displayName} onBlur={commit}/></label>
    <section className="mp-spectator" id="mpUnseatedNote" hidden={room.synced === true && state.seat != null}>
      <div className="mp-spectator-title">{t(!room.synced ? 'multiplayer.connectingRoom' : state.spectatorRequested ? 'multiplayer.spectatorSeat' : 'multiplayer.notSeated')}</div>
      <div className="mp-spectator-hint">{t(!room.synced ? 'multiplayer.syncingState' : state.spectatorRequested ? 'multiplayer.waitSpectatorStream' : 'multiplayer.chooseSeatOrSpectate')}</div>
      <div className="mp-spectator-loadout" hidden={!room.synced || state.spectatorRequested}><div className="mp-local-character" aria-hidden="true"><span id="mpLocalCharacterGlyph">{loadout.glyph}</span></div><div className="mp-local-copy"><strong>{t('multiplayer.you')}</strong><span id="mpLocalLoadoutLabel">{label(state.preferredLoadout)}</span></div><div className="mp-local-actions">{arrow('mpLoadoutPrev', true)}{arrow('mpLoadoutNext', false)}</div></div>
    </section>
    <div className="mp-local-player" id="mpLocalPlayer" hidden={!room.synced || state.seat == null}><button className="mp-stand-button" id="mpStandUp" type="button" onClick={service.standUp}>{t('multiplayer.leaveSeat')}</button><div className="mp-seated-loadout">{arrow('mpLoadoutPrevSeat', true)}<span id="mpLocalRoleLabel">{label(state.preferredLoadout)}</span>{arrow('mpLoadoutNextSeat', false)}</div></div>
    <button className="mp-game-check-button" id="mpCheckGame" type="button" hidden={state.seat == null || th09NetworkOverlayOpen} disabled={state.seat == null || !!room.phase && room.phase !== 'lobby' || state.ready || state.checkBusy || state.launchBusy} onClick={() => {void service.checkGame();}}>{t(state.checkBusy ? 'multiplayer.checkingGame' : 'multiplayer.checkGame')}</button>
  </div>;
}
