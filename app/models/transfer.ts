import type {TransferKind, TransferMode, TransferPresentation} from '../../src/launcher/app-types.mts';
import type {NetworkActivitySnapshot} from '../../src/launcher/network-activity.mts';
import type {RuntimeEventMessage} from '../../src/contracts/runtime-protocol.mts';
import type {Translate} from '../i18n';
import type {PreparationProgress} from '../services/package-acquisition';
import type {RuntimeLocalResourceProgress, RuntimePlan} from '../services/runtime';
import {preparationErrorText} from '../services/package-acquisition';

export interface TransferSnapshot {
  hidden: boolean;
  kind: TransferKind;
  mode: TransferMode;
  title: string;
  label: string;
  amount: string;
  barWidth: string;
  speedText: string;
  etaText: string;
  indeterminate: boolean;
  networkOwned: boolean;
  networkActive: boolean;
  warningVisible: boolean;
  warningText: string;
  retryVisible: boolean;
  cancelVisible: boolean;
  cancelLabel: string;
  debugVisible: boolean;
  debugText: string;
  midiNoticeVisible: boolean;
  midiNoticeRevision: number;
  revision: number;
}
export interface TransferModelPorts {
  retryMusic(timeoutMs: number): Promise<unknown>;
  cancelDownload(): void | Promise<void>;
  playerStatus(message: string): void;
  toast(message: string): void;
  noteGameDataTransfer?(message: TransferPresentation): void;
}
export interface TransferModelTimers {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}
export interface TransferModelFrames {request(callback: () => void): number; cancel(id: number): void}
const emptyNetwork: NetworkActivitySnapshot = {active: [], count: 0, loaded: 0, total: 0};
function record(value: unknown): Record<string, unknown> {return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};}
/** Main app3445–3464 normalization, after the one Runtime owner authenticates. */
export function transferPresentation(value: unknown): TransferPresentation {
  const source = record(value);
  return {kind: source.kind === 'game' || source.kind === 'music' || source.kind === 'language' ? source.kind : undefined,
    mode: source.mode === 'runtime' || source.mode === 'base' || source.mode === 'ogg' || source.mode === 'language' || source.mode === '' ? source.mode : undefined,
    title: typeof source.title === 'string' ? source.title : undefined, label: typeof source.label === 'string' ? source.label : undefined,
    loaded: Number(source.loaded) || 0, total: Number(source.total) || 0, speed: Number(source.speed) || 0,
    phase: typeof source.phase === 'string' ? source.phase : undefined, statusText: typeof source.statusText === 'string' ? source.statusText : undefined,
    indeterminate: source.indeterminate === true, failed: source.failed === true, completed: source.completed === true,
    files: Array.isArray(source.files) ? source.files : Number(source.files) || 0};
}
export function transferClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const value = Math.min(Math.ceil(seconds), 99 * 60 + 59);
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

/** Main 1206–1270 and 3489–3668. Presentation only: the original one network
 * tracker, authenticated Runtime and blocking-operation owner supply events. */
