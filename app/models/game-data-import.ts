import {gameIdForProduct, type ProductId} from '../../src/contracts/product-catalog.mts';
import {createGameDataContinuation, gameDataContinuationMatches, type GameDataContinuation} from '../../src/launcher/launcher-lifecycle.mts';
import type {Translate} from '../i18n';
import {isGameDataAcquisitionFailure} from '../services/game-data-acquisition';
import {preparationErrorText, type PackageAcquisition} from '../services/package-acquisition';

export interface GameDataImportContext {
  product: ProductId;
  roomCode: string | null;
  replayViewer: boolean;
  runtimeReady: boolean;
  launched: boolean;
  playerOpen: boolean;
  importServer: boolean;
  /** Already validated Host fallback; no URL is invented by this model. */
  fallback: {url: string; hint?: string} | null;
}
export interface GameDataImportAttempt {
  id: number;
  firstByte: boolean;
  downloadComplete: boolean;
  unlocked: boolean;
  dialogDismissed: boolean;
  importFlow: boolean;
  manual: boolean;
  continuation?: GameDataContinuation;
}
export interface GameDataImportSnapshot {
  attempt: Readonly<GameDataImportAttempt> | null;
  importOpen: boolean;
  linkOpen: boolean;
  busy: boolean;
  busyText: string;
  reason: string;
  fallback: Readonly<{url: string; hint?: string}> | null;
  /** Main openGameDataImportWindow / transferDownload presentation event. */
  presentationRevision: number;
  revision: number;
}
export interface GameDataRoomImportHandle {
  markImporting(): void;
  /** No effect if this room/preparation is no longer the current importing one. */
  cancelIfImporting(): void;
  /** Resumes the original room preparation, not gameplay. */
  resume(): Promise<void>;
}
export interface GameDataImportPorts {
  pickFile(options: {accept: string}): Promise<(Blob & {name?: string}) | null>;
  closePlayer(): Promise<boolean>;
  resetUnlaunchedRuntime(): void | Promise<void>;
  openPlayer(product: ProductId): void;
  /** Internal configured launch, with its own failure presentation. Does not
   * repeat the launcher click's warnings or automatic fullscreen request. */
  launchConfigured(): Promise<void>;
  feedback: {status(message: string): void; playerStatus(message: string): void; toast(message: string): void};
  roomPreparationForImport?(continuation: GameDataContinuation | undefined): GameDataRoomImportHandle | null;
  /** The document's existing blocking-operation owner supplies cancellation.
   * This model never creates another network tracker or native Runtime owner. */
  beginBlockingDownload(options: {label: string; onCancel(): Promise<void>}): {finish(): void; cancel(): Promise<void>};
  onActivityChange?(): void;
  /** Main unlockGameDataImport keeps existing metrics but reveals GAME DATA. */
  showGameDataTransfer?(): void;
}
export interface GameDataImportTimers {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}
export interface BeginManualGameDataImport {
  reason?: string;
  kind?: 'install-only' | 'launch';
  continuation?: GameDataContinuation;
  useReasonVerbatim?: boolean;
}

/** Main 1588–1605, 3318–3488 and 9643–9740. Plain document-lived model:
 * no DOM, route mutation, permissions, Runtime transport, or private store. */
