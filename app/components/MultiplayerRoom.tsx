import {useState} from 'react';
import {Link, useLocation, useNavigate} from 'react-router';
import {PRODUCT_GAMES, gameIdForProduct, multiplayerConfigForProduct} from '../../src/contracts/product-catalog.mts';
import {isUiMessageKey, t} from '../../src/launcher/i18n.mts';
import type {MultiplayerRoomController, MultiplayerRoomSnapshot} from '../services/multiplayer-room.client';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
const button = 'inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#30312c] px-4 py-2.5 text-sm text-paper hover:bg-[#3c3e36] disabled:cursor-not-allowed disabled:opacity-40';
const field = 'min-h-11 w-full rounded-xl border border-line bg-[#30312c] px-3 text-base text-paper';
const label = (key: string) => isUiMessageKey(key) ? t(key) : key;
const connectionLabel = {idle: '等待房间', loading: '读取配置', connecting: '连接房间', connected: '已连接', reconnecting: '重新连接中', unavailable: '连接不可用'};
export function MultiplayerRoom() {
  const {controller, snapshot} = useMultiplayerRoom();
  if (!controller || !snapshot?.route) return <p role="status" className="py-8 text-muted">正在载入联机房间与输入设置…</p>;
  if (snapshot.launch === 'running') return <p role="status" className="text-sm text-muted">联机游戏已交给 Runtime，房间连接继续保留。</p>;
  return <MultiplayerRoomView controller={controller} snapshot={snapshot}/>;
}
export function MultiplayerRoomView({controller, snapshot}: {controller: MultiplayerRoomController; snapshot: MultiplayerRoomSnapshot}) {
  const navigate = useNavigate(), location = useLocation();
  const queryWith = (patch: Record<string, string>) => {const next = new URLSearchParams(location.search); for (const [key, value] of Object.entries(patch)) next.set(key, value); return `?${next}`;};
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
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
  return <section aria-label="联机房间" className={`fixed inset-0 overflow-y-auto overscroll-contain bg-[#111210] px-5 pt-[max(18px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] text-paper sm:px-8 lg:px-14 ${snapshot.launch === 'starting' ? 'z-10' : 'z-[15]'}`}>
    <div className="mx-auto max-w-[1440px]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <button type="button" className={button} onClick={() => void navigate(`/lobby?game=${route.productId}`, {replace: true})}>← 返回大厅</button>
        <span role="status" className="text-sm text-muted">{connectionLabel[snapshot.connection]}</span>
        <button type="button" className={`${button} gap-2`} onClick={() => perform(async () => {await navigator.clipboard.writeText(route.roomCode); setNotice('已复制房间号');})}><span className="text-xs text-muted">房间号</span><strong className="text-xl tracking-widest">{route.roomCode}</strong><span className="text-xs">复制</span></button>
      </header>
      <div className="py-7 sm:py-10">
        <h1 className="text-[clamp(30px,4vw,54px)] leading-tight font-black">{game.title}</h1>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted"><span>联机</span>{room && <><span>{policy.difficulties[room.difficulty]}</span><span>{room.playerCount} 人</span><span>{room.visibility === 'private' ? '私人房间' : '公开房间'}</span><span>{room.phase === 'lobby' ? '等待准备' : room.phase === 'starting' ? '正在启动' : '游戏中'}</span>{room.disableCheatMovement && <span>禁用无限移动</span>}</>}</div>
      </div>
      {(error || snapshot.error || notice || snapshot.notice) && <p role={error || snapshot.error ? 'alert' : 'status'} className="mb-5 rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed">{error || snapshot.error || notice || snapshot.notice}</p>}
      {!live && <button type="button" className={`${button} mb-5`} onClick={() => controller.retry()}>重新连接房间</button>}
      {!snapshot.runtimeAvailable && <p className="mb-5 rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">房间列表、入座、机体和房间设置已连接服务器。多人资源准备与游戏启动尚未接入，因此当前不能标记准备或开始本局。</p>}
      {snapshot.runtimeAvailable && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-panel p-4 text-sm">
        <p role="status" className="grow">{preparation?.status === 'ready' ? '联机资源已准备' : preparation?.status === 'preparing' ? `正在准备${preparation.stage === 'package' ? '游戏资源' : 'Runtime'}${preparation.percent == null ? '…' : ` ${preparation.percent}%`}` : preparation?.status === 'failed' ? '资源准备失败' : preparation?.status === 'cancelled' ? '资源准备已取消' : '先准备资源，再确认准备'}</p>
        <button type="button" className={button} disabled={preparation?.status === 'preparing' || preparation?.status === 'ready'} onClick={() => perform(() => controller.prepare())}>准备资源</button>
        {preparation?.status === 'preparing' && <button type="button" className={button} onClick={() => controller.cancelPreparation()}>取消准备</button>}
      </div>}
      <div className="grid gap-6 rounded-[28px] border border-line bg-[#20211ef0] p-5 md:p-7 lg:grid-cols-[minmax(0,1fr)_160px_190px]">
        <div className={`grid gap-5 ${room?.playerCount === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          {Array.from({length: room?.playerCount ?? 2}, (_, index) => {
            const seat = room?.seats[index], loadout = seat ? policy.loadouts[seat.loadout] : null;
            return <article key={index} aria-label={`P${index + 1} ${index === 0 ? '房主' : '玩家'}`} className="flex min-w-0 flex-col gap-3 border-b border-line pb-5 sm:border-r sm:border-b-0 sm:pr-5 sm:pb-0 last:border-0">
              <span className="text-xs tracking-[.18em] text-muted">P{index + 1}{index === 0 && ' · 房主'}</span>
              {seat ? <><div aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-[#e8cbd2] text-3xl text-[#842e43]">{loadout?.glyph ?? '?'}</div><h2 className="text-lg font-bold break-words">{seat.name || '未命名'}{seat.clientId === snapshot.clientId && <span className="ml-2 text-xs font-normal text-muted">我</span>}</h2><p className="text-sm text-muted">{loadout ? label(loadout.labelKey) : '未知机体'}</p><p className={`text-sm ${seat.offline ? 'text-muted' : seat.ready ? 'text-[#b5dfaa]' : 'text-[#dfc38c]'}`}>{seat.offline ? '正在重连' : seat.ready ? '已准备' : '等待准备'}</p>
                {seat.resource && <p className="text-xs text-muted">资源：{seat.resource.status === 'ready' ? '已就绪' : seat.resource.status === 'preparing' ? `准备中 ${seat.resource.percent ?? ''}${seat.resource.percent == null ? '' : '%'}` : seat.resource.status === 'failed' ? '失败' : seat.resource.status === 'cancelled' ? '已取消' : '正在导入'}</p>}
                {seat.controlMode && <p className="text-xs text-muted">{seat.controlMode === 'normal' ? '普通操作' : seat.controlMode === 'touch' ? '触屏操作' : '无限移动'}</p>}
                {owner && index > 0 && <button type="button" className={button} disabled={!lobby || busy} onClick={() => perform(() => controller.removePlayer(index, seat.clientId))}>移出房间</button>}
              </> : <button type="button" className={`${button} min-h-32 flex-col gap-3 border border-dashed border-line bg-transparent`} disabled={!lobby || busy} onClick={() => perform(() => controller.takeSeat(index))}><span className="text-3xl">＋</span>加入 P{index + 1}</button>}
            </article>;
          })}
        </div>
        <aside className="border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"><h2 className="mb-3 text-sm text-muted">{room?.spectatorCount ?? 0} 人 · 观战席</h2><button type="button" className={`${button} w-full`} disabled={!live || busy} onClick={() => perform(() => room?.localSpectator ? controller.leaveSpectator() : controller.spectate())}>{room?.localSpectator ? '退出观战' : '加入观战'}</button><p className="mt-3 text-xs leading-relaxed text-muted">本局开始后加入，将保留到下一局。</p></aside>
        <footer className="grid content-center gap-3 border-t border-line pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <button type="button" className={`${button} rounded-full bg-red font-bold`} disabled={!lobby || busy || !local || !local?.ready && (!snapshot.runtimeAvailable || preparation?.status !== 'ready')} onClick={() => perform(() => controller.setReady(!local?.ready))}>{local?.ready ? '取消准备' : '准备'}</button>
          <button type="button" className={`${button} rounded-full bg-red font-bold`} disabled={!lobby || busy || !owner || !snapshot.runtimeAvailable || preparation?.status !== 'ready' || !!room?.seats.slice(0, room.playerCount).some(seat => !seat || seat.offline || !seat.ready)} onClick={() => perform(() => controller.start())}>{owner ? '开始游戏' : '等待房主'}</button>
          {snapshot.pendingAction && <p role="status" className="text-xs text-muted">正在等待服务器确认…</p>}
        </footer>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <details className="rounded-2xl border border-line bg-panel p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">个人设置 / 机体</summary><div className="grid gap-4 pt-4">
          <form className="grid gap-2" onSubmit={event => {event.preventDefault(); perform(() => controller.setDisplayName(name));}}><label className="grid gap-2 text-sm text-muted">联机昵称（首次设置后固定）<input className={field} value={snapshot.nameLocked ? snapshot.displayName : name} maxLength={12} autoComplete="off" disabled={snapshot.nameLocked} onChange={event => setName(event.target.value)}/></label>{!snapshot.nameLocked && <button type="submit" className={button}>保存昵称</button>}</form>
          <label className="grid gap-2 text-sm text-muted">机体<select className={field} value={snapshot.preferredLoadout} disabled={!lobby || busy} onChange={event => perform(() => controller.setLoadout(Number(event.target.value)))}>{policy.loadouts.map((loadout, index) => <option key={index} value={index}>{label(loadout.labelKey)}</option>)}</select></label>
          <button type="button" className={button} disabled={!lobby || busy || !local} onClick={() => perform(() => controller.standUp())}>离开玩家席位</button>
          <Link to={{pathname: `/play/${route.productId}`, search: queryWith({roomOptions: '1'})}} state={{roomOptionsParent: location.pathname + location.search + location.hash}} className="inline-flex min-h-11 items-center text-sm text-accent underline">作品 / 触屏设置</Link>
          <Link to={{pathname: `/play/${route.productId}`, search: queryWith({panel: 'help'})}} className="text-sm text-accent underline">操作帮助</Link>
          <p className="text-xs text-muted">触屏设置以作品的已保存设置为准；无限移动不符合禁用规则时，需要先调整设置。</p>
        </div></details>
        <details className="rounded-2xl border border-line bg-panel p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">房间 / 难度设置</summary><fieldset className="grid gap-4 pt-4" disabled={!lobby || busy || !owner || !room}>
          <p className="text-xs text-muted">只有 P1 房主可以修改。影响对局的更改会由服务器取消玩家准备。</p>
          <div className="grid grid-cols-2 gap-3"><label className="grid gap-2 text-sm text-muted">人数<select className={field} value={room?.playerCount ?? policy.playerCounts[0]} onChange={event => settings({playerCount: Number(event.target.value) as 2 | 3})}>{policy.playerCounts.map(count => <option key={count} value={count}>{count} 人</option>)}</select></label><label className="grid gap-2 text-sm text-muted">难度<select className={field} value={room?.difficulty ?? 1} onChange={event => settings({difficulty: Number(event.target.value)})}>{policy.difficulties.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label></div>
          <label className="grid gap-2 text-sm text-muted">可见性<select className={field} value={room?.visibility ?? 'public'} onChange={event => settings({visibility: event.target.value as 'public' | 'private'})}><option value="public">公开房间</option><option value="private">私人房间</option></select></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={room?.disableCheatMovement ?? false} onChange={event => settings({disableCheatMovement: event.target.checked})}/>禁用无限移动</label>
        </fieldset></details>
        <details className="rounded-2xl border border-line bg-panel p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">网络检测 / 输入时序</summary><div className="grid gap-4 pt-4">
          <p className="text-xs leading-relaxed text-muted">房间测试只检测独立探测连接，不代表正式游戏使用的线路，也不能代替开局的 Runtime 测量。</p>
          <button type="button" className={button} disabled={!lobby || !local} onClick={() => perform(() => controller.retryNetwork())}>重新检测</button>
          {snapshot.peers.map(peer => <div key={peer.clientId} className="rounded-xl border border-line p-3"><h3 className="mb-3 text-sm">P{peer.seat + 1}</h3><div className="grid grid-cols-3 gap-3">{(['direct', 'turn', 'relay'] as const).map(lane => <div key={lane}><p className="text-xs text-muted">{lane === 'direct' ? '直连' : lane === 'turn' ? 'TURN' : '中继'}</p><p className="mt-1 text-sm tabular-nums">{peer.metrics[lane].state === 'connected' && peer.metrics[lane].rtt != null ? `${Math.round(peer.metrics[lane].rtt!)} ms` : peer.metrics[lane].state === 'checking' ? '检测中' : '不可用'}</p></div>)}</div></div>)}
          {!!policy.inputTiming && <fieldset className="grid gap-3" disabled={!lobby || !owner}><label className="grid gap-2 text-sm text-muted">输入延迟<select className={field} value={snapshot.timingChoice.inputDelay} onChange={event => perform(() => controller.setTimingChoice({...snapshot.timingChoice, inputDelay: event.target.value === 'auto' ? 'auto' : Number(event.target.value)}))}><option value="auto">{policy.inputTiming.measuredStartup ? '开局由 Runtime 实测决定' : '自动建议'}</option>{Array.from({length: policy.inputTiming.measuredStartup ? 10 : 9}, (_, frames) => <option key={frames} value={frames}>{frames} 帧</option>)}</select></label>
            {policy.inputTiming.measuredStartup && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={snapshot.timingChoice.rollback} onChange={event => perform(() => controller.setTimingChoice({...snapshot.timingChoice, rollback: event.target.checked}))}/>启用回滚（手动输入延迟保持不变）</label>}
          </fieldset>}
          {(snapshot.measuredTiming || room?.timing) && <p className="text-sm">本局 Runtime 实测输入延迟：{(snapshot.measuredTiming || room?.timing)!.inputDelay} 帧</p>}
        </div></details>
        <details className="rounded-2xl border border-line bg-panel p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">观战成员（{room?.spectatorCount ?? 0}）</summary><ul className="grid gap-3 pt-4">{room?.spectators.map(spectator => <li key={spectator.clientId} className="flex items-center justify-between gap-3 rounded-xl bg-[#30312c] p-3"><span className="min-w-0 break-words text-sm">{spectator.name || '未命名'}{spectator.clientId === snapshot.clientId && '（我）'}</span>{owner && <button type="button" className={button} disabled={!lobby || busy} onClick={() => perform(() => controller.removeSpectator(spectator.clientId))}>移出</button>}</li>)}{!room?.spectatorCount && <li className="text-sm text-muted">暂无观战成员</li>}</ul></details>
      </div>
    </div>
  </section>;
}
