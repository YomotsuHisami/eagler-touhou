import {useLocale} from './LocaleProvider';
import {useEffect} from 'react';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {useGamePreferences} from './GameSettingsProvider';
import {useTouchLayoutSnapshot} from './TouchLayoutProvider';
import {useGameLaunchJob} from './GameLaunchProvider';
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function GameLaunch({productId}: {productId: ProductId}) {
  const {t} = useLocale();
  const {controller, snapshot} = useGameLaunchJob(), live = useRuntimeSnapshot();
  const {settings} = useGamePreferences(productId);
  const layout = useTouchLayoutSnapshot();
  const multiplayer = isMultiplayerProductId(productId);
  useEffect(() => {
    if (!controller || multiplayer || controller.getSnapshot().preparing) return;
    if (controller.getSnapshot().inspection?.productId !== productId) void controller.inspect(productId).catch(() => {});
  }, [controller, productId, multiplayer]);
  if (multiplayer) return <p className="my-6 text-sm text-muted">{t('react.launch.multiplayerUnavailable')}</p>;
  const inspection = snapshot?.inspection?.productId === productId ? snapshot.inspection : null;
  const active = !!live && (live.epoch !== null || live.ready || live.launched || !!live.saveError);
  return <section aria-label={t('react.launch.aria', {product:productId.toUpperCase()})} className="my-6 grid gap-3 rounded-2xl border border-line p-4">
    <h2 className="font-bold">{t('react.launch.title', {product:productId.toUpperCase()})}</h2>
    <p className="text-sm text-muted">{t('react.launch.hint')}</p>
    <p role="status">{snapshot?.inspecting ? t('react.launch.inspecting') : inspection?.requiresStorageRepair ? t('react.launch.repairHint') : inspection?.available ? t('react.launch.available') : inspection?.reason?.message ?? t('react.launch.waiting')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!controller || snapshot?.preparing || snapshot?.inspecting} onClick={() => void controller?.inspect(productId).catch(() => {})}>{t('react.launch.recheck')}</button>
      <button type="button" className={button} disabled={!controller || !settings || !inspection?.available || snapshot?.preparing || active} onClick={() => {
        if (settings) void controller?.prepare(productId, settings, layout?.saved ?? null).catch(() => {});
      }}>{t(inspection?.requiresStorageRepair ? 'react.launch.prepareRepair' : 'react.launch.prepare')}</button>
    </div>
    {snapshot?.progress && <p className="text-xs text-muted">{t('react.launch.processed', {completed:snapshot.progress.completed,total:snapshot.progress.total})}</p>}
    {snapshot?.warnings.map((warning, index) => <p key={index} role="status" className="text-sm text-accent">{warning}</p>)}
    {snapshot?.error && <p role="alert" className="text-sm text-accent">{snapshot.error}</p>}
    <p className="text-xs text-muted">{t('react.launch.audioHint')}</p>
  </section>;
}
