import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {Link, useLocation, useNavigate, useNavigation} from 'react-router';
import {PRODUCT_GAMES, gameIdForProduct, multiplayerConfigForProduct, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {lobbyRoomState, type LobbyCreateInput, type LobbyDirectoryController, type LobbyDirectorySnapshot, type LobbyRoom, type LobbyRoomIntent} from '../services/lobby-directory.client';
import {AnimatedDialog} from './AnimatedDialog';
import {useLocale} from './LocaleProvider';
import {useLobbyDirectory} from './LobbyDirectoryProvider';
import {MultiplayerGuideButton} from './Notices';
import {LobbyNetworkDiagnostics} from './LobbyNetworkDiagnostics';
import th06Artwork from '../../th06-card.webp';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[13px] bg-[#30312c] px-[18px] py-2.5 text-sm font-bold text-[#f4eee8] transition-colors hover:bg-[#3c3e36] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
const primary = `${button} bg-[#fce5ec] text-[#a92e4c] hover:bg-[#fff1f5] disabled:bg-[#30312c] disabled:text-[#b1aea5]`;
const input = 'min-h-12 w-full min-w-0 rounded-[13px] border border-line bg-[#30312c] px-3.5 py-2.5 text-base text-paper';
const titleFor = (product: MultiplayerProductId) => PRODUCT_GAMES[gameIdForProduct(product)].title;

export function LobbyDirectory() {
  const {controller, snapshot} = useLobbyDirectory();
  return <LobbyDirectorySurface controller={controller} snapshot={snapshot}/>;
}
/** Presentation seam for source-owned populated UI evidence; production keeps
 * the same root directory service and its canonical room/transport policy. */
export function LobbyDirectorySurface({controller, snapshot}: {controller: LobbyDirectoryController | null; snapshot: LobbyDirectorySnapshot | null}) {
  const {t} = useLocale();
  return <section aria-label={t('lobby.title')} className="mx-auto max-w-[1440px] pb-8 text-[#f4eee8]">
    <Link to="/" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-nav hover:text-paper">← {t('library.back')}</Link>
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-[clamp(30px,3vw,42px)] leading-tight font-black">{t('lobby.title')}</h1>
      <div className="flex flex-wrap gap-2"><LobbyNetworkDiagnostics relayUrl={snapshot?.diagnosticRelayUrl ?? null} className={button}/><MultiplayerGuideButton gameId={snapshot?.selectedProduct ? gameIdForProduct(snapshot.selectedProduct) : 'th06'} className={button}/></div>
    </header>
    <p className="mb-5 rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">{t('ui.multiplayer.directoryIntro')}</p>
    {!controller || !snapshot ? <p role="status" className="py-12 text-center text-muted">{t('ui.multiplayer.directoryLoading')}</p> : <LobbyDirectoryView controller={controller} snapshot={snapshot}/>}
  </section>;
}
export function LobbyDirectoryView({controller, snapshot}: {controller: LobbyDirectoryController; snapshot: LobbyDirectorySnapshot}) {
  const {t} = useLocale();
  const location = useLocation(), navigate = useNavigate(), navigation = useNavigation();
  const dialogLocation = navigation.location ?? location;
  const search = new URLSearchParams(dialogLocation.search);
  const dialogValue = search.get('lobbyDialog');
  const mode = dialogValue === 'create' || dialogValue === 'join' ? dialogValue : null;
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false), closing = useRef(false);
  const requestPrefix = useId(), sequence = useRef(0);
  const committed = useRef({location, navigation});
  const attempt = useRef<{id: string; search: string; settled: boolean; closeRequested: boolean; cancelled: boolean} | null>(null);
  function acknowledgeClose(ticket: NonNullable<typeof attempt.current>) {
    if (attempt.current !== ticket || ticket.cancelled || !ticket.settled || !ticket.closeRequested) return;
    const current = committed.current;
    if (current.navigation.state !== 'idle') return;
    ticket.cancelled = true;
    if (current.location.state?.lobbyDialogRequestId === ticket.id && current.location.pathname === '/lobby' && current.location.search.replace(/^\?/, '') === ticket.search) void navigate(-1);
  }
  useLayoutEffect(() => {
    committed.current = {location, navigation};
    const ticket = attempt.current;
    if (ticket && navigation.location && navigation.location.state?.lobbyDialogRequestId !== ticket.id) ticket.cancelled = true;
    if (ticket) acknowledgeClose(ticket);
  }, [location, navigation]);
  useLayoutEffect(() => {closing.current = false;}, [dialogLocation.key]);
  useLayoutEffect(() => () => {if (attempt.current) attempt.current.cancelled = true;}, []);
  const loading = snapshot.connection === 'idle' || snapshot.connection === 'loading' || snapshot.connection === 'live' && snapshot.loadedProduct !== snapshot.selectedProduct;
  const rooms = snapshot.rooms.filter(room => room.product === snapshot.selectedProduct);
  const disabled = snapshot.connection !== 'live' || !!snapshot.mine || snapshot.recovering || !snapshot.products.length;
  function changeSearch(patch: Record<string, string | null>, replace: boolean, state?: unknown) {
    const next = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(patch)) {if (value === null) next.delete(key); else next.set(key, value);}
    void navigate({pathname: '/lobby', search: next.toString()}, {replace, ...(state ? {state} : {})});
  }
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('game');
    if (navigation.state !== 'idle' || !snapshot.selectedProduct || !snapshot.products.length || snapshot.products.some(product => product === requested)) return;
    const next = new URLSearchParams(location.search); next.set('game', snapshot.selectedProduct);
    void navigate({pathname: location.pathname, search: next.toString()}, {replace: true, state: location.state});
  }, [snapshot.selectedProduct, snapshot.products, location.pathname, location.search, location.state, navigate, navigation.state]);
  function openDialog(next: 'create' | 'join') {
    if (disabled || mode || attempt.current && !attempt.current.settled && !attempt.current.cancelled) return;
    setError(null);
    const query = new URLSearchParams(location.search); query.set('lobbyDialog', next);
    const ticket = {id: `${requestPrefix}-${++sequence.current}`, search: query.toString(), settled: false, closeRequested: false, cancelled: false};
    attempt.current = ticket; closing.current = false;
    void Promise.resolve(navigate({pathname: '/lobby', search: ticket.search}, {state: {lobbyDialogFrom: location.key, lobbyDialogRequestId: ticket.id}, flushSync: true})).then(() => {
      if (attempt.current !== ticket || ticket.cancelled) return;
      ticket.settled = true; acknowledgeClose(ticket);
    });
  }
  function closeDialog() {
    if (!mode || closing.current) return;
    closing.current = true; setError(null);
    const ticket = attempt.current;
    if (ticket && dialogLocation.state?.lobbyDialogRequestId === ticket.id) {
      if (!ticket.cancelled) {ticket.closeRequested = true; acknowledgeClose(ticket);}
      return;
    }
    if (dialogLocation.state?.lobbyDialogFrom) void navigate(-1);
    else changeSearch({lobbyDialog: null}, true);
  }
  function transition(prepare: () => LobbyRoomIntent) {
    if (submitting.current) return;
    submitting.current = true; setError(null);
    try {
      const intent = prepare();
      // A modal entry is replaced so Back returns to the directory, not a
      // submitted form. Ordinary row navigation remains a normal Router push.
      const target = new URL(intent.href, 'https://router.invalid');
      const locale = new URLSearchParams(location.search).get('uiLocale');
      if (locale) target.searchParams.set('uiLocale', locale);
      void navigate(target.pathname + target.search, {replace: !!mode, state: {returnTo: '/lobby'}});
    } catch (reason) {setError(reason instanceof Error ? reason.message : String(reason));}
    finally {queueMicrotask(() => {submitting.current = false;});}
  }
  return <>
    {!!snapshot.products.length && <>
      <div aria-label={t('ui.multiplayer.games')} className="-mx-1.5 mb-4 flex snap-x gap-[18px] overflow-x-auto px-1.5 py-1.5">
        {snapshot.products.map(product => {
          const gameId = gameIdForProduct(product), game = PRODUCT_GAMES[gameId];
          return <Link key={product} to={`/play/${product}`} aria-label={t('ui.multiplayer.settingsForGame', {game: game.title})} className={`relative isolate flex h-[210px] w-[clamp(220px,66vw,280px)] shrink-0 snap-center flex-col justify-end overflow-hidden rounded-[22px] border p-5 shadow-menu min-[821px]:h-[clamp(195px,18vw,235px)] min-[821px]:w-[clamp(230px,22vw,310px)] ${snapshot.selectedProduct === product ? 'border-accent' : 'border-line'}`}>
            {gameId === 'th06' && <img src={th06Artwork} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover"/>}
            <span aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-black/90 via-black/30 to-[#65514b]/20"/>
            <span className="absolute top-3 left-5 font-ui text-4xl font-black">{game.number}</span>
            <h2 lang="ja" className="text-[26px] leading-tight font-black min-[821px]:text-[clamp(23px,2.1vw,30px)]">{game.title}</h2>
            <p lang="en" className="mt-2 text-[11px] text-paper/80">{game.subtitle}</p>
          </Link>;
        })}
      </div>
      <div aria-label={t('ui.multiplayer.filterGames')} className="mb-5 flex flex-wrap justify-center gap-2">
        {snapshot.products.map(product => <button key={product} type="button" className={`${button} min-w-14 px-4 ${snapshot.selectedProduct === product ? 'bg-[#fce5ec] text-[#a92e4c]' : ''}`} aria-pressed={snapshot.selectedProduct === product} aria-label={t('ui.multiplayer.roomsForGame', {game: titleFor(product)})} onClick={() => changeSearch({game: product, lobbyDialog: null}, true)}>{PRODUCT_GAMES[gameIdForProduct(product)].number}</button>)}
      </div>
    </>}
    {['th08mp', 'th09mp', 'th10mp'].includes(snapshot.selectedProduct) && <p className="mb-4 text-center text-sm text-[#dfbfaa]">{t('ui.multiplayer.testingHint')}</p>}
    {snapshot.mine && <aside aria-label={t('ui.multiplayer.membership')} className="mb-5 rounded-[18px] bg-[#292a26] p-5 text-sm">
      <strong className="text-base">{t('ui.multiplayer.membershipCode', {code: snapshot.mine.code})}</strong>
      <p className="mt-2 text-muted"><span lang="ja">{titleFor(snapshot.mine.product)}</span> · {snapshot.supportsRecovery ? t('ui.multiplayer.releaseHint') : t('ui.multiplayer.releaseUnsupported')}</p>
      {snapshot.supportsRecovery && <button type="button" className={`${button} mt-3`} disabled={snapshot.recovering || snapshot.connection !== 'live' || !snapshot.mine.recoveryToken} onClick={() => controller.releaseMembership()}>{snapshot.recovering ? t('ui.multiplayer.releasing') : t('ui.multiplayer.release')}</button>}
    </aside>}
    {snapshot.error && <div role={snapshot.connection === 'loading' ? 'status' : 'alert'} className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#262722] p-5">
      <div><strong>{t(snapshot.connection === 'unsupported' ? 'ui.multiplayer.lobbyUnsupported' : snapshot.connection === 'missing' ? 'ui.multiplayer.lobbyUnconfigured' : 'ui.multiplayer.lobbyUnavailable')}</strong><p lang="zh-CN" className="mt-1 text-sm text-muted">{snapshot.error}</p></div>
      <button type="button" className={primary} onClick={() => controller.retry()}>{t('lobby.retry')}</button>
    </div>}
    {(snapshot.notice || error) && <p lang="zh-CN" role={error ? 'alert' : 'status'} className="mb-5 rounded-2xl bg-[#292a26] p-4 text-sm">{error || snapshot.notice}</p>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-muted">{loading ? t('ui.multiplayer.roomsLoading') : t('lobby.roomCount', {count: rooms.length})}</p>
      <div className="flex w-full gap-2 sm:w-auto">
        <button type="button" className={`${primary} flex-1 sm:flex-auto`} disabled={disabled} onClick={() => openDialog('create')}>{t('lobby.create')}</button>
        <button type="button" className={`${button} flex-1 sm:flex-auto`} disabled={disabled} onClick={() => openDialog('join')}>{t('lobby.byCode')}</button>
        <button type="button" aria-label={t('ui.multiplayer.refreshRooms')} className={`${button} w-11 px-2`} onClick={() => controller.refresh()}>↻</button>
      </div>
    </div>
    <div aria-busy={loading} aria-label={t('ui.multiplayer.publicRooms')} className="overflow-hidden rounded-[20px] bg-[#20211ef0]">
      {loading ? <p role="status" className="grid min-h-[340px] max-[820px]:min-h-[280px] place-items-center px-6 text-muted">{t('ui.multiplayer.roomsSyncing')}</p> : rooms.length ? <>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(200px,2.6fr)_70px_minmax(125px,1.35fr)_60px_80px_106px] items-center gap-4 bg-paper/[.025] px-7 py-4 text-[13px] text-muted min-[1100px]:grid"><span className="pl-[92px]">{t('ui.multiplayer.gameAndCode')}</span><span>{t('lobby.difficulty')}</span><span>{t('ui.multiplayer.members')}</span><span>{t('lobby.capacity')}</span><span>{t('lobby.state')}</span><span/></div>
        <ul>{rooms.map(room => <LobbyRoomRow key={`${room.product}-${room.code}`} room={room} disabled={disabled} onJoin={() => transition(() => controller.joinRoomIntent(room.product, room.code, true))}/>)}</ul>
      </> : <div className="grid min-h-[340px] max-[820px]:min-h-[280px] content-center justify-items-center gap-4 px-6 py-10 text-center">
        <h2 className="text-xl font-bold">{snapshot.connection === 'live' ? t('ui.multiplayer.noPublicRooms') : t('ui.multiplayer.roomsUnavailable')}</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted">{snapshot.connection === 'live' ? t('ui.multiplayer.emptyHint') : t('ui.multiplayer.unavailableHint')}</p>
        <button type="button" className={primary} disabled={snapshot.connection === 'live' && disabled} onClick={() => snapshot.connection === 'live' ? openDialog('create') : controller.retry()}>{snapshot.connection === 'live' ? t('lobby.create') : t('ui.multiplayer.retryConnection')}</button>
      </div>}
    </div>
    {!loading && snapshot.total > snapshot.rooms.length && <p className="mt-4 text-sm text-muted">{t('ui.multiplayer.truncated', {count: snapshot.rooms.length})}</p>}
    <AnimatedDialog layout="lobby-dialog" open={!!mode} onOpenChange={open => {if (!open) closeDialog();}} title={mode === 'join' ? t('lobby.byCode') : t('lobby.create')} description={t('ui.multiplayer.intentHint')}>
      {mode && <LobbyRoomForm key={`${mode}-${snapshot.selectedProduct}`} mode={mode} snapshot={snapshot} disabled={disabled || navigation.state !== 'idle'} onCancel={closeDialog} onCreate={value => transition(() => controller.createRoomIntent(value))} onJoin={(product, code) => transition(() => controller.joinRoomIntent(product, code))}/>}
      {error && <p lang="zh-CN" role="alert" className="mt-3 text-sm text-accent">{error}</p>}
    </AnimatedDialog>
  </>;
}
function LobbyRoomRow({room, disabled, onJoin}: {room: LobbyRoom; disabled: boolean; onJoin(): void}) {
  const {t} = useLocale();
  const stateLabel = {recruiting: t('lobby.recruiting'), full: t('ui.multiplayer.full'), playing: t('lobby.playing')};
  const controlLabel = {normal: t('ui.multiplayer.normal'), touch: t('ui.multiplayer.touch'), cheat: t('ui.multiplayer.unlimited')};
  const gameId = gameIdForProduct(room.product), game = PRODUCT_GAMES[gameId], state = lobbyRoomState(room);
  const difficulty = multiplayerConfigForProduct(room.product)!.difficulties[room.difficulty];
  return <li className="grid min-h-[120px] grid-cols-[minmax(0,1fr)_94px] items-center gap-x-3 gap-y-2 border-t border-paper/10 p-3.5 min-[1100px]:min-h-[108px] min-[1100px]:grid-cols-[minmax(200px,2.6fr)_70px_minmax(125px,1.35fr)_60px_80px_106px] min-[1100px]:gap-4 min-[1100px]:px-7 min-[1100px]:py-[22px]">
    <div className="flex min-w-0 items-center gap-2.5 min-[1100px]:gap-5">
      <span aria-hidden="true" className="relative h-[58px] w-[50px] shrink-0 overflow-hidden rounded-[9px] bg-[#65514b] min-[1100px]:h-20 min-[1100px]:w-[72px] min-[1100px]:rounded-xl">{gameId === 'th06' && <img src={th06Artwork} alt="" className="h-full w-full object-cover"/>}<span className="absolute top-0 left-1.5 font-ui text-[25px] font-black drop-shadow-lg min-[1100px]:text-[31px]">{game.number}</span></span>
      <div className="min-w-0"><h2 lang="ja" className="text-base leading-snug font-bold break-words min-[1100px]:text-lg">{game.title}</h2><p className="text-xs text-muted min-[1100px]:text-sm">#{room.code}<span className="min-[1100px]:hidden"> · {difficulty}</span></p><p lang="en" className="hidden text-[11px] text-muted min-[1100px]:block">{game.subtitle}</p>{room.disableCheatMovement && <p className="mt-1 text-[11px] text-muted">{t('ui.multiplayer.unlimitedDisabled')}</p>}</div>
    </div>
    <p className="hidden text-[15px] min-[1100px]:block">{difficulty}</p>
    <div aria-label={t('ui.multiplayer.membersAria', {players: room.players, capacity: room.capacity, ready: room.ready, spectators: room.spectators})} className="col-start-2 row-start-1 min-[1100px]:col-auto min-[1100px]:row-auto">
      <p className="mb-1 text-sm tabular-nums min-[1100px]:hidden">{room.players} / {room.capacity}</p>
      <div className={`flex gap-1.5 ${room.seats.some(seat => seat?.controlMode) ? 'pb-5' : ''}`}>
        {room.seats.map((seat, index) => <span key={index} role="img" aria-label={t('ui.multiplayer.seatAria', {seat: index + 1, details: !seat ? t('ui.multiplayer.emptySeat') : t('ui.multiplayer.occupiedSeatAria', {name: seat.initial, status: !seat.online ? t('ui.multiplayer.offline') : seat.ready ? t('room.ready') : t('ui.multiplayer.waitingReady'), control: seat.controlMode ? t('ui.multiplayer.controlSuffix', {control: controlLabel[seat.controlMode]}) : ''})})} className={`relative grid size-[26px] shrink-0 place-items-center rounded-full text-[13px] min-[1100px]:size-[30px] ${!seat ? 'border border-paper/30' : 'bg-[#fce5ec] text-[#a92e4c]'} ${seat && !seat.online ? 'opacity-40' : ''}`}>
          {seat?.initial}{seat?.ready && <span aria-hidden="true" className="absolute right-0 bottom-0 size-1.5 rounded-full bg-[#bdd29d] ring-2 ring-[#20211e]"/>}{seat?.controlMode && <span aria-hidden="true" className="absolute top-full mt-1 w-8 text-center text-[9px] leading-tight text-muted">{seat.controlMode === 'cheat' ? t('ui.multiplayer.unlimitedShort') : controlLabel[seat.controlMode]}</span>}
        </span>)}
      </div>
    </div>
    <p className="hidden text-[15px] tabular-nums min-[1100px]:block">{room.players} / {room.capacity}</p>
    <p className={`col-start-1 row-start-2 flex items-center gap-1.5 pl-[60px] text-[13px] min-[1100px]:col-auto min-[1100px]:row-auto min-[1100px]:pl-0 ${state === 'recruiting' ? 'text-paper' : 'text-[#eda0a0]'}`}><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${state === 'recruiting' ? 'bg-[#9ebb79]' : 'bg-[#e78b8e]'}`}/>{stateLabel[state]}</p>
    <button type="button" className={`${primary} col-start-2 row-start-2 px-3 min-[1100px]:col-auto min-[1100px]:row-auto`} disabled={disabled || !room.joinable || state !== 'recruiting'} aria-label={t('ui.multiplayer.joinRoomAria', {game: game.title, code: room.code})} onClick={onJoin}>{state === 'recruiting' ? t('lobby.joinRoom') : stateLabel[state]}</button>
  </li>;
}
function LobbyRoomForm({mode, snapshot, disabled, onCancel, onCreate, onJoin}: {mode: 'create' | 'join'; snapshot: LobbyDirectorySnapshot; disabled: boolean; onCancel(): void; onCreate(value: LobbyCreateInput): void; onJoin(product: MultiplayerProductId, code: string): void}) {
  const {t} = useLocale();
  const [product, setProduct] = useState(snapshot.selectedProduct || snapshot.products[0]);
  const policy = multiplayerConfigForProduct(product);
  const [capacity, setCapacity] = useState<2 | 3>(policy?.playerCounts[0] ?? 2);
  const [difficulty, setDifficulty] = useState(Math.min(1, (policy?.difficulties.length ?? 1) - 1));
  const [code, setCode] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [disableCheatMovement, setDisableCheatMovement] = useState(false);
  return <form className="grid gap-5" onSubmit={event => {event.preventDefault(); if (disabled || !product) return; if (mode === 'join') onJoin(product, code); else onCreate({productId: product, playerCount: capacity, difficulty, visibility, disableCheatMovement});}}>
    <label className="grid gap-2 text-sm text-muted">{t('lobby.game')}<select className={input} value={product} onChange={event => {const next = event.target.value as MultiplayerProductId, config = multiplayerConfigForProduct(next)!; setProduct(next); setCapacity(config.playerCounts[0]); setDifficulty(Math.min(1, config.difficulties.length - 1));}}>{snapshot.products.map(id => <option key={id} value={id} lang="ja">{titleFor(id)}</option>)}</select></label>
    {mode === 'join' ? <label className="grid gap-2 text-sm text-muted">{t('lobby.roomCode')}<input className={input} inputMode="numeric" autoComplete="off" required pattern="[0-9]{4,8}" maxLength={8} value={code} onChange={event => setCode(event.target.value)} placeholder={t('ui.multiplayer.codePlaceholder')}/></label> : <>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm text-muted">{t('lobby.capacity')}<select className={input} value={capacity} onChange={event => setCapacity(Number(event.target.value) as 2 | 3)}>{policy?.playerCounts.map(count => <option key={count} value={count}>{t('lobby.playersCount', {count})}</option>)}</select></label><label className="grid gap-2 text-sm text-muted">{t('lobby.difficulty')}<select className={input} value={difficulty} onChange={event => setDifficulty(Number(event.target.value))}>{policy?.difficulties.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label></div>
      <label className="grid gap-2 text-sm text-muted">{t('room.visibility')}<select className={input} value={visibility} onChange={event => setVisibility(event.target.value as 'public' | 'private')}><option value="public">{t('ui.multiplayer.publicRoom')}</option><option value="private">{t('ui.multiplayer.privateRoom')}</option></select></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-[#a92e4c]" checked={disableCheatMovement} onChange={event => setDisableCheatMovement(event.target.checked)}/>{t('ui.multiplayer.disableUnlimited')}</label>
    </>}
    <p className="text-xs leading-relaxed text-muted">{mode === 'join' ? t('ui.multiplayer.joinHint') : visibility === 'private' ? t('ui.multiplayer.privateHint') : t('ui.multiplayer.createHint')}</p>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={onCancel}>{t('lobby.cancel')}</button><button type="submit" className={primary} disabled={disabled || !product}>{mode === 'join' ? t('ui.multiplayer.continueJoin') : t('ui.multiplayer.continueCreate')}</button></div>
  </form>;
}
