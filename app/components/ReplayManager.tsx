import {useLocale} from './LocaleProvider';
import {useCallback, useEffect, useId, useRef, useState, useSyncExternalStore} from 'react';
import {Link, useLocation} from 'react-router';
import {productManagementSearch} from '../runtime/route-session.mts';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {ReplayFilesMissingError, type ReplayController, type ReplayDeleteConfirmation, type ReplayDownload, type ReplayMessage, type ReplayRenameRequest, type ReplaySnapshot} from '../services/replays.client';
import {AnimatedDialog} from './AnimatedDialog';
import {useReplayController} from './ReplayProvider';
import {useFilePreparation} from './FilePreparationProvider';
import {useLibraryPanelNavigation} from './LibraryPanelNavigation';
const none = () => () => {};
const empty = () => null;
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
function formatBytes(bytes: number) {return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;}
function download(file: ReplayDownload) {
  const bytes = new Uint8Array(file.bytes.byteLength); bytes.set(file.bytes);
  const url = URL.createObjectURL(new Blob([bytes.buffer], {type: file.type}));
  const link = document.createElement('a'); link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ReplayManager({productId, compact = false}: {productId: ProductId; compact?: boolean}) {
  const {t} = useLocale();
  const controller = useReplayController();
  const location = useLocation();
  const {snapshot: preparation} = useFilePreparation();
  const automaticRead = useRef<{controller: ReplayController; key: string} | null>(null);
  const getSnapshot = useCallback(() => controller?.getSnapshot(productId) ?? null, [controller, productId]);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, getSnapshot, empty);
  useEffect(() => {controller?.loadProduct(productId);}, [controller, productId]);
  useEffect(() => {
    if (!compact && location.pathname.replace(/\/$/, '') === `/play/${productId}/replays` && controller && snapshot && !snapshot.loaded && !snapshot.busy && !snapshot.fileOperationBusy && (snapshot.readAvailable || preparation?.canPrepare)) {
      const key = `${productId}:${snapshot.epoch ?? 'idle'}`;
      if (automaticRead.current?.controller === controller && automaticRead.current.key === key) return;
      automaticRead.current = {controller, key};void controller.refresh(productId).catch(() => {});
    }
  }, [controller, productId, compact, location.pathname, snapshot?.loaded, snapshot?.busy, snapshot?.fileOperationBusy, snapshot?.readAvailable, snapshot?.epoch, preparation?.canPrepare]);
  if (!controller || !snapshot) return <p role="status" className={compact ? 'settings-file-loading' : 'py-6 text-muted'}>{t('react.replays.loading')}</p>;
  return <ReplayManagerView key={productId} productId={productId} controller={controller} snapshot={snapshot} compact={compact}/>;
}
/** The view owns downloads and confirmation presentation; service owns file policy. */
export function ReplayManagerView({productId, controller, snapshot, compact = false}: {productId: ProductId; controller: ReplayController; snapshot: ReplaySnapshot; compact?: boolean}) {
  const {t} = useLocale();
  const location = useLocation();
  const panel = useLibraryPanelNavigation();
  const {snapshot: preparation} = useFilePreparation();
  const [confirmation, setConfirmation] = useState<ReplayDeleteConfirmation | null>(null);
  const [renaming, setRenaming] = useState<ReplayRenameRequest | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState<ReplayMessage | null>(null);
  const [viewError, setViewError] = useState<ReplayMessage | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [missingExport, setMissingExport] = useState(false);
  const mounted = useRef(true), ticket = useRef(confirmation), renameTicket = useRef(renaming);
  const renamePending = useRef(false);
  const renameInput = useRef<HTMLInputElement>(null), replayInput = useRef<HTMLInputElement>(null), renameInputId = useId();
  ticket.current = confirmation; renameTicket.current = renaming;
  useEffect(() => {mounted.current = true; return () => {
    mounted.current = false;
    if (ticket.current) controller.cancelDelete(ticket.current);
    if (renameTicket.current) controller.cancelRename(renameTicket.current);
  };}, [controller]);
  useEffect(() => {
    if (confirmation && (confirmation.epoch !== snapshot.epoch || !snapshot.readAvailable)) closeConfirmation();
    if (renaming && (renaming.epoch !== snapshot.epoch || !snapshot.readAvailable)) closeRename();
  }, [controller, confirmation, renaming, snapshot.epoch, snapshot.readAvailable]);
  const canPrepare = preparation?.canPrepare === true;
  const busy = !!snapshot.busy, operationBusy = busy || snapshot.fileOperationBusy || preparation?.phase === 'preparing';
  const readDisabled = operationBusy || (!snapshot.readAvailable && !canPrepare);
  const importDisabled = operationBusy || (!snapshot.readAvailable && !canPrepare);
  const writeDisabled = operationBusy || (!snapshot.available && !snapshot.readAvailable);
  const manageTarget = {pathname:'/play/' + productId + '/replays', search:productManagementSearch(location.search), hash:location.hash};
  const display = (value: ReplayMessage) => typeof value === 'string' ? value : t(value.key, value.params);
  async function perform(operation: () => Promise<unknown>) {
    setViewError(null); setDownloadNotice(null); setMissingExport(false);
    try {await operation();} catch (error) {if (mounted.current) setViewError(controller.errorMessage(error));}
  }
  async function exportDownload(operation: () => Promise<ReplayDownload>) {
    let result: ReplayDownload;
    try {result = await operation();}
    catch (error) {
      if (error instanceof ReplayFilesMissingError && mounted.current) {setMissingExport(true); return;}
      throw error;
    }
    // A dismissed view must not unexpectedly open a download after navigation.
    if (!mounted.current) return;
    download(result); setDownloadNotice(result.name);
  }
  function closeConfirmation() {
    if (confirmation) controller.cancelDelete(confirmation);
    setConfirmation(null);
  }
  function closeRename() {
    if (renameTicket.current) controller.cancelRename(renameTicket.current);
    renameTicket.current = null; setRenaming(null); setRenameError(null);
  }
  async function rename() {
    const accepted = renameTicket.current;
    if (!accepted || writeDisabled || renamePending.current) return;
    renamePending.current = true;
    setRenameError(null); setViewError(null); setDownloadNotice(null);
    try {
      await controller.renameFile(accepted, renameName);
      if (mounted.current && renameTicket.current === accepted) closeRename();
    } catch (error) {
      if (!mounted.current) return;
      if (renameTicket.current === accepted) setRenameError(controller.errorMessage(error));
      else setViewError(controller.errorMessage(error));
    } finally {renamePending.current = false;}
  }
  const missingExportPrompt = <AnimatedDialog open={missingExport} onOpenChange={setMissingExport} title={t('dialog.confirmTitle')} description={t('file.missingReplayPrompt')} layer={70}>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button type="button" className={button} onClick={() => setMissingExport(false)}>{t('lobby.cancel')}</button>
      <button type="button" className={button} disabled={importDisabled} onClick={() => {setMissingExport(false);replayInput.current?.click();}}>{t('file.selectImport')}</button>
    </div>
  </AnimatedDialog>;
  const shownServiceError = missingExport && typeof snapshot.error === 'object' && snapshot.error?.key === 'file.noReplayToExport' ? null : snapshot.error;
  if (compact) return <section aria-label={t('react.replays.title')} className="settings-file-manager-compact">
    <div className="settings-file-tool-actions" role="group" aria-label={t('react.replays.title')}>
      <button type="button" className="settings-file-pill" disabled={readDisabled} title={!snapshot.readAvailable && !canPrepare ? snapshot.unavailableReason ?? undefined : undefined}
        onClick={() => void perform(() => exportDownload(() => controller.exportAll(productId)))}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75v8.5m-3.25-3.25L8 10.25l3.25-3.25M2.5 11.25v2h11v-2"/></svg>
        {t('settings.download')}
      </button>
      <Link className={'settings-file-pill' + (readDisabled ? ' is-disabled' : '')} aria-disabled={readDisabled || undefined} to={manageTarget} onClick={event => {
        if (!panel || readDisabled || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();panel.open(manageTarget);
      }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 14V3m-4 4 4-4 4 4"/></svg>
        {t('settings.manage')}
      </Link>
    </div>
    {missingExportPrompt}
    <input ref={replayInput} aria-label={t('react.replays.selectFile')} type="file" accept=".zip,.rpy,.rpyx" disabled={importDisabled} hidden onChange={event => {
      const file = event.currentTarget.files?.[0];event.currentTarget.value = '';if (file) void perform(() => controller.importFile(productId, file));
    }}/>
    {busy && <p role="status" className="settings-file-message">{t(snapshot.busy === 'list' ? 'react.replays.reading' : snapshot.busy === 'import' ? 'react.replays.importing' : snapshot.busy === 'export' ? 'react.replays.exporting' : snapshot.busy === 'rename' ? 'react.replays.renaming' : 'react.replays.deleting')}</p>}
    {(viewError || shownServiceError) && <p role="alert" className="settings-file-message text-accent">{display((viewError || shownServiceError)!)}</p>}
    {(downloadNotice || snapshot.notice) && <p role="status" className="settings-file-message">{downloadNotice ? t('react.files.downloadRequested', {name:downloadNotice}) : display(snapshot.notice!)}</p>}
  </section>;
  return <section aria-label={t('react.replays.title')} className="my-5 grid gap-5">
    <div className="rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">
      <p>{t('react.replays.storageHint')}</p>
      {!isMultiplayerProductId(productId) && <p className="mt-2">{t('react.replays.playbackHint')}</p>}
    </div>
    {!snapshot.readAvailable && <div className="grid gap-2 rounded-xl border border-line p-4 text-sm">
      <p role="status">{snapshot.unavailableReason}</p>
      <Link to={{pathname:`/play/${productId}`,search:productManagementSearch(location.search)}} className="min-h-11 w-fit py-2 text-accent underline underline-offset-4">{t('react.files.prepareResources')}</Link>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={readDisabled} onClick={() => void perform(() => controller.refresh(productId))}>{t('react.replays.refresh')}</button>
      <label className={`${button} relative inline-flex items-center ${importDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
        {t('react.replays.import')}
        <input ref={replayInput} aria-label={t('react.replays.selectFile')} type="file" accept=".zip,.rpy,.rpyx" disabled={importDisabled} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100" onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
          if (file) void perform(() => controller.importFile(productId, file));
        }}/>
      </label>
      <button type="button" className={button} disabled={readDisabled || !snapshot.loaded} onClick={() => void perform(() => exportDownload(() => controller.exportAll(productId)))}>{t('react.replays.exportAll')}</button>
    </div>
    {missingExportPrompt}
    <p role="status" aria-live="polite" className="text-sm text-muted">{busy ? t(snapshot.busy === 'list' ? 'react.replays.reading' : snapshot.busy === 'import' ? 'react.replays.importing' : snapshot.busy === 'export' ? 'react.replays.exporting' : snapshot.busy === 'rename' ? 'react.replays.renaming' : 'react.replays.deleting') : snapshot.loaded ? t('react.replays.count', {count:snapshot.files.length}) : t('react.replays.notLoaded')}</p>
    {(viewError || shownServiceError) && !renaming && <p role="alert" className="break-words text-sm text-accent">{display((viewError || shownServiceError)!)}</p>}
    {(downloadNotice || snapshot.notice) && <p role="status" className="break-words text-sm">{downloadNotice ? t('react.files.downloadRequested', {name:downloadNotice}) : display(snapshot.notice!)}</p>}
    {snapshot.loaded && !snapshot.files.length && <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">{t('react.replays.empty')}</p>}
    {snapshot.loaded && snapshot.files.length > 0 && <ul aria-label={t('react.replays.files')} className="divide-y divide-line rounded-2xl border border-line px-4">
      {snapshot.files.map(file => <li key={file.path} className="flex flex-wrap items-center gap-3 py-4">
        <div className="min-w-0 flex-1 basis-40"><p className="break-all text-sm" title={file.name}>{file.name}</p><p className="mt-1 text-xs text-muted">{formatBytes(file.size)}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={readDisabled} aria-label={t('react.files.downloadName', {name:file.name})} onClick={() => void perform(() => exportDownload(() => controller.exportFile(productId, file.path)))}>{t('settings.download')}</button>
          <button type="button" className={button} disabled={writeDisabled} aria-label={t('react.replays.renameName', {name:file.name})} onClick={() => {
            setViewError(null); setDownloadNotice(null); setRenameError(null);
            try {
              const next = controller.requestRename(productId, file.path);
              renameTicket.current = next; setRenaming(next); setRenameName(next.name);
            } catch (error) {setViewError(controller.errorMessage(error));}
          }}>{t('action.rename')}</button>
          <button type="button" className={`${button} text-accent`} disabled={writeDisabled} aria-label={t('react.files.deleteName', {name:file.name})} onClick={() => {
            setViewError(null);
            try {setConfirmation(controller.requestDelete(productId, file.path));} catch (error) {setViewError(error instanceof Error ? error.message : String(error));}
          }}>{t('action.delete')}</button>
        </div>
      </li>)}
    </ul>}
    <AnimatedDialog open={renaming !== null} onOpenChange={open => {if (!open) closeRename();}} title={t('replay.renamePrompt')} description={t('react.replays.renameHint')} initialFocus={renameInput} layer={70}
      onOpenAutoFocus={() => renameInput.current?.select()}>
      <form onSubmit={event => {event.preventDefault(); void rename();}}>
        <p className="my-3 break-all text-sm">{renaming?.name}</p>
        <label htmlFor={renameInputId} className="text-sm">{t('react.replays.newName')}</label>
        <input ref={renameInput} id={renameInputId} value={renameName} onChange={event => {setRenameName(event.target.value); setRenameError(null);}}
          required autoComplete="off" spellCheck={false} disabled={writeDisabled} className="my-2 min-h-11 w-full rounded-xl border border-line bg-panel px-3 text-paper"/>
        <p className="text-sm text-muted">{renaming && t('replay.nameInvalid', {prefix:renaming.prefix})}</p>
        {snapshot.busy === 'rename' && <p role="status" className="mt-3 text-sm text-muted">{t('react.replays.renaming')}</p>}
        {renameError && <p role="alert" className="mt-3 break-words text-sm text-accent">{display(renameError)}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className={button} onClick={closeRename}>{t(snapshot.busy === 'rename' ? 'action.close' : 'lobby.cancel')}</button>
          <button type="submit" className={button} disabled={writeDisabled || renaming?.epoch !== snapshot.epoch}>{t('action.rename')}</button>
        </div>
      </form>
    </AnimatedDialog>
    <AnimatedDialog open={confirmation !== null} onOpenChange={open => {if (!open) closeConfirmation();}} title={t('react.replays.deleteTitle')} description={t('react.replays.deleteHint')} layer={70}>
      <p className="my-5 break-all text-sm">{confirmation?.name}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={button} onClick={closeConfirmation}>{t('lobby.cancel')}</button>
        <button type="button" className={`${button} border-accent text-accent`} disabled={writeDisabled || confirmation?.epoch !== snapshot.epoch} onClick={() => {
          const accepted = confirmation; setConfirmation(null);
          if (accepted) void perform(() => controller.confirmDelete(accepted));
        }}>{t('react.files.confirmDelete')}</button>
      </div>
    </AnimatedDialog>
  </section>;
}
