import {useState} from 'react';
import {AnimatedDialog} from './AnimatedDialog';
import {useMultiplayerLaunch} from './MultiplayerRoomProvider';
const button = 'min-h-11 rounded-xl border border-line px-3 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink';
const phaseTitle = {waiting: '正在连接其他玩家…', stabilizing: '正在稳定连接…', measuring: '正在测量连接延迟…', negotiating: '各方确认测量结果…', ready: '联机测量完成'};
/** Only current Runtime-epoch reports reach this surface. Room probes never do. */
export function MultiplayerCalibration() {
  const {controller, snapshot} = useMultiplayerLaunch();
  const [reportOpen, setReportOpen] = useState(false), [copyStatus, setCopyStatus] = useState('');
  if (!controller || !snapshot?.active) return null;
  const {progress, report, dismissed} = snapshot.calibration;
  return <>
    {progress && !dismissed && <aside aria-label="联机开局测量" className="fixed right-3 bottom-20 left-3 z-[60] mx-auto max-w-md rounded-2xl border border-line bg-panel p-4 text-paper shadow-menu sm:left-auto">
      <h2 role="status" className="font-bold">{phaseTitle[progress.phase]}</h2>
      {progress.timing ? <><p className="mt-2 text-sm">输入延迟：{progress.timing.inputDelay} 帧 · 回滚：{progress.timing.adonisMode === 2 ? '开启' : '关闭'}</p><button type="button" className={`${button} mt-3`} onClick={() => controller.dismissCalibration()}>收起</button></> : <>
        <p className="mt-2 text-sm text-muted">{progress.phase === 'waiting' ? '等待所有玩家的输入通道就绪。' : progress.phase === 'stabilizing' ? '等待 1 秒后开始测量。' : progress.phase === 'negotiating' ? '等待所有玩家确认本局测量结果。' : `探测 ${progress.probes}/129 · 有效应答 ${progress.replies}/120`}</p>
        <progress aria-label={phaseTitle[progress.phase]} className="mt-3 w-full" max={129} value={progress.phase === 'measuring' ? progress.probes : undefined}/>
      </>}
    </aside>}
    {report && <button type="button" className={`${button} fixed right-3 bottom-3 z-[60] bg-panel text-paper`} onClick={() => {setReportOpen(true); setCopyStatus('');}}>标定报告</button>}
    <AnimatedDialog open={reportOpen && !!report} onOpenChange={setReportOpen} layer={70} title="开局延迟标定报告" description="本报告来自实际游戏输入通道的开局测量。房间探测和局内 RTT 与开局 P95 是不同的测量。">
      <textarea readOnly aria-label="标定报告 JSON" className="h-72 w-full rounded-xl border border-line bg-background p-3 font-mono text-xs" value={controller.reportText() ?? ''}/>
      <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" className={button} onClick={() => void navigator.clipboard.writeText(controller.reportText() ?? '').then(() => setCopyStatus('已复制报告'), () => setCopyStatus('复制失败，请选择文本后手动复制'))}>复制报告</button><button type="button" className={button} onClick={() => setReportOpen(false)}>关闭</button></div>
      {copyStatus && <p role="status" className="mt-3 text-sm">{copyStatus}</p>}
    </AnimatedDialog>
  </>;
}
