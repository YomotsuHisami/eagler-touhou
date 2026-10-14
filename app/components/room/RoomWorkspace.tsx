import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent} from 'react';
import {CHARACTER_ART} from '../../../src/contracts/character-art.mts';
import {multiplayerDisplayInitial} from '../../../src/launcher/multiplayer-identity.mts';
import {useLocale} from '../../i18n';
import {scoreText} from '../launcher/score-copy';
import {CharacterPortraits} from '../launcher/CharacterPortraits';
import {MainSelect} from '../launcher/MainSelect';
import {roomPresentation, roomConnectionMessage} from './presentation';
import {roomLoadoutArt, roomLoadoutGroups} from './room-loadouts';
import {RoomPanel} from './RoomPanel';
import {RoomPersonal} from './RoomPersonal';
import {RoomNetwork} from './RoomNetwork';
import {RoomSpectators} from './RoomSpectators';
import {RoomGameSettings} from './RoomGameSettings';
import type {RoomViewProps, RoomPanelKind} from './types';
import type {RoomOwnerSnapshot, MultiplayerRoomService} from '../../services/multiplayer-room';
import {RoomSeatProgress} from './RoomSeatProgress';

export function RoomWorkspace(props: RoomViewProps) {
  const {t} = useLocale(), {service, network, context, assetUrl} = props;
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  useSyncExternalStore(network.subscribe, network.getSnapshot, network.getSnapshot);
  const trigger = useRef<HTMLElement | null>(null), retained = useRef<NonNullable<RoomViewProps['panel']>>({kind:'personal'});
  if (props.panel) retained.current = props.panel;
  const panel = props.panel ?? retained.current;
  useLayoutEffect(() => {if (props.panel) service.setRoomSettingsOpen(props.panel.kind === 'game');}, [service, props.panel?.kind]);
  useLayoutEffect(() => {service.setRoomProductBusy(props.settingsOpen || !!props.panel);}, [service, props.settingsOpen, props.panel?.kind]);
  useLayoutEffect(() => {service.setEditingSettings(props.settingsOpen || props.panel?.kind === 'game');}, [service, props.settingsOpen, props.panel?.kind]);
  useLayoutEffect(() => () => {service.setRoomProductBusy(false); service.setEditingSettings(false);}, [service]);
  const p = roomPresentation(state, t);
  const focusedSeat = useRef<string | null>(null);
  useEffect(() => {
    if (props.visible === false || state.seat == null) {focusedSeat.current = null; return;}
    if (!p?.ready || p.room.phase !== 'lobby' || props.settingsOpen || props.panel || context.launched || context.launchStage || context.th09NetworkOverlayOpen) return;
    const key = `${state.epoch}:${state.seat}`;
    if (focusedSeat.current === key) return;
    const seat = document.querySelector<HTMLElement>('.room-workspace-seat.is-local');
    if (!seat) return;
    let active = true;
    // The relay can assign our seat after entry ends, or while the parent card
    // is still inert. Focus once both are ready, including a direct room URL.
    const focus = () => {
      if (!active || !seat.isConnected || seat.closest('[inert],[hidden],[data-workspace-motion]') || document.querySelector('dialog[open]')) return;
      seat.focus({preventScroll:true});
      if (document.activeElement === seat) {focusedSeat.current = key; active = false; observer.disconnect();}
    };
    const observer = new MutationObserver(focus);
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['inert','hidden','data-workspace-motion','open']});
    queueMicrotask(focus);
    return () => {active = false; observer.disconnect();};
  }, [state.epoch, state.seat, p?.ready, p?.room.phase, props.visible, props.settingsOpen, props.panel, context.launched, context.launchStage, context.th09NetworkOverlayOpen]);
  if (!p) return <section className="workspace-panel room-workspace" id="mpRoomView" inert={props.settingsOpen} data-room-settings-open={props.settingsOpen} aria-busy="true" aria-label={t('room.redesignTitle')}><h1>{t('room.redesignTitle')}</h1><p role="status">{t('multiplayer.connectingRoom')}</p></section>;
  const {room, config, ready, owner, game} = p;
  const open = (kind: RoomPanelKind, element: HTMLElement, peerId?: string) => {trigger.current = element; props.onOpenPanel(kind,peerId);};
  const editable = ready && owner && room.phase === 'lobby' && !state.productPending;
  const connectionText = !ready ? roomConnectionMessage(state,t) : context.launchStage === 'path' ? t('room.connectingGameplay') : context.launchStage || room.phase === 'starting' ? t('room.starting') : room.phase === 'running' ? t('room.running') : t('room.online');
  const allReady = state.canStart && state.preparation?.status === 'ready';
  return <section className="workspace-panel room-workspace" id="mpRoomView" hidden={props.visible === false} inert={props.settingsOpen} data-room-settings-open={props.settingsOpen} aria-label={`${game.title} ${t('room.redesignTitle')}`}>
    <header className="room-workspace-header">
      <h1>{t('room.redesignTitle')}</h1>
      <div className="room-workspace-tools" role="group" aria-label={t('room.redesignTitle')} tabIndex={0}>
      <div className="room-workspace-heading">
        <label className="room-difficulty" htmlFor="roomDifficultyPicker"><span>{t('lobby.difficulty')}</span><MainSelect className="option-select" aria-label={t('lobby.difficulty')} id="roomDifficultyPicker" value={String(room.difficulty)} disabled={!editable} onChange={event => service.setRoomSettings({difficulty:Number(event.currentTarget.value)})}>{config.difficulties.map((name,index) => <option key={name} value={index}>{name}</option>)}</MainSelect></label>
        <button className="workspace-control room-workspace-button room-cheat" aria-pressed={!room.disableCheatMovement} disabled={!editable} onClick={() => service.setRoomSettings({disableCheatMovement:!room.disableCheatMovement})}>{t(room.disableCheatMovement ? 'room.forbidCheat' : 'room.allowCheat')}</button>
        <button className="workspace-control room-workspace-button room-directory-lock" id="roomDirectoryLock" aria-pressed={room.directoryLocked !== false} disabled={!editable || !state.productSwitchSupported || state.productPending} title={t(!state.productSwitchSupported ? 'room.switchUnsupported' : room.directoryLocked !== false ? 'room.unlockDirectory' : 'room.lockDirectory')} onClick={() => service.setDirectoryLocked(room.directoryLocked === false)}>{t('room.directoryLockToggle')}</button>
      </div>
      <div className="room-workspace-connection"><span id="mpRoomConnection" role="status" data-idle-connected={ready && !context.launchStage && room.phase === 'lobby'}>{connectionText}</span>
        <button className="workspace-control room-workspace-button room-privacy" id="roomVisibilityToggle" disabled={!editable} aria-pressed={room.visibility === 'private'} aria-label={t(room.visibility === 'private' ? 'room.private' : 'room.public')} title={t(room.visibility === 'private' ? 'room.private' : 'room.public')} onClick={() => service.setRoomSettings({visibility:room.visibility === 'private' ? 'public' : 'private'})}><img className="room-icon" src={assetUrl(room.visibility === 'private' ? 'assets/room-lock-closed.svg' : 'assets/room-lock-open.svg')} alt="" width="18" height="18"/></button>
        <button className="workspace-control room-workspace-button room-code" id="mpCopyRoomCode" aria-label={t('multiplayer.copyRoomCode')} title={t('multiplayer.copyRoomCode')} onClick={() => {void props.onCopyRoomCode(room.code);}}><img className="room-icon" src={assetUrl('assets/room-copy.svg')} alt="" width="18" height="18"/><strong id="mpRoomCode">{room.code}</strong></button>
      </div>
      </div>
    </header>
    {/* A seated player's own seat already names the failure and offers retry. */}
    {state.preparation?.status === 'failed' && <p className="room-preparation-warning" role="alert">{state.preparation.error || t('room.resourcesUnavailable')}{state.seat == null && <button onClick={service.retryPreparation}>{t('room.retryDownload')}</button>}</p>}
    <div className="room-workspace-content"><div className="room-workspace-seats" id="mpSeatStage" data-player-count={room.playerCount}>
      {Array.from({length:room.playerCount},(_,index) => <WorkspaceSeat key={`${state.epoch}:${index}`} state={state} service={service} index={index} assetUrl={assetUrl} onPersonal={element => open('personal',element)} onNetwork={(element,peer) => open('network',element,peer)}/>)}
    </div>{owner && config.playerCounts.includes(3) && room.playerCount === 2 && <button className="room-add-player" id="roomAddPlayer" disabled={!editable} aria-label={t('room.addThirdPlayer')} onClick={() => service.setRoomSettings({playerCount:3})}>＋</button>}
    </div>
    <footer className="room-workspace-footer"><div className="room-workspace-return-actions"><button className="room-workspace-button" id="mpLeaveRoom" disabled={state.retentionPending} onClick={() => {void props.onLeave();}}>{t('room.returnLobby')}</button>{owner && <button className="room-workspace-button room-dissolve" id="mpDissolveRoom" disabled={!ready || !state.retentionSupported || state.retentionPending || state.productPending || room.phase !== 'lobby' || state.checkBusy || state.launchBusy} title={!state.retentionSupported ? t('room.dissolveUnsupported') : undefined} onClick={() => {void (props.onDissolve ? props.onDissolve() : service.dissolveRoom());}}>{t('room.dissolve')}</button>}</div><div className="room-workspace-actions">
      <button className="room-workspace-button" id="mpReady" hidden={state.seat == null} disabled={!state.ready && (!state.selectionConfirmed || state.preparation?.status !== 'ready') || state.loadoutPending || state.productPending || !ready || room.phase !== 'lobby' || state.checkBusy} aria-pressed={state.ready} onClick={() => {void service.toggleReady();}}>{t(state.ready ? 'multiplayer.readyDone' : 'multiplayer.ready')}</button>
      <button className="room-workspace-button room-primary" id="mpStartGame" hidden={!owner} disabled={!allReady} onClick={service.start}>{t('multiplayer.startGame')}</button>
    </div></footer>

    <RoomPanel open={!!props.panel} kind={panel.kind} peerId={panel.peerId} trigger={trigger} onCloseRequest={props.onClosePanel} onClosed={() => service.setRoomSettingsOpen(false)}>
      <RoomPersonal state={state} service={service} assetUrl={assetUrl} th09NetworkOverlayOpen={context.th09NetworkOverlayOpen} hidden={panel.kind !== 'personal'}/>
      <RoomNetwork state={state} network={network} context={context} peerId={panel.peerId} hidden={panel.kind !== 'network'}/>
      <RoomSpectators state={state} service={service} hidden={panel.kind !== 'spectators'}/><RoomGameSettings state={state} service={service} hidden={panel.kind !== 'game'}/>
    </RoomPanel>
  </section>;
}