export function createTransferModel({translate: t, context, ports, frames,
  timers = {setTimeout, clearTimeout}, now = () => globalThis.performance?.now?.() ?? Date.now()}: {
  translate: Translate;
  context(): {epoch: number | null; launched: boolean; iosWebKitTouch: boolean};
  ports: TransferModelPorts;
  frames: TransferModelFrames;
  timers?: TransferModelTimers;
  now?: () => number;
}) {
  const listeners = new Set<() => void>(); let disposed = false, speed = 0;
  let network: NetworkActivitySnapshot = emptyNetwork, local: RuntimeLocalResourceProgress | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null, midiTimer: ReturnType<typeof setTimeout> | null = null;
  let networkFrame: number | null = null, midiFrame: number | null = null;
  let snapshot: TransferSnapshot = Object.freeze({hidden: true, kind: '', mode: '', title: t('player.loading'), label: t('player.gameData'),
    amount: '0 / 0 MiB', barWidth: '0%', speedText: '0 KiB/s', etaText: '--:--', indeterminate: false,
    networkOwned: false, networkActive: false, warningVisible: false, warningText: '', retryVisible: false,
    cancelVisible: false, cancelLabel: t('player.cancelDownload'), debugVisible: false, debugText: '',
    midiNoticeVisible: false, midiNoticeRevision: 0, revision: 0});
  function publish(patch: Partial<TransferSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({...snapshot, ...patch, revision: snapshot.revision + 1});
    for (const listener of listeners) listener();
  }
  function clearHide() {if (hideTimer !== null) timers.clearTimeout(hideTimer); hideTimer = null;}
  const speedText = (value: number) => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MiB/s` : `${Math.round(value / 1024)} KiB/s`;
  const networkMiB = (value: number) => `${(Math.max(0, Number(value) || 0) / 1048576).toFixed(1)} MiB`;
  function renderNetwork() {
    if (!network.count) {
      publish({networkActive: false, indeterminate: false, ...(snapshot.networkOwned ? {hidden: true, networkOwned: false} : {})}); return;
    }
    const current = [...network.active].reverse().find(task => task.phase === 'receiving' && task.loaded > 0) || network.active.at(-1);
    if (!current) return;
    const elapsed = Math.max((now() - current.startedAt) / 1000, .1), instant = current.loaded / elapsed;
    const known = network.total > 0, currentKnown = current.total > 0;
    publish({hidden: false, networkActive: true, networkOwned: true,
      title: current.title || t('transfer.serverRequesting'), label: network.count > 1 ? `${current.label}  +${network.count - 1}` : current.label,
      amount: known ? `${networkMiB(network.loaded)} / ${networkMiB(network.total)}` : current.phase === 'requesting' ? t('transfer.waitingServer')
        : current.loaded > 0 ? t('transfer.received', {amount: networkMiB(current.loaded)}) : t('transfer.receiving'),
      barWidth: known ? `${Math.min(100, network.loaded / network.total * 100).toFixed(1)}%`
        : currentKnown ? `${Math.min(100, current.loaded / current.total * 100).toFixed(1)}%` : '34%',
      indeterminate: !known && !currentKnown, speedText: current.phase === 'requesting' ? t('transfer.waiting') : speedText(instant),
      etaText: currentKnown && instant > 1024 ? transferClock((current.total - current.loaded) / instant) : t('transfer.requestCount', {count: network.count}),
      warningVisible: false, retryVisible: false});
  }
  function hide() {
    if (disposed) return;
    if (network.count > 0) {renderNetwork(); return;}
    clearHide(); speed = 0;
    publish({hidden: true, networkOwned: false, indeterminate: false, warningVisible: false, retryVisible: false,
      debugVisible: false, debugText: '', kind: '', mode: ''});
  }
  function hideLater() {if (disposed) return; clearHide(); hideTimer = timers.setTimeout(hide, 2200);}
  function show(message: TransferPresentation) {
    if (disposed) return;
    ports.noteGameDataTransfer?.(message); clearHide();
    const loaded = Number(message.loaded) || 0, total = Number(message.total) || 0, instant = Number(message.speed) || 0;
    const mode = message.mode ?? ''; if (snapshot.mode !== mode) speed = 0;
    speed = speed ? speed * .72 + instant * .28 : instant;
    const profile = mode === 'ogg' ? {title: t('transfer.musicDownloading'), label: t('transfer.oggMusic')}
      : mode === 'language' ? {title: t('transfer.languageDownloading'), label: t('transfer.language')}
        : {title: t('transfer.loading'), label: t('transfer.gameResources')};
    publish({hidden: false, networkOwned: false, indeterminate: !!message.indeterminate || (!!message.phase && !Number(message.total)),
      kind: message.kind || (mode === 'ogg' ? 'music' : 'game'), mode, title: message.title || profile.title, label: message.label || profile.label,
      amount: message.phase === 'requesting' && !total ? t('transfer.waitingServer') : message.phase === 'preparing' && !total ? message.statusText || t('transfer.preparing')
        : total ? `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB` : loaded ? `${(loaded / 1048576).toFixed(1)} MiB` : t('transfer.requesting'),
      barWidth: total ? `${Math.min(100, loaded / total * 100).toFixed(1)}%` : message.phase ? '34%' : '0%',
      speedText: message.phase === 'requesting' ? t('transfer.waiting') : message.phase === 'preparing' ? t('transfer.preparingShort') : speedText(speed),
      etaText: total && speed > 1024 ? transferClock((total - loaded) / speed) : '--:--'});
  }
  function runtimeTransfer(message: unknown) {show(transferPresentation(message));}
  function musicFailure(failed = 1) {
    if (disposed || context().launched) return;
    publish({hidden: false, kind: 'music', warningVisible: true, warningText: t('transfer.oggFailed', {count: failed || 1}), retryVisible: true});
  }
  function musicComplete(message: unknown) {
    show({...transferPresentation(message), mode: 'ogg', speed: 0});
    publish({title: t('transfer.musicComplete'), warningVisible: false, retryVisible: false}); hideLater();
  }
  function localComplete() {publish({title: t('transfer.musicReady'), warningVisible: false, retryVisible: false}); hideLater();}
  function localProgress(progress: RuntimeLocalResourceProgress) {
    if (disposed || progress.epoch !== context().epoch) return;
    local = progress;
    show({kind: 'music', mode: 'ogg', title: t('transfer.musicPreparing'), label: t('transfer.localOgg'),
      loaded: progress.loaded, total: progress.total, speed: progress.speed, files: progress.files});
    if (progress.phase === 'remaining' && progress.completed >= progress.files && progress.files > 0) localComplete();
  }
  function midiFallback() {
    if (disposed) return;
    if (midiTimer !== null) timers.clearTimeout(midiTimer); if (midiFrame !== null) frames.cancel(midiFrame);
    publish({midiNoticeVisible: false});
    midiFrame = frames.request(() => {
      midiFrame = null; if (disposed) return;
      publish({midiNoticeVisible: true, midiNoticeRevision: snapshot.midiNoticeRevision + 1});
      midiTimer = timers.setTimeout(() => {midiTimer = null; publish({midiNoticeVisible: false});}, 2000);
    });
  }
  function playerDebug(value: unknown) {
    if (disposed || !context().iosWebKitTouch) return;
    const debug = record(record(value).debug);
    const lines = ['EAGLER-RUNTIME/1 debug', `note=${debug.note || ''}`, `stage=${debug.stage || ''}`, `nav=${debug.nav || ''}`,
      `load=${debug.loadSeen ? 'yes' : 'no'} hostReady=${debug.hostReadySeen ? 'yes' : 'no'}`,
      `readyState=${debug.readyState || '-'} document=${debug.documentPresent ? 'yes' : 'no'}`, `mount=${debug.mountType || '-'}`,
      `iframe=${debug.iframeSrc || '-'}`, `href=${debug.href || '-'}`];
    if (debug.lastError) lines.push(`error=${debug.lastError}`); if (debug.lastRejection) lines.push(`rejection=${debug.lastRejection}`);
    publish({debugVisible: true, debugText: lines.join('\n')});
  }
  function languageFailure(label: string, error: unknown) {
    publish({hidden: false, kind: 'language', title: t('transfer.languageFailed'), label: label || t('transfer.language'),
      warningVisible: true, warningText: t('transfer.languageFailedDetail', {reason: preparationErrorText(error)}), retryVisible: false});
  }
  return Object.freeze({
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => snapshot,
    runtimeTransfer, musicFailure, musicComplete, localProgress, languageFailure, hide, playerDebug, midiFallback,
    revealGameData() {publish({hidden: false, kind: 'game'});},
    runtimeEvent(message: RuntimeEventMessage) {
      if (disposed || message.epoch !== context().epoch) return;
      if (message.event === 'transfer') runtimeTransfer(message);
      else if (message.event === 'music-error' || message.event === 'music-incomplete') musicFailure(Number(message.failed) || 1);
      else if (message.event === 'music-complete') musicComplete(message);
      else if (message.event === 'midi-fallback') midiFallback();
      else if (message.event === 'player-debug') playerDebug(message);
      else if (message.event === 'ready' && snapshot.kind === 'game') hide();
    },
    beginRuntime(plan: Readonly<RuntimePlan>) {
      if (disposed) return;
      local = null;
      ports.playerStatus(t(plan.generation ? 'runtime.preparingLocal' : 'runtime.loadingGameData'));
      show({kind: 'game', mode: 'runtime', title: t(plan.generation ? 'runtime.preparingLocal' : 'runtime.requestingComponent'),
        label: t(plan.generation ? 'runtime.localGameLabel' : 'runtime.requestingComponentLabel', {game: plan.game.toUpperCase()}),
        phase: plan.generation ? 'preparing' : 'requesting', indeterminate: true});
    },
    networkSnapshot(next: NetworkActivitySnapshot) {
      if (disposed) return; network = next;
      if (networkFrame !== null) return;
      networkFrame = frames.request(() => {networkFrame = null; if (!disposed) renderNetwork();});
    },
    preparationProgress(progress: PreparationProgress) {
      if (disposed) return;
      // Main 6068–6145 reports language requests/bytes only in the transfer
      // surface. Keep the Player's native-ready status until configure begins.
      if (progress.stage !== 'language' && progress.message) ports.playerStatus(progress.message);
      if (progress.presentation) {
        if (progress.stage === 'language') publish({warningVisible: false, retryVisible: false});
        show(progress.presentation);
      }
      if (progress.completion === 'language') {publish({title: t('language.downloadComplete')}); hideLater();}
      else if (progress.completion === 'local-music') localComplete();
      if (progress.failure?.kind === 'language') languageFailure(progress.failure.label, progress.failure.reason);
    },
    launchAcknowledged() {if (!disposed && local?.epoch === context().epoch && local.completed >= local.files && local.files > 0) localComplete();},
    localFailure(error: unknown, epoch = context().epoch) {if (epoch !== context().epoch || disposed) return; hide(); ports.toast(t('transfer.localOggPartialFailed', {reason: preparationErrorText(error)}));},
    setCancellation(label: string | null) {publish({cancelVisible: label !== null, cancelLabel: label || t('player.cancelDownload')});},
    async cancel() {if (!disposed && snapshot.cancelVisible) {publish({cancelVisible: false}); await ports.cancelDownload();}},
    async retry() {
      if (disposed) return; const epoch = context().epoch;
      publish({retryVisible: false, warningText: t('transfer.retryingOgg')});
      try {await ports.retryMusic(30 * 60 * 1000);}
      catch (error) {if (!disposed && epoch === context().epoch) {musicFailure(1); ports.playerStatus(preparationErrorText(error));}}
    },
    dispose() {
      if (disposed) return; disposed = true; clearHide();
      if (midiTimer !== null) timers.clearTimeout(midiTimer);
      if (networkFrame !== null) frames.cancel(networkFrame); if (midiFrame !== null) frames.cancel(midiFrame);
      listeners.clear();
    },
  });
}
export type TransferModel = ReturnType<typeof createTransferModel>;
