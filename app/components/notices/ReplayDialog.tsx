import {useRef, useState, useSyncExternalStore, type CSSProperties} from 'react';
import {isReplayImportFileName} from '../../../src/launcher/replay-files.mts';
import {formatReplayBytes, type createReplayModel} from '../../models/replays';
import {useLocale} from '../../i18n';
import {useMainDialog, type MainDialogProps} from './use-main-dialog';

export interface ReplayDialogProps extends MainDialogProps {
  model: ReturnType<typeof createReplayModel>;
  onImportRequest(): void;
  /** The actual replay importer must use model.mutations, as main importFile does. */
  onDropFile(file: File): Promise<void>;
  /** Route to original setStatus(errorReason) and toast(replay.importFailed). */
  onImportError(error: unknown): void;
}
/** Main index.html817–824 and app.mts6429–6575, without a new route or rename UI. */
export function ReplayDialog({model, onImportRequest, onDropFile, onImportError, ...props}: ReplayDialogProps) {
  const {t} = useLocale(), state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const dialog = useMainDialog({...props, onClosed: model.close}, 220, 'replay-window-out', 'close');
  const dragDepth = useRef(0), [dragging, setDragging] = useState(false);
  const summary = state.phase === 'loading' ? t('status.readingReplay') : state.phase === 'error' ? t('status.replayReadFailed') : t('replay.fileCount', {count: state.rows.length});
  const resetDrag = () => {dragDepth.current = 0; setDragging(false);};
  return <dialog ref={dialog.ref} data-launcher-document="" className="replay-dialog" id="replayDialog" onCancel={dialog.onCancel} onAnimationEnd={dialog.onAnimationEnd}>
    <form method="dialog" className={`replay-window${dragging ? ' dragging' : ''}`} onSubmit={event => {event.preventDefault(); dialog.requestClose();}}
      onDragEnter={event => {if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true);}}
      onDragOver={event => {if (!event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy';}}
      onDragLeave={() => {dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false);}}
      onDrop={event => {
        event.preventDefault(); resetDrag();
        const files = [...(event.dataTransfer?.files || [])];
        void (async () => {
          if (files.length !== 1) throw new Error(t('replay.dropSingle'));
          if (!isReplayImportFileName(files[0].name)) throw new Error(t('replay.dropType'));
          await onDropFile(files[0]);
        })().catch(onImportError);
      }}>
      <header><strong>{t('replay.manager')}</strong><button type="button" data-replay-close="" aria-label={t('action.close')} onClick={dialog.requestClose}>×</button></header>
      <div className="replay-drop-hint">{t('replay.dropHint')}</div>
      <div className="replay-list" id="replayList">
        {state.phase === 'loading' ? <div className="replay-loading"><i aria-hidden="true"/><span>{t('replay.loading')}</span></div>
          : state.phase === 'error' ? <div className="replay-empty replay-load-error">{t('status.replayReadFailed')}</div>
          : !state.rows.length ? <div className="replay-empty">{t('status.noReplay')}</div>
          : state.rows.map((row, index) => <div className={`replay-row${state.animateRows ? ' replay-row-enter' : ''}`} key={row.path}
            style={state.animateRows ? {'--replay-row-delay': `${Math.min(index, 8) * 16}ms`} as CSSProperties : undefined}>
            <span className="replay-name" title={row.name}>{row.name}</span><span className="replay-size">{formatReplayBytes(row.size)}</span>
            <span className="replay-row-actions"><button type="button" onClick={() => {void model.download(row.path);}}>{t('action.download')}</button><button type="button" onClick={() => {void model.rename(row.path);}}>{t('action.rename')}</button><button type="button" className="replay-delete" onClick={() => {void model.remove(row.path);}}>{t('action.delete')}</button></span>
          </div>)}
      </div>
      <footer><span id="replaySummary">{summary}</span><span className="replay-actions"><button type="button" data-action="import-replay" onClick={onImportRequest}>{t('replay.import')}</button><button type="button" data-replay-close="" onClick={dialog.requestClose}>{t('action.close')}</button></span></footer>
    </form>
  </dialog>;
}
