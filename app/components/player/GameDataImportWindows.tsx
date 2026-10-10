import {useLayoutEffect, useSyncExternalStore} from 'react';
import {useLocale} from '../../i18n';
import type {GameDataImportModel} from '../../models/game-data-import';
import {closeMainSelectMenus} from '../launcher/MainSelect';
import {TransientWindow} from '../TransientWindow';

export interface GameDataImportWindowsProps {
  model: GameDataImportModel;
  /** Read the live Runtime state for main's programmatic-popup fallback policy. */
  getRuntimeReady(): boolean;
}
/** Main public/index.html838–864 + app.mts3328–3367,9643–9672.
 * Host places these transient sections in the correct fullscreen overlay host;
 * no second dialog/history, file session, continuation or startup owner.
 */
export function GameDataImportWindows({model, getRuntimeReady}: GameDataImportWindowsProps) {
  const {t} = useLocale(), state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useLayoutEffect(() => {
    // Main app.mts3361/9656 closes menus on presentation, including repeated
    // opens. A hidden remount must not replay an earlier presentation, and
    // busy/progress/metadata changes are not presentation events.
    if (state.presentationRevision && (state.importOpen || state.linkOpen)) closeMainSelectMenus();
  }, [state.presentationRevision]);
  const fallback = state.fallback;
  return <>
    <TransientWindow id="gameDataImportWindow" titleId="gameDataImportTitle" title={t('package.importTitle')}
      closeId="gameDataImportClose" closeLabel={t('package.closeImport')} open={state.importOpen} busy={state.busy} onClose={model.dismissImport}>
      <p id="gameDataImportReason">{state.reason || t('package.unavailable')}</p>
      <div className="game-data-import-busy" id="gameDataImportBusy" role="status" aria-live="polite" hidden={!state.busy}><i className="eagler-preload-spinner" aria-hidden="true"/><span id="gameDataImportBusyText">{state.busyText || t('package.installing')}</span></div>
      <div className="game-data-import-actions"><button className="transfer-import" id="transferImport" type="button" disabled={state.busy} onClick={() => {void model.chooseFile();}}>{t('action.import')}</button><button className="transfer-download" id="transferDownload" type="button" disabled={state.busy || !fallback} title={t(fallback ? 'package.fallbackLinkTitle' : 'package.fallbackLinkUnavailableTitle')} onClick={model.openLink}>{t('action.openLink')}</button></div>
      <input id="gameDataImportInput" type="file" accept=".zip,.dat,application/zip" hidden onChange={event => {const file = event.currentTarget.files?.[0] ?? null; event.currentTarget.value = ''; void model.importFile(file);}}/>
    </TransientWindow>
    <TransientWindow variant="reference" id="gameDataLinkWindow" titleId="gameDataLinkTitle" title={t('package.downloadTitle')}
      closeId="gameDataLinkClose" closeLabel={t('package.closeLink')} open={state.linkOpen} onClose={model.closeLink}>
      <div className="game-data-link-row"><span>{t('package.link')}</span><a id="gameDataFallbackUrl" href={fallback?.url} target="_blank" rel="noopener noreferrer" aria-label={t('package.openLinkAria')} onClick={event => {
        if (!fallback?.url || getRuntimeReady()) return;
        event.stopPropagation();
        const opened = window.open(fallback.url, '_blank');
        if (opened) {opened.opener = null; event.preventDefault();}
      }}>{fallback?.url || t('package.fallbackLinkUnavailable')}</a></div>
      <div className="game-data-link-row"><span>{t('package.codeHint')}</span><strong id="gameDataFallbackHint">{fallback?.hint || t('common.none')}</strong></div>
    </TransientWindow>
  </>;
}
