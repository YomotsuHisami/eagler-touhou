import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {PRODUCT_GAMES, gameIdForProduct, type ProductId} from '../../../src/contracts/product-catalog.mts';
import {isReplayImportFileName} from '../../../src/launcher/replay-files.mts';
import {useLocale} from '../../i18n';
import type {SaveLibraryModel} from '../../models/save-library';
import {formatReplayBytes, type ReplayModel} from '../../models/replays';
import {useSurfaceNavigation} from '../../navigation/surface-navigation';
import type {SettingsActions} from '../settings/types';
import {SaveLibraryPanel} from './SaveLibraryPanel';
import {FileActionIcon} from './FileActionIcon';

export interface WorkspaceReplayActions {
  importFile(product: ProductId): Promise<void>;
  dropFile(file: File, product: ProductId): Promise<void>;
}

/** A Router-owned workspace, sharing the original file/storage owners. */
export function FilesWorkspace({product, language, saveLibrary, replays, replayActions, actions, hidden = false, assetUrl = path=>path}: {
  product: ProductId; language: string; saveLibrary?: SaveLibraryModel; replays?: ReplayModel | null;
  replayActions?: WorkspaceReplayActions; actions: SettingsActions; hidden?: boolean; assetUrl?:(path:string)=>string;
}) {
  const {t} = useLocale(), navigation = useSurfaceNavigation();
  return <aside className="tools workspace-panel files-workspace" id="scoreFilesDialog" hidden={hidden} inert={hidden} aria-labelledby="scoreFilesTitle"
    onKeyDown={event => {if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault(); event.stopPropagation(); navigation.closeInfoDialog('scoreFilesDialog');}}}>
    <div className="workspace-toolbar files-workspace-toolbar">
      <button type="button" id="scoreFilesClose" onClick={() => navigation.closeInfoDialog('scoreFilesDialog')}><span aria-hidden="true">←</span>{t('action.back')}</button>
      <h1 id="scoreFilesTitle">{t('workspace.files')}</h1><span className="files-game-title">{PRODUCT_GAMES[gameIdForProduct(product)].title}</span>
    </div>
    <div className="files-workspace-columns">
      {saveLibrary ? <SaveLibraryPanel retainSelection model={saveLibrary} product={product} language={language} active actions={actions} assetUrl={assetUrl}/> : <NativeSavePanel product={product} actions={actions} assetUrl={assetUrl}/>}
      {replays && replayActions ? <WorkspaceReplayPanel model={replays} product={product} actions={replayActions} reportError={actions.reportError} assetUrl={assetUrl}/> : <section className="file-library" aria-labelledby="fileReplayTitle"><div className="file-library-heading"><h2 id="fileReplayTitle">{t('settings.replay')}</h2></div><p className="file-library-empty" role="status">{t('files.replayUnavailable')}</p></section>}
    </div>
  </aside>;
}

function NativeSavePanel({product, actions, assetUrl}: {product: ProductId; actions: SettingsActions; assetUrl:(path:string)=>string}) {
  const {t} = useLocale();
  return <section className="file-library" aria-labelledby="saveLibraryTitle">
    <div className="file-library-heading"><h2 id="saveLibraryTitle">{t('settings.save')}</h2>
      <button type="button" aria-label={t('files.importSave')} onClick={() => {void actions.file('import-save',product).catch(actions.reportError);}}>{t('files.import')}</button>
    </div>
    <ul className="file-library-list"><li className="file-library-row" data-native-save="">
      <strong className="file-library-name">{t('files.nativeSave')}</strong><small className="file-library-size">—</small>
      <div className="save-library-row-actions">
        <button className="file-icon-action" type="button" data-action="export-save" aria-label={t('files.export')} title={t('files.export')} onClick={() => {void actions.file('export-save',product).catch(actions.reportError);}}><FileActionIcon kind="export" assetUrl={assetUrl}/></button>
        <button className="file-icon-action file-delete-action" type="button" data-action="clear-save" aria-label={t('files.clearNative')} title={t('files.clearNative')} onClick={() => {void actions.file('clear-save',product).catch(actions.reportError);}}><FileActionIcon kind="delete" assetUrl={assetUrl}/></button>
      </div>
    </li></ul>
  </section>;
}

/** Only this panel owns replay visibility. Closing waits on the original queue
 * and releases only an idle Runtime acquired for this file session. */
function WorkspaceReplayPanel({model, product, actions, reportError,assetUrl}: {model: ReplayModel; product: ProductId; actions: WorkspaceReplayActions; reportError(error: unknown): void;assetUrl:(path:string)=>string}) {
  const {t} = useLocale(), state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [importing, setImporting] = useState(false), [dragging, setDragging] = useState(false), dragDepth = useRef(0);
  const errorHandler = useRef(reportError); errorHandler.current = reportError;
  useEffect(() => {
    let active = true;
    void model.open(product).catch(error => {if (active) errorHandler.current(error);});
    return () => {active = false; model.close();};
  }, [model, product]);
  const current = state.productId === product && state.open, loading = !current || state.phase === 'loading';
  async function importReplay(file?: File) {
    if (importing || !current) return;
    setImporting(true);
    try {if (file) {if (!isReplayImportFileName(file.name)) throw new Error(t('replay.dropType')); await actions.dropFile(file, product);} else await actions.importFile(product);}
    catch (error) {reportError(error);} finally {setImporting(false);}
  }
  return <section className={`file-library replay-library${dragging ? ' dragging' : ''}`} aria-labelledby="fileReplayTitle" aria-busy={loading || importing}
    onDragEnter={event => {if (event.dataTransfer.types.includes('Files')) {event.preventDefault(); dragDepth.current++; setDragging(true);}}}
    onDragOver={event => {if (event.dataTransfer.types.includes('Files')) {event.preventDefault(); event.dataTransfer.dropEffect = 'copy';}}}
    onDragLeave={() => {if (--dragDepth.current <= 0) {dragDepth.current = 0; setDragging(false);}}}
    onDrop={event => {event.preventDefault(); dragDepth.current = 0; setDragging(false); const files = [...event.dataTransfer.files]; if (files.length !== 1) reportError(new Error(t('replay.dropSingle'))); else void importReplay(files[0]);}}>
    <div className="file-library-heading"><h2 id="fileReplayTitle">{t('settings.replay')}</h2><button type="button" data-action="import-replay" aria-label={t('files.importReplay')} disabled={!current || loading || importing} onClick={() => {void importReplay();}}>{t('files.import')}</button></div>
    <div className="file-library-scroll replay-library-scroll" tabIndex={0} role="region" aria-label={t('files.replayList')}>
      {loading ? <p className="file-library-empty">{t('replay.loading')}</p> : state.phase === 'error' ? <div className="file-library-empty"><p>{t('status.replayReadFailed')}</p><button type="button" onClick={() => {void model.open(product).catch(reportError);}}>{t('files.retry')}</button></div> : !state.rows.length ? <p className="file-library-empty">{t('status.noReplay')}</p> :
        <ul className="file-library-list">{state.rows.map(row => <li className="file-library-row" key={row.path}><strong className="file-library-name" title={row.name}>{row.name}</strong><small className="file-library-size">{formatReplayBytes(row.size).replace('KiB','KB').replace('MiB','MB')}</small><button className="file-icon-action" type="button" title={t('files.export')} aria-label={`${t('files.export')} ${row.name}`} disabled={importing} onClick={() => {void model.download(row.path);}}><FileActionIcon kind="export" assetUrl={assetUrl}/></button></li>)}</ul>}
    </div>
  </section>;
}
