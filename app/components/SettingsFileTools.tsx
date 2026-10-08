import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useLocale} from './LocaleProvider';
import {gameIdForProduct, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import {ReplayManager} from './ReplayManager';
import {SaveManager} from './SaveManager';
import {useHintController} from './HintProvider';
import {useFilePreparation} from './FilePreparationProvider';
import './game-launch.css';

const none = () => () => {};
const empty = () => null;

/** Compact save/replay controls for the product settings drawer. */
export function SettingsFileTools({productId}: {productId: ProductId}) {
  const {t} = useLocale();
  return <section className="settings-file-tools" aria-label={t('react.routes.management')}>
    <div className="settings-file-tool-row">
      <span className="settings-file-tool-label">{t('settings.save')}</span>
      <SaveManager productId={productId} compact/>
    </div>
    <div className="settings-file-tool-row">
      <span className="settings-file-tool-label">{t('settings.replay')}</span>
      <ReplayManager productId={productId} compact/>
    </div>
    <HintFileTools productId={productId}/>
  </section>;
}

function HintFileTools({productId}: {productId: ProductId}) {
  const {t} = useLocale();
  const controller = useHintController();
  const {snapshot: preparation} = useFilePreparation();
  const game = gameIdForProduct(productId), storage = PRODUCT_GAMES[game].storage;
  const supported = 'hintFiles' in storage && storage.hintFiles.length > 0;
  const getSnapshot = () => controller?.getSnapshot(productId) ?? null;
  const snapshot = useSyncExternalStore(controller?.subscribe ?? none, getSnapshot, empty);
  const mounted = useRef(true);
  const [viewError, setViewError] = useState<string | null>(null);
  useEffect(() => {mounted.current = true; controller?.loadProduct(productId); return () => {mounted.current = false;};}, [controller, productId]);
  if (!supported) return null;
  const busy = !!snapshot?.busy || !!snapshot?.fileOperationBusy || preparation?.phase === 'preparing';
  const disabled = !controller || busy || !snapshot?.available && preparation?.canPrepare !== true;
  async function perform(operation: () => Promise<unknown>) {
    setViewError(null);
    try {await operation();} catch (error) {
      if (mounted.current) setViewError(error instanceof Error ? error.message : String(error));
    }
  }
  return <div className="settings-file-tool-row">
    <span className="settings-file-tool-label">{t('settings.hint')}</span>
    <div className="settings-file-manager-compact">
      <div className="settings-file-tool-actions" role="group" aria-label={t('react.hints.title')}>
        <label className={'settings-file-pill settings-file-import' + (disabled ? ' is-disabled' : '')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10.25v-8.5m-3.25 3.25L8 1.75l3.25 3.25M2.5 11.25v2h11v-2"/></svg>
          {t('settings.import')}
          <input aria-label={t('react.hints.selectFile')} type="file" accept=".txt" disabled={disabled} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100" onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
            if (file && controller) void perform(() => controller.importFile(productId, file));
          }}/>
        </label>
        <button type="button" className="settings-file-pill" disabled={disabled} onClick={() => {
          if (controller) void perform(() => controller.deleteFiles(productId));
        }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 4.25h10.5m-9.25 0 .5 9h7l.5-9M6 4.25V2.5h4v1.75m-3.25 2v4.5m2.5-4.5v4.5"/></svg>
          {t('action.delete')}
        </button>
      </div>
      {snapshot?.busy && <p role="status" className="settings-file-message">{t(snapshot.busy === 'import' ? 'react.hints.importing' : 'react.hints.deleting')}</p>}
      {(viewError || snapshot?.error) && <p role="alert" className="settings-file-message text-accent">{viewError || snapshot?.error}</p>}
      {snapshot?.notice && <p role="status" className="settings-file-message">{t(snapshot.notice === 'deleted' ? 'react.hints.deleted' : 'react.hints.imported')}</p>}
    </div>
  </div>;
}
