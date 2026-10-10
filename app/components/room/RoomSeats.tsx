import {useEffect, useLayoutEffect, useRef} from 'react';
import {multiplayerDisplayInitial} from '../../../src/launcher/multiplayer-identity.mts';
import {touchMovementUsesJoystick} from '../../../src/launcher/game-preferences.mts';
import type {MultiplayerRoomService, RoomOwnerSnapshot} from '../../services/multiplayer-room';
import {useLocale} from '../../i18n';
import {networkMessage, roomPresentation} from './presentation';
import type {RoomNetworkPresentation, RoomPanelKind, RoomViewContext} from './types';
export interface RoomSeatsProps {state: RoomOwnerSnapshot; service: MultiplayerRoomService; network: RoomNetworkPresentation; context: RoomViewContext; openPanel(kind: RoomPanelKind, trigger: HTMLElement, peerId?: string): void;}
export function RoomSeats(props: RoomSeatsProps) {return <div className="mp-seat-stage" id="mpSeatStage" data-player-count={props.state.room?.playerCount}>{[0, 1, 2].map(index => <RoomSeat {...props} index={index} key={index}/>)}</div>;}
function RoomSeat({state, service, network, context, openPanel, index}: RoomSeatsProps & {index: number}) {
  const {t} = useLocale(), presentation = roomPresentation(state, t)!;
  const {room, ready, owner, label} = presentation;
  const node = useRef<HTMLElement>(null), previous = useRef<{room: string; occupant: string; animations: Animation[]} | null>(null);
  const active = index < room.playerCount, seat = room.synced ? room.seats?.[index] || null : null;
  const occupied = room.synced === true && (!!seat || state.seat === index), occupant = occupied ? seat?.clientId || state.localClientId : '';
  useLayoutEffect(() => {
    const element = node.current, before = previous.current;
    if (!element || before && before.room === room.code && before.occupant === occupant) return;
    before?.animations.forEach(animation => animation.cancel());
    const next = {room: room.code, occupant, animations: [] as Animation[]}; previous.current = next;
    if (!before || before.room !== room.code || !room.synced || element.hidden || document.body.classList.contains('less-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const child of element.querySelectorAll<HTMLElement>(':scope > .mp-seat-face, :scope > .mp-seat-index, :scope > .mp-seat-name, :scope > .mp-seat-state')) {
      if (!child.hidden && typeof child.animate === 'function') {
        const animation = child.animate([{opacity: .25}, {opacity: 1}], {duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)'});
        // A superseded occupant or React teardown cancels these visual leaves.
        // Cancellation is expected and must not become an unhandled rejection.
        void animation.finished.catch(() => {}); next.animations.push(animation);
      }
    }
  }, [room.code, room.synced, occupant]);
  useEffect(() => () => {previous.current?.animations.forEach(animation => animation.cancel());}, []);
  const seatLabel = label(seat ? seat.loadout : state.preferredLoadout);
  const control = state.seat === index ? !context.touchEnabled || touchMovementUsesJoystick(context.touchMovementMode) ? 'normal' : context.touchMovementMode === 'touch-unlimited' ? 'cheat' : 'touch' : seat?.controlMode;
  const message = networkMessage(state, context, t), local = seat?.clientId === state.localClientId;
  const values = (['direct', 'turn'] as const).map(lane => {const metric = seat ? network.metric(seat.clientId, lane) : null, measured = state.connected && room.synced && !seat?.offline && metric?.state === 'connected' && metric.rtt != null; return `${t(`room.${lane}`)} ${measured ? `${Math.max(1, Math.round(metric!.rtt!))}ms` : '—'}`;});
  const resource = state.seat === index && state.preparation ? {...state.preparation, percent: state.preparation.status === 'ready' ? 100 : state.preparation.status === 'preparing' && state.preparation.total ? Math.round((state.preparation.loaded || 0) / state.preparation.total * 100) : null} : seat?.resource;
  const resourceLabel = !resource ? '' : resource.status === 'ready' ? t('room.resourcesReady') : resource.status === 'failed' ? t('room.resourcesUnavailable') : resource.status === 'cancelled' ? t('room.resourcesCancelled') : resource.status === 'importing' ? t('package.importingSimple') : resource.stage === 'runtime' ? t('room.preparingRuntime') : resource.percent == null ? t('room.preparingResources') : t('room.peerDownloading', {percent: resource.percent});
  return <article ref={node} className={`mp-seat${occupied ? ' occupied' : ''}${index === 0 && owner ? ' owner' : ''}${seat?.offline ? ' reconnecting' : ''}${occupied && seat?.ready ? ' is-ready' : ''}`} data-mp-seat={index} hidden={!active} title={occupied ? seatLabel : ''}>
    <div className="mp-seat-face"><div className="mp-seat-drop" data-mp-seat-drop={index} hidden={occupied}><button type="button" disabled={!ready || !active || occupied} onClick={() => {void service.takeSeat(index);}}>{t('multiplayer.join')} P{index + 1}</button></div>
      <span className="mp-seat-glyph" data-mp-seat-glyph={index} hidden={!occupied}>{multiplayerDisplayInitial(seat?.name ?? (state.seat === index ? state.displayName : ''), '?')}</span>
      {index === 0 && <span className="mp-seat-owner-mark" role="img" aria-label={t('multiplayer.host')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 5 4 4-6 4 6 5-4-2 12H5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M6 21h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>}
    </div><span className="mp-seat-index"><span>P{index + 1}</span><button className="mp-seat-latency" type="button" hidden={!seat} disabled={local || !!message || !!seat?.offline} aria-haspopup="dialog" aria-controls="mpRoomPanel" data-network-peer={seat && !local ? seat.clientId : undefined} aria-label={seat && !local ? `${t('multiplayer.you')} → P${index + 1} · ${values.join(' / ')} · ${t('room.connections')}` : undefined} onClick={event => {if (seat) openPanel('network', event.currentTarget, seat.clientId);}}>{local ? t('room.localDevice') : values.map(value => <span key={value}>{value}</span>)}</button></span>
    <strong className="mp-seat-name" data-mp-seat-name={index}>{occupied ? seatLabel : ''}</strong><span className="mp-seat-state" data-mp-seat-state={index}>{!occupied ? '' : t(seat?.offline ? 'multiplayer.playerReconnecting' : seat?.ready ? 'room.ready' : 'room.notReady')}</span>
    <span className="mp-seat-me" data-mp-seat-me={index} hidden={state.seat !== index}>{t('multiplayer.you')}</span>
    <span className="mp-seat-control" hidden={!occupied || !control} data-mode={control || ''}>{control ? t(`multiplayer.control.${control}`) : ''}</span>
    <button className="mp-seat-edit" type="button" hidden={state.seat !== index || !occupied} aria-label={t('room.playerOptions')} onClick={event => openPanel('personal', event.currentTarget)}/>
    {index > 0 && <button className="mp-seat-remove" type="button" hidden={!ready || !owner || room.phase !== 'lobby' || !seat} aria-label={t('room.removePlayer', {seat: index + 1})} title={t('room.removePlayer', {seat: index + 1})} onClick={() => {void service.removePlayer(index);}}>×</button>}
    <div className="mp-seat-resource" hidden={!seat || !resource} data-status={resource?.status}><span className="mp-seat-resource-label">{resourceLabel}</span><span className={`mp-seat-resource-track${resource?.status === 'importing' || resource?.status === 'preparing' && resource.percent == null ? ' indeterminate' : ''}`}><span style={{width: `${resource?.status === 'ready' ? 100 : resource?.percent ?? 0}%`}}/></span></div>
  </article>;
}