export function createGameDataImportModel({acquisition, translate: t, getContext, ports,
  timers = {setTimeout, clearTimeout}}: {
  acquisition: Pick<PackageAcquisition, 'importPackage'>;
  translate: Translate;
  getContext(): GameDataImportContext;
  ports: GameDataImportPorts;
  timers?: GameDataImportTimers;
}) {
  const listeners = new Set<() => void>();
  let disposed = false, serial = 0, revision = 0, presentationRevision = 0, attempt: GameDataImportAttempt | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null, completeTimer: ReturnType<typeof setTimeout> | null = null;
  let blocking: ReturnType<GameDataImportPorts['beginBlockingDownload']> | null = null;
  let importOpen = false, linkOpen = false, busy = false, busyText = '', reason = '';
  let snapshot: GameDataImportSnapshot;
  function publish() {
    if (disposed) return;
    const fallback = getContext().fallback;
    snapshot = Object.freeze({attempt: attempt ? Object.freeze({...attempt}) : null,
      importOpen, linkOpen, busy, busyText, reason, fallback: fallback ? Object.freeze({...fallback}) : null, presentationRevision, revision: ++revision});
    for (const listener of listeners) listener();
    ports.onActivityChange?.();
  }
  function clearTimers() {
    if (startTimer !== null) timers.clearTimeout(startTimer);
    if (completeTimer !== null) timers.clearTimeout(completeTimer);
    startTimer = null; completeTimer = null;
  }
  function clear() {
    clearTimers(); const owned = blocking; blocking = null; owned?.finish();
    attempt = null; importOpen = false; linkOpen = false; busy = false; publish();
  }
  function capture(kind: 'install-only' | 'launch') {return createGameDataContinuation({kind, ...getContext()});}
  function available() {return !disposed && !!attempt?.unlocked && !getContext().runtimeReady;}
  function openImport() {
    if (!available()) return;
    attempt!.dialogDismissed = false; importOpen = true; presentationRevision++; publish();
  }
  function fallbackReason(value: string) {return t(getContext().importServer ? 'package.importServerOnly' : 'package.fallbackWaitOrImport', {reason: value});}
  function beginManual(options: BeginManualGameDataImport = {}) {
    if (disposed) return;
    clear();
    attempt = {id: ++serial, firstByte: false, downloadComplete: false, unlocked: true, dialogDismissed: false,
      importFlow: true, manual: true, continuation: options.continuation ?? capture(options.kind ?? 'install-only')};
    const value = options.reason ?? t('package.manualCancelledReason');
    reason = options.useReasonVerbatim ? value : t('package.manualImportReason', {reason: value});
    if (available()) openImport(); else publish();
  }
  function beginImportRequired(value = t('package.noLaunchableLocal')) {
    if (disposed) return;
    clear(); attempt = {id: ++serial, firstByte: false, downloadComplete: false, unlocked: true, dialogDismissed: false,
      importFlow: true, manual: false, continuation: capture('launch')};
    reason = fallbackReason(value); if (available()) openImport(); else publish();
  }
  function unlock(value: string) {
    if (!attempt || disposed || getContext().runtimeReady || attempt.id !== serial) return;
    const first = !attempt.unlocked; attempt.unlocked = true; reason = fallbackReason(value);
    ports.showGameDataTransfer?.();
    if (first && !attempt.dialogDismissed) openImport();
    else publish();
  }
  async function closeOrReset() {
    return getContext().playerOpen ? ports.closePlayer() : (await ports.resetUnlaunchedRuntime(), true);
  }
  async function cancelledDirectDownload() {
    if (disposed) return;
    const continuation = capture('launch');
    if (!await closeOrReset() || disposed || !gameDataContinuationMatches(continuation, getContext())) return;
    beginManual({continuation}); ports.feedback.status(t('package.downloadCancelledImport'));
  }
  function beginDirectDownload() {
    if (disposed) return;
    clear(); const id = ++serial;
    attempt = {id, firstByte: false, downloadComplete: false, unlocked: false, dialogDismissed: false, importFlow: false, manual: false};
    blocking = ports.beginBlockingDownload({label: t('player.cancelDownload'), onCancel: cancelledDirectDownload});
    startTimer = timers.setTimeout(() => {
      if (attempt?.id === id && !attempt.firstByte) unlock(t('package.firstByteTimeout'));
    }, 10_000);
    completeTimer = timers.setTimeout(() => {
      if (attempt?.id === id && !attempt.downloadComplete && !getContext().runtimeReady) {
        unlock(t(attempt.firstByte ? 'package.downloadSlow' : 'package.downloadStartTimeout'));
      }
    }, 20_000);
    publish();
  }
  function noteTransfer(message: {kind?: string; mode?: string; loaded?: number; total?: number}) {
    if (disposed || !attempt || attempt.id !== serial || getContext().runtimeReady) return;
    if ((message.kind || (message.mode === 'ogg' ? 'music' : 'game')) !== 'game') return;
    const loaded = Number(message.loaded) || 0, total = Number(message.total) || 0;
    if (loaded > 0 && !attempt.firstByte) {
      attempt.firstByte = true; if (startTimer !== null) timers.clearTimeout(startTimer); startTimer = null;
    }
    if (total > 0 && loaded >= total && !attempt.downloadComplete) {
      attempt.downloadComplete = true; if (completeTimer !== null) timers.clearTimeout(completeTimer); completeTimer = null;
    }
    publish();
  }
  async function importFile(file: (Blob & {name?: string}) | null) {
    if (!file || !available() || busy) return;
    const id = attempt!.id, game = gameIdForProduct(getContext().product);
    const roomImport = ports.roomPreparationForImport?.(attempt!.continuation) ?? null;
    busy = true; busyText = t(roomImport ? 'package.importingSimple' : 'package.importing');
    roomImport?.markImporting(); publish();
    try {
      const imported = await acquisition.importPackage({game, file, onProgress(progress) {
        if (!disposed && attempt?.id === id) ports.feedback.playerStatus(progress.message);
      }});
      if (disposed || attempt?.id !== id) return;
      ports.feedback.toast(t('package.imported', {count: Object.keys(imported.files).length}));
      if (attempt.importFlow && !getContext().launched) {
        const continuation = attempt.continuation;
        const preparedRoom = ports.roomPreparationForImport?.(continuation) ?? null;
        clear();
        if (preparedRoom) {ports.feedback.status(t('package.continuing')); void preparedRoom.resume(); return;}
        if (gameDataContinuationMatches(continuation, getContext())) {
          ports.feedback.playerStatus(t('package.continuing')); await ports.resetUnlaunchedRuntime();
          if (disposed || !gameDataContinuationMatches(continuation, getContext())) return;
          ports.openPlayer(getContext().product); await ports.launchConfigured(); return;
        }
        ports.feedback.status(t('package.importedReady')); publish(); return;
      }
      if (getContext().runtimeReady) {ports.feedback.playerStatus(t('package.readyNextLaunch')); return;}
      if (attempt?.id !== id) return;
      const continuation = capture('launch');
      ports.feedback.playerStatus(t('package.localLaunching')); clear(); await ports.resetUnlaunchedRuntime();
      if (disposed || !gameDataContinuationMatches(continuation, getContext())) return;
      await ports.launchConfigured();
    } catch (error) {
      // Once an import is committed and its attempt cleared, any continuation
      // failure belongs to the launch/room owner, never to "invalid ZIP" UI.
      if (disposed || attempt?.id !== id) return;
      roomImport?.cancelIfImporting();
      const message = preparationErrorText(error); ports.feedback.playerStatus(message);
      const storageFailure = /IndexedDB|存储|写入|配额|quota|浏览器已清理|持久化/i.test(message);
      reason = t(getContext().importServer ? 'package.importServerMissing' : storageFailure ? 'package.importStorageFailed' : 'package.importInvalid', {reason: message});
      openImport(); ports.feedback.toast(message);
    } finally {
      if (!disposed && (!attempt || attempt.id === id)) {busy = false; publish();}
    }
  }
  async function handleLaunchFailure(error: unknown): Promise<boolean> {
    if (disposed || getContext().launched) return false;
    const message = preparationErrorText(error);
    if (message === 'EAGLER_RUNTIME_SESSION_SUPERSEDED') return false;
    const cancelled = error && typeof error === 'object' && 'name' in error && error.name === 'AbortError' || /已取消下载/.test(message);
    if (!cancelled && !isGameDataAcquisitionFailure(error)) return false;
    const captured = capture('launch');
    if (!await closeOrReset() || disposed || !gameDataContinuationMatches(captured, getContext())) return true;
    if (cancelled) {beginManual(); ports.feedback.status(t('package.downloadCancelledImport')); return true;}
    if (getContext().importServer) {
      beginImportRequired(message); ports.feedback.status(message); ports.feedback.toast(message); return true;
    }
    beginManual({reason: t('package.resourceFailureLocal'), continuation: captured, useReasonVerbatim: true});
    ports.feedback.status(t('package.resourceFailureStatus')); return true;
  }
  publish();
  return Object.freeze({
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => snapshot,
    refresh: publish, clear, finish: clear, beginManual, beginImportRequired, beginDirectDownload, noteTransfer, unlock,
    openManual() {beginManual({reason: t('package.manualImportIntro')});},
    openImport,
    dismissImport() {if (busy) return; importOpen = false; linkOpen = false; if (attempt) attempt.dialogDismissed = true; publish();},
    openLink() {if (available() && !busy && getContext().fallback) {linkOpen = true; presentationRevision++; publish();}},
    closeLink() {linkOpen = false; publish();},
    async chooseFile() {
      if (!available() || busy) return;
      const id = attempt!.id, file = await ports.pickFile({accept: '.zip,.dat,application/zip'});
      if (!disposed && attempt?.id === id) await importFile(file);
    },
    importFile, handleLaunchFailure,
    async cancelDirectDownload() {await blocking?.cancel();},
    dispose() {if (disposed) return; clear(); disposed = true; listeners.clear();},
  });
}
export type GameDataImportModel = ReturnType<typeof createGameDataImportModel>;
