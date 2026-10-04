import {useLayoutEffect, useRef, useState} from 'react';
import {AnimatedDialog} from './AnimatedDialog';
import {ProductPanelHeader} from './ProductPanelHeader';
import {GameSettings} from './GameSettings';
import {useRoomPanelNavigation} from './RoomPanelNavigation';
import {copyText} from '../browser/clipboard';
import type {RoomPanelKind} from '../services/room-panel-route';
import {useNavigate} from 'react-router';
import {HelpLink} from './HelpPanel';
import {PRODUCT_GAMES, gameIdForProduct, multiplayerConfigForProduct} from '../../src/contracts/product-catalog.mts';
import {isUiMessageKey, type UiMessageKey} from '../../src/launcher/i18n.mts';
import type {MultiplayerRoomController, MultiplayerRoomSnapshot} from '../services/multiplayer-room.client';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
import {useLocale} from './LocaleProvider';
const button = 'inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#30312c] px-4 py-2.5 text-sm text-paper hover:bg-[#3c3e36] disabled:cursor-not-allowed disabled:opacity-40';
const field = 'min-h-11 w-full rounded-xl border border-line bg-[#30312c] px-3 text-base text-paper';
export function MultiplayerRoom() {
  const {t} = useLocale();
  const {controller, snapshot} = useMultiplayerRoom();
  if (!controller || !snapshot?.route) return <p role="status" className="py-8 text-muted">{t('ui.multiplayer.roomLoading')}</p>;
  if (snapshot.launch === 'running') return <p role="status" className="text-sm text-muted">{t('ui.multiplayer.runtimeHandoff')}</p>;
  return <MultiplayerRoomView controller={controller} snapshot={snapshot}/>;
}
export function MultiplayerRoomView({controller, snapshot, embedded = false, onLeave, leaveLabel}: {controller: MultiplayerRoomController; snapshot: MultiplayerRoomSnapshot; embedded?: boolean; onLeave?(): void; leaveLabel?: string}) {
  const {t} = useLocale();
  const label = (key: string) => isUiMessageKey(key) ? t(key) : key;
  const connectionLabel = {idle: t('ui.multiplayer.waitingRoom'), loading: t('ui.multiplayer.readingConfig'), connecting: t('ui.multiplayer.connecting'), connected: t('ui.multiplayer.connected'), reconnecting: t('ui.multiplayer.reconnecting'), unavailable: t('ui.multiplayer.connectionUnavailable')};

  const navigate = useNavigate(), panels = useRoomPanelNavigation();
  const retainedPanel = useRef<RoomPanelKind>('personal'), panelTrigger = useRef<HTMLElement | null>(null);
  const personalTrigger = useRef<HTMLButtonElement>(null), panelBody = useRef<HTMLDivElement>(null);
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
  const [name, setName] = useState(snapshot.displayName);
  const route = snapshot.route!;
  const game = PRODUCT_GAMES[gameIdForProduct(route.productId)], policy = multiplayerConfigForProduct(route.productId)!;
  const room = snapshot.room, local = room?.localSeat != null ? room.seats[room.localSeat] : null;
  const live = snapshot.connection === 'connected', lobby = live && room?.phase === 'lobby', owner = room?.localSeat === 0;
  const busy = !!snapshot.pendingAction;
  function perform(callback: () => void | Promise<unknown>) {
    setError(null); setNotice(null);
    try {void Promise.resolve(callback()).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));}
    catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
  }
  function settings(patch: Partial<Pick<NonNullable<typeof room>, 'playerCount' | 'difficulty' | 'visibility' | 'disableCheatMovement'>>) {
    if (!room) return;
    perform(() => controller.setRoomSettings({playerCount: room.playerCount, difficulty: room.difficulty, visibility: room.visibility, disableCheatMovement: room.disableCheatMovement, ...patch}));
  }
  const preparation = snapshot.preparation;
  return <section aria-label={t('multiplayer.roomAria')} className={`${embedded ? 'relative min-h-svh' : 'fixed inset-0 overflow-y-auto'} overscroll-contain bg-[#111210] px-5 pt-[max(18px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] text-paper sm:px-8 lg:px-14 ${snapshot.launch === 'starting' ? 'z-10' : 'z-[15]'}`}>
    <div className="mx-auto max-w-[1440px]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <button type="button" className={button} onClick={onLeave ?? (() => void navigate(`/lobby?game=${route.productId}`, {replace: true}))}>{leaveLabel ?? t('ui.multiplayer.backLobby')}</button>
        <span role="status" className="text-sm text-muted">{connectionLabel[snapshot.connection]}</span>
        <button type="button" className={`${button} gap-2`} onClick={() => perform(async () => {setNotice(await copyText(route.roomCode) ? 'ui.multiplayer.codeCopied' : 'ui.multiplayer.codeCopyFailed');})}><span className="text-xs text-muted">{t('lobby.roomCode')}</span><strong className="text-xl tracking-widest">{route.roomCode}</strong><span className="text-xs">{t('ui.multiplayer.copy')}</span></button>
      </header>
      <div className="py-7 sm:py-10">
        <h1 lang="ja" className="text-[clamp(30px,4vw,54px)] leading-tight font-black">{game.title}</h1>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted"><span>{t('library.multiplayer')}</span>{room && <><span>{policy.difficulties[room.difficulty]}</span><span>{t('lobby.playersCount', {count: room.playerCount})}</span><span>{room.visibility === 'private' ? t('ui.multiplayer.privateRoom') : t('ui.multiplayer.publicRoom')}</span><span>{room.phase === 'lobby' ? t('multiplayer.waitReady') : room.phase === 'starting' ? t('room.starting') : t('lobby.playing')}</span>{room.disableCheatMovement && <span>{t('ui.multiplayer.unlimitedDisabled')}</span>}</>}</div>
      </div>
      {(error || snapshot.error || notice || snapshot.notice) && <p lang={error || snapshot.error || !notice ? 'zh-CN' : undefined} role={error || snapshot.error ? 'alert' : 'status'} className="mb-5 rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed">{error || snapshot.error || (notice ? t(notice) : snapshot.notice)}</p>}
      {!live && <button type="button" className={`${button} mb-5`} onClick={() => controller.retry()}>{t('ui.multiplayer.reconnectRoom')}</button>}
      {!snapshot.runtimeAvailable && <p className="mb-5 rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">{t('ui.multiplayer.runtimeUnavailable')}</p>}
      {snapshot.runtimeAvailable && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-panel p-4 text-sm">
        <p role="status" className="grow">{preparation?.status === 'ready' ? t('ui.multiplayer.resourcesPrepared') : preparation?.status === 'preparing' ? t('ui.multiplayer.preparingStage', {stage: preparation.stage === 'package' ? t('transfer.gameResources') : 'Runtime', progress: preparation.percent == null ? '…' : ` ${preparation.percent}%`}) : preparation?.status === 'failed' ? t('ui.multiplayer.resourcesFailed') : preparation?.status === 'cancelled' ? t('ui.multiplayer.resourcesCancelled') : t('ui.multiplayer.prepareFirst')}</p>
        <button type="button" className={button} disabled={preparation?.status === 'preparing' || preparation?.status === 'ready'} onClick={() => perform(() => controller.prepare())}>{t('ui.multiplayer.prepareResources')}</button>
        {preparation?.status === 'preparing' && <button type="button" className={button} onClick={() => controller.cancelPreparation()}>{t('ui.multiplayer.cancelPreparation')}</button>}
      </div>}
      <div className="grid gap-6 rounded-[28px] border border-line bg-[#20211ef0] p-5 md:p-7 lg:grid-cols-[minmax(0,1fr)_160px_190px]">
        <div className={`grid gap-5 ${room?.playerCount === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {Array.from({length: room?.playerCount ?? 2}, (_, index) => {
            const seat = room?.seats[index], loadout = seat ? policy.loadouts[seat.loadout] : null;
            return <article key={index} aria-label={t('ui.multiplayer.seatRole', {seat: index + 1, role: index === 0 ? t('multiplayer.host') : t('ui.multiplayer.player')})} className="flex min-w-0 flex-col gap-3 border-b border-line pb-5 sm:border-r sm:border-b-0 sm:pr-5 sm:pb-0 last:border-0">
              <span className="text-xs tracking-[.18em] text-muted">P{index + 1}{index === 0 && t('ui.multiplayer.hostSuffix')}</span>
              {seat ? <><div aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-[#e8cbd2] text-3xl text-[#842e43]">{loadout?.glyph ?? '?'}</div><h2 className="text-lg font-bold break-words">{seat.name || t('multiplayer.namePlaceholder')}{seat.clientId === snapshot.clientId && <span className="ml-2 text-xs font-normal text-muted">{t('multiplayer.you')}</span>}</h2><p className="text-sm text-muted">{loadout ? label(loadout.labelKey) : t('ui.multiplayer.unknownLoadout')}</p><p className={`text-sm ${seat.offline ? 'text-muted' : seat.ready ? 'text-[#b5dfaa]' : 'text-[#dfc38c]'}`}>{seat.offline ? t('ui.multiplayer.playerReconnecting') : seat.ready ? t('room.ready') : t('ui.multiplayer.waitingReady')}</p>
                {seat.resource && <p className="text-xs text-muted">{t('ui.multiplayer.resourceStatus', {status: seat.resource.status === 'ready' ? t('runtime.readyStatus') : seat.resource.status === 'preparing' ? t('ui.multiplayer.resourcePreparing', {progress: seat.resource.percent == null ? '' : ` ${seat.resource.percent}%`}) : seat.resource.status === 'failed' ? t('ui.multiplayer.failed') : seat.resource.status === 'cancelled' ? t('ui.multiplayer.cancelled') : t('ui.multiplayer.importing')})}</p>}
                {seat.controlMode && <p className="text-xs text-muted">{seat.controlMode === 'normal' ? t('ui.multiplayer.normalControls') : seat.controlMode === 'touch' ? t('ui.multiplayer.touchControls') : t('ui.multiplayer.unlimited')}</p>}
                {owner && index > 0 && <button type="button" className={button} disabled={!lobby || busy} onClick={() => perform(() => controller.removePlayer(index, seat.clientId))}>{t('ui.multiplayer.removePlayer')}</button>}
              </> : <button type="button" className={`${button} min-h-32 flex-col gap-3 border border-dashed border-line bg-transparent`} disabled={!lobby || busy} onClick={() => perform(() => controller.takeSeat(index))}><span className="text-3xl">＋</span>{t('ui.multiplayer.takeSeat', {seat: index + 1})}</button>}
            </article>;
          })}
        </div>
        <aside className="border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"><h2 className="mb-3 text-sm text-muted">{t('ui.multiplayer.spectatorCount', {count: room?.spectatorCount ?? 0})}</h2><button type="button" className={`${button} w-full`} disabled={!live || busy} onClick={() => perform(() => room?.localSpectator ? controller.leaveSpectator() : controller.spectate())}>{room?.localSpectator ? t('ui.multiplayer.leaveSpectators') : t('ui.multiplayer.joinSpectators')}</button><p className="mt-3 text-xs leading-relaxed text-muted">{t('ui.multiplayer.lateSpectatorHint')}</p></aside>
        <footer className="grid content-center gap-3 border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <button type="button" className={`${button} rounded-full bg-red font-bold`} disabled={!lobby || busy || !local || !local?.ready && (!snapshot.runtimeAvailable || preparation?.status !== 'ready')} onClick={() => perform(() => controller.setReady(!local?.ready))}>{local?.ready ? t('ui.multiplayer.cancelReady') : t('lobby.ready')}</button>
          <button type="button" className={`${button} rounded-full bg-red font-bold`} disabled={!lobby || busy || !owner || !snapshot.runtimeAvailable || preparation?.status !== 'ready' || !!room?.seats.slice(0, room.playerCount).some(seat => !seat || seat.offline || !seat.ready)} onClick={() => perform(() => controller.start())}>{owner ? t('multiplayer.startGame') : t('multiplayer.waitHost')}</button>
          {snapshot.pendingAction && <p role="status" className="text-xs text-muted">{t('ui.multiplayer.serverConfirmation')}</p>}
        </footer>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <button ref={personalTrigger} type="button" className={button} aria-haspopup="dialog" aria-expanded={panels.kind === 'personal'} onClick={event => openPanel('personal', event.currentTarget)}>{t('ui.multiplayer.personalSettings')}</button>
        <button type="button" className={button} aria-haspopup="dialog" aria-expanded={panels.kind === 'game'} onClick={event => openPanel('game', event.currentTarget)}>{t('multiplayer.gameSettings')}</button>
        <button type="button" className={button} aria-haspopup="dialog" aria-expanded={panels.kind === 'network'} onClick={event => openPanel('network', event.currentTarget)}>{t('ui.multiplayer.networkTiming')}</button>
        <button type="button" className={button} aria-haspopup="dialog" aria-expanded={panels.kind === 'spectators'} onClick={event => openPanel('spectators', event.currentTarget)}>{t('ui.multiplayer.spectatorMembers', {count: room?.spectatorCount ?? 0})}</button>
      </div>
      <AnimatedDialog open={panels.kind !== null} onOpenChange={open => {if (!open) panels.closePanel();}} layer={48}
        title={panel === 'personal' ? t('ui.multiplayer.personalSettings') : panel === 'game' ? t('multiplayer.gameSettings') : panel === 'network' ? t('ui.multiplayer.networkTiming') : panel === 'spectators' ? t('ui.multiplayer.spectatorMembers', {count: room?.spectatorCount ?? 0}) : t('ui.multiplayer.gameTouchSettings')}
        returnFocus={panelTrigger.current ? panelTrigger : personalTrigger} layout={panel === 'options' ? 'library-panel' : 'dialog'}>
        {panel === 'options' && <ProductPanelHeader productId={route.productId} onBack={panels.closePanel} backLabel={t('react.routes.backRoom')}/>}
        <div ref={panelBody} tabIndex={-1} className={panel === 'options' ? 'library-panel-scroll' : undefined}>
        {(error || snapshot.error || notice || snapshot.notice) && <p role={error || snapshot.error ? 'alert' : 'status'} className="mt-4 text-sm">{error || snapshot.error || (notice ? t(notice) : snapshot.notice)}</p>}
        <div hidden={panel !== 'personal'}><div className="grid gap-4 pt-4">
          <form className="grid gap-2" onSubmit={event => {event.preventDefault(); perform(() => controller.setDisplayName(name));}}><label className="grid gap-2 text-sm text-muted">{t('ui.multiplayer.lockedNameLabel')}<input className={field} value={snapshot.nameLocked ? snapshot.displayName : name} maxLength={12} autoComplete="off" disabled={snapshot.nameLocked} onChange={event => setName(event.target.value)}/></label>{!snapshot.nameLocked && <button type="submit" className={button}>{t('ui.multiplayer.saveName')}</button>}</form>
          <label className="grid gap-2 text-sm text-muted">{t('ui.multiplayer.loadout')}<select className={field} value={snapshot.preferredLoadout} disabled={!lobby || busy} onChange={event => perform(() => controller.setLoadout(Number(event.target.value)))}>{policy.loadouts.map((loadout, index) => <option key={index} value={index}>{label(loadout.labelKey)}</option>)}</select></label>
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
        <div hidden={panel !== 'spectators'}><ul className="grid gap-3 pt-4">{room?.spectators.map(spectator => <li key={spectator.clientId} className="flex items-center justify-between gap-3 rounded-xl bg-[#30312c] p-3"><span className="min-w-0 break-words text-sm">{spectator.name || t('multiplayer.namePlaceholder')}{spectator.clientId === snapshot.clientId && t('ui.multiplayer.meSuffix')}</span>{owner && <button type="button" className={button} disabled={!lobby || busy} onClick={() => perform(() => controller.removeSpectator(spectator.clientId))}>{t('ui.multiplayer.remove')}</button>}</li>)}{!room?.spectatorCount && <li className="text-sm text-muted">{t('ui.multiplayer.noSpectators')}</li>}</ul></div>
        {panel === 'options' && <div className="pt-4"><GameSettings productId={route.productId}/></div>}
        </div>
        <button type="button" className={`${button} mt-5 ${panel === 'options' ? 'mx-6 mb-5 shrink-0' : ''}`} onClick={panels.closePanel}>{t('action.close')}</button>
      </AnimatedDialog>
    </div>
  </section>;
}
