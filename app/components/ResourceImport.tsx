import {useLocale} from './LocaleProvider';
import {useId, useSyncExternalStore} from 'react';
import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import {rawDataImportFileNames} from '../../src/launcher/raw-data-import.mts';
import type {ResourceImportController} from '../services/resource-import.client';
const empty = () => null;
const none = () => () => {};
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';

/** The root owns controller lifetime. Choosing a file only prepares a review. */
export function ResourceImport({productId, controller, externalBusy = false}: {productId: ProductId; controller: ResourceImportController | null; externalBusy?: boolean}) {
  const {t} = useLocale();
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, controller?.getSnapshot ?? empty, empty);
  const id = useId(), gameId = gameIdForProduct(productId);
  const rawNames = rawDataImportFileNames(gameId);
  const operation = snapshot?.operation;
  const review = snapshot?.review?.gameId === gameId ? snapshot.review : null;
  const busy = !!operation || externalBusy;
  const formats = ['Package ZIP', ...rawNames].join(' / ');
  return <section aria-label={t('react.import.title')} className="grid gap-4 rounded-2xl border border-line p-4 text-sm">
    <h2 className="font-bold">{t('react.import.title')}</h2>
    <p className="leading-relaxed text-muted">{t('react.import.chooseHint', {formats})}</p>
    <label htmlFor={`${id}-file`} className="grid gap-2"><span>{t('react.import.selectFile')}</span>
      <input id={`${id}-file`} type="file" accept={['.zip', ...new Set(rawNames.map(name => `.${name.split('.').at(-1)}`))].join(',')}
        disabled={!controller || busy} className="min-h-11 max-w-full rounded-xl border border-line p-2 file:mr-3 file:rounded-lg file:border-0 file:bg-nav-hover file:px-3 file:py-2 file:text-nav-ink disabled:opacity-50"
        onChange={event => {const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void controller?.inspectImport(productId, file, file.name).catch(() => {});}}/>
    </label>
    <div><button type="button" className={button} disabled={!controller || busy} onClick={() => void controller?.inspectRemoval(productId).catch(() => {})}>{t('react.import.inspectRemoval')}</button></div>
    {operation && <div role="status" className="rounded-xl border border-line p-3">
      <p><span lang="ja">{PRODUCT_GAMES[gameIdForProduct(operation.productId)].title}</span> · {operation.cancelRequested ? t('react.import.waitingCancel') : operation.kind === 'inspect' ? t('react.import.inspecting') : t('react.import.committing')}</p>
      {operation.progress && <p className="mt-1 text-xs text-muted">{t('react.import.processed', {completed:operation.progress.completed,total:operation.progress.total})}</p>}
      <button type="button" className={`${button} mt-3`} disabled={operation.cancelRequested} onClick={() => controller?.cancel()}>{t('react.resources.cancelTask')}</button>
    </div>}
    {snapshot?.error && snapshot.errorGameId === gameId && <p role="alert" className="text-accent">{snapshot.error}</p>}
    {review && <div role="group" aria-labelledby={`${id}-review`} className="grid gap-3 rounded-xl border border-accent/40 p-4">
      <h3 id={`${id}-review`} className="font-bold">{review.kind === 'import' ? t('react.import.confirmTitle') : t('react.import.removeTitle')}</h3>
      {review.fileName && <p className="break-all">{review.fileName}</p>}
      <p className="break-all text-xs text-muted">{t('react.import.summary', {revision:review.revision,files:review.files,size:(review.bytes / (1024 * 1024)).toFixed(1)})}</p>
      {review.kind === 'import' && <>
        <p className="text-muted">{t('react.import.verified', {verified:review.sha256VerifiedFiles,files:review.files})}{review.previousGenerationId ? t('react.import.replaceHint') : t('react.import.installHint')}{t('react.import.savesUnchanged')}</p>
        <p className="text-xs text-muted">{t('react.import.validationHint')}</p>
      </>}
      {review.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-muted">{review.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void controller?.confirm(review.id).catch(() => {})}>{review.kind === 'import' ? review.previousGenerationId ? t('react.import.confirmReplace') : t('react.import.confirm') : t('react.import.confirmRemoveAll')}</button><button type="button" className={button} disabled={busy} onClick={() => controller?.cancel()}>{t('react.import.keepCurrent')}</button></div>
    </div>}
    {snapshot?.outcome?.gameId === gameId && <p role="status" className="text-muted">{snapshot.outcome.kind === 'import' ? t('react.import.imported') : t('react.import.removed')}</p>}
    <p className="text-xs text-muted">{t('react.import.cancelHint')}</p>
  </section>;
}
