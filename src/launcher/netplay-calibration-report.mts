import { parseMeasuredNetplayTiming } from '../contracts/netplay-timing.mjs';

let report: Record<string, unknown> | null = null;
let button: HTMLButtonElement | null = null;
let dialog: HTMLDialogElement | null = null;

export function resetCalibrationReport() {
  report = null;
  if (button) button.hidden = true;
  dialog?.close();
}

export function recordCalibrationReport(value: unknown, parent: HTMLElement, currentNetwork: () => string) {
  const timing = parseMeasuredNetplayTiming(value);
  if (!timing || timing.route === 'spectator') return;
  const raw = value as Record<string, unknown>;
  const calibration = raw.calibration as Record<string, unknown> | undefined;
  if (!calibration || !Array.isArray(calibration.players) || ![2,3].includes(calibration.players.length)) return;
  const game=['th08mp','th09mp','th10mp'].includes(String(calibration.game))?String(calibration.game):'th09mp';
  const players = calibration.players as Array<Record<string, unknown>>;
  if (!players.every((p, index) => p.player === index && Number.isInteger(p.p95Us) &&
    Number(p.p95Us) >= 1 && Number(p.p95Us) <= 1_000_000 && Number.isInteger(p.samples) &&
    Number(p.samples) >= 96 && Number(p.samples) <= 120 && p.lost === 120 - Number(p.samples))) return;
  report = {
    schema: `eagler-touhou/${game.slice(0,4)}-calibration-report/1`, game,
    ...timing, completedAt: calibration.completedAt, runtimeBuild: calibration.build,
    localPlayer: calibration.localPlayer,
    players: players.map(p => ({ player: p.player, p95Us: p.p95Us, samples: p.samples, lost: p.lost, minUs:p.minUs, maxUs:p.maxUs, meanUs:p.meanUs })),
    formula: 'B=max(1,ceil(floor(max(players.p95Us)/2)*60/1000000)); automatic hybrid P=min(configuredReserve,B-1), configuredReserve<=2; automatic D=B-P>=1',
    measurement: 'Startup input-channel RTT; arrival-triggered echo and high-resolution clock; frozen for this match',
    method:calibration.method,intervalMs:calibration.intervalMs,tailWaitMs:calibration.tailWaitMs,
    scope:calibration.scope,
    probes:calibration.probes,windowStart:calibration.windowStart,windowEnd:calibration.windowEnd,
    userAgent: navigator.userAgent,
  };
  if (!button) {
    button = document.createElement('button');
    button.id = 'netplayCalibrationReport'; button.type = 'button';
    button.style.cssText = 'pointer-events:auto;min-height:32px;padding:5px 9px;border:1px solid #777;border-radius:8px;background:#242421;color:#fff;font:inherit;cursor:pointer';
    parent.append(button);
    button.addEventListener('click', () => {
      if (!report) return;
      const english = document.documentElement.dataset.uiLocale === 'en';
      dialog?.remove();
      dialog = document.createElement('dialog');
      dialog.id = 'netplayCalibrationDialog';
      dialog.style.cssText = 'box-sizing:border-box;width:560px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:18px;border:1px solid #777;border-radius:14px;background:#242421;color:#fff';
      const heading = document.createElement('h2');
      heading.textContent = english ? 'Startup calibration report' : '开局延迟标定报告';
      const hint = document.createElement('p');
      hint.textContent = english ? 'Send this report to diagnose the chosen delay. Live RTT and startup P95 are different measurements.' : '复制这份报告发给我。局内 RTT 与开局 P95 是不同测量，报告会同时保留。';
      const text = document.createElement('textarea');
      text.id = 'netplayCalibrationText'; text.readOnly = true;
      text.setAttribute('aria-label', heading.textContent);
      text.style.cssText = 'box-sizing:border-box;width:100%;height:40dvh;min-height:140px;background:#161614;color:#eee;padding:10px;font:12px/1.5 monospace';
      text.value = JSON.stringify({ ...report, copiedAt: new Date().toISOString(), liveNetworkDisplay: currentNetwork() }, null, 2);
      const copy = document.createElement('button'); copy.id = 'netplayCalibrationCopy'; copy.type = 'button';
      copy.textContent = english ? 'Copy report' : '复制报告';
      copy.style.cssText = 'min-height:44px;margin:10px 12px 0 0;padding:8px 14px';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text.value); copy.textContent = english ? 'Copied' : '已复制'; }
        catch { text.focus(); text.select(); copy.textContent = english ? 'Selected — copy manually' : '已选中，请手动复制'; }
      });
      const close = document.createElement('button'); close.type = 'button';
      close.textContent = english ? 'Close' : '关闭'; close.style.cssText = 'min-height:44px;padding:8px 14px';
      close.addEventListener('click', () => dialog?.close());
      dialog.append(heading, hint, text, copy, close); document.body.append(dialog); dialog.showModal();
    });
  }
  button.textContent = document.documentElement.dataset.uiLocale === 'en' ? 'Calibration report' : '标定报告';
  button.hidden = false;
}
