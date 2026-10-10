import {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import type {NetplayCalibration} from '../models/netplay-calibration';

/** Original diagnostics trigger and native report dialog. Opening captures the
 * current real network display; only a user's Copy click calls the clipboard. */
export function NetplayCalibrationReport({model, english, currentNetwork, clipboard}: {
  model: NetplayCalibration; english: boolean; currentNetwork(): string;
  clipboard?: Pick<Clipboard, 'writeText'>;
}) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null), text = useRef<HTMLTextAreaElement>(null);
  const lifetime = useRef(0);
  const [openedEnglish, setOpenedEnglish] = useState(english);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const visible = snapshot.reportText !== null;
  useLayoutEffect(() => {
    const node = dialog.current; if (!node) return;
    if (visible && !node.open) {lifetime.current++; setOpenedEnglish(english); setCopyState('idle'); node.showModal();}
    else if (!visible && node.open) {lifetime.current++; node.close();}
  }, [visible, snapshot.reportText]);
  const reportEnglish = visible ? openedEnglish : english;
  const heading = reportEnglish ? 'Startup calibration report' : '开局延迟标定报告';
  async function copyReport() {
    const value = snapshot.reportText, owner = lifetime.current; if (value === null) return;
    try {
      const writer = clipboard ?? navigator.clipboard;
      await writer.writeText(value);
      if (lifetime.current === owner && model.getSnapshot().reportText === value) setCopyState('copied');
    } catch {
      if (lifetime.current !== owner || model.getSnapshot().reportText !== value) return;
      text.current?.focus(); text.current?.select(); setCopyState('selected');
    }
  }
  return <>
    <button id="netplayCalibrationReport" type="button" hidden={!snapshot.report} onClick={() => model.openReport(currentNetwork())}
      style={{pointerEvents: 'auto', minHeight: 32, padding: '5px 9px', border: '1px solid #777', borderRadius: 8, background: '#242421', color: '#fff', font: 'inherit', cursor: 'pointer'}}>
      {english ? 'Calibration report' : '标定报告'}
    </button>
    {typeof document !== 'undefined' && createPortal(<dialog id="netplayCalibrationDialog" data-launcher-document="" ref={dialog}
      onClose={() => {if (!dialog.current?.open) model.closeReport();}} onCancel={event => {event.preventDefault(); model.closeReport();}}
      style={{boxSizing: 'border-box', width: 560, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)', padding: 18, border: '1px solid #777', borderRadius: 14, background: '#242421', color: '#fff'}}>
      <h2>{heading}</h2>
      <p>{reportEnglish ? 'Send this report to diagnose the chosen delay. Live RTT and startup P95 are different measurements.' : '复制这份报告发给我。局内 RTT 与开局 P95 是不同测量，报告会同时保留。'}</p>
      <textarea id="netplayCalibrationText" ref={text} readOnly aria-label={heading} value={snapshot.reportText ?? ''}
        style={{boxSizing: 'border-box', width: '100%', height: '40dvh', minHeight: 140, background: '#161614', color: '#eee', padding: 10, font: '12px/1.5 monospace'}}/>
      <button id="netplayCalibrationCopy" type="button" onClick={() => {void copyReport();}} style={{minHeight: 44, margin: '10px 12px 0 0', padding: '8px 14px'}}>
        {copyState === 'copied' ? reportEnglish ? 'Copied' : '已复制' : copyState === 'selected' ? reportEnglish ? 'Selected — copy manually' : '已选中，请手动复制' : reportEnglish ? 'Copy report' : '复制报告'}
      </button>
      <button type="button" onClick={model.closeReport} style={{minHeight: 44, padding: '8px 14px'}}>{reportEnglish ? 'Close' : '关闭'}</button>
    </dialog>, document.body)}
  </>;
}
