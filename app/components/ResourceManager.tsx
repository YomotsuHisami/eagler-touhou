import {useEffect, useId, useState} from 'react';
import {gameIdForProduct, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {useResourceInspection} from './ResourceManagerProvider';

const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
const states = {absent: '未安装', partial: '部分已安装', installed: '已安装', update: '有资源更新'};
const typeNames: Record<string, string> = {ogg: 'OGG 音乐', wav: 'WAV 音乐', language: '语言包', resource: '附加资源'};
function size(bytes: number | null) {
  if (bytes === null) return '大小未声明';
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Route view only: jobs and Package Store writes remain with the root owner. */
export function ResourceManager({productId}: {productId: ProductId}) {
  const {controller, snapshot, inspection, error} = useResourceInspection(productId);
  const [confirm, setConfirm] = useState<string | null>(null);
  const id = useId();
  const gameId = gameIdForProduct(productId);
  const operation = snapshot?.operation;
  const busy = !!operation;
  useEffect(() => { setConfirm(null); }, [productId]);
  const pending = inspection?.components.find(component => component.id === confirm && component.canRemove);
  return <section aria-label="资源管理" className="my-6 grid gap-5 text-sm">
    <p className="leading-relaxed text-muted">查看此浏览器的资源，并安装站点已发布的可选组件。{isMultiplayerProductId(productId) ? '此联机入口与单机共用同一份资源。' : '单机与对应联机入口共用资源。'}关闭页面内的资源窗口不会取消正在进行的任务。</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={!controller || busy} onClick={() => void controller?.inspect(productId).catch(() => {})}>重新检查资源</button>
      {operation?.gameId === gameId && <button type="button" className={button} disabled={operation.cancelRequested} onClick={() => controller?.cancel()}>{operation.cancelRequested ? '正在取消…' : '取消当前任务'}</button>}
    </div>
    {!controller && <p role="status" className="text-muted">正在载入资源服务…</p>}
    {operation?.gameId === gameId && <div role="status" className="rounded-xl border border-line p-3">
      <p>{operation.cancelRequested ? '正在等待当前操作停止；已提交的资源不会回滚。' : operation.kind === 'inspect' ? '正在检查本机存储与发布目录…' : operation.kind === 'install' ? '正在下载并校验资源…' : '正在移除可选资源引用…'}</p>
      {operation.progress && <><progress className="mt-2 w-full accent-accent" value={operation.progress.completed} max={Math.max(1, operation.progress.total)} aria-label="资源文件处理进度"/><p className="mt-1 text-xs text-muted">已处理 {operation.progress.completed} / {operation.progress.total} 项文件</p></>}
    </div>}
    {operation && operation.gameId !== gameId && <p role="status" className="text-muted">另一个作品的资源任务正在进行，完成或取消后即可操作。</p>}
    {error && <p role="alert" className="rounded-xl border border-accent/30 p-3 text-accent">{error.message}</p>}
    {inspection && <>
      <div className="rounded-2xl border border-line p-4">
        <h2 className="font-bold">本机资源</h2>
        <p className="mt-2 text-muted">{inspection.generationId ? `基础资源 ${inspection.installedBaseFileCount} / ${inspection.baseFileCount} 项 · ${inspection.source === 'local' ? '本地导入' : '站点安装'}` : '此浏览器尚未安装此作品的资源'}</p>
        {inspection.installedRevision && <p className="mt-1 break-all text-xs text-muted">本机版本：{inspection.installedRevision}</p>}
        {inspection.publishedRevision && <p className="mt-1 break-all text-xs text-muted">发布版本：{inspection.publishedRevision}</p>}
        {inspection.updateAvailable && <p className="mt-2 text-accent">安装组件时会同步更新基础资源，并保留新版本仍支持的已安装组件。</p>}
      </div>
      {inspection.warning && <p role="status" className="rounded-xl border border-line p-3 text-muted">{inspection.warning}</p>}
      {inspection.components.length ? <ul className="grid gap-3">{inspection.components.map(component => <li key={component.id} className="rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{typeNames[component.id] ?? component.title}</h3><p className="mt-1 text-xs text-muted">{typeNames[component.type] ?? component.type} · {component.fileCount} 项 · {size(component.bytes)}</p></div><span className="rounded-full border border-line px-2 py-1 text-xs">{states[component.status]}</span></div>
        <p className="mt-2 text-xs text-muted">本机可用文件：{component.installedFileCount} 项</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!controller || busy || !component.canInstall} title={component.installReason ?? undefined} onClick={() => {setConfirm(null); void controller?.install(productId, component.id).catch(() => {});}}>{component.status === 'update' ? '更新此组件' : component.status === 'partial' ? '补全此组件' : '安装此组件'}</button>
          <button type="button" className={button} disabled={!controller || busy || !component.canRemove} title={component.removeReason ?? undefined} onClick={() => setConfirm(component.id)}>移除组件</button>
        </div>
        {component.removeReason && component.installedFileCount > 0 && <p className="mt-2 text-xs text-muted">{component.removeReason}</p>}
      </li>)}</ul> : <p className="rounded-2xl border border-line p-4 text-muted">没有可管理的可选组件。此页面不会生成缺失的发布资源。</p>}
      {pending && <div role="group" aria-labelledby={`${id}-remove`} className="rounded-2xl border border-accent/50 p-4">
        <h3 id={`${id}-remove`} className="font-bold">确认移除 {typeNames[pending.id] ?? pending.title}？</h3>
        <p className="my-3 leading-relaxed text-muted">只移除此组件独占的可选文件。基础资源、其他组件和存档会保留；对应的单机与联机入口会同时受此更改影响。运行中已使用的资源由现有会话保留。</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => {setConfirm(null); void controller?.remove(productId, pending.id).catch(() => {});}}>确认移除</button><button type="button" className={button} onClick={() => setConfirm(null)}>保留组件</button></div>
      </div>}
    </>}
    <p className="text-xs leading-relaxed text-muted">检查仅核对文件是否存在，不代表游戏或文件完整性验收。安装由现有 Package 安装器校验；取消不会撤销已经提交的资源。ZIP / 原版数据导入及基础资源删除尚未接入此页面。</p>
  </section>;
}
