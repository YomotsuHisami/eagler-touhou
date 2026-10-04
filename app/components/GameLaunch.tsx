import {useEffect} from 'react';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {useGamePreferences} from './GameSettingsProvider';
import {useTouchLayoutSnapshot} from './TouchLayoutProvider';
import {useGameLaunchJob} from './GameLaunchProvider';
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function GameLaunch({productId}: {productId: ProductId}) {
  const {controller, snapshot} = useGameLaunchJob(), live = useRuntimeSnapshot();
  const {settings} = useGamePreferences(productId);
  const layout = useTouchLayoutSnapshot();
  const multiplayer = isMultiplayerProductId(productId);
  useEffect(() => {
    if (!controller || multiplayer || controller.getSnapshot().preparing) return;
    if (controller.getSnapshot().inspection?.productId !== productId) void controller.inspect(productId).catch(() => {});
  }, [controller, productId, multiplayer]);
  if (multiplayer) return <p className="my-6 text-sm text-muted">联机房间与启动流程尚未接入此入口。单机准备不会代替联机启动。</p>;
  const inspection = snapshot?.inspection?.productId === productId ? snapshot.inspection : null;
  const active = !!live && (live.epoch !== null || live.ready || live.launched || !!live.saveError);
  return <section aria-label={`${productId.toUpperCase()} 游戏启动`} className="my-6 grid gap-3 rounded-2xl border border-line p-4">
    <h2 className="font-bold">准备并启动 {productId.toUpperCase()}</h2>
    <p className="text-sm text-muted">按点击时的语言、音乐与游戏设置准备资源。资源校验完成后仍需明确点击启动。</p>
    <p role="status">{snapshot?.inspecting ? '正在检查已安装与发布资源…' : inspection?.available ? '已找到匹配资源；准备时仍会验证数据完整性。' : inspection?.reason?.message ?? '等待资源检查。'}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!controller || snapshot?.preparing || snapshot?.inspecting} onClick={() => void controller?.inspect(productId).catch(() => {})}>重新检查</button>
      <button type="button" className={button} disabled={!controller || !settings || !inspection?.available || snapshot?.preparing || active} onClick={() => {
        if (settings) void controller?.prepare(productId, settings, layout?.saved ?? null).catch(() => {});
      }}>准备游戏资源</button>
    </div>
    {snapshot?.progress && <p className="text-xs text-muted">已处理 {snapshot.progress.completed} / {snapshot.progress.total} 项资源</p>}
    {snapshot?.warnings.map((warning, index) => <p key={index} role="status" className="text-sm text-accent">{warning}</p>)}
    {snapshot?.error && <p role="alert" className="text-sm text-accent">{snapshot.error}</p>}
    <p className="text-xs text-muted">OGG 先准备前两首，游玩时继续下载其余曲目；MIDI 会在明确启动时请求播放声音。源码仓库不含原版数据或完整 Runtime。</p>
  </section>;
}
