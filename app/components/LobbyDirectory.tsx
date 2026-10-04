import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {Link, useLocation, useNavigate, useNavigation} from 'react-router';
import {PRODUCT_GAMES, gameIdForProduct, multiplayerConfigForProduct, type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {lobbyRoomState, type LobbyCreateInput, type LobbyDirectoryController, type LobbyDirectorySnapshot, type LobbyRoom, type LobbyRoomIntent} from '../services/lobby-directory.client';
import {AnimatedDialog} from './AnimatedDialog';
import {useLobbyDirectory} from './LobbyDirectoryProvider';
import th06Artwork from '../../th06-card.webp';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[13px] bg-[#30312c] px-[18px] py-2.5 text-sm font-bold text-[#f4eee8] transition-colors hover:bg-[#3c3e36] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
const primary = `${button} bg-[#fce5ec] text-[#a92e4c] hover:bg-[#fff1f5] disabled:bg-[#30312c] disabled:text-[#b1aea5]`;
const input = 'min-h-12 w-full min-w-0 rounded-[13px] border border-line bg-[#30312c] px-3.5 py-2.5 text-base text-paper';
const titleFor = (product: MultiplayerProductId) => PRODUCT_GAMES[gameIdForProduct(product)].title;
const stateLabel = {recruiting: '招募中', full: '已满员', playing: '游戏中'};
const controlLabel = {normal: '普通', touch: '触屏', cheat: '无限移动'};

export function LobbyDirectory() {
  const {controller, snapshot} = useLobbyDirectory();
  return <section aria-label="联机大厅" className="mx-auto max-w-[1440px] pb-8 text-[#f4eee8]">
    <Link to="/" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-nav hover:text-paper">← 返回游戏库</Link>
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-[clamp(30px,3vw,42px)] leading-tight font-black">联机大厅</h1>
      <Link to="https://github.com/YomotsuHisami/eagler-touhou/blob/main/content/MULTIPLAYER.md" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-bold text-accent">联机说明 ↗</Link>
    </header>
    <p className="mb-5 rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">查看实时公开房间，或输入好友分享的房间号。创建和加入需要进入房间后由服务器确认；私人房间不会显示在列表中。</p>
    {!controller || !snapshot ? <p role="status" className="py-12 text-center text-muted">正在载入联机大厅…</p> : <LobbyDirectoryView controller={controller} snapshot={snapshot}/>}
  </section>;
}
export function LobbyDirectoryView({controller, snapshot}: {controller: LobbyDirectoryController; snapshot: LobbyDirectorySnapshot}) {
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
      <div aria-label="联机作品" className="-mx-1.5 mb-4 flex snap-x gap-[18px] overflow-x-auto px-1.5 py-1.5">
        {snapshot.products.map(product => {
          const gameId = gameIdForProduct(product), game = PRODUCT_GAMES[gameId];
          return <Link key={product} to={`/play/${product}`} aria-label={`${game.title} 联机设置`} className={`relative isolate flex h-[210px] w-[clamp(220px,66vw,280px)] shrink-0 snap-center flex-col justify-end overflow-hidden rounded-[22px] border p-5 shadow-menu min-[821px]:h-[clamp(195px,18vw,235px)] min-[821px]:w-[clamp(230px,22vw,310px)] ${snapshot.selectedProduct === product ? 'border-accent' : 'border-line'}`}>
            {gameId === 'th06' && <img src={th06Artwork} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover"/>}
            <span aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-black/90 via-black/30 to-[#65514b]/20"/>
            <span className="absolute top-3 left-5 font-ui text-4xl font-black">{game.number}</span>
            <h2 className="text-[26px] leading-tight font-black min-[821px]:text-[clamp(23px,2.1vw,30px)]">{game.title}</h2>
            <p className="mt-2 text-[11px] text-paper/80">{game.subtitle}</p>
          </Link>;
        })}
      </div>
      <div aria-label="筛选联机作品" className="mb-5 flex flex-wrap justify-center gap-2">
        {snapshot.products.map(product => <button key={product} type="button" className={`${button} min-w-14 px-4 ${snapshot.selectedProduct === product ? 'bg-[#fce5ec] text-[#a92e4c]' : ''}`} aria-pressed={snapshot.selectedProduct === product} aria-label={`查看${titleFor(product)}房间`} onClick={() => changeSearch({game: product, lobbyDialog: null}, true)}>{PRODUCT_GAMES[gameIdForProduct(product)].number}</button>)}
      </div>
    </>}
    {['th08mp', 'th09mp', 'th10mp'].includes(snapshot.selectedProduct) && <p className="mb-4 text-center text-sm text-[#dfbfaa]">此作品联机模式仍在测试中，可能遇到同步或兼容问题。</p>}
    {snapshot.mine && <aside aria-label="当前房间占用" className="mb-5 rounded-[18px] bg-[#292a26] p-5 text-sm">
      <strong className="text-base">你已在房间 #{snapshot.mine.code}</strong>
      <p className="mt-2 text-muted">{titleFor(snapshot.mine.product)} · {snapshot.supportsRecovery ? '创建或加入新房间前，请退出原房间；释放会结束原房间或标签页的联机连接。' : '此服务器不支持从大厅释放，请回到原房间或标签页退出。'}</p>
      {snapshot.supportsRecovery && <button type="button" className={`${button} mt-3`} disabled={snapshot.recovering || snapshot.connection !== 'live' || !snapshot.mine.recoveryToken} onClick={() => controller.releaseMembership()}>{snapshot.recovering ? '正在释放…' : '释放原房间占用'}</button>}
    </aside>}
    {snapshot.error && <div role={snapshot.connection === 'loading' ? 'status' : 'alert'} className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#262722] p-5">
      <div><strong>大厅连接{snapshot.connection === 'unsupported' ? '暂不支持' : snapshot.connection === 'missing' ? '未配置' : '暂不可用'}</strong><p className="mt-1 text-sm text-muted">{snapshot.error}</p></div>
      <button type="button" className={primary} onClick={() => controller.retry()}>重新连接</button>
    </div>}
    {(snapshot.notice || error) && <p role={error ? 'alert' : 'status'} className="mb-5 rounded-2xl bg-[#292a26] p-4 text-sm">{error || snapshot.notice}</p>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-muted">{loading ? '正在读取房间列表…' : `${rooms.length} 个房间`}</p>
      <div className="flex w-full gap-2 sm:w-auto">
        <button type="button" className={`${primary} flex-1 sm:flex-auto`} disabled={disabled} onClick={() => openDialog('create')}>创建房间</button>
        <button type="button" className={`${button} flex-1 sm:flex-auto`} disabled={disabled} onClick={() => openDialog('join')}>输入房间号</button>
        <button type="button" aria-label="刷新房间列表" className={`${button} w-11 px-2`} onClick={() => controller.refresh()}>↻</button>
      </div>
    </div>
    <div aria-busy={loading} aria-label="公开房间列表" className="overflow-hidden rounded-[20px] bg-[#20211ef0]">
      {loading ? <p role="status" className="grid min-h-[280px] place-items-center px-6 text-muted">正在连接并同步房间…</p> : rooms.length ? <>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(200px,2.6fr)_70px_minmax(125px,1.35fr)_60px_80px_106px] items-center gap-4 bg-paper/[.025] px-7 py-4 text-[13px] text-muted min-[1100px]:grid"><span className="pl-[92px]">作品 / 房间号</span><span>难度</span><span>房间成员</span><span>人数</span><span>状态</span><span/></div>
        <ul>{rooms.map(room => <LobbyRoomRow key={`${room.product}-${room.code}`} room={room} disabled={disabled} onJoin={() => transition(() => controller.joinRoomIntent(room.product, room.code, true))}/>)}</ul>
      </> : <div className="grid min-h-[280px] content-center justify-items-center gap-4 px-6 py-10 text-center">
        <h2 className="text-xl font-bold">{snapshot.connection === 'live' ? '暂时没有公开房间' : '暂时无法读取房间'}</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted">{snapshot.connection === 'live' ? '可以创建新房间，或输入好友分享的房间号。私人房间不会显示在这里。' : '检查连接后重试；房间列表暂不代表服务器的实时状态。'}</p>
        <button type="button" className={primary} disabled={snapshot.connection === 'live' && disabled} onClick={() => snapshot.connection === 'live' ? openDialog('create') : controller.retry()}>{snapshot.connection === 'live' ? '创建房间' : '重试连接'}</button>
      </div>}
    </div>
    {!loading && snapshot.total > snapshot.rooms.length && <p className="mt-4 text-sm text-muted">当前仅显示前 {snapshot.rooms.length} 个房间，可切换作品筛选。</p>}
    <AnimatedDialog open={!!mode} onOpenChange={open => {if (!open) closeDialog();}} title={mode === 'join' ? '输入房间号' : '创建房间'} description="这一步准备房间意图；是否创建或加入成功，需要后续房间连接向服务器确认。">
      {mode && <LobbyRoomForm key={`${mode}-${snapshot.selectedProduct}`} mode={mode} snapshot={snapshot} disabled={disabled || navigation.state !== 'idle'} onCancel={closeDialog} onCreate={value => transition(() => controller.createRoomIntent(value))} onJoin={(product, code) => transition(() => controller.joinRoomIntent(product, code))}/>}
      {error && <p role="alert" className="mt-3 text-sm text-accent">{error}</p>}
    </AnimatedDialog>
  </>;
}
function LobbyRoomRow({room, disabled, onJoin}: {room: LobbyRoom; disabled: boolean; onJoin(): void}) {
  const gameId = gameIdForProduct(room.product), game = PRODUCT_GAMES[gameId], state = lobbyRoomState(room);
  const difficulty = multiplayerConfigForProduct(room.product)!.difficulties[room.difficulty];
  return <li className="grid min-h-[120px] grid-cols-[minmax(0,1fr)_94px] items-center gap-x-3 gap-y-2 border-t border-paper/10 p-3.5 min-[1100px]:min-h-[108px] min-[1100px]:grid-cols-[minmax(200px,2.6fr)_70px_minmax(125px,1.35fr)_60px_80px_106px] min-[1100px]:gap-4 min-[1100px]:px-7 min-[1100px]:py-[22px]">
    <div className="flex min-w-0 items-center gap-2.5 min-[1100px]:gap-5">
      <span aria-hidden="true" className="relative h-[58px] w-[50px] shrink-0 overflow-hidden rounded-[9px] bg-[#65514b] min-[1100px]:h-20 min-[1100px]:w-[72px] min-[1100px]:rounded-xl">{gameId === 'th06' && <img src={th06Artwork} alt="" className="h-full w-full object-cover"/>}<span className="absolute top-0 left-1.5 font-ui text-[25px] font-black drop-shadow-lg min-[1100px]:text-[31px]">{game.number}</span></span>
      <div className="min-w-0"><h2 className="text-base leading-snug font-bold break-words min-[1100px]:text-lg">{game.title}</h2><p className="text-xs text-muted min-[1100px]:text-sm">#{room.code}<span className="min-[1100px]:hidden"> · {difficulty}</span></p><p className="hidden text-[11px] text-muted min-[1100px]:block">{game.subtitle}</p>{room.disableCheatMovement && <p className="mt-1 text-[11px] text-muted">禁用无限移动</p>}</div>
    </div>
    <p className="hidden text-[15px] min-[1100px]:block">{difficulty}</p>
    <div aria-label={`${room.players} / ${room.capacity} 人，${room.ready} 人准备，${room.spectators} 人观战`} className="col-start-2 row-start-1 min-[1100px]:col-auto min-[1100px]:row-auto">
      <p className="mb-1 text-sm tabular-nums min-[1100px]:hidden">{room.players} / {room.capacity}</p>
      <div className={`flex gap-1.5 ${room.seats.some(seat => seat?.controlMode) ? 'pb-5' : ''}`}>
        {room.seats.map((seat, index) => <span key={index} role="img" aria-label={`座位 ${index + 1}：${!seat ? '空位' : `${seat.initial}，${!seat.online ? '离线' : seat.ready ? '已准备' : '等待准备'}${seat.controlMode ? `，${controlLabel[seat.controlMode]}` : ''}`}`} className={`relative grid size-[26px] shrink-0 place-items-center rounded-full text-[13px] min-[1100px]:size-[30px] ${!seat ? 'border border-paper/30' : 'bg-[#fce5ec] text-[#a92e4c]'} ${seat && !seat.online ? 'opacity-40' : ''}`}>
          {seat?.initial}{seat?.ready && <span aria-hidden="true" className="absolute right-0 bottom-0 size-1.5 rounded-full bg-[#bdd29d] ring-2 ring-[#20211e]"/>}{seat?.controlMode && <span aria-hidden="true" className="absolute top-full mt-1 w-8 text-center text-[9px] leading-tight text-muted">{controlLabel[seat.controlMode]}</span>}
        </span>)}
      </div>
    </div>
    <p className="hidden text-[15px] tabular-nums min-[1100px]:block">{room.players} / {room.capacity}</p>
    <p className={`col-start-1 row-start-2 flex items-center gap-1.5 pl-[60px] text-[13px] min-[1100px]:col-auto min-[1100px]:row-auto min-[1100px]:pl-0 ${state === 'recruiting' ? 'text-paper' : 'text-[#eda0a0]'}`}><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${state === 'recruiting' ? 'bg-[#9ebb79]' : 'bg-[#e78b8e]'}`}/>{stateLabel[state]}</p>
    <button type="button" className={`${primary} col-start-2 row-start-2 px-3 min-[1100px]:col-auto min-[1100px]:row-auto`} disabled={disabled || !room.joinable || state !== 'recruiting'} aria-label={`加入 ${game.title} 房间 ${room.code}`} onClick={onJoin}>{state === 'recruiting' ? '加入房间' : stateLabel[state]}</button>
  </li>;
}
function LobbyRoomForm({mode, snapshot, disabled, onCancel, onCreate, onJoin}: {mode: 'create' | 'join'; snapshot: LobbyDirectorySnapshot; disabled: boolean; onCancel(): void; onCreate(value: LobbyCreateInput): void; onJoin(product: MultiplayerProductId, code: string): void}) {
  const [product, setProduct] = useState(snapshot.selectedProduct || snapshot.products[0]);
  const policy = multiplayerConfigForProduct(product);
  const [capacity, setCapacity] = useState<2 | 3>(policy?.playerCounts[0] ?? 2);
  const [difficulty, setDifficulty] = useState(Math.min(1, (policy?.difficulties.length ?? 1) - 1));
  const [code, setCode] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [disableCheatMovement, setDisableCheatMovement] = useState(false);
  return <form className="grid gap-5" onSubmit={event => {event.preventDefault(); if (disabled || !product) return; if (mode === 'join') onJoin(product, code); else onCreate({productId: product, playerCount: capacity, difficulty, visibility, disableCheatMovement});}}>
    <label className="grid gap-2 text-sm text-muted">作品<select className={input} value={product} onChange={event => {const next = event.target.value as MultiplayerProductId, config = multiplayerConfigForProduct(next)!; setProduct(next); setCapacity(config.playerCounts[0]); setDifficulty(Math.min(1, config.difficulties.length - 1));}}>{snapshot.products.map(id => <option key={id} value={id}>{titleFor(id)}</option>)}</select></label>
    {mode === 'join' ? <label className="grid gap-2 text-sm text-muted">房间号<input className={input} inputMode="numeric" autoComplete="off" required pattern="[0-9]{4,8}" maxLength={8} value={code} onChange={event => setCode(event.target.value)} placeholder="4 至 8 位数字"/></label> : <>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm text-muted">人数<select className={input} value={capacity} onChange={event => setCapacity(Number(event.target.value) as 2 | 3)}>{policy?.playerCounts.map(count => <option key={count} value={count}>{count} 人</option>)}</select></label><label className="grid gap-2 text-sm text-muted">难度<select className={input} value={difficulty} onChange={event => setDifficulty(Number(event.target.value))}>{policy?.difficulties.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label></div>
      <label className="grid gap-2 text-sm text-muted">房间可见性<select className={input} value={visibility} onChange={event => setVisibility(event.target.value as 'public' | 'private')}><option value="public">公开房间</option><option value="private">私人房间</option></select></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-[#a92e4c]" checked={disableCheatMovement} onChange={event => setDisableCheatMovement(event.target.checked)}/>禁用无限移动</label>
    </>}
    <p className="text-xs leading-relaxed text-muted">{mode === 'join' ? '输入好友分享的房间号，是否可以加入由房间服务器确认。' : visibility === 'private' ? '私人房间不会出现在大厅列表中，好友仍可通过房间号加入。' : '创建成功后，公开房间将出现在大厅列表中。'}</p>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={onCancel}>取消</button><button type="submit" className={primary} disabled={disabled || !product}>{mode === 'join' ? '继续加入' : '继续创建'}</button></div>
  </form>;
}