function WorkspaceSeat({state,service,index,assetUrl,onPersonal,onNetwork}: {state:RoomOwnerSnapshot; service:MultiplayerRoomService; index:number; assetUrl(path:string):string; onPersonal(element:HTMLElement):void; onNetwork(element:HTMLElement,peer:string):void}) {
  const {t,locale} = useLocale(), p = roomPresentation(state,t)!;
  const seat = p.room.synced ? p.room.seats?.[index] : null, local = state.seat === index, occupied = !!seat || local && p.room.synced;
  const isHost = p.room.hostClientId === undefined ? index === 0 : seat?.clientId === p.room.hostClientId;
  const removable = p.owner && !local && p.room.phase === 'lobby' && (occupied || p.room.playerCount === 3 && state.roomCardsSupported);
  const [step,setStep] = useState<'character'|'mode'>('character');
  const stage = local && state.selectionConfirmed ? 'done' : step;
  useLayoutEffect(() => setStep('character'), [local, state.epoch, state.seat]);
  const node = useRef<HTMLElement>(null), swipe = useRef<{x:number;y:number}|null>(null);
  const loadoutIndex = local ? p.normalize(state.preferredLoadout) : p.normalize(seat?.loadout);
  const groups = roomLoadoutGroups(state.product!), groupIndex = groups.findIndex(group => group.includes(loadoutIndex)), group = groups[groupIndex] ?? groups[0]!;
  const art = roomLoadoutArt(state.product!,loadoutIndex), baseArt = roomLoadoutArt(state.product!,group[0]!);
  const name = state.product==='th08mp' && locale==='zh-CN' ? ['结界组','咏唱组','红魔组','幽冥组'][groupIndex] : baseArt.map(id => scoreText(CHARACTER_ART[id].name,locale)).join(' & ');
  const shotLabel = (value:number) => {
    if(locale!=='zh-CN') return p.label(value);
    const loadout=p.config.loadouts[value]!;
    if(state.product==='th08mp') return value<4 ? '组合' : `${p.label(value)} · 单人`;
    const spells=state.product==='th06mp'||state.product==='th07mp' ? [['灵符','梦符'],['魔符','恋符'],['幻符','时符']] : state.product==='th10mp' ? [['诱导装备','前方集中装备','封印装备'],['高威力装备','贯通装备','魔法使装备']] : null;
    const spell=spells?.[loadout.character]?.[loadout.shot];
    return spell ? `${String.fromCharCode(65+loadout.shot)} · ${spell}` : p.label(value);
  };
  const mutable = local && p.ready && p.room.phase === 'lobby' && !state.ready && !state.loadoutPending && !state.productPending && !state.checkBusy && !state.launchBusy;
  const select = (value:number, confirmed = false): boolean => {
    const current=service.getSnapshot();
    if(current.epoch!==state.epoch || current.seat!==index || !current.connected || !current.room?.synced || current.room.phase!=='lobby' || current.ready || current.loadoutPending || current.checkBusy || current.launchBusy) return false;
    service.changeLoadout(value-current.preferredLoadout, confirmed); return true;
  };
  const move = (delta:number) => {
    if (!mutable || stage === 'done') return;
    const next = stage === 'character' ? groups[(groupIndex+delta+groups.length)%groups.length]![0]! : group[(group.indexOf(loadoutIndex)+delta+group.length)%group.length]!;
    select(next);
  };
  const confirm = () => {if (!mutable || service.getSnapshot().loadoutPending) return; if (stage === 'character' && group.length>1) setStep('mode'); else select(loadoutIndex, true);};
  const reselect = () => {if (!mutable) return; select(loadoutIndex, false);setStep('character');node.current?.focus({preventScroll:true});};
  useLayoutEffect(() => {
    const element=node.current;
    if(local && stage==='done' && element?.contains(document.activeElement)) document.getElementById('mpReady')?.focus({preventScroll:true});
  },[local,stage,state.loadoutPending]);
  const key = (event:KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || (event.target instanceof Element && event.target.closest('input,select,[role="listbox"]'))) return;
    if(event.target instanceof Element && event.target.closest('button') && (!event.target.closest('.room-shot-options') || event.key==='Enter' || event.key===' ')) return;
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(event.key)) return;
    event.preventDefault();event.stopPropagation();if(event.repeat)return;
    if(event.key==='Escape') {if(mutable){select(loadoutIndex, false);setStep(stage==='done' && group.length>1 ? 'mode' : 'character');}} else if(event.key==='Enter')confirm();else move(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1);
  };
  return <article ref={node} className={`room-workspace-seat${local ? ' is-local':''}${occupied ? ' occupied':''}`} data-mp-seat={index} tabIndex={local ? 0 : undefined} aria-label={local ? t('room.chooseCharacter') : `P${index+1}`} onKeyDown={key}
    onPointerDown={event => {if(mutable && event.pointerType==='touch' && event.isPrimary && !(event.target instanceof Element && event.target.closest('button'))) {swipe.current={x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture(event.pointerId);}}}
    onPointerCancel={() => {swipe.current=null;}} onPointerUp={event => {const start=swipe.current;swipe.current=null;if(!start)return;const dx=event.clientX-start.x,dy=event.clientY-start.y;if(Math.abs(dx)>35 && Math.abs(dx)>Math.abs(dy))move(dx<0?1:-1);else if(Math.abs(dx)<12&&Math.abs(dy)<12)confirm();}}>
    <h3>P{index+1}</h3><p className="room-player-name">{occupied ? <>{local ? t('multiplayer.you') : seat?.name || t('multiplayer.namePlaceholder')}{isHost ? ` · ${t('multiplayer.host')}` : ''}<span className={`room-ready-badge${seat?.ready ? ' ready':''}`} role="img" aria-label={t(seat?.ready ? 'room.ready' : 'room.notReady')}>{seat?.ready ? '✓' : ''}</span></> : t('room.waitPlayer')}</p>
    {removable && <button className="room-player-remove" disabled={!p.ready || state.productPending} aria-label={t(occupied ? 'room.removePlayer' : 'room.removeEmptySeat',{seat:index+1})} title={t(occupied ? 'room.removePlayer' : 'room.removeEmptySeat',{seat:index+1})} onClick={() => {if (occupied) void service.removePlayer(index); else service.removeEmptySeat(index);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>}
    {occupied && <><button className="room-player-avatar" aria-label={local ? t('room.playerOptions') : t('room.connections')} disabled={!local && (!seat || seat.offline || !p.ready)} onClick={event => {if(local)onPersonal(event.currentTarget);else if(seat)onNetwork(event.currentTarget,seat.clientId);}}>{multiplayerDisplayInitial(local ? state.displayName : seat?.name,'?')}</button>
      <div className="room-character-art" key={art.join(':')}><CharacterPortraits label={t('room.currentLoadout')} characters={art} assetUrl={assetUrl}/></div>
      <div className="room-character-details">{local && stage!=='done' && <p className="room-select-phase">{t(stage==='character' ? 'room.chooseCharacter' : state.product==='th08mp' ? 'room.chooseMode' : 'room.chooseShot')}<span>{stage==='character' ? 'Choose Girl.' : state.product==='th08mp' ? 'Choose Player.' : state.product==='th10mp' || state.product==='th11mp' ? 'Choose Weapon.' : 'Choose Spell Card.'}</span></p>}<h4>{local ? name : p.label(loadoutIndex)}</h4>
        {local && stage!=='character' && <div className="room-shot-options">{group.filter(value => stage!=='done' || value===loadoutIndex).map(value => <button key={value} className={value===loadoutIndex ? 'selected':''} aria-pressed={value===loadoutIndex} disabled={!mutable} onClick={() => select(value, true)}>{shotLabel(value)}</button>)}</div>}
      </div>
      <RoomSeatProgress state={state} index={index} service={service} onDevice={element => {if (local) onPersonal(element); else if (seat) onNetwork(element,seat.clientId);}}/>
      {local && <button className="room-touch-reselect" disabled={!mutable} onClick={reselect}>{t('room.reselect')}</button>}
    </>}
    {!occupied && <button className="room-take-seat" disabled={!p.ready || p.room.phase!=='lobby'} onClick={() => {void service.takeSeat(index);}}>{t('multiplayer.join')} P{index+1}</button>}
  </article>;
}
