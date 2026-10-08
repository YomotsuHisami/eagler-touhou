import {useEffect, useRef} from 'react';
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
import {useGamePackageImporter} from './GamePackageImporterContext';
import {usePlayerSurface} from '../runtime/PlayerToolsSurface';
import './game-launch.css';
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
const importableFailureCodes = new Set(['host-unavailable', 'game-unavailable', 'unpublished-runtime', 'catalog-unavailable',
  'package-unavailable', 'missing-object', 'asset-unavailable', 'integrity-failed', 'language-unavailable', 'storage-repair-required']);
function importableFailure(reason: unknown) {
  return !!reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' && importableFailureCodes.has(reason.code);
}
export function MultiplayerReplayViewer({productId, compact = false}: {productId: MultiplayerProductId; compact?: boolean}) {
  const {t} = useLocale(), {controller, snapshot, startReplay, starting} = useMultiplayerReplay();
  const {settings} = useGamePreferences(productId), layout = useTouchLayoutSnapshot(), live = useRuntimeSnapshot();
  const {snapshot: room} = useMultiplayerRoom();
  const openPackageImport = useGamePackageImporter(), playerSurface = usePlayerSurface();
  const capturedStart = useRef<{settings: PreferencesSnapshot; touchLayout: TouchLayout | null} | null>(null);
  useResourceInspection(productId);
  useEffect(() => {
    if (!controller || controller.getSnapshot().preparing) return;
    // Returning from resource import rechecks the same Replay product.
    void controller.inspect(productId).catch(() => {});
  }, [controller, productId]);
  if (!controller || !snapshot) return <p role="status" className="py-6 text-muted">{t('ui.multiplayerReplay.loading')}</p>;
  const active = !!live && (live.epoch !== null || live.ready || live.launched || live.fileOperationBusy || !!live.saveError || !!live.closeError);
  const importPackage = (resume: boolean, reason?: string, selection?: {settings: PreferencesSnapshot; touchLayout: TouchLayout | null}) => {
    if (!openPackageImport) return;
    capturedStart.current = resume ? selection ?? null : null;
    openPackageImport(productId, {reason, onDismiss: () => {if (resume) capturedStart.current = null;}, onImported: importedProduct => {
      if (importedProduct !== productId) return;
      const captured = resume ? capturedStart.current : null;
      capturedStart.current = null;
      void controller.inspect(productId).then(async () => {
        if (!captured || !startReplay) return;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const release = playerSurface?.beginStart() ?? (() => {});
        try {await startReplay(productId, captured.settings, captured.touchLayout);} catch {} finally {release();}
      }).catch(() => {});
    }});
  };
  const selection = settings ? {settings, touchLayout: layout?.saved ?? null} : null;
  const content = <MultiplayerReplayViewerView productId={productId} controller={controller} snapshot={snapshot} settings={settings} touchLayout={layout?.saved ?? null}
    runtimeActive={active} inRoom={!!room?.route} startReplay={startReplay} starting={starting} compact={compact}
    onImport={openPackageImport ? (resume = false, reason?: string, captured?: {settings: PreferencesSnapshot; touchLayout: TouchLayout | null}) => importPackage(resume, reason, captured) : undefined}
    onWatch={startReplay && selection ? async () => {
      const release = playerSurface?.beginStart() ?? (() => {});
      try {await startReplay(productId, selection.settings, selection.touchLayout);}
      catch (reason) {if (importableFailure(reason)) importPackage(true, reason instanceof Error ? reason.message : String(reason), selection);}
      finally {release();}
    } : undefined}/>;
  return content;
}
/** Presentation injection seam for source/SSR and synthetic CI coverage. */
export function MultiplayerReplayViewerView({productId, controller, snapshot, settings, touchLayout, runtimeActive, inRoom, startReplay, starting = false, compact = false, onImport, onWatch}: {
  productId: MultiplayerProductId; controller: MultiplayerReplayJob; snapshot: MultiplayerReplaySnapshot;
  settings: PreferencesSnapshot | null; touchLayout: TouchLayout | null; runtimeActive: boolean; inRoom: boolean;
  startReplay: ((productId: MultiplayerProductId, settings: PreferencesSnapshot, touchLayout: TouchLayout | null) => Promise<unknown>) | null;
  starting?: boolean; compact?: boolean; onImport?: (resume?: boolean, reason?: string, selection?: {settings: PreferencesSnapshot; touchLayout: TouchLayout | null}) => void; onWatch?: () => void;
}) {
  const {t} = useLocale(), location = useLocation();
  const inspection = snapshot.inspection?.productId === productId ? snapshot.inspection : null;
  const current = snapshot.selection?.productId === productId;
  const disabled = !startReplay || !settings || snapshot.preparing || starting || runtimeActive || inRoom;
  if (compact) return <section aria-label={t('ui.multiplayerReplay.title')} className="game-launch-actions multiplayer-replay-launch">
    <div className="game-launch-buttons">
    <button type="button" data-launch-primary=""
      disabled={disabled} onClick={() => {
        if (disabled) return;
        if (inspection?.available === false) {
          if (importableFailure(inspection.reason)) onImport?.(true, inspection.reason?.message, settings ? {settings, touchLayout} : undefined);
          return;
        }
        onWatch?.();
      }}><svg viewBox="0 0 24 24" aria-hidden="true" className="game-launch-play"><path d="m9 6 9 6-9 6Z"/></svg>{starting ? t('ui.multiplayerReplay.starting') : t('action.watchReplay')}</button>
    {onImport && <button type="button" className="game-launch-import" data-launch-secondary=""
      disabled={starting || snapshot.preparing} onClick={() => onImport(false, inspection?.reason?.message)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 3v11m-4-4 4 4 4-4"/></svg>{t('action.import')}</button>}
    </div>
    {(inRoom || runtimeActive || snapshot.preparing || starting || inspection?.requiresStorageRepair || inspection?.reason || snapshot.error) &&
      <p role="status" className="basis-full text-xs text-muted">
        {inRoom ? t('ui.multiplayerReplay.leaveRoom') : runtimeActive ? t('ui.multiplayerReplay.closeCurrent') : snapshot.preparing ? t('ui.multiplayerReplay.preparing', {game: productId.toUpperCase()}) : starting ? t('ui.multiplayerReplay.starting') : inspection?.requiresStorageRepair ? t('react.launch.repairHint') : snapshot.error ?? inspection?.reason?.message}
      </p>}
    {current && snapshot.progress && <p role="status" className="basis-full text-xs text-muted">{t('react.launch.processed', {completed: snapshot.progress.completed, total: snapshot.progress.total})}</p>}
  </section>;
  return <section aria-label={t('ui.multiplayerReplay.title')} className="my-6 grid gap-3 rounded-2xl border border-line p-4">
    <h2 className="font-bold">{t('ui.multiplayerReplay.title')}</h2>
    <p className="text-sm text-muted">{t('ui.multiplayerReplay.hint')}</p>
    <p role="status" className="text-sm">{inRoom ? t('ui.multiplayerReplay.leaveRoom') : runtimeActive ? t('ui.multiplayerReplay.closeCurrent') : snapshot.inspecting ? t('react.launch.inspecting') : inspection?.requiresStorageRepair ? t('react.launch.repairHint') : inspection?.available ? t('react.launch.available') : inspection?.reason?.message ?? t('ui.multiplayerReplay.waiting')}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={snapshot.preparing || snapshot.inspecting} onClick={() => void controller.inspect(productId).catch(() => {})}>{t('react.launch.recheck')}</button>
      <button type="button" className={button} disabled={disabled || !inspection?.available} onClick={() => {
        if (settings && startReplay && !inRoom && !runtimeActive) void startReplay(productId, settings, touchLayout).catch(() => {});
      }}>{starting ? t('ui.multiplayerReplay.starting') : t('ui.multiplayerReplay.open')}</button>
      <Link className={`${button} inline-flex items-center`} to={{pathname: `/play/${productId}/resources`, search: productManagementSearch(location.search)}}>{t('ui.multiplayerReplay.resources')}</Link>
    </div>
    <p className="text-xs text-muted">{t('ui.multiplayerReplay.importHint')}</p>
    {current && snapshot.progress && <p role="status" className="text-xs text-muted">{t('react.launch.processed', {completed: snapshot.progress.completed, total: snapshot.progress.total})}</p>}
    {(current || inspection) && snapshot.error && <p role="alert" className="text-sm text-accent">{snapshot.error}</p>}
  </section>;
}
