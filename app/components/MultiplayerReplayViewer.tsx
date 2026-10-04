import {useEffect} from 'react';
import {Link, useLocation} from 'react-router';
import type {MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import type {MultiplayerReplayJob, MultiplayerReplaySnapshot} from '../services/multiplayer-replay.client';
import type {PreferencesSnapshot} from '../services/preferences.client';
import type {TouchLayout} from '../../src/launcher/touch-layout-model.mts';
import {productManagementSearch} from '../runtime/route-session.mts';
import {useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {useGamePreferences} from './GameSettingsProvider';
import {useTouchLayoutSnapshot} from './TouchLayoutProvider';
import {useResourceInspection} from './ResourceManagerProvider';
import {useMultiplayerReplay} from './MultiplayerReplayProvider';
import {useMultiplayerRoom} from './MultiplayerRoomProvider';
import {useLocale} from './LocaleProvider';
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
export function MultiplayerReplayViewer({productId}: {productId: MultiplayerProductId}) {
  const {t} = useLocale(), {controller, snapshot} = useMultiplayerReplay();
  const {settings} = useGamePreferences(productId), layout = useTouchLayoutSnapshot(), live = useRuntimeSnapshot();
  const {snapshot: room} = useMultiplayerRoom();
  useResourceInspection(productId);
  useEffect(() => {
    if (!controller || controller.getSnapshot().preparing) return;
    // Returning from resource import rechecks the same Replay product.
    void controller.inspect(productId).catch(() => {});
  }, [controller, productId]);
  if (!controller || !snapshot) return <p role="status" className="py-6 text-muted">{t('ui.multiplayerReplay.loading')}</p>;
  const active = !!live && (live.epoch !== null || live.ready || live.launched || live.fileOperationBusy || !!live.saveError || !!live.closeError);
  return <MultiplayerReplayViewerView productId={productId} controller={controller} snapshot={snapshot} settings={settings} touchLayout={layout?.saved ?? null} runtimeActive={active} inRoom={!!room?.route}/>;
}
/** Presentation injection seam for source/SSR and synthetic CI coverage. */
export function MultiplayerReplayViewerView({productId, controller, snapshot, settings, touchLayout, runtimeActive, inRoom}: {
  productId: MultiplayerProductId; controller: MultiplayerReplayJob; snapshot: MultiplayerReplaySnapshot;
  settings: PreferencesSnapshot | null; touchLayout: TouchLayout | null; runtimeActive: boolean; inRoom: boolean;
}) {
  const {t} = useLocale(), location = useLocation();
  const inspection = snapshot.inspection?.productId === productId ? snapshot.inspection : null;
  const current = snapshot.selection?.productId === productId;
  return <section aria-label={t('ui.multiplayerReplay.title')} className="my-6 grid gap-3 rounded-2xl border border-line p-4">
    <h2 className="font-bold">{t('ui.multiplayerReplay.title')}</h2>
    <p className="text-sm text-muted">{t('ui.multiplayerReplay.hint')}</p>
    <p role="status" className="text-sm">{inRoom ? t('ui.multiplayerReplay.leaveRoom') : runtimeActive ? t('ui.multiplayerReplay.closeCurrent') : snapshot.inspecting ? t('react.launch.inspecting') : inspection?.requiresStorageRepair ? t('react.launch.repairHint') : inspection?.available ? t('react.launch.available') : inspection?.reason?.message ?? t('ui.multiplayerReplay.waiting')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={snapshot.preparing || snapshot.inspecting} onClick={() => void controller.inspect(productId).catch(() => {})}>{t('react.launch.recheck')}</button>
      <button type="button" className={button} disabled={!settings || !inspection?.available || snapshot.preparing || runtimeActive || inRoom} onClick={() => {
        if (settings && !inRoom && !runtimeActive) void controller.prepare(productId, settings, touchLayout).catch(() => {});
      }}>{t('ui.multiplayerReplay.prepare')}</button>
      <Link className={`${button} inline-flex items-center`} to={{pathname: `/play/${productId}/resources`, search: productManagementSearch(location.search)}}>{t('ui.multiplayerReplay.resources')}</Link>
    </div>
    <p className="text-xs text-muted">{t('ui.multiplayerReplay.importHint')}</p>
    {current && snapshot.progress && <p role="status" className="text-xs text-muted">{t('react.launch.processed', {completed: snapshot.progress.completed, total: snapshot.progress.total})}</p>}
    {(current || inspection) && snapshot.error && <p role="alert" className="text-sm text-accent">{snapshot.error}</p>}
  </section>;
}
