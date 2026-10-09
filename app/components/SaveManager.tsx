import {useLocale} from './LocaleProvider';
import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Link, useLocation} from 'react-router';
import {productManagementSearch} from '../runtime/route-session.mts';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {SaveFileMissingError, type SaveController, type SaveDownload, type SaveSnapshot} from '../services/saves.client';
import {AnimatedDialog} from './AnimatedDialog';
import {useSaveController} from './SaveProvider';
import {useFilePreparation} from './FilePreparationProvider';
const none = () => () => {};
const empty = () => null;
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
function formatBytes(bytes: number) {return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;}
function download(file: SaveDownload) {
  const bytes = new Uint8Array(file.bytes.byteLength); bytes.set(file.bytes);
  const url = URL.createObjectURL(new Blob([bytes.buffer], {type: file.type}));
  try {
    const link = document.createElement('a'); link.href = url; link.download = file.name;
    document.body.append(link);
    try {link.click();} finally {link.remove();}
  } finally {setTimeout(() => URL.revokeObjectURL(url), 1000);}
}
export function SaveManager({productId, compact = false}: {productId: ProductId; compact?: boolean}) {
  const {t} = useLocale();
  const controller = useSaveController();
  const getSnapshot = useCallback(() => controller?.getSnapshot(productId) ?? null, [controller, productId]);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, getSnapshot, empty);
  useEffect(() => {controller?.loadProduct(productId);}, [controller, productId]);
  useEffect(() => {
    if (!compact && controller && snapshot?.readAvailable && !snapshot.loaded && !snapshot.busy && !snapshot.fileOperationBusy) void controller.refresh(productId).catch(() => {});
  }, [controller, productId, compact, snapshot?.readAvailable, snapshot?.epoch]);
  if (!controller || !snapshot) return <p role="status" className={compact ? 'settings-file-loading' : 'py-6 text-muted'}>{t('react.saves.loading')}</p>;
  return <SaveManagerView key={productId} productId={productId} controller={controller} snapshot={snapshot} compact={compact}/>;
}
/** Route view only: file policy and accepted work survive route dismissal. */
export function SaveManagerView({productId, controller, snapshot, compact = false}: {productId: ProductId; controller: SaveController; snapshot: SaveSnapshot; compact?: boolean}) {
  const {t} = useLocale();
  const {snapshot: preparation} = useFilePreparation();
  const location = useLocation();
  const [confirmation, setConfirmation] = useState<'overwrite' | 'missing' | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true), selectionConsent = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;selectionConsent.current = false;};}, [controller]);
  const canPrepare = preparation?.canPrepare === true;
  const busy = !!snapshot.busy || snapshot.fileOperationBusy || preparation?.phase === 'preparing';
  const readDisabled = busy || (!snapshot.readAvailable && !canPrepare);
  const importDisabled = busy || (!snapshot.readAvailable && !canPrepare);
  const displayNotice = (notice: NonNullable<SaveSnapshot['notice']>) => typeof notice === 'string' ? notice : t(notice.key, notice.params);
  async function perform(operation: () => Promise<unknown>) {
    setViewError(null); setDownloadNotice(null);
    try {await operation();} catch (error) {if (mounted.current) setViewError(error instanceof Error ? error.message : String(error));}
  }
  async function exportDownload() {
    let result: SaveDownload;
    try {result = await controller.exportFile(productId);}
    catch (error) {
      if (error instanceof SaveFileMissingError && mounted.current) {setConfirmation('missing'); return;}
      throw error;
    }
    // Downloads belong to this view; navigating away does not trigger a late one.
    if (!mounted.current) return;
    download(result); setDownloadNotice(result.name);
  }
  function closeConfirmation() {
    setConfirmation(null);selectionConsent.current = false;
  }
  const controls = <div className={compact ? 'settings-file-tool-actions' : 'flex flex-wrap gap-2'} role="group" aria-label={t('react.saves.title')}>
    {!compact && <button type="button" className={button} disabled={readDisabled} onClick={() => void perform(() => controller.refresh(productId))}>{t('react.saves.refresh')}</button>}
    <button type="button" className={compact ? 'settings-file-pill' : button} disabled={readDisabled} title={!snapshot.readAvailable ? snapshot.unavailableReason ?? undefined : undefined} onClick={() => void perform(exportDownload)}>
      {compact && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75v8.5m-3.25-3.25L8 10.25l3.25-3.25M2.5 11.25v2h11v-2"/></svg>}
      {compact ? t('settings.download') : t('react.saves.export')}
    </button>
    <button type="button" disabled={importDisabled} aria-haspopup="dialog" className={compact ? 'settings-file-pill settings-file-import' : button} onClick={() => setConfirmation('overwrite')}>
      {compact && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10.25v-8.5m-3.25 3.25L8 1.75l3.25 3.25M2.5 11.25v2h11v-2"/></svg>}
      {compact ? t('settings.import') : t('react.saves.import')}
    </button>
      <input ref={importInput} aria-label={t('react.saves.selectFile')} type="file" accept=".dat" disabled={importDisabled} hidden onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        const accepted = selectionConsent.current;selectionConsent.current = false;
        if (!file || !accepted || !mounted.current) return;
        setViewError(null); setDownloadNotice(null);
        void perform(async () => {
          controller.validateImportFile(file);
          if (!snapshot.readAvailable) await controller.prepareFiles(productId);
          if (!mounted.current) return;
          await controller.confirmImport(controller.requestImport(productId, file));
        });
      }}/>
  </div>;
  const notices = <>
    {(viewError || snapshot.error) && <p role="alert" className="break-words text-sm text-accent">{viewError || snapshot.error}</p>}
    {(downloadNotice || snapshot.notice) && <p role="status" className="break-words text-sm">{downloadNotice ? t('react.files.downloadRequested', {name:downloadNotice}) : displayNotice(snapshot.notice!)}</p>}
  </>;
  const importConfirmation = <AnimatedDialog open={confirmation !== null} onOpenChange={open => {if (!open) closeConfirmation();}} title={t('dialog.confirmTitle')} description={t(confirmation === 'missing' ? 'file.missingSavePrompt' : 'file.importSaveOverwrite')} layer={70}>
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={button} onClick={closeConfirmation}>{t('lobby.cancel')}</button>
      <button type="button" className={button + ' border-accent text-accent'} disabled={importDisabled} onClick={() => {
        setConfirmation(null);selectionConsent.current = true;importInput.current?.click();
      }}>{t(confirmation === 'missing' ? 'file.selectImport' : 'file.continueImport')}</button>
    </div>
  </AnimatedDialog>;
  if (compact) return <section aria-label={t('react.saves.title')} className="settings-file-manager-compact">
    {controls}
    {notices}
    {importConfirmation}
  </section>;
  return <section aria-label={t('react.saves.title')} className="my-5 grid gap-5">
    <div className="rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">
      <p>{t('react.saves.storageHint', {file:snapshot.scoreFile})}</p>
      <p className="mt-2">{t('react.saves.fileHint')}</p>
    </div>
    {!snapshot.readAvailable && <div className="grid gap-2 rounded-xl border border-line p-4 text-sm">
      <p role="status">{snapshot.unavailableReason}</p>
      <Link to={{pathname:`/play/${productId}${isMultiplayerProductId(productId) ? '/replays' : ''}`,search:productManagementSearch(location.search)}} className="min-h-11 w-fit py-2 text-accent underline underline-offset-4">{t('react.files.prepareResources')}</Link>
    </div>}
    <div className="rounded-2xl border border-line p-4">
      <p className="break-all text-sm">{snapshot.game.toUpperCase()} · {snapshot.scoreFile}</p>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted">{snapshot.busy === 'import' ? t('react.saves.importing')
        : snapshot.busy === 'export' ? t('react.saves.exporting') : snapshot.busy === 'read' ? t('react.saves.reading')
          : snapshot.loaded ? snapshot.exists ? t('react.saves.existing', {size:formatBytes(snapshot.size ?? 0)}) : t('react.saves.empty') : t('react.saves.notLoaded')}</p>
    </div>
    {controls}
    {notices}
    {importConfirmation}
  </section>;
}
