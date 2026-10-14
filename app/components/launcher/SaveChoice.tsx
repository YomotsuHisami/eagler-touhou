import {useEffect, useSyncExternalStore} from 'react';
import type {ProductId} from '../../../src/contracts/product-catalog.mts';
import {supportsScore} from '../../services/score-storage';
import type {SaveLibraryModel} from '../../models/save-library';
import {useLocale} from '../../i18n';
import {MainSelect, MainSelectPrefix} from './MainSelect';

export function SaveChoice({model, product, language, onFiles}: {model: SaveLibraryModel; product: ProductId; language: string; onFiles(): void}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot), {t} = useLocale();
  useEffect(() => {model.select(product, language); return () => model.clear(product);}, [model, product, language]);
  if (!supportsScore(product)) return null;
  const pending = !!state.binding?.run;
  return <div className="save-choice"><div className="save-choice-control"><label htmlFor="launchSaveChoice">{t('saveLibrary.choice')}</label><MainSelectPrefix prefix={<span className="save-choice-prefix" aria-hidden="true">{t('saveLibrary.choice')}</span>}><MainSelect className="option-select" id="launchSaveChoice" aria-label={t('saveLibrary.choice')} value={state.product === product ? state.binding?.selectedId ?? '' : ''} disabled={state.product !== product || state.phase !== 'ready' || state.busy || state.runtimeBusy || pending} onChange={event => {void model.choose(event.target.value || null);}}><option value="">{t('saveLibrary.currentChoice')}</option>{state.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</MainSelect></MainSelectPrefix></div>{pending && <button type="button" onClick={onFiles}>{t('saveLibrary.pending')}</button>}{state.error && <small role="status">{t(`saveLibrary.error.${state.error}`)}</small>}</div>;
}
