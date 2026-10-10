import {useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {multiplayerDisplayInitial} from '../../../src/launcher/multiplayer-identity.mts';
import {useLocale} from '../../i18n';
import type {RoomViewProps, RoomPanelKind} from './types';
import {roomPresentation, networkMessage} from './presentation';
import {RoomProgress} from './RoomProgress';
import {RoomSeats} from './RoomSeats';
import {RoomPanel} from './RoomPanel';
import {RoomPersonal} from './RoomPersonal';
import {RoomNetwork} from './RoomNetwork';
import {RoomSpectators} from './RoomSpectators';
import {RoomGameSettings} from './RoomGameSettings';
/** Main index570–713 + app8058–8353. All controls target the real room/network
 * owners; panel/drawer intents belong to the single root Router. */
export function RoomView(props: RoomViewProps) {
  const {service, network, context, assetUrl} = props, {t} = useLocale();
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  useSyncExternalStore(network.subscribe, network.getSnapshot, network.getSnapshot);
  const trigger = useRef<HTMLElement | null>(null), retained = useRef<NonNullable<RoomViewProps['panel']>>({kind: 'personal'});
  if (props.panel) retained.current = props.panel;
  const currentPanel = props.panel || retained.current;
  useLayoutEffect(() => {if (props.panel) service.setRoomSettingsOpen(props.panel.kind === 'game');}, [service, props.panel?.kind]);
  const presentation = roomPresentation(state, t);
  if (!presentation) return null;
  const {room, game, gameId, config, ready, owner, label} = presentation;
  const openPanel = (kind: RoomPanelKind, element: HTMLElement, peerId?: string) => {trigger.current = element; props.onOpenPanel(kind, peerId);};
  const spectators = room.spectators || [], spectatorCount = Math.max(spectators.length, Math.max(0, Number(room.spectatorCount) || 0));
  const synchronizedReady = ready && room.phase === 'lobby' && Array.isArray(room.seats) && room.seats.slice(0, room.playerCount).every(seat => seat && !seat.offline && seat.ready);
  const rollbackSupported = !!config.inputTiming?.measuredStartup, rollbackHidden = !rollbackSupported || !owner && room.phase === 'lobby';
  const phase = t(context.launchStage === 'path' ? 'room.connectingGameplay' : context.launchStage || room.phase === 'starting' ? 'room.starting' : room.phase === 'running' ? 'room.running' : state.preparation?.status === 'preparing' ? 'room.preparingResources' : state.preparation?.status === 'importing' ? 'package.importingSimple' : state.preparation?.status === 'ready' ? 'room.resourcesReady' : state.preparation?.status === 'failed' ? 'room.resourcesUnavailable' : 'room.lobby');
  const message = networkMessage(state, context, t), peers = (room.seats || []).slice(0, room.playerCount).flatMap((seat, index) => seat && index !== state.seat ? [{seat, index}] : []);
  return <section className="mp-room-view" id="mpRoomView" hidden={props.visible === false} aria-label={`${gameId.toUpperCase()} ${t('multiplayer.roomAria')}`} inert={props.settingsOpen}>
    <header className="mp-room-head"><button className="mp-room-back mp-room-top-action" id="mpLeaveRoom" type="button" onClick={() => {void props.onLeave();}}><img className="room-icon" src={assetUrl('assets/room-caret-left.svg')} alt=""/><span>{t('action.back')}</span></button><span className={`mp-room-connection${ready ? ' connected' : ''}`} id="mpRoomConnection" role="status">{t(ready ? 'room.online' : 'multiplayer.reconnecting')}</span>
      <button className="mp-room-code mp-room-top-action" id="mpCopyRoomCode" type="button" aria-label={t('multiplayer.copyRoomCode')} onClick={() => {void props.onCopyRoomCode(room.code);}}><span className="mp-room-code-label">{t('multiplayer.roomCode')}</span><strong id="mpRoomCode">{room.code}</strong><img className="room-icon" src={assetUrl('assets/room-copy.svg')} alt=""/></button>
      <button className="edge-drawer-cue-right mp-settings-room-cue mp-room-top-action" id="mpSettingsRoomDrawerToggle" type="button" aria-controls="mpSettingsRoomDrawer" aria-expanded={props.settingsOpen} aria-label={t('settings.title')} hidden={props.settingsOpen || props.settingsClosing} onClick={props.onOpenSettings}><img className="room-icon" src={assetUrl('assets/room-gear-six.svg')} alt=""/></button>
    </header>
    <section className="mp-room-summary"><h2 className="mp-room-title" id="mpRoomTitle">{game.title}</h2><div className="mp-room-tags"><span id="mpRoomMode">{t('room.coop', {count: room.playerCount})}</span><span id="mpRoomDifficultyBadge">{config.difficulties[room.difficulty] || 'Normal'}</span><span id="mpRoomPhase" title={state.preparation?.status === 'failed' ? state.preparation.error : ''}>{phase}</span></div><RoomProgress state={state} service={service}/>
      <div id="mpRoomSettingsDrawer"><button className={`mp-room-settings-toggle${props.panel?.kind === 'game' ? ' open' : ''}`} id="mpRoomSettingsToggle" type="button" aria-expanded={props.panel?.kind === 'game'} aria-controls="mpRoomPanel" onClick={event => openPanel('game', event.currentTarget)}><img className="room-icon" src={assetUrl('assets/room-sliders-horizontal.svg')} alt=""/><span>{t('multiplayer.gameSettings')}</span></button><button className="mp-room-settings-toggle mp-room-guide-open" id="mpRoomGuideOpen" type="button" onClick={props.onGuide}><span>{t('multiplayerGuide.action')}</span><span aria-hidden="true">›</span></button></div>
    </section>
    <div className="mp-session-dock"><div className="mp-dock-players"><RoomSeats state={state} service={service} network={network} context={context} openPanel={openPanel}/>
      <div id="mpNetworkToggle" className="mp-network-summary" hidden><div id="mpNetworkSummary">{message || peers.map(({seat, index}) => {const title = `${t('multiplayer.you')} → P${index + 1} · ${label(seat.loadout)}`, values = (['direct', 'turn'] as const).map(lane => {const metric = network.metric(seat.clientId, lane), measured = !seat.offline && metric.state === 'connected' && metric.rtt != null; return `${t(`room.${lane}`)} ${measured ? `${Math.max(1, Math.round(metric.rtt!))} ms` : t(seat.offline || metric.state === 'unavailable' ? 'room.unavailable' : 'room.checking')}`;}).join(' · '); return <button key={seat.clientId} className="mp-peer-connection" type="button" data-network-peer={seat.clientId} aria-haspopup="dialog" aria-label={`${title} · ${values} · ${t('room.connections')}`} onClick={event => openPanel('network', event.currentTarget, seat.clientId)}><span className="mp-peer-connection-title">{title}</span><span className="mp-peer-connection-values">{values}</span><img className="room-icon" src={assetUrl('assets/room-caret-right.svg')} alt=""/></button>;})}</div></div>
      <div id="mpInputTiming" className="mp-room-input-timing" hidden={rollbackHidden}><button className="mp-rollback-toggle" id="mpRollbackToggle" type="button" role="switch" aria-checked={room.phase && room.phase !== 'lobby' ? room.adonisMode !== 1 : state.rollbackEnabled} title={t('room.rollbackHint')} hidden={rollbackHidden} disabled={!ready || !owner || room.phase !== 'lobby'} onClick={() => service.setRollbackEnabled(!state.rollbackEnabled)}><span>{t('room.enableRollback')}</span><i aria-hidden="true"/></button></div>
    </div><aside className="mp-spectator-rail" id="mpSpectatorRail" aria-label={t('multiplayer.spectators')}><button type="button" className="mp-spectator-rail-head" id="mpSpectatorToggle" aria-expanded={props.panel?.kind === 'spectators'} aria-haspopup="dialog" aria-controls="mpSpectatorContent" onClick={event => openPanel('spectators', event.currentTarget)}><span id="mpSpectatorAvatars" className="mp-spectator-stack" aria-hidden="true" hidden={!spectators.length}>{spectators.slice(0, 3).map(entry => <span key={entry.clientId}>{multiplayerDisplayInitial(entry.name, '?')}</span>)}</span><span className="mp-spectator-caption"><img className="room-icon" src={assetUrl('assets/room-users.svg')} alt=""/><span id="mpSpectatorCount">{spectatorCount}</span><span>{t('room.spectatorLounge')}</span><img className="room-icon" src={assetUrl('assets/room-caret-right.svg')} alt=""/></span></button></aside>
      <footer className="mp-room-footer" hidden={!room.synced || state.seat == null}><button className={`mp-ready-button${state.ready && state.seat != null ? ' ready' : ''}`} id="mpReady" type="button" hidden={state.seat == null} disabled={!ready || state.seat == null || room.phase !== 'lobby' || state.checkBusy || ['cancelled', 'importing'].includes(state.preparation?.status || '') && !state.ready} aria-pressed={state.ready && state.seat != null} onClick={() => {void service.toggleReady();}}>{t(state.ready && state.seat != null ? 'multiplayer.readyDone' : 'multiplayer.ready')}</button><button className="mp-start-button" id="mpStartGame" type="button" hidden={!owner || !state.ready} disabled={!ready || room.phase !== 'lobby' || owner && !synchronizedReady} onClick={service.start}>{t(!synchronizedReady ? 'multiplayer.waitReady' : 'multiplayer.startGame')}</button></footer>
    </div>
    <RoomPanel open={!!props.panel} kind={currentPanel.kind} peerId={currentPanel.peerId} onCloseRequest={props.onClosePanel} onClosed={() => service.setRoomSettingsOpen(false)} trigger={trigger}>
      <RoomPersonal state={state} service={service} assetUrl={assetUrl} th09NetworkOverlayOpen={context.th09NetworkOverlayOpen} hidden={currentPanel.kind !== 'personal'}/>
      <RoomNetwork state={state} network={network} context={context} peerId={currentPanel.peerId} hidden={currentPanel.kind !== 'network'}/>
      <RoomSpectators state={state} service={service} hidden={currentPanel.kind !== 'spectators'}/><RoomGameSettings state={state} service={service} hidden={currentPanel.kind !== 'game'}/>
    </RoomPanel>
  </section>;
}
