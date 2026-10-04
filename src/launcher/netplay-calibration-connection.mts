import { parseMeasuredNetplayTiming } from '../contracts/netplay-timing.mjs';

let progress: Record<string, unknown> | null = null;
let resultUntil = 0;
export function resetCalibrationProgress() { progress=null;resultUntil=0; }
export function recordCalibrationProgress(value: unknown) {
  if(!value || typeof value!=='object')return;
  const v=value as Record<string,unknown>;
  if(v.phase==='closed'){resetCalibrationProgress();return;}
  if(v.phase==='ready') {
    if(!parseMeasuredNetplayTiming(v) || v.route==='spectator')return;
    progress=v;resultUntil=Date.now()+8000;return;
  }
  if(!['waiting','stabilizing','measuring','negotiating'].includes(String(v.phase)))return;
  progress=v;resultUntil=0;
}
export function renderCalibrationConnection(windowElement: HTMLElement): boolean {
  windowElement.removeAttribute('data-calibration');
  windowElement.querySelector('#netplayCalibrationDismiss')?.remove();
  const note=windowElement.querySelector<HTMLElement>('#netplayConnectionNote');
  if(note)note.hidden=true;
  if(!progress || (progress.phase==='ready' && Date.now()>=resultUntil))return false;
  const english=document.documentElement.dataset.uiLocale==='en';
  const ready=progress.phase==='ready';
  windowElement.hidden=false;
  windowElement.classList.remove('reconnecting');
  windowElement.dataset.calibration=String(progress.phase);
  const title=windowElement.querySelector<HTMLElement>('#netplayConnectionTitle')!;
  title.textContent=ready ? (english?'Connection measured':'联机测量完成')
    : progress.phase==='waiting' ? (english?'Connecting to players…':'正在连接其他玩家…')
    : progress.phase==='stabilizing' ? (english?'Allowing connection to settle…':'正在稳定连接…')
    : progress.phase==='negotiating' ? (english?'Confirming measured delay…':'各方确认测量结果…')
    : (english?'Measuring connection latency…':'正在测量连接延迟…');
  const summary=windowElement.querySelector<HTMLElement>('#netplayConnectionSummary')!;
  summary.hidden=false;
  summary.replaceChildren();
  if(ready){
    const delay=document.createElement('span');
    delay.textContent=english?`Input delay: ${progress.inputDelay} frame(s)`:`输入延迟：${progress.inputDelay} 帧`;
    const rollback=document.createElement('span');
    rollback.textContent=english?`Rollback: ${Number(progress.adonisMode)===2?'on':'off'}`:`回滚：${Number(progress.adonisMode)===2?'开启':'关闭'}`;
    summary.append(delay,rollback);
  }else summary.textContent=progress.phase==='stabilizing'
    ? (english?'Measurement starts after one second.':'等待 1 秒后开始测量。')
    : progress.phase==='waiting' ? (english?'Waiting for all player input channels.':'等待所有玩家的输入通道就绪。')
    : progress.phase==='negotiating' ? (english?'Waiting for every player to confirm.':'等待所有玩家确认测量结果。')
    : (english?`Probes ${progress.probes??0}/129 · replies ${progress.replies??0}/120`:`探测 ${progress.probes??0}/129 · 有效应答 ${progress.replies??0}/120`);
  const rows=windowElement.querySelector<HTMLElement>('#netplayConnectionPeers')!;
  rows.replaceChildren();
  if(!ready){
    const meter=document.createElement('progress');meter.id='netplayCalibrationProgress';
    meter.max=129;if(progress.phase==='measuring')meter.value=Number(progress.probes??0);
    meter.setAttribute('aria-label',title.textContent);rows.append(meter);
  }else{
    const table=document.createElement('table');table.className='netplay-calibration-table';
    const head=table.createTHead().insertRow();
    for(const text of english?['Player','Measured latency','Maximum latency']:['玩家','测定延迟','最大延迟']){
      const th=document.createElement('th');th.scope='col';th.textContent=text;head.append(th);
    }
    const body=table.createTBody();
    const calibration=progress.calibration as Record<string,unknown>|undefined;
    const players=calibration?.players as Array<Record<string,unknown>>|undefined;
    for(const p of players??[]){
      if(!Number(p.samples))continue;
      const row=body.insertRow();const label=document.createElement('th');label.scope='row';label.textContent=`P${Number(p.player)+1}`;row.append(label);
      // The same frozen statistic that determines D, never the mean.
      for(const key of ['p95Us','maxUs'])row.insertCell().textContent=`${(Number(p[key])/1000).toFixed(2)} ms`;
    }
    rows.append(table);
    if(players?.length===3&&note){note.hidden=false;note.textContent=english?'Each player’s slowest input link.':'各玩家最慢的输入链路。';}
    const dismiss=document.createElement('button');dismiss.id='netplayCalibrationDismiss';dismiss.type='button';
    dismiss.textContent=english?'Dismiss':'收起';
    dismiss.onclick=()=>{resultUntil=0;windowElement.hidden=true;};windowElement.append(dismiss);
  }
  return true;
}
