import {useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {useLocale} from '../../i18n';
import type {TransferModel} from '../../models/transfer';

/** Original index.html822–837. The existing transfer owner arbitrates network,
 * package/runtime/language/music progress and owns cancellation/retry timers. */
export function TransferPanel({model}: {model: TransferModel}) {
  const {t} = useLocale(), state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const notice = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = notice.current;
    if (!node) return;
    node.classList.remove('show');
    if (state.midiNoticeVisible) {void node.offsetWidth; node.classList.add('show');}
  }, [state.midiNoticeVisible, state.midiNoticeRevision]);
  return <><div ref={notice} className="music-notice" id="musicNotice" role="status" aria-live="polite">
    <strong>{t('player.oggNotReady')}</strong><span>{t('player.oggFallback')}</span>
  </div><aside className="transfer" id="transfer" aria-live="polite" hidden={state.hidden}
    data-network-owned={state.networkOwned ? '1' : '0'} data-network-active={state.networkActive ? '1' : undefined}>
    <strong id="transferTitle">{state.title}</strong>
    <div className="transfer-line"><span id="transferLabel">{state.label}</span><span id="transferAmount">{state.amount}</span></div>
    <div className={`transfer-bar${state.indeterminate ? ' indeterminate' : ''}`}><i id="transferBar" style={{width: state.barWidth}}/></div>
    <div className="transfer-meta"><span id="transferSpeed">{state.speedText}</span><span id="transferEta">{state.etaText}</span></div>
    <pre className="player-debug" id="playerDebug" hidden={!state.debugVisible}>{state.debugText}</pre>
    <div className="transfer-warning" id="transferWarning" hidden={!state.warningVisible}>{state.warningText}</div>
    <div className="transfer-actions"><button className="transfer-cancel" id="transferCancel" type="button" hidden={!state.cancelVisible} onClick={() => {void model.cancel();}}>{state.cancelLabel}</button>
      <button className="transfer-retry" id="transferRetry" type="button" hidden={!state.retryVisible} onClick={() => {void model.retry();}}>{t('action.retry')}</button></div>
  </aside></>;
}
