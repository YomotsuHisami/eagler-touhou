import {useLocale} from './LocaleProvider';
import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Link, useLocation} from 'react-router';
import {productManagementSearch} from '../runtime/route-session.mts';
import {isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import type {SaveController, SaveDownload, SaveImportConfirmation, SaveSnapshot} from '../services/saves.client';
import {AnimatedDialog} from './AnimatedDialog';
import {useSaveController} from './SaveProvider';
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
export function SaveManager({productId}: {productId: ProductId}) {
  const {t} = useLocale();
  const controller = useSaveController();
  const getSnapshot = useCallback(() => controller?.getSnapshot(productId) ?? null, [controller, productId]);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, getSnapshot, empty);
  useEffect(() => {controller?.loadProduct(productId);}, [controller, productId]);
  useEffect(() => {
    if (controller && snapshot?.available && !snapshot.loaded && !snapshot.busy && !snapshot.fileOperationBusy) void controller.refresh(productId).catch(() => {});
  }, [controller, productId, snapshot?.available, snapshot?.epoch]);
  if (!controller || !snapshot) return <p role="status" className="py-6 text-muted">{t('react.saves.loading')}</p>;
  return <SaveManagerView key={productId} productId={productId} controller={controller} snapshot={snapshot}/>;
}
/** Route view only: file policy and accepted work survive route dismissal. */
export function SaveManagerView({productId, controller, snapshot}: {productId: ProductId; controller: SaveController; snapshot: SaveSnapshot}) {
  const {t} = useLocale();
  const location = useLocation();
  const [confirmation, setConfirmation] = useState<SaveImportConfirmation | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const mounted = useRef(true), ticket = useRef(confirmation);
  ticket.current = confirmation;
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; if (ticket.current) controller.cancelImport(ticket.current);};}, [controller]);
  useEffect(() => {
    if (confirmation && (confirmation.epoch !== snapshot.epoch || !snapshot.available)) {
      controller.cancelImport(confirmation); setConfirmation(null);
    }
  }, [controller, confirmation, snapshot.epoch, snapshot.available]);
  const disabled = !!snapshot.busy || snapshot.fileOperationBusy || !snapshot.available;
  async function perform(operation: () => Promise<unknown>) {
    setViewError(null); setDownloadNotice(null);
    try {await operation();} catch (error) {if (mounted.current) setViewError(error instanceof Error ? error.message : String(error));}
  }
  async function exportDownload() {
    const result = await controller.exportFile(productId);
    // Downloads belong to this view; navigating away does not trigger a late one.
    if (!mounted.current) return;
    download(result); setDownloadNotice(result.name);
  }
  function closeConfirmation() {
    if (confirmation) controller.cancelImport(confirmation);
    setConfirmation(null);
  }
  return <section aria-label={t('react.saves.title')} className="my-5 grid gap-5">
    <div className="rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">
      <p>{t('react.saves.storageHint', {file:snapshot.scoreFile})}</p>
      <p className="mt-2">{t('react.saves.fileHint')}</p>
    </div>
    {!snapshot.available && <div className="grid gap-2 rounded-xl border border-line p-4 text-sm">
      <p role="status">{snapshot.unavailableReason}</p>
      <Link to={{pathname:`/play/${productId}${isMultiplayerProductId(productId) ? '/replays' : ''}`,search:productManagementSearch(location.search)}} className="min-h-11 w-fit py-2 text-accent underline underline-offset-4">{t('react.files.prepareResources')}</Link>
    </div>}
    <div className="rounded-2xl border border-line p-4">
      <p className="break-all text-sm">{snapshot.game.toUpperCase()} · {snapshot.scoreFile}</p>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-muted">{snapshot.busy === 'import' ? t('react.saves.importing')
        : snapshot.busy === 'export' ? t('react.saves.exporting') : snapshot.busy === 'read' ? t('react.saves.reading')
          : snapshot.loaded ? snapshot.exists ? t('react.saves.existing', {size:formatBytes(snapshot.size ?? 0)}) : t('react.saves.empty') : t('react.saves.notLoaded')}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled} onClick={() => void perform(() => controller.refresh(productId))}>{t('react.saves.refresh')}</button>
      <button type="button" className={button} disabled={disabled || snapshot.loaded && !snapshot.exists} onClick={() => void perform(exportDownload)}>{t('react.saves.export')}</button>
      <label className={`${button} relative inline-flex items-center ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
        {t('react.saves.import')}
        <input aria-label={t('react.saves.selectFile')} type="file" accept=".dat" disabled={disabled} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100" onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
          if (!file) return;
          closeConfirmation(); setViewError(null); setDownloadNotice(null);
          try {setConfirmation(controller.requestImport(productId, file));} catch (error) {setViewError(error instanceof Error ? error.message : String(error));}
        }}/>
      </label>
    </div>
    {(viewError || snapshot.error) && <p role="alert" className="break-words text-sm text-accent">{viewError || snapshot.error}</p>}
    {(downloadNotice || snapshot.notice) && <p role="status" className="break-words text-sm">{downloadNotice ? t('react.files.downloadRequested', {name:downloadNotice}) : snapshot.notice}</p>}
    <AnimatedDialog open={confirmation !== null} onOpenChange={open => {if (!open) closeConfirmation();}} title={t('react.saves.importTitle')} description={t('react.saves.importHint')}>
      <dl className="my-5 grid gap-2 text-sm">
        <div><dt className="text-muted">{t('react.saves.selectedFile')}</dt><dd className="break-all">{confirmation?.name} {confirmation ? `(${formatBytes(confirmation.size)})` : ''}</dd></div>
        <div><dt className="text-muted">{t('react.saves.replaceTarget')}</dt><dd className="break-all">{confirmation?.game.toUpperCase()} · {confirmation?.scoreFile}</dd></div>
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={button} onClick={closeConfirmation}>{t('lobby.cancel')}</button>
        <button type="button" className={`${button} border-accent text-accent`} disabled={disabled || confirmation?.epoch !== snapshot.epoch} onClick={() => {
          const accepted = confirmation; setConfirmation(null);
          if (accepted) void perform(() => controller.confirmImport(accepted));
        }}>{t('react.saves.confirmImport')}</button>
      </div>
    </AnimatedDialog>
  </section>;
}
