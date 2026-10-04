import {useLocale} from './LocaleProvider';
import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import {useEffect, useId, useState} from 'react';
import {gameIdForProduct, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {useResourceInspection, useResourceImport} from './ResourceManagerProvider';
import {ResourceImport} from './ResourceImport';

const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
const states = {absent: 'react.resources.absent', partial: 'react.resources.partial', installed: 'react.resources.installed', update: 'react.resources.update'} as const;
const typeNames: Readonly<Record<string, UiMessageKey>> = {ogg: 'react.resources.ogg', wav: 'react.resources.wav', language: 'react.resources.language', resource: 'react.resources.extra'};
function size(bytes: number | null, t: ReturnType<typeof useLocale>['t']) {
  if (bytes === null) return t('react.resources.sizeUnknown');
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Route view only: jobs and Package Store writes remain with the root owner. */
export function ResourceManager({productId}: {productId: ProductId}) {
  const {t} = useLocale();
  const {controller, snapshot, inspection, error} = useResourceInspection(productId);
  const localImport = useResourceImport();
  const [confirm, setConfirm] = useState<string | null>(null);
  const id = useId();
  const gameId = gameIdForProduct(productId);
  const operation = snapshot?.operation;
  const busy = !!operation || !!localImport.snapshot?.operation;
  useEffect(() => { setConfirm(null); }, [productId]);
  const pending = inspection?.components.find(component => component.id === confirm && component.canRemove);
  return <section aria-label={t('react.resources.title')} className="my-6 grid gap-5 text-sm">
    <p className="leading-relaxed text-muted">{t('react.resources.intro')}{isMultiplayerProductId(productId) ? t('react.resources.sharedMultiplayer') : t('react.resources.sharedSingleplayer')}{t('react.resources.dismissHint')}</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={!controller || busy} onClick={() => void controller?.inspect(productId).catch(() => {})}>{t('react.resources.recheck')}</button>
      {operation?.gameId === gameId && <button type="button" className={button} disabled={operation.cancelRequested} onClick={() => controller?.cancel()}>{operation.cancelRequested ? t('react.resources.cancelling') : t('react.resources.cancelTask')}</button>}
    </div>
    {!controller && <p role="status" className="text-muted">{t('react.resources.loading')}</p>}
    {operation?.gameId === gameId && <div role="status" className="rounded-xl border border-line p-3">
      <p>{operation.cancelRequested ? t('react.resources.waitingCancel') : operation.kind === 'inspect' ? t('react.resources.inspecting') : operation.kind === 'remove' ? t('react.resources.removing') : t('react.resources.downloading')}</p>
      {operation.progress && <><progress className="mt-2 w-full accent-accent" value={operation.progress.completed} max={Math.max(1, operation.progress.total)} aria-label={t('react.resources.progressAria')}/><p className="mt-1 text-xs text-muted">{t('react.resources.filesProcessed', {completed:operation.progress.completed, total:operation.progress.total})}</p></>}
    </div>}
    {operation && operation.gameId !== gameId && <p role="status" className="text-muted">{t('react.resources.otherTask')}</p>}
    {error && <p role="alert" className="rounded-xl border border-accent/30 p-3 text-accent">{error.message}</p>}
    {inspection && <>
      <div className="rounded-2xl border border-line p-4">
        <h2 className="font-bold">{t('react.resources.local')}</h2>
        <p className="mt-2 text-muted">{inspection.generationId ? t('react.resources.baseSummary', {installed:inspection.installedBaseFileCount, total:inspection.baseFileCount, source:inspection.source === 'local' ? t('react.resources.localImport') : t('react.resources.siteInstall')}) : t('react.resources.notInstalled')}</p>
        {inspection.installedRevision && <p className="mt-1 break-all text-xs text-muted">{t('react.resources.localRevision', {revision:inspection.installedRevision})}</p>}
        {inspection.publishedRevision && <p className="mt-1 break-all text-xs text-muted">{t('react.resources.publishedRevision', {revision:inspection.publishedRevision})}</p>}
        <button type="button" className={`${button} mt-3`} disabled={!controller || busy || !inspection.publishedRevision} onClick={() => void controller?.installBase(productId).catch(() => {})}>{inspection.generationId ? t('react.resources.repairBase') : t('react.resources.installBase')}</button>
        {inspection.updateAvailable && <p className="mt-2 text-accent">{t('react.resources.updateHint')}</p>}
      </div>
      {inspection.warning && <p role="status" className="rounded-xl border border-line p-3 text-muted">{inspection.warning}</p>}
      {inspection.components.length ? <ul className="grid gap-3">{inspection.components.map(component => <li key={component.id} className="rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{typeNames[component.id] ? t(typeNames[component.id]) : component.title}</h3><p className="mt-1 text-xs text-muted">{t('react.resources.componentSummary', {type:typeNames[component.type] ? t(typeNames[component.type]) : component.type, count:component.fileCount, size:size(component.bytes, t)})}</p></div><span className="rounded-full border border-line px-2 py-1 text-xs">{t(states[component.status])}</span></div>
        <p className="mt-2 text-xs text-muted">{t('react.resources.localFiles', {count:component.installedFileCount})}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!controller || busy || !component.canInstall} title={component.installReason ?? undefined} onClick={() => {setConfirm(null); void controller?.install(productId, component.id).catch(() => {});}}>{component.status === 'update' ? t('react.resources.updateComponent') : component.status === 'partial' ? t('react.resources.repairComponent') : t('react.resources.installComponent')}</button>
          <button type="button" className={button} disabled={!controller || busy || !component.canRemove} title={component.removeReason ?? undefined} onClick={() => setConfirm(component.id)}>{t('react.resources.removeComponent')}</button>
        </div>
        {component.removeReason && component.installedFileCount > 0 && <p className="mt-2 text-xs text-muted">{component.removeReason}</p>}
      </li>)}</ul> : <p className="rounded-2xl border border-line p-4 text-muted">{t('react.resources.noComponents')}</p>}
      {pending && <div role="group" aria-labelledby={`${id}-remove`} className="rounded-2xl border border-accent/50 p-4">
        <h3 id={`${id}-remove`} className="font-bold">{t('react.resources.confirmRemoveName', {name:typeNames[pending.id] ? t(typeNames[pending.id]) : pending.title})}</h3>
        <p className="my-3 leading-relaxed text-muted">{t('react.resources.removeHint')}</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => {setConfirm(null); void controller?.remove(productId, pending.id).catch(() => {});}}>{t('react.resources.confirmRemove')}</button><button type="button" className={button} onClick={() => setConfirm(null)}>{t('react.resources.keepComponent')}</button></div>
      </div>}
    </>}
    <ResourceImport productId={productId} controller={localImport.controller} externalBusy={!!operation}/>
    <p className="text-xs leading-relaxed text-muted">{t('react.resources.checkHint')}</p>
  </section>;
}
