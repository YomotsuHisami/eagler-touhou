import { useCallback, useEffect, useRef, useState } from 'react';
import { PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, type ProductId } from '../../src/contracts/product-catalog.mts';
import { replayImportAccept } from '../../src/launcher/replay-files.mts';
import { useBrowserServices } from '../services/browser-services';
import { createReplayFileService, type ReplayConfirmation, type ReplayDownload, type ReplayFile, type ReplayFileService } from '../services/replay-files.client';
import { Button, Dialog } from '../ui';
import { useUiText } from '../services/ui-preferences';

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);
function saveDownload(value: ReplayDownload) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes)], { type: value.type }));
  const link = document.createElement('a');
  link.href = url; link.download = value.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function confirmationText(request: ReplayConfirmation, t: ReturnType<typeof useUiText>) {
  if (request.kind === 'delete') return { title: t('action.delete'), description: t('replay.deleteConfirm', { name: request.path.split('/').pop() }), action: t('action.delete') };
  if (request.kind === 'replace') return { title: t('ui.replay.replaceTitle'), description: t('ui.replay.replaceHint', { name: request.path.split('/').pop() }), action: t('ui.replay.replace') };
  const product = PRODUCT_GAMES[gameIdForProduct(request.productId)];
  return { title: t('ui.replay.closeTitle'), description: t('ui.replay.closeHint', { game: `${product.title} (${request.productId})` }), action: t('ui.replay.close') };
}

