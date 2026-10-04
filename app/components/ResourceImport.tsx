import {useId, useSyncExternalStore} from 'react';
import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import {rawDataImportFileNames} from '../../src/launcher/raw-data-import.mts';
import type {ResourceImportController} from '../services/resource-import.client';
const empty = () => null;
const none = () => () => {};
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';

/** The root owns controller lifetime. Choosing a file only prepares a review. */
export function ResourceImport({productId, controller, externalBusy = false}: {productId: ProductId; controller: ResourceImportController | null; externalBusy?: boolean}) {
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  const id = useId(), gameId = gameIdForProduct(productId);
  const rawNames = rawDataImportFileNames(gameId);
  const operation = snapshot?.operation;
  const review = snapshot?.review?.gameId === gameId ? snapshot.review : null;
  const busy = !!operation || externalBusy;
  const formats = ['Package ZIP', ...rawNames].join(' / ');
  return <section aria-label="导入与移除资源" className="grid gap-4 rounded-2xl border border-line p-4 text-sm">
    <h2 className="font-bold">导入与移除资源</h2>
    <p className="leading-relaxed text-muted">从本机选择 {formats}，先检查再确认导入。文件仅用于此浏览器的资源存储，不会上传。</p>
    <label htmlFor={`${id}-file`} className="grid gap-2"><span>选择资源文件（不超过 256 MiB）</span>
      <input id={`${id}-file`} type="file" accept={['.zip', ...new Set(rawNames.map(name => `.${name.split('.').at(-1)}`))].join(',')}
        disabled={!controller || busy} className="min-h-11 max-w-full rounded-xl border border-line p-2 file:mr-3 file:rounded-lg file:border-0 file:bg-nav-hover file:px-3 file:py-2 file:text-nav-ink disabled:opacity-50"
        onChange={event => {const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void controller?.inspectImport(productId, file, file.name).catch(() => {});}}/>
    </label>
    <div><button type="button" className={button} disabled={!controller || busy} onClick={() => void controller?.inspectRemoval(productId).catch(() => {})}>查看全部资源移除范围</button></div>
    {operation && <div role="status" className="rounded-xl border border-line p-3">
      <p>{PRODUCT_GAMES[gameIdForProduct(operation.productId)].title} · {operation.cancelRequested ? '正在等待当前操作停止…' : operation.kind === 'inspect' ? '正在读取并校验资源…' : '正在提交已确认的资源更改…'}</p>
      {operation.progress && <p className="mt-1 text-xs text-muted">已处理 {operation.progress.completed} / {operation.progress.total} 项</p>}
      <button type="button" className={`${button} mt-3`} disabled={operation.cancelRequested} onClick={() => controller?.cancel()}>取消当前任务</button>
    </div>}
    {snapshot?.error && snapshot.errorGameId === gameId && <p role="alert" className="text-accent">{snapshot.error}</p>}
    {review && <div role="group" aria-labelledby={`${id}-review`} className="grid gap-3 rounded-xl border border-accent/40 p-4">
      <h3 id={`${id}-review`} className="font-bold">{review.kind === 'import' ? '确认导入资源' : '确认移除全部已安装资源'}</h3>
      {review.fileName && <p className="break-all">{review.fileName}</p>}
      <p className="break-all text-xs text-muted">版本：{review.revision} · {review.files} 项文件 · {(review.bytes / (1024 * 1024)).toFixed(1)} MiB</p>
      {review.kind === 'import' && <>
        <p className="text-muted">SHA-256 已验证 {review.sha256VerifiedFiles} / {review.files} 项。{review.previousGenerationId ? '导入将替换此作品当前安装，包括 ZIP 中未包含的旧可选组件。' : '确认后会在本机创建此作品的安装。'}存档不会更改。</p>
        <p className="text-xs text-muted">此检查不代表 Runtime 或实际游戏运行验收。</p>
      </>}
      {review.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-muted">{review.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void controller?.confirm(review.id).catch(() => {})}>{review.kind === 'import' ? review.previousGenerationId ? '确认导入并替换' : '确认导入' : '确认移除全部资源'}</button><button type="button" className={button} disabled={busy} onClick={() => controller?.cancel()}>保留现状</button></div>
    </div>}
    {snapshot?.outcome?.gameId === gameId && <p role="status" className="text-muted">{snapshot.outcome.kind === 'import' ? '资源已导入本机。' : '已解除此作品的资源安装；存档与正在运行会话的资源仍保留。'}</p>}
    <p className="text-xs text-muted">取消无法撤销已经提交的更改；已取消的检查不会开始导入。资源移除不会立即清空仍在使用的数据。</p>
  </section>;
}
