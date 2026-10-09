import {copyText} from '../browser/clipboard';
import {useLocale} from './LocaleProvider';
import {useState} from 'react';
import {AnimatedDialog} from './AnimatedDialog';
import {useMultiplayerLaunch} from './MultiplayerRoomProvider';
import {useMultiplayerConnection} from '../runtime/useMultiplayerConnection';
import '../runtime/netplay-connection.css';
const button = 'min-h-11 rounded-xl border border-line px-3 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink';
/** Only current Runtime-epoch reports reach this surface. Room probes never do. */
export function MultiplayerCalibration() {
  const {t} = useLocale();
  const {controller, snapshot} = useMultiplayerLaunch();
  const connection = useMultiplayerConnection();
  const [reportOpen, setReportOpen] = useState(false), [copyStatus, setCopyStatus] = useState<'ui.providers.calibration.copied' | 'ui.providers.calibration.copyFailed' | ''>('');
  const [returnError, setReturnError] = useState<string | null>(null), [returning, setReturning] = useState(false);
  if (!controller || !snapshot?.calibration || !snapshot.active && !snapshot.calibration.report) return null;
  const {progress, report, dismissed} = snapshot.calibration;
  const active = snapshot.active;
  const phaseTitle = progress?.phase === 'retrying' ? t('ui.providers.calibration.measuring')
    : progress?.phase === 'suspended' ? t('ui.providers.calibration.waiting')
    : progress?.phase === 'unavailable' ? t('ui.multiplayer.connectionUnavailable')
    : progress ? t(({waiting: 'ui.providers.calibration.waiting', stabilizing: 'ui.providers.calibration.stabilizing', measuring: 'ui.providers.calibration.measuring', negotiating: 'ui.providers.calibration.negotiating', ready: 'ui.providers.calibration.ready'} as const)[progress.phase]) : '';
  const phaseHint = progress?.phase === 'retrying'
    ? t('ui.providers.calibration.retryingHint', {attempt: progress.attempt ?? 1, maxAttempts: progress.maxAttempts ?? 4})
    : progress?.phase === 'suspended'
      ? t('ui.providers.calibration.suspendedHint')
      : progress?.phase === 'unavailable'
        ? t(progress.reason === 8 ? 'ui.providers.calibration.highDelayHint' : 'ui.providers.calibration.unavailableHint')
        : progress?.phase === 'waiting' ? t('ui.providers.calibration.waitingHint')
          : progress?.phase === 'stabilizing' ? t('ui.providers.calibration.stabilizingHint')
            : progress?.phase === 'negotiating' ? t('ui.providers.calibration.negotiatingHint')
              : progress?.phase === 'measuring' ? t('ui.providers.calibration.progress', {probes: progress.probes, replies: progress.replies}) : '';
  async function returnToRoom() {
    if (!controller || !active || returning) return;
    setReturning(true); setReturnError(null);
    try {await controller.returnToRoom(active);}
    catch (error) {setReturnError(error instanceof Error ? error.message : String(error));}
    finally {setReturning(false);}
  }
  return <>
    {active && connection && !connection.view.hidden && !(connection.healthy && progress && !dismissed) && <section className="netplay-connection-window" role="status" aria-live="assertive">
      <h2>{connection.view.title}</h2>{connection.view.summary && <p className="netplay-connection-summary">{connection.view.summary}</p>}
      <div className="netplay-connection-peers">{connection.view.peerRows.map(peer => <div className="netplay-connection-peer" key={peer.player}><span>P{peer.player+1}</span><span>{peer.status}</span></div>)}</div>
      {!connection.spectator && (connection.view.ended || connection.view.reconnecting) && <button type="button" className={`${button} mt-3`} disabled={returning} onClick={() => void returnToRoom()}>{t('ui.multiplayer.returnToRoom')}</button>}
      {returnError && <p role="alert" className="mt-2 text-sm text-accent">{returnError}</p>}
    </section>}
    {active && progress && !dismissed && (!connection || connection.healthy) && <aside aria-label={t('ui.providers.calibration.aria')} className="netplay-connection-window">
      <h2 role="status" className="font-bold">{phaseTitle}</h2>
      {progress.timing ? <><p className="mt-2 text-sm">{t('ui.providers.calibration.timing', {frames: progress.timing.inputDelay, rollback: t(progress.timing.adonisMode === 2 ? 'ui.providers.calibration.enabled' : 'ui.providers.calibration.disabled')})}</p><button type="button" className={`${button} mt-3`} onClick={() => controller.dismissCalibration()}>{t('ui.providers.dismiss')}</button></> : <>
        <p className="mt-2 text-sm text-muted">{phaseHint}</p>
        {progress.phase !== 'unavailable' && <progress aria-label={phaseTitle} className="mt-3 w-full" max={129} value={progress.phase === 'measuring' ? progress.probes : undefined}/>}
        {['retrying', 'suspended', 'unavailable'].includes(progress.phase) && <button type="button" className={`${button} mt-3`} disabled={returning} onClick={() => void returnToRoom()}>{t('react.routes.backRoom')}</button>}
        {returnError && <p role="alert" className="mt-2 text-sm text-accent">{returnError}</p>}
      </>}
    </aside>}
    {report && <button type="button" className={`${button} fixed right-3 bottom-3 z-[60] bg-panel text-paper`} onClick={() => {setReportOpen(true); setCopyStatus('');}}>{t('ui.providers.calibration.report')}</button>}
    <AnimatedDialog open={reportOpen && !!report} onOpenChange={setReportOpen} layer={70} title={t('ui.providers.calibration.reportTitle')} description={t('ui.providers.calibration.reportDescription')}>
      <textarea readOnly aria-label={t('ui.providers.calibration.reportJson')} className="h-72 w-full rounded-xl border border-line bg-background p-3 font-mono text-xs" value={controller.reportText() ?? ''}/>
      <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={() => void copyText(controller.reportText() ?? '').then(copied => setCopyStatus(copied ? 'ui.providers.calibration.copied' : 'ui.providers.calibration.copyFailed'))}>{t('ui.providers.calibration.copy')}</button><button type="button" className={button} onClick={() => setReportOpen(false)}>{t('action.close')}</button></div>
      {copyStatus && <p role="status" className="mt-3 text-sm">{t(copyStatus)}</p>}
    </AnimatedDialog>
  </>;
}