/** Runtime-backed files; no parallel IndexedDB tree or second Runtime iframe. */
export function ReplayFiles({ productId }: { productId: ProductId }) {
  const services = useBrowserServices();
  const t = useUiText();
  const [files, setFiles] = useState<ReplayFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [decision, setDecision] = useState<ReplayConfirmation | null>(null);
  const [rename, setRename] = useState<{ path: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const decisionResolver = useRef<((value: boolean) => void) | null>(null);
  const active = useRef<object | null>(null);
  const running = useRef(false);
  const dragDepth = useRef(0);
  const confirm = useCallback((request: ReplayConfirmation): Promise<boolean> => {
    if (!active.current || decisionResolver.current) return Promise.resolve(false);
    setDecision(request);
    return new Promise(resolve => { decisionResolver.current = resolve; });
  }, []);
  useEffect(() => {
    const picker = input.current;
    const cancelled = () => { if (picker) picker.value = ''; };
    picker?.addEventListener('cancel', cancelled);
    return () => picker?.removeEventListener('cancel', cancelled);
  }, []);
  const [service, setService] = useState<ReplayFileService | null>(null);
  const answer = (approved: boolean) => {
    const resolve = decisionResolver.current; decisionResolver.current = null;
    setDecision(null); resolve?.(approved);
  };
  useEffect(() => {
    // Create inside the effect so React StrictMode's setup/cleanup replay gets
    // a fresh controller rather than reusing an already-disposed instance.
    const controller = services ? createReplayFileService({
      runtime: services.runtime, productId, confirm,
      getLaunchRequest: () => {
        const preferences = services.preferences.read(productId);
        return { language: preferences.language, music: preferences.musicPreference, options: preferences.options };
      },
    }) : null;
    setService(controller);
    const view = {}; active.current = view; running.current = false;
    setFiles([]); setLoaded(false); setError(''); setNotice(''); setRename(null); setDecision(null);
    setDragging(false); dragDepth.current = 0;
    if (controller) {
      running.current = true; setBusy(true);
      void controller.list().then(rows => {
        if (active.current === view) { setFiles(rows); setLoaded(true); }
      }).catch(reason => { if (active.current === view) setError(errorText(reason)); })
        .finally(() => { if (active.current === view) { running.current = false; setBusy(false); } });
    } else setBusy(false);
    return () => {
      if (active.current === view) active.current = null;
      const resolve = decisionResolver.current; decisionResolver.current = null; resolve?.(false);
      // In-flight mutations finish durably; only their own temporary epoch may close.
      void controller?.dispose().catch(reason => console.error('Replay Runtime close failed', reason));
    };
  }, [services, productId, confirm]);

  async function perform<T>(operation: () => Promise<T>, complete?: (value: T) => void, reload = false) {
    if (!service || running.current || !active.current) return;
    const view = active.current;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await operation();
      if (active.current !== view) return;
      complete?.(result);
      if (reload) {
        const rows = await service.list();
        if (active.current === view) { setFiles(rows); setLoaded(true); }
      }
    } catch (reason) {
      if (active.current === view) setError(errorText(reason));
    } finally {
      if (active.current === view) { running.current = false; setBusy(false); }
    }
  }
  function importFile(file?: File) {
    if (!file || !service) return;
    void perform(() => service.importFile(file), count => setNotice(t('ui.replay.imported', { count })), true);
  }
  const confirmation = decision ? confirmationText(decision, t) : null;
  const disabled = busy || !service;
  return <section aria-label={t('replay.manager')} aria-busy={busy} onDragEnter={event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); dragDepth.current++; setDragging(true);
  }} onDragOver={event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }} onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={event => {
    event.preventDefault(); dragDepth.current = 0; setDragging(false);
    if (disabled) return;
    const incoming = Array.from(event.dataTransfer.files);
    if (incoming.length !== 1) { setError(t('replay.dropSingle')); return; }
    importFile(incoming[0]);
  }}>
    <h3>{t('replay.manager')}</h3>
    <p>{t(isMultiplayerProductId(productId) ? 'ui.replay.multiplayerHint' : 'ui.replay.soloHint')}</p>
    <input ref={input} type="file" hidden accept={replayImportAccept} aria-label={t('file.chooseReplay')} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; importFile(file);
    }} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button disabled={disabled} onClick={() => input.current?.click()}>{t('replay.import')}</Button>
      <Button disabled={disabled} onClick={() => service && void perform(() => service.list(), rows => { setFiles(rows); setLoaded(true); })}>{t('ui.replay.refresh')}</Button>
      <Button disabled={disabled || !files.length} onClick={() => service && void perform(() => service.exportArchive(), saveDownload)}>{t('ui.replay.exportAll')}</Button>
      <Button disabled={disabled} onClick={() => service && void perform(() => service.play(), () => setNotice(t('ui.replay.opened')))}>{t('ui.replay.play')}</Button>
    </div>
    {dragging && <p role="status">{t('replay.dropHint')}</p>}
    {busy && <p role="status">{t('ui.replay.working')}</p>}
    {loaded && <p>{t('replay.fileCount', { count: files.length })}</p>}
    {loaded && !files.length && <p>{t('replay.empty')} · {t('file.chooseReplay')}</p>}
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {files.map(file => <li key={file.path} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 0', borderBottom: '1px solid var(--color-line)' }}>
        <span style={{ flex: '1 1 180px', overflowWrap: 'anywhere' }}><strong>{file.path.split('/').pop()}</strong><br /><small>{formatBytes(file.size)}</small></span>
        <Button size="sm" disabled={disabled} aria-label={`${t('action.download')} ${file.path.split('/').pop()}`} onClick={() => service && void perform(() => service.exportOne(file.path), saveDownload)}>{t('action.download')}</Button>
        <Button size="sm" disabled={disabled} aria-label={`${t('action.rename')} ${file.path.split('/').pop()}`} onClick={() => setRename({ path: file.path, name: file.path.split('/').pop() || '' })}>{t('action.rename')}</Button>
        <Button size="sm" variant="danger" disabled={disabled} aria-label={`${t('action.delete')} ${file.path.split('/').pop()}`} onClick={() => service && void perform(() => service.remove(file.path), undefined, true)}>{t('action.delete')}</Button>
      </li>)}
    </ul>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <Dialog open={!!rename} onOpenChange={open => { if (!open) setRename(null); }} title={t('action.rename')} description={t('ui.replay.renameHint')} closeLabel={t('action.close')}>
      {rename && <form onSubmit={event => {
        event.preventDefault(); const change = rename; setRename(null);
        if (service) void perform(() => service.rename(change.path, change.name), undefined, true);
      }}>
        <label>{t('ui.replay.filename')}<input autoFocus value={rename.name} onChange={event => setRename({ ...rename, name: event.target.value })} style={{ display: 'block', width: '100%', margin: '8px 0 16px' }} /></label>
        <Button type="submit" variant="primary" disabled={disabled || !rename.name.trim()}>{t('action.save')}</Button>
      </form>}
    </Dialog>
    <Dialog open={!!decision} onOpenChange={open => { if (!open) answer(false); }} title={confirmation?.title || t('action.confirm')} description={confirmation?.description} closeLabel={t('action.close')}
      footer={<><Button onClick={() => answer(false)}>{t('action.cancel')}</Button><Button variant={decision?.kind === 'close-runtime' ? 'primary' : 'danger'} onClick={() => answer(true)}>{confirmation?.action || t('action.confirm')}</Button></>}>
      <p>{t('ui.replay.confirmHint')}</p>
    </Dialog>
  </section>;
}
