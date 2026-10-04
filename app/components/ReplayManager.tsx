import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Link} from 'react-router';
import type {ProductId} from '../../src/contracts/product-catalog.mts';
import type {ReplayController, ReplayDeleteConfirmation, ReplayDownload, ReplaySnapshot} from '../services/replays.client';
import {AnimatedDialog} from './AnimatedDialog';
import {useReplayController} from './ReplayProvider';
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
export function ReplayManager({productId}: {productId: ProductId}) {
  const controller = useReplayController();
  const getSnapshot = useCallback(() => controller?.getSnapshot(productId) ?? null, [controller, productId]);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, getSnapshot, empty);
  useEffect(() => {controller?.loadProduct(productId);}, [controller, productId]);
  useEffect(() => {
    if (controller && snapshot?.available && !snapshot.loaded) void controller.refresh(productId).catch(() => {});
  }, [controller, productId, snapshot?.available, snapshot?.epoch]);
  if (!controller || !snapshot) return <p role="status" className="py-6 text-muted">正在载入录像管理…</p>;
  return <ReplayManagerView key={productId} productId={productId} controller={controller} snapshot={snapshot}/>;
}
/** The view owns downloads and confirmation presentation; service owns file policy. */
export function ReplayManagerView({productId, controller, snapshot}: {productId: ProductId; controller: ReplayController; snapshot: ReplaySnapshot}) {
  const [confirmation, setConfirmation] = useState<ReplayDeleteConfirmation | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const mounted = useRef(true), ticket = useRef(confirmation);
  ticket.current = confirmation;
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; if (ticket.current) controller.cancelDelete(ticket.current);};}, [controller]);
  const busy = !!snapshot.busy, disabled = busy || !snapshot.available;
  async function perform(operation: () => Promise<unknown>) {
    setViewError(null); setDownloadNotice(null);
    try {await operation();} catch (error) {if (mounted.current) setViewError(error instanceof Error ? error.message : String(error));}
  }
  async function exportDownload(operation: () => Promise<ReplayDownload>) {
    const result = await operation();
    // A dismissed view must not unexpectedly open a download after navigation.
    if (!mounted.current) return;
    download(result); setDownloadNotice(`已请求浏览器下载 ${result.name}；请在下载列表中确认。`);
  }
  function closeConfirmation() {
    if (confirmation) controller.cancelDelete(confirmation);
    setConfirmation(null);
  }
  return <section aria-label="本机录像管理" className="my-5 grid gap-5">
    <div className="rounded-2xl border border-line bg-panel p-4 text-sm leading-relaxed text-muted">
      <p>录像保留在当前浏览器，由该作品的 Runtime 读写。导入时重名会分配新名称；ZIP 只处理 .rpy 和 .rpyx 文件。</p>
      <p className="mt-2">录像播放尚未接入此界面，不能直接播放或验证录像与当前版本是否兼容。</p>
    </div>
    {!snapshot.available && <div className="grid gap-2 rounded-xl border border-line p-4 text-sm">
      <p role="status">{snapshot.unavailableReason}</p>
      <Link to={`/play/${productId}`} className="min-h-11 w-fit py-2 text-accent underline underline-offset-4">返回作品页准备资源</Link>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={disabled} onClick={() => void perform(() => controller.refresh(productId))}>刷新列表</button>
      <label className={`${button} relative inline-flex items-center ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
        导入录像
        <input aria-label="选择要导入的录像文件" type="file" accept=".zip,.rpy,.rpyx" disabled={disabled} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100" onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
          if (file) void perform(() => controller.importFile(productId, file));
        }}/>
      </label>
      <button type="button" className={button} disabled={disabled || !snapshot.loaded || !snapshot.files.length} onClick={() => void perform(() => exportDownload(() => controller.exportAll(productId)))}>导出全部 ZIP</button>
    </div>
    <p role="status" aria-live="polite" className="text-sm text-muted">{busy ? `${snapshot.busy === 'list' ? '正在读取' : snapshot.busy === 'import' ? '正在导入' : snapshot.busy === 'export' ? '正在导出' : '正在删除'}录像…` : snapshot.loaded ? `${snapshot.files.length} 个录像` : '尚未读取录像列表'}</p>
    {(viewError || snapshot.error) && <p role="alert" className="break-words text-sm text-accent">{viewError || snapshot.error}</p>}
    {(downloadNotice || snapshot.notice) && <p role="status" className="break-words text-sm">{downloadNotice || snapshot.notice}</p>}
    {snapshot.loaded && !snapshot.files.length && <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">此作品还没有录像。可导入已有文件，或在游戏中保存录像后重新读取。</p>}
    {snapshot.loaded && snapshot.files.length > 0 && <ul aria-label="录像文件" className="divide-y divide-line rounded-2xl border border-line px-4">
      {snapshot.files.map(file => <li key={file.path} className="flex flex-wrap items-center gap-3 py-4">
        <div className="min-w-0 flex-1 basis-40"><p className="break-all text-sm" title={file.name}>{file.name}</p><p className="mt-1 text-xs text-muted">{formatBytes(file.size)}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={disabled} aria-label={`下载 ${file.name}`} onClick={() => void perform(() => exportDownload(() => controller.exportFile(productId, file.path)))}>下载</button>
          <button type="button" className={`${button} text-accent`} disabled={disabled} aria-label={`删除 ${file.name}`} onClick={() => {
            setViewError(null);
            try {setConfirmation(controller.requestDelete(productId, file.path));} catch (error) {setViewError(error instanceof Error ? error.message : String(error));}
          }}>删除</button>
        </div>
      </li>)}
    </ul>}
    <AnimatedDialog open={confirmation !== null} onOpenChange={open => {if (!open) closeConfirmation();}} title="删除此录像？" description="此操作会删除当前浏览器中这一个录像文件，无法在此界面撤销。建议先下载备份。">
      <p className="my-5 break-all text-sm">{confirmation?.name}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={button} onClick={closeConfirmation}>取消</button>
        <button type="button" className={`${button} border-accent text-accent`} disabled={disabled || confirmation?.epoch !== snapshot.epoch} onClick={() => {
          const accepted = confirmation; setConfirmation(null);
          if (accepted) void perform(() => controller.confirmDelete(accepted));
        }}>确认删除</button>
      </div>
    </AnimatedDialog>
  </section>;
}
