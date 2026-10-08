import {useLocale} from './LocaleProvider';
import {useEffect, useLayoutEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {useGamePreferences} from './GameSettingsProvider';
import {useTouchLayoutSnapshot} from './TouchLayoutProvider';
import {useGameLaunchJob, useSettingsGameLaunch, useGamePackageImporter} from './GameLaunchProvider';
import type {LaunchUpdateChoice} from '../services/game-launch-job.client';
import './game-launch.css';

const button = 'min-h-11 disabled:cursor-not-allowed disabled:opacity-50';
export function GameLaunch({productId}: {productId: ProductId}) {
  const {t} = useLocale();
  const {controller, snapshot} = useGameLaunchJob(), live = useRuntimeSnapshot();
  const {settings} = useGamePreferences(productId);
  const layout = useTouchLayoutSnapshot();
  const {controller: start, snapshot: launch} = useSettingsGameLaunch();
  const importPackage = useGamePackageImporter();
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const multiplayer = isMultiplayerProductId(productId);
  useLayoutEffect(() => {
    setFooter(document.querySelector<HTMLElement>('[data-library-launch-footer]'));
  }, [productId]);
  useEffect(() => {
    if (!controller || multiplayer || controller.getSnapshot().preparing || live?.epoch != null) return;
    const current = controller.getSnapshot();
    // Keep a failed preparation visible until the user explicitly rechecks.
    if (current.error && current.selection?.productId === productId && !current.inspection) return;
    if (current.inspection?.productId !== productId) void controller.inspect(productId).catch(() => {});
  }, [controller, productId, multiplayer, snapshot?.preparing, live?.epoch]);
  if (multiplayer) return <p className="my-6 text-sm text-muted">{t('react.launch.multiplayerUnavailable')}</p>;
  const inspection = snapshot?.inspection?.productId === productId ? snapshot.inspection : null;
  const active = !!live && (live.launched || live.runtimeVariant === 'multiplayer' || !!live.saveError || live.fileOperationBusy || live.epoch !== null && live.phase !== 'prepared');
  const launching = !!launch && !['idle', 'error'].includes(launch.phase);
  const prepareDisabled = !start || !settings || snapshot?.preparing || launching || active;
  const prepare = (choice?: LaunchUpdateChoice) => {if (settings) void start?.launch({productId, preferences: settings, touchLayout: layout?.saved ?? null, updateChoice: choice});};
  const statusAvailable = !!inspection?.available && !inspection.requiresStorageRepair && !snapshot?.inspecting && !snapshot?.preparing;
  const status = launch?.phase === 'starting' ? t('react.prepared.starting') : snapshot?.preparing ? t('react.runtime.preparing')
    : snapshot?.inspecting ? t('react.launch.inspecting')
    : inspection?.requiresStorageRepair ? t('react.launch.repairHint')
    : inspection?.available ? t('react.launch.available')
    : inspection?.reason?.message ?? t('react.launch.waiting');
  const content = <section aria-label={t('react.launch.aria', {product:productId.toUpperCase()})} className="game-launch-actions">
    <div className="sr-only">
      <h2>{t('react.launch.title', {product:productId.toUpperCase()})}</h2>
      <p>{t('react.launch.hint')}</p>
    </div>
    <p role="status" className={launching || snapshot?.preparing ? undefined : 'sr-only'} data-launch-status="" data-launch-available={statusAvailable ? 'true' : 'false'}>
      <span>{status}</span>
      <button type="button" className="game-launch-recheck" disabled={!controller || snapshot?.preparing || snapshot?.inspecting} onClick={() => void controller?.inspect(productId).catch(() => {})}>{t('react.launch.recheck')}</button>
    </p>
    {inspection?.updateAvailable && <p role="status" className="game-launch-update">{t(inspection.source === 'local' ? 'package.updateAvailableLocal' : 'package.updateAvailableRemote')}</p>}
    <div className="game-launch-buttons">
      <button type="button" className={button} data-launch-primary="" disabled={prepareDisabled} onClick={() => prepare()}><svg viewBox="0 0 24 24" aria-hidden="true" className="game-launch-play"><path d="m9 6 9 6-9 6Z"/></svg>{t(inspection?.requiresStorageRepair ? 'react.launch.prepareRepair' : 'action.start')}</button>
      <button type="button" disabled={!importPackage || snapshot?.preparing || launching} onClick={() => importPackage?.(productId)} className="game-launch-import" data-launch-secondary="">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 3v11m-4-4 4 4 4-4"/></svg>
        {t('action.import')}
      </button>
    </div>
    {!!(snapshot?.preparing || launch?.error) && <div className="game-launch-messages">
      {snapshot?.progress && <p className="game-launch-detail" role="status">{t('react.launch.processed', {completed:snapshot.progress.completed,total:snapshot.progress.total})}</p>}
      {snapshot?.warnings.map((warning, index) => <p key={index} role="status" className="game-launch-warning">{warning}</p>)}
      {launch?.error && <p role="alert" className="game-launch-error">{launch.error}</p>}
    </div>}
  </section>;
  return footer ? createPortal(content, footer) : content;
}
