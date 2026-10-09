import {useCallback, useRef, useState, useSyncExternalStore} from 'react';
import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import {rawDataImportFileNames} from '../../src/launcher/raw-data-import.mts';
import type {ResourceImportSnapshot} from '../services/resource-import.client';
import {installSelectedGamePackage} from '../services/game-package-import';
import {useResourceImport} from './ResourceManagerProvider';
import {useLocale} from './LocaleProvider';
import {AnimatedDialog} from './AnimatedDialog';
import type {UiMessageKey} from '../../src/launcher/i18n.mts';

export interface GamePackageImportOptions {
  /** Called only after the selected file has been installed successfully. */
  onImported?(productId: ProductId): void;
  /** Called when the user closes the import surface without installing. */
  onDismiss?(): void;
  /** Optional reason supplied by the captured Start attempt. */
  reason?: string;
  reasonKey?: UiMessageKey;
  /** Optional host-owned fallback link metadata. */
  fallback?: {url: string; hint?: string};
}

interface ImportRequest extends GamePackageImportOptions {
  id: number;
  productId: ProductId;
}

const noSnapshot = () => null;
const noSubscribe = () => () => {};
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';

function safeFallbackUrl(url: string | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {return null;}
}

/** Keep game-package import in the current launcher surface. Selection is
 * captured when opened, and a successful import resumes only that request.
 */
export function useGamePackageImport() {
  const {t} = useLocale();
  const {controller, snapshot} = useResourceImport();
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<ImportRequest | null>(null);
  const busyRef = useRef(false);
  const serial = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const importSnapshot = useSyncExternalStore(controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? noSnapshot, noSnapshot) as ResourceImportSnapshot | null;

  const open = useCallback((productId: ProductId, options: GamePackageImportOptions = {}) => {
    if (busyRef.current) return false;
    const previous = requestRef.current;
    if (previous) previous.onDismiss?.();
    const next: ImportRequest = {...options, id: ++serial.current, productId};
    requestRef.current = next;
    setRequest(next);
    setError(null);
    return true;
  }, []);

  const dismiss = useCallback(() => {
    const current = requestRef.current;
    if (!current || busyRef.current) return;
    requestRef.current = null;
    setRequest(null);
    setError(null);
    current.onDismiss?.();
  }, []);

  const selectFile = useCallback(async (file: File | null) => {
    const captured = requestRef.current;
    if (!file || !captured || busyRef.current) return;
    if (!controller) {
      setError(t('ui.providers.import.unavailable'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let installed = false;
    try {
      await installSelectedGamePackage(controller, captured.productId, file);
      installed = true;
    } catch (failure) {
      if (requestRef.current === captured) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    if (!installed || requestRef.current !== captured) return;
    requestRef.current = null;
    setRequest(null);
    setError(null);
    captured.onImported?.(captured.productId);
  }, [controller, t]);

  const product = request ? PRODUCT_GAMES[gameIdForProduct(request.productId)] : null;
  const rawNames = request ? rawDataImportFileNames(gameIdForProduct(request.productId)) : [];
  const accept = ['.zip', ...new Set(rawNames.map(name => `.${name.split('.').at(-1)}`)), 'application/zip'].join(',');
  const operation = importSnapshot?.operation;
  const externalBusy = !!operation && !busy;
  const fallbackUrl = safeFallbackUrl(request?.fallback?.url);

  const dialog = <AnimatedDialog open={!!request} onOpenChange={open => {if (!open) dismiss();}}
    title={t('package.importTitle')}
    description={request?.reason || (request?.reasonKey ? t(request.reasonKey) : t('package.manualImportIntro'))}
    layer={62}
    onEscapeKeyDown={event => {if (busyRef.current) event.preventDefault();}}
    onPointerDownOutside={event => {if (busyRef.current) event.preventDefault();}}>
    {request && <section className="grid gap-4 text-sm" aria-busy={busy || undefined}>
      <p className="text-nav"><span lang="ja">{product?.title}</span></p>
      <input ref={input} type="file" accept={accept} hidden disabled={!controller || busy || externalBusy}
        onChange={event => {
          const selected = event.currentTarget.files?.[0] ?? null;
          event.currentTarget.value = '';
          void selectFile(selected);
        }}/>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!controller || busy || externalBusy}
          onClick={() => input.current?.click()}>{t('action.import')}</button>
        {fallbackUrl && <a className={`${button} inline-flex items-center`} href={fallbackUrl}
          target="_blank" rel="noopener noreferrer" title={request.fallback?.hint || t('package.fallbackLinkTitle')}>
          {t('action.openLink')}
        </a>}
        <button type="button" className={button} disabled={busy}
          onClick={dismiss}>{t('package.closeImport')}</button>
      </div>
      {busy && <div role="status" aria-live="polite" className="rounded-xl border border-line p-3">
        <p>{operation?.kind === 'inspect' ? t('react.import.inspecting') : t('package.importing')}</p>
        {operation?.progress && <p className="mt-1 text-xs text-muted">
          {t('react.import.processed', {completed: operation.progress.completed, total: operation.progress.total})}
        </p>}
      </div>}
      {externalBusy && <p role="status" className="rounded-xl border border-line p-3">{t('react.import.inspecting')}</p>}
      {request.fallback?.hint && <p className="text-xs text-muted">{request.fallback.hint}</p>}
      {error && <p role="alert" className="whitespace-pre-line text-accent">{error}</p>}
    </section>}
  </AnimatedDialog>;

  return {open, dismiss, dialog};
}
