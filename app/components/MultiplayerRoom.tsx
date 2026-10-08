import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AnimatedDialog} from './AnimatedDialog';
import {ProductPanelHeader} from './ProductPanelHeader';
import {GameSettings} from './GameSettings';
import {SettingsFileTools} from './SettingsFileTools';
import {MultiplayerSettingsActions} from './MultiplayerSettingsActions';
import {useRoomPanelNavigation} from './RoomPanelNavigation';
import {dismissNestedDialog} from '../services/nested-dialog-dismissal';
import {copyText} from '../browser/clipboard';
import type {RoomPanelKind} from '../services/room-panel-route';
import {useLocation, useNavigate, useNavigation} from 'react-router';
import {HelpLink, usePlayerHelp} from './HelpPanel';
import {MultiplayerGuideButton} from './Notices';
import {PRODUCT_GAMES, gameIdForProduct, multiplayerConfigForProduct} from '../../src/contracts/product-catalog.mts';
import {isUiMessageKey, type UiMessageKey} from '../../src/launcher/i18n.mts';
import type {MultiplayerRoomController, MultiplayerRoomSnapshot} from '../services/multiplayer-room.client';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
import {useGamePreferences} from './GameSettingsProvider';
import {useLocale} from './LocaleProvider';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import roomCaretLeftIcon from '../../public/assets/room-caret-left.svg';
import roomCaretRightIcon from '../../public/assets/room-caret-right.svg';
import roomCopyIcon from '../../public/assets/room-copy.svg';
import roomGearIcon from '../../public/assets/room-gear-six.svg';
import roomUsersIcon from '../../public/assets/room-users.svg';
import roomSlidersIcon from '../../public/assets/room-sliders-horizontal.svg';
import './multiplayer-room.css';
const button = 'inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#30312c] px-4 py-2.5 text-sm text-paper hover:bg-[#3c3e36] disabled:cursor-not-allowed disabled:opacity-40';
const field = 'min-h-11 w-full rounded-xl border border-line bg-[#30312c] px-3 text-base text-paper';
export function MultiplayerRoom() {
  const {t} = useLocale();
  const {controller, snapshot} = useMultiplayerRoom();
  if (!controller || !snapshot?.route) return <p role="status" className="py-8 text-muted">{t('ui.multiplayer.roomLoading')}</p>;
  if (snapshot.launch === 'running') return <p role="status" className="text-sm text-muted">{t('ui.multiplayer.runtimeHandoff')}</p>;
  return <MultiplayerRoomView controller={controller} snapshot={snapshot}/>;
}
export interface RoomPanelDismissal {active: boolean; dismiss(): void}
export function MultiplayerRoomView({controller, snapshot, embedded = false, onLeave, leaveLabel, onPanelDismissalChange}: {controller: MultiplayerRoomController; snapshot: MultiplayerRoomSnapshot; embedded?: boolean; onLeave?(): void; leaveLabel?: string; onPanelDismissalChange?(scope: RoomPanelDismissal | null): void}) {
  const {t} = useLocale(), runtime = useRuntimeSnapshot();
  const challengeLabel = t('room.challengeMode');
  const label = (key: string) => isUiMessageKey(key) ? t(key) : key;
  const connectionLabel = {idle: t('ui.multiplayer.waitingRoom'), loading: t('ui.multiplayer.readingConfig'), connecting: t('ui.multiplayer.connecting'), connected: t('ui.multiplayer.connected'), reconnecting: t('ui.multiplayer.reconnecting'), unavailable: t('ui.multiplayer.connectionUnavailable')};

  const navigate = useNavigate(), panels = useRoomPanelNavigation(), help = usePlayerHelp();
  const location = useLocation(), navigation = useNavigation();
  const route = snapshot.route!;
  const {store: preferenceStore} = useGamePreferences(route.productId);
  const upperActive = help.open || help.present || new URLSearchParams((navigation.location ?? location).search).has('touchLayout');
  const [panelPresent, setPanelPresent] = useState(false);
  useLayoutEffect(() => {
    onPanelDismissalChange?.({active: panels.kind !== null || panelPresent, dismiss: () => {if (panels.kind !== null) panels.closePanel();}});
    return () => onPanelDismissalChange?.(null);
  }, [onPanelDismissalChange, panels.kind, panels.closePanel, panelPresent]);
  const retainedPanel = useRef<RoomPanelKind>('personal'), panelTrigger = useRef<HTMLElement | null>(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const previousPanel = useRef<RoomPanelKind | null>(panels.kind);
  useLayoutEffect(() => {
    if (panels.kind && previousPanel.current && panels.kind !== previousPanel.current) panelBody.current?.focus({preventScroll: true});
    previousPanel.current = panels.kind;
  }, [panels.kind]);
  useLayoutEffect(() => {if (panels.kind) retainedPanel.current = panels.kind;}, [panels.kind]);
  const panel = panels.kind ?? retainedPanel.current;
  function openPanel(kind: RoomPanelKind, trigger: HTMLElement) {
    if (!panels.kind) panelTrigger.current = trigger;
    trigger.focus({preventScroll: true}); panels.openPanel(kind);
  }
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<UiMessageKey | null>(null);
  const [confirmation, setConfirmation] = useState<{kind: 'player'; seat: number; clientId: string; productId: string; roomCode: string; sessionSerial: number} | {kind: 'spectator'; clientId: string; productId: string; roomCode: string; sessionSerial: number} | null>(null);
  const [movementPrompt, setMovementPrompt] = useState(false);
  const movementDecision = useRef<{productId: string; roomCode: string; sessionSerial: number; localSeat: number | null; retry: (() => void) | null} | null>(null), promptedMovementSession = useRef<string | null>(null);
  const [name, setName] = useState(snapshot.displayName);
  const game = PRODUCT_GAMES[gameIdForProduct(route.productId)], policy = multiplayerConfigForProduct(route.productId)!;
  const room = snapshot.room, local = room?.localSeat != null ? room.seats[room.localSeat] : null;
  const live = snapshot.connection === 'connected', lobby = live && room?.phase === 'lobby', owner = room?.localSeat === 0;
  const checking = snapshot.gameCheck?.status === 'checking';
  const busy = !!snapshot.pendingAction || checking;
  const runtimeBusy = !!runtime && (runtime.epoch != null || runtime.ready || runtime.launched || runtime.fileOperationBusy || !!runtime.saveError || !!runtime.closeError);
  function perform(callback: () => void | Promise<unknown>) {
    setError(null); setNotice(null);
    try {void Promise.resolve(callback()).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));}
    catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
  }
  function settings(patch: Partial<Pick<NonNullable<typeof room>, 'playerCount' | 'difficulty' | 'visibility' | 'disableCheatMovement' | 'challengeMode'>>) {
    if (!room) return;
    perform(() => controller.setRoomSettings({playerCount: room.playerCount, difficulty: room.difficulty, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement, ...patch}));
  }
  function ensureMovementAllowed(retry?: () => void) {
    if (room?.disableCheatMovement && snapshot.input.movementMode === 'touch-unlimited') {
      movementDecision.current = {productId: route.productId, roomCode: route.roomCode, sessionSerial: snapshot.sessionSerial, localSeat: room.localSeat, retry: retry ?? null}; setMovementPrompt(true); return false;
    }
    retry?.(); return true;
  }
  function chooseMovement(mode: 'touch' | 'joystick') {
    const decision = movementDecision.current, current = controller.getSnapshot();
    if (!preferenceStore || !decision || current.sessionSerial !== decision.sessionSerial || current.route?.productId !== decision.productId || current.route.roomCode !== decision.roomCode ||
        current.connection !== 'connected' || current.room?.phase !== 'lobby' || !current.room.disableCheatMovement || current.room.localSeat !== decision.localSeat ||
        current.input.movementMode !== 'touch-unlimited') {
      movementDecision.current = null; setMovementPrompt(false); return;
    }
    preferenceStore.setOption(route.productId, 'touchMovementMode', mode);
    controller.setInput({...current.input, movementMode: mode});
    setMovementPrompt(false);
    movementDecision.current = null; decision.retry?.();
  }
  useEffect(() => {
    const promptKey = `${snapshot.sessionSerial}:${route.productId}:${route.roomCode}`;
    if (room?.disableCheatMovement && snapshot.input.movementMode === 'touch-unlimited' && room.localSeat != null && promptedMovementSession.current !== promptKey) {
      promptedMovementSession.current = promptKey;
      movementDecision.current = {productId: route.productId, roomCode: route.roomCode, sessionSerial: snapshot.sessionSerial, localSeat: room.localSeat, retry: null}; setMovementPrompt(true);
    }
  }, [route.productId, route.roomCode, room, snapshot.input.touchEnabled, snapshot.input.movementMode, snapshot.sessionSerial]);
  useEffect(() => {
    const decision = movementDecision.current, current = controller.getSnapshot();
    if (decision && (current.sessionSerial !== decision.sessionSerial || current.route?.productId !== decision.productId || current.route.roomCode !== decision.roomCode || current.connection !== 'connected' || current.room?.phase !== 'lobby' || !current.room.disableCheatMovement || current.room.localSeat !== decision.localSeat || current.input.movementMode !== 'touch-unlimited')) {
      movementDecision.current = null; setMovementPrompt(false);
    }
  }, [controller, snapshot.route, snapshot.room, snapshot.connection]);
  const confirmRemoval = () => {
    const target = confirmation; setConfirmation(null);
    if (!target) return;
    const current = controller.getSnapshot();
    if (current.sessionSerial !== target.sessionSerial || current.route?.productId !== target.productId || current.route.roomCode !== target.roomCode ||
        current.connection !== 'connected' || current.room?.phase !== 'lobby' || current.room.localSeat !== 0) return;
    perform(() => target.kind === 'player'
      ? controller.removePlayer(target.seat, target.clientId)
      : controller.removeSpectator(target.clientId));
  };
  const nicknameInitial = (value: string) => Array.from(value.trim())[0] || '?';
  const leaveRoom = () => {
    if (onLeave) {onLeave(); return;}
    const fromDirectory = (location.state as {returnTo?: unknown} | null)?.returnTo === '/lobby' || new URLSearchParams(route.search).get('fromLobby') === '1';
    controller.leave();
    void navigate(fromDirectory ? `/lobby?game=${route.productId}` : `/play/${route.productId}`, {replace: true});
  };
  const preparation = snapshot.preparation;
  const measuredNetwork = snapshot.peers.flatMap(peer => (['direct', 'turn', 'relay'] as const).map(lane => ({peer, lane, metric: peer.metrics[lane]})))
    .filter(item => item.metric.state === 'connected' && item.metric.rtt != null)
    .sort((a, b) => a.metric.rtt! - b.metric.rtt!)[0];
  const measuredLane = measuredNetwork?.lane === 'direct' ? t('room.direct') : measuredNetwork?.lane === 'turn' ? t('room.turn') : measuredNetwork ? t('room.relay') : '';
  const networkSummary = measuredNetwork
    ? `P${measuredNetwork.peer.seat + 1} · ${measuredLane} ${Math.round(measuredNetwork.metric.rtt!)} ms`
    : snapshot.peers.some(peer => (['direct', 'turn', 'relay'] as const).some(lane => peer.metrics[lane].state === 'checking')) ? t('room.checking') : t('room.unavailable');
  return <section id="mpRoomView" aria-label={t('multiplayer.roomAria')} className={`mp-room-ui mp-room-view ${embedded ? 'is-embedded' : ''} ${checking ? 'is-checking' : snapshot.launch === 'starting' ? 'is-starting' : ''}`}>
    <div className="mp-room-shell">
      <header className="mp-room-head">
        <button type="button" className="mp-room-back mp-room-top-action" onClick={leaveRoom}><img src={roomCaretLeftIcon} alt="" aria-hidden="true" className="mp-room-icon mp-room-back-icon"/>{leaveLabel ?? t('ui.multiplayer.backLobby')}</button>
        <span role="status" className={`mp-room-connection ${snapshot.connection}`}>{connectionLabel[snapshot.connection]}</span>
        <button type="button" className="mp-room-code mp-room-top-action" onClick={() => perform(async () => {setNotice(await copyText(route.roomCode) ? 'ui.multiplayer.codeCopied' : 'ui.multiplayer.codeCopyFailed');})} aria-label={`${t('lobby.roomCode')} ${route.roomCode} · ${t('ui.multiplayer.copy')}`}><span className="mp-room-code-label">{t('lobby.roomCode')}</span><strong>{route.roomCode}</strong><img src={roomCopyIcon} alt="" aria-hidden="true" className="mp-room-icon mp-room-code-copy"/></button>
        <button type="button" className="mp-room-settings-open mp-room-top-action" aria-label={t('ui.multiplayer.gameTouchSettings')} title={t('ui.multiplayer.gameTouchSettings')} aria-haspopup="dialog" aria-expanded={panels.kind === 'options'} onClick={event => openPanel('options', event.currentTarget)}><img src={roomGearIcon} alt="" aria-hidden="true" className="mp-room-icon"/></button>
      </header>
      <section className="mp-room-summary">
        <h1 lang="ja" className="mp-room-title">{game.title}</h1>
        <div className="mp-room-tags"><span>{t('library.multiplayer')}</span>{room && <><span>{policy.difficulties[room.difficulty]}</span><span>{t('lobby.playersCount', {count: room.playerCount})}</span><span>{room.visibility === 'private' ? t('ui.multiplayer.privateRoom') : t('ui.multiplayer.publicRoom')}</span><span id="mpRoomPhase">{room.phase === 'lobby' ? t('multiplayer.waitReady') : room.phase === 'starting' ? t('room.starting') : t('lobby.playing')}</span>{room.disableCheatMovement && <span>{t('ui.multiplayer.unlimitedDisabled')}</span>}{room.challengeMode && <span>{challengeLabel}</span>}</>}</div>
        <div id="mpRoomSettingsDrawer" className="mp-room-summary-actions" aria-label={t('multiplayer.gameSettings')}>
          <button type="button" className="mp-room-settings-toggle" aria-haspopup="dialog" aria-expanded={panels.kind === 'game'} onClick={event => openPanel('game', event.currentTarget)}><img src={roomSlidersIcon} alt="" className="room-icon"/>{t('multiplayer.gameSettings')}</button>
          <MultiplayerGuideButton className="mp-room-settings-toggle mp-room-guide-open" gameId={gameIdForProduct(route.productId)}/>
        </div>
      </section>
      {(error || snapshot.error || notice || snapshot.notice) && <p lang={error || snapshot.error || !notice ? 'zh-CN' : undefined} role={error || snapshot.error ? 'alert' : 'status'} className="mp-room-notice">{error || snapshot.error || (notice ? t(notice) : snapshot.notice)}</p>}
      {!live && <button type="button" className="mp-room-settings-toggle" onClick={() => controller.retry()}>{t('ui.multiplayer.reconnectRoom')}</button>}
      {!snapshot.runtimeAvailable && <p className="mp-room-resource-status">{t('ui.multiplayer.runtimeUnavailable')}</p>}
      {snapshot.runtimeAvailable && <div className="mp-room-resource-progress">
        <p role="status">{preparation?.status === 'ready' ? t('ui.multiplayer.resourcesPrepared') : preparation?.status === 'preparing' ? t('ui.multiplayer.preparingStage', {stage: preparation.stage === 'package' ? t('transfer.gameResources') : 'Runtime', progress: preparation.percent == null ? '…' : ` ${preparation.percent}%`}) : preparation?.status === 'failed' ? t('ui.multiplayer.resourcesFailed') : preparation?.status === 'cancelled' ? t('ui.multiplayer.resourcesCancelled') : preparation?.status === 'importing' ? t('ui.multiplayer.importing') : t('ui.multiplayer.prepareFirst')}</p>
        {preparation?.status === 'preparing' && <progress aria-label={t('ui.multiplayer.prepareResources')} max={100} value={preparation.percent ?? undefined}/>}
        <div className="mp-room-resource-actions"><button type="button" className="mp-room-settings-toggle" disabled={checking || preparation?.status === 'preparing' || preparation?.status === 'ready'} onClick={() => perform(() => controller.prepare())}>{t('ui.multiplayer.prepareResources')}</button>
        <button type="button" data-multiplayer-check-game className="mp-room-settings-toggle" disabled={!lobby || busy || !local || local.ready || !snapshot.gameCheckAvailable || runtimeBusy || snapshot.launch === 'starting' || snapshot.launch === 'running'} onClick={() => perform(() => controller.checkGame())}>{t('multiplayer.checkGame')}</button>
        {checking && <button type="button" className="mp-room-settings-toggle" onClick={() => controller.cancelGameCheck()}>{t('lobby.cancel')}</button>}
        {preparation?.status === 'preparing' && <button type="button" className="mp-room-settings-toggle" onClick={() => controller.cancelPreparation()}>{t('ui.multiplayer.cancelPreparation')}</button>}</div>
        {snapshot.gameCheck && <p data-multiplayer-check-status={snapshot.gameCheck.status} role={snapshot.gameCheck.status === 'failed' ? 'alert' : 'status'}>{snapshot.gameCheck.status === 'checking' ? t('multiplayer.checkingGame') : snapshot.gameCheck.status === 'passed' ? t('multiplayer.checkGamePassed') : snapshot.gameCheck.status === 'failed' ? t('multiplayer.checkGameFailed', {reason: snapshot.gameCheck.error ?? ''}) : t('ui.multiplayer.cancelled')}</p>}
      </div>}
      <div className="mp-session-dock">
        <div className="mp-dock-players">
        <div className="mp-seat-stage" data-player-count={room?.playerCount ?? 2}>
          {Array.from({length: room?.playerCount ?? 2}, (_, index) => {
            const seat = room?.seats[index], loadout = seat ? policy.loadouts[seat.loadout] : null;
            const seatStatus = seat?.offline ? t('ui.multiplayer.playerReconnecting') : seat?.ready ? t('room.ready') : t('ui.multiplayer.waitingReady');
            const control = seat?.controlMode === 'normal' ? t('ui.multiplayer.normalControls') : seat?.controlMode === 'touch' ? t('ui.multiplayer.touchControls') : seat?.controlMode === 'cheat' ? t('ui.multiplayer.unlimited') : '';
            return <article key={index} aria-label={t('ui.multiplayer.seatRole', {seat: index + 1, role: index === 0 ? t('multiplayer.host') : t('ui.multiplayer.player')})} className={`mp-seat ${index === 0 && owner ? 'owner' : ''} ${seat ? `occupied ${seat.offline ? 'reconnecting' : ''} ${seat.ready ? 'is-ready' : ''}` : ''}`}>
              <div className="mp-seat-face">{seat ? <span className="mp-seat-glyph" aria-hidden="true">{nicknameInitial(seat.name)}</span> : <div className="mp-seat-drop"><button type="button" disabled={!lobby || busy} aria-label={t('ui.multiplayer.takeSeat', {seat: index + 1})} onClick={() => ensureMovementAllowed(() => perform(() => controller.takeSeat(index)))}>＋</button></div>}</div>
              <span className="mp-seat-index">P{index + 1}</span>
              {seat && <><strong className="mp-seat-name">{loadout ? label(loadout.labelKey) : t('ui.multiplayer.unknownLoadout')}</strong>
                <span className="mp-seat-control">{control}</span>
                <span className="mp-seat-state">{seatStatus}</span>
                {seat.resource && <span className="mp-seat-resource">{t('ui.multiplayer.resourceStatus', {status: seat.resource.status === 'ready' ? t('runtime.readyStatus') : seat.resource.status === 'preparing' ? t('ui.multiplayer.resourcePreparing', {progress: seat.resource.percent == null ? '' : ` ${seat.resource.percent}%`}) : seat.resource.status === 'failed' ? t('ui.multiplayer.failed') : seat.resource.status === 'cancelled' ? t('ui.multiplayer.cancelled') : t('ui.multiplayer.importing')})}</span>}
                {seat.clientId === snapshot.clientId && <button type="button" className="mp-seat-edit" aria-label={t('ui.multiplayer.personalSettings')} onClick={event => openPanel('personal', event.currentTarget)}/>}
                {owner && index > 0 && <button type="button" className="mp-seat-remove" aria-label={t('ui.multiplayer.removePlayer')} disabled={!lobby || busy} onClick={() => setConfirmation({kind: 'player', seat: index, clientId: seat.clientId, productId: route.productId, roomCode: route.roomCode, sessionSerial: snapshot.sessionSerial})}>×</button>}
              </>}
            </article>;
          })}
        </div>
        {!local && <section className="mp-unseated-note"><strong>{room?.localSpectator ? t('multiplayer.spectating') : t('multiplayer.chooseSeat')}</strong><span>{t('multiplayer.chooseSeatOrSpectate')}</span></section>}
        <button type="button" className="mp-network-summary" aria-label={t('ui.multiplayer.networkTiming')} aria-haspopup="dialog" aria-expanded={panels.kind === 'network'} onClick={event => openPanel('network', event.currentTarget)}><span>{t('ui.multiplayer.networkTiming')}</span><strong>{networkSummary}</strong></button>
        </div>
        <aside className="mp-spectator-rail">
          <button type="button" className="mp-spectator-rail-head" aria-haspopup="dialog" aria-expanded={panels.kind === 'spectators'} onClick={event => openPanel('spectators', event.currentTarget)} aria-label={t('ui.multiplayer.spectatorMembers', {count: room?.spectatorCount ?? 0})}>
            <span className="mp-spectator-stack" aria-hidden="true">{room?.spectators.slice(0, 3).map(spectator => <span key={spectator.clientId}>{nicknameInitial(spectator.name)}</span>)}</span>
            <span className="mp-spectator-caption"><img src={roomUsersIcon} alt="" aria-hidden="true" className="mp-room-icon mp-spectator-icon"/><span id="mpSpectatorCount">{room?.spectatorCount ?? 0}</span><span>{t('room.spectatorLounge')}</span><img src={roomCaretRightIcon} alt="" aria-hidden="true" className="mp-room-icon mp-spectator-caret"/></span>
          </button>
        </aside>
        <footer className="mp-room-footer">
          <button type="button" className={`mp-ready-button ${local?.ready ? 'ready' : ''}`} disabled={!lobby || busy || !local || !local.ready && !snapshot.runtimeAvailable} onClick={() => ensureMovementAllowed(() => perform(() => controller.setReady(!local?.ready)))}>{local?.ready ? t('ui.multiplayer.cancelReady') : t('lobby.ready')}</button>
          <button type="button" className="mp-start-button" disabled={!lobby || busy || !owner || !snapshot.runtimeAvailable || preparation?.status !== 'ready' || !!room?.seats.slice(0, room.playerCount).some(seat => !seat || seat.offline || !seat.ready)} onClick={() => ensureMovementAllowed(() => perform(() => controller.start()))}>{owner ? t('multiplayer.startGame') : t('multiplayer.waitHost')}</button>
          {snapshot.pendingAction && <p role="status" className="mp-owner-status">{t('ui.multiplayer.serverConfirmation')}</p>}
        </footer>
      </div>
      <AnimatedDialog onPresenceChange={setPanelPresent} open={panels.kind !== null} onOpenChange={open => {if (!open && !upperActive) panels.closePanel();}} layer={48}
        title={panel === 'personal' ? t('ui.multiplayer.personalSettings') : panel === 'game' ? t('multiplayer.gameSettings') : panel === 'network' ? t('ui.multiplayer.networkTiming') : panel === 'spectators' ? t('ui.multiplayer.spectatorMembers', {count: room?.spectatorCount ?? 0}) : t('ui.multiplayer.gameTouchSettings')}
        onPointerDownOutside={event => {if (upperActive) event.preventDefault();}}
        onEscapeKeyDown={event => {
          if (dismissNestedDialog(event, [{...help, dismiss: help.closeHelp}])) return;
          if (new URLSearchParams((navigation.location ?? location).search).has('touchLayout')) event.preventDefault();
        }}
        returnFocus={panelTrigger} layout={panel === 'options' ? 'library-panel' : 'dialog'} panelKind="room" swipeToClose={panels.kind === 'options' && !upperActive ? 'right' : undefined} swipeCloseKey={panels.key}>
        {panel === 'options' && <ProductPanelHeader productId={route.productId} onBack={panels.closePanel} backLabel={t('react.routes.backRoom')}/>}
        <div ref={panelBody} tabIndex={-1} className={panel === 'options' ? 'library-panel-scroll' : undefined}>
        {(error || snapshot.error || notice || snapshot.notice) && <p role={error || snapshot.error ? 'alert' : 'status'} className="mt-4 text-sm">{error || snapshot.error || (notice ? t(notice) : snapshot.notice)}</p>}
        <div hidden={panel !== 'personal'}><div className="grid gap-4 pt-4">
          <form className="grid gap-2" onSubmit={event => {event.preventDefault(); perform(() => controller.setDisplayName(name));}}><label className="grid gap-2 text-sm text-muted">{t('ui.multiplayer.lockedNameLabel')}<input className={field} value={snapshot.nameLocked ? snapshot.displayName : name} maxLength={12} autoComplete="off" disabled={snapshot.nameLocked} onChange={event => setName(event.target.value)}/></label>{!snapshot.nameLocked && <button type="submit" className={button}>{t('ui.multiplayer.saveName')}</button>}</form>
          <div className="grid gap-3 rounded-2xl border border-line p-4"><span className="text-sm text-muted">{t('ui.multiplayer.loadout')}</span><div className="flex items-center justify-between gap-3"><button type="button" aria-label={t('multiplayer.previousCharacter')} className={button} disabled={!lobby || busy || policy.loadouts.length < 2} onClick={() => perform(() => controller.setLoadout((snapshot.preferredLoadout + policy.loadouts.length - 1) % policy.loadouts.length))}>‹</button><div className="grid min-w-0 justify-items-center gap-2 text-center"><span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-[#e8cbd2] text-3xl text-[#842e43]">{policy.loadouts[snapshot.preferredLoadout]?.glyph ?? '?'}</span><strong>{label(policy.loadouts[snapshot.preferredLoadout]?.labelKey ?? 'ui.multiplayer.unknownLoadout')}</strong></div><button type="button" aria-label={t('multiplayer.nextCharacter')} className={button} disabled={!lobby || busy || policy.loadouts.length < 2} onClick={() => perform(() => controller.setLoadout((snapshot.preferredLoadout + 1) % policy.loadouts.length))}>›</button></div></div>
          <button type="button" className={button} disabled={!lobby || busy || !local} onClick={() => perform(() => controller.standUp())}>{t('ui.multiplayer.standUp')}</button>
          <button type="button" onClick={event => openPanel('options', event.currentTarget)} className="inline-flex min-h-11 items-center text-left text-sm text-accent underline">{t('ui.multiplayer.gameTouchSettings')}</button>
          <HelpLink className="text-sm text-accent underline">{t('ui.multiplayer.controlsHelp')}</HelpLink>
          <p className="text-xs text-muted">{t('ui.multiplayer.touchSettingsHint')}</p>
        </div></div>
        <div hidden={panel !== 'game'}><fieldset className="grid gap-4 pt-4" disabled={!lobby || busy || !owner || !room}>
          <p className="text-xs text-muted">{t('ui.multiplayer.hostSettingsHint')}</p>
          <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm text-muted">{t('lobby.capacity')}<select className={field} value={room?.playerCount ?? policy.playerCounts[0]} onChange={event => settings({playerCount: Number(event.target.value) as 2 | 3})}>{policy.playerCounts.map(count => <option key={count} value={count}>{t('lobby.playersCount', {count})}</option>)}</select></label><label className="grid gap-2 text-sm text-muted">{t('lobby.difficulty')}<select className={field} value={room?.difficulty ?? 1} onChange={event => settings({difficulty: Number(event.target.value)})}>{policy.difficulties.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label></div>
          <label className="grid gap-2 text-sm text-muted">{t('ui.multiplayer.visibility')}<select className={field} value={room?.visibility ?? 'public'} onChange={event => settings({visibility: event.target.value as 'public' | 'private'})}><option value="public">{t('ui.multiplayer.publicRoom')}</option><option value="private">{t('ui.multiplayer.privateRoom')}</option></select></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={room?.disableCheatMovement ?? false} onChange={event => settings({disableCheatMovement: event.target.checked})}/>{t('ui.multiplayer.disableUnlimited')}</label>
          {policy.gameplay === 'cooperative' && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={room?.challengeMode ?? false} onChange={event => settings({challengeMode: event.target.checked})}/>{challengeLabel}</label>}
        </fieldset></div>
        <div hidden={panel !== 'network'}><div className="grid gap-4 pt-4">
          <p className="text-xs leading-relaxed text-muted">{t('ui.multiplayer.networkHint')}</p>
          <button type="button" className={button} disabled={!lobby || !local} onClick={() => perform(() => controller.retryNetwork())}>{t('room.retry')}</button>
          {snapshot.peers.map(peer => <div key={peer.clientId} className="rounded-xl border border-line p-3"><h3 className="mb-3 text-sm">P{peer.seat + 1}</h3><div className="grid grid-cols-3 gap-3">{(['direct', 'turn', 'relay'] as const).map(lane => <div key={lane}><p className="text-xs text-muted">{lane === 'direct' ? t('room.direct') : lane === 'turn' ? 'TURN' : t('room.relay')}</p><p className="mt-1 text-sm tabular-nums">{peer.metrics[lane].state === 'connected' && peer.metrics[lane].rtt != null ? `${Math.round(peer.metrics[lane].rtt!)} ms` : peer.metrics[lane].state === 'checking' ? t('room.checking') : t('room.unavailable')}</p></div>)}</div></div>)}
          {!!policy.inputTiming && <fieldset className="grid gap-3" disabled={!lobby || !owner}><label className="grid gap-2 text-sm text-muted">{t('room.inputDelay')}<select className={field} value={snapshot.timingChoice.inputDelay} onChange={event => perform(() => controller.setTimingChoice({...snapshot.timingChoice, inputDelay: event.target.value === 'auto' ? 'auto' : Number(event.target.value)}))}><option value="auto">{policy.inputTiming.measuredStartup ? t('ui.multiplayer.runtimeInputDelay') : t('ui.multiplayer.automaticRecommendation')}</option>{Array.from({length: policy.inputTiming.measuredStartup ? 10 : 9}, (_, frames) => <option key={frames} value={frames}>{t('ui.multiplayer.frames', {frames})}</option>)}</select></label>
            {policy.inputTiming.measuredStartup && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={snapshot.timingChoice.rollback} onChange={event => perform(() => controller.setTimingChoice({...snapshot.timingChoice, rollback: event.target.checked}))}/>{t('ui.multiplayer.rollbackHint')}</label>}
          </fieldset>}
          {(snapshot.measuredTiming || room?.timing) && <p className="text-sm">{t('ui.multiplayer.measuredInputDelay', {frames: (snapshot.measuredTiming || room?.timing)!.inputDelay})}</p>}
        </div></div>
        <div hidden={panel !== 'spectators'}><ul className="mp-spectator-list pt-4">{room?.spectators.map((spectator, index) => <li key={spectator.clientId} className="mp-spectator-entry"><span className="mp-spectator-avatar" aria-hidden="true">{nicknameInitial(spectator.name)}</span><span className="mp-spectator-copy"><strong>{t('room.spectatorNumber', {number: index + 1})}</strong>{spectator.clientId === snapshot.clientId && <small>{t('ui.multiplayer.meSuffix')}</small>}</span>{owner && <button type="button" className={button} disabled={!lobby || busy} onClick={() => setConfirmation({kind: 'spectator', clientId: spectator.clientId, productId: route.productId, roomCode: route.roomCode, sessionSerial: snapshot.sessionSerial})}>{t('ui.multiplayer.remove')}</button>}</li>)}{!room?.spectatorCount && <li className="text-sm text-muted">{t('ui.multiplayer.noSpectators')}</li>}</ul><button type="button" className="mp-spectator-join" disabled={!live || busy} onClick={() => perform(() => room?.localSpectator ? controller.leaveSpectator() : controller.spectate())}>{room?.localSpectator ? t('ui.multiplayer.leaveSpectators') : t('ui.multiplayer.joinSpectators')}</button></div>
        {panel === 'options' && <div className="pt-4"><GameSettings productId={route.productId} fileTools={<SettingsFileTools productId={route.productId}/>} multiplayerActions={<MultiplayerSettingsActions productId={route.productId}/>}/></div>}
        </div>
        <button type="button" className={`${button} mt-5 ${panel === 'options' ? 'mx-6 mb-5 shrink-0' : ''}`} onClick={panels.closePanel}>{t('action.close')}</button>
      </AnimatedDialog>
      <AnimatedDialog open={movementPrompt} onOpenChange={open => {if (!open) {movementDecision.current = null; setMovementPrompt(false);}}} title={t('room.movementRequired')} description={t('room.movementRequiredHint')} layer={70}>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={() => {movementDecision.current = null; setMovementPrompt(false);}}>{t('action.cancel')}</button><button type="button" className={button} onClick={() => chooseMovement('joystick')}>{t('room.useJoystick')}</button><button type="button" className={`${button} bg-red`} onClick={() => chooseMovement('touch')}>{t('room.useTouch')}</button></div>
      </AnimatedDialog>
      <AnimatedDialog open={confirmation !== null} onOpenChange={open => {if (!open) setConfirmation(null);}} title={t('action.confirm')} description={confirmation?.kind === 'player' ? t('room.removePlayerConfirm', {seat: confirmation.seat + 1}) : confirmation ? t('room.removeSpectatorConfirm') : ''} layer={70}>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={() => setConfirmation(null)}>{t('action.cancel')}</button><button type="button" className={`${button} bg-red`} onClick={confirmRemoval}>{confirmation?.kind === 'player' ? t('room.removePlayer', {seat: confirmation.seat + 1}) : t('room.removeSpectator')}</button></div>
      </AnimatedDialog>
    </div>
  </section>;
}
