import {useLocale} from './LocaleProvider';
import {useState} from 'react';
import {AnimatedDialog} from './AnimatedDialog';
import {useMultiplayerLaunch} from './MultiplayerRoomProvider';
const button = 'min-h-11 rounded-xl border border-line px-3 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink';
const phaseTitle = {waiting: 'ui.providers.calibration.waiting', stabilizing: 'ui.providers.calibration.stabilizing', measuring: 'ui.providers.calibration.measuring', negotiating: 'ui.providers.calibration.negotiating', ready: 'ui.providers.calibration.ready'} as const;
/** Only current Runtime-epoch reports reach this surface. Room probes never do. */
export function MultiplayerCalibration() {
  const {t} = useLocale();
  const {controller, snapshot} = useMultiplayerLaunch();
  const [reportOpen, setReportOpen] = useState(false), [copyStatus, setCopyStatus] = useState<'ui.providers.calibration.copied' | 'ui.providers.calibration.copyFailed' | ''>('');
  if (!controller || !snapshot?.active) return null;
  const {progress, report, dismissed} = snapshot.calibration;
  return <>
    {progress && !dismissed && <aside aria-label={t('ui.providers.calibration.aria')} className="fixed right-3 bottom-20 left-3 z-[60] mx-auto max-w-md rounded-2xl border border-line bg-panel p-4 text-paper shadow-menu sm:left-auto">
      <h2 role="status" className="font-bold">{t(phaseTitle[progress.phase])}</h2>
      {progress.timing ? <><p className="mt-2 text-sm">{t('ui.providers.calibration.timing', {frames: progress.timing.inputDelay, rollback: t(progress.timing.adonisMode === 2 ? 'ui.providers.calibration.enabled' : 'ui.providers.calibration.disabled')})}</p><button type="button" className={`${button} mt-3`} onClick={() => controller.dismissCalibration()}>{t('ui.providers.dismiss')}</button></> : <>
        <p className="mt-2 text-sm text-muted">{progress.phase === 'waiting' ? t('ui.providers.calibration.waitingHint') : progress.phase === 'stabilizing' ? t('ui.providers.calibration.stabilizingHint') : progress.phase === 'negotiating' ? t('ui.providers.calibration.negotiatingHint') : t('ui.providers.calibration.progress', {probes: progress.probes, replies: progress.replies})}</p>
        <progress aria-label={t(phaseTitle[progress.phase])} className="mt-3 w-full" max={129} value={progress.phase === 'measuring' ? progress.probes : undefined}/>
      </>}
    </aside>}
    {report && <button type="button" className={`${button} fixed right-3 bottom-3 z-[60] bg-panel text-paper`} onClick={() => {setReportOpen(true); setCopyStatus('');}}>{t('ui.providers.calibration.report')}</button>}
    <AnimatedDialog open={reportOpen && !!report} onOpenChange={setReportOpen} layer={70} title={t('ui.providers.calibration.reportTitle')} description={t('ui.providers.calibration.reportDescription')}>
      <textarea readOnly aria-label={t('ui.providers.calibration.reportJson')} className="h-72 w-full rounded-xl border border-line bg-background p-3 font-mono text-xs" value={controller.reportText() ?? ''}/>
      <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={() => void navigator.clipboard.writeText(controller.reportText() ?? '').then(() => setCopyStatus('ui.providers.calibration.copied'), () => setCopyStatus('ui.providers.calibration.copyFailed'))}>{t('ui.providers.calibration.copy')}</button><button type="button" className={button} onClick={() => setReportOpen(false)}>{t('action.close')}</button></div>
      {copyStatus && <p role="status" className="mt-3 text-sm">{t(copyStatus)}</p>}
    </AnimatedDialog>
  </>;
}
