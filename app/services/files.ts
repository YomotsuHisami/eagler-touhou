import {gameIdForProduct, isMultiplayerProductId, PRODUCT_GAMES, type ProductId} from '../../src/contracts/product-catalog.mts';
import * as replay from '../../src/launcher/replay-files.mts';
import type {RuntimeResponseMessage} from '../../src/contracts/runtime-protocol.mts';
import type {RuntimeService, RuntimeFileSession} from './runtime';
import type {SettingsDecision, SettingsFileAction} from '../components/settings/types';

export type ImportFileKind = 'save' | 'replay' | 'hint';
export interface ImportContext {
  /** Reject acquisition of a gameplay/startup Runtime owned by a newer accepted intent. */
  assertRuntimeOwnership(): void;
  /** Optional host presentation owner, captured before Replay queueing. */
  ownsPresentation?: () => boolean;
  complete(): void;
}
export interface FileActionsOptions {
  runtime: RuntimeService;
  prepareFiles(product: ProductId, options?: {retireRunning?: boolean; ownsPresentation?: () => boolean}): Promise<void>;
  /** Release only a temporary file Runtime, after its exclusive operation ends. */
  releasePrepared(product: ProductId): Promise<void>;
  translate(key: string, params?: Record<string, string | number>): string;
  confirm(decision: SettingsDecision): Promise<boolean>;
  pickFile(accept: string): Promise<File | null>;
  download(name: string, bytes: ArrayBuffer, mime: string): void;
  feedback: {toast(message: string): void; status(message: string): void; playerStatus(message: string): void};
  replayManager: {open(product: ProductId): Promise<void>; refresh(): Promise<void>; isOpen(): boolean; close(): void};
  /** Same queue used by the Replay manager's rename/delete actions. */
  replayMutations: replay.ReplayMutationQueue;
  /** Capture ownership, presentation and completion together before queueing.
   * Assertions guard native acquisition; presentation is passed through preparation
   * without cancelling file work. complete() runs only after successful import
   * retirement and the following Replay-manager update. */
  captureImportContext(product: ProductId): ImportContext;
}
const maxImportBytes = 128 * 1024 * 1024;
const maxStoredFileBytes = 64 * 1024 * 1024;
const maxReplayArchiveExpandedBytes = 128 * 1024 * 1024;
function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && !Array.isArray(error) && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error ?? '');
}
function copyBuffer(bytes: Uint8Array): ArrayBuffer {const copy = new Uint8Array(bytes.length); copy.set(bytes); return copy.buffer;}

/** Original main file flows. Native Runtime remains the only IDBFS writer. */
export function createFileActions(options: FileActionsOptions) {
  const {runtime, translate: t, feedback} = options;
  function bytes(response: RuntimeResponseMessage): number[] {
    if (!Array.isArray(response.bytes) || !response.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error(t('runtime.invalidFileContent'));
    return response.bytes as number[];
  }
  function listing(response: RuntimeResponseMessage): {path: string; size: number}[] {
    if (!Array.isArray(response.files)) throw new Error(t('runtime.invalidFileList'));
    return response.files.map(value => {
      if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string' || !value.path) throw new Error(t('runtime.invalidFileEntry'));
      return {path: value.path, size: Math.max(0, Number('size' in value ? value.size : 0) || 0)};
    });
  }
  function hints(product: ProductId): readonly string[] {
    const storage = PRODUCT_GAMES[gameIdForProduct(product)].storage;
    return 'hintFiles' in storage ? storage.hintFiles : [];
  }
  function prefix(product: ProductId): string {
    const value = PRODUCT_GAMES[gameIdForProduct(product)].replay?.prefix;
    if (!value) throw new Error(t('replay.unsupported'));
    return value;
  }
  function sessionOptions(product: ProductId) {
    return {runtimeVariant: isMultiplayerProductId(product) ? 'multiplayer' as const : 'normal' as const};
  }
  async function exportFiles(kind: 'save' | 'replay', product: ProductId): Promise<void> {
    const game = gameIdForProduct(product);
    const label = t(kind === 'save' ? 'file.kind.save' : 'file.kind.replay');
    const wasReady = runtime.getSnapshot().ready;
    feedback.toast(t('file.exportPreparing', {kind: label}));
    try {
      await options.prepareFiles(product);
      feedback.playerStatus(t('file.exporting', {kind: label}));
      await runtime.withFileSession(game, async access => {
        await access.sync();
        if (kind === 'save') {
          const path = PRODUCT_GAMES[game].storage.scoreFile;
          options.download(path, copyBuffer(new Uint8Array(bytes(await access.send('read', {path})))), 'application/octet-stream');
        } else {
          const zip = await import('fflate');
          // listReplayStorageFiles in main also flushes before listing.
          await access.sync();
          const stored = listing(await access.send('list', {}));
          const paths = replay.selectReplayExportPaths(stored.map(file => file.path));
          if (!paths.some(replay.isReplayFilePath)) throw new Error(t('file.noReplayToExport'));
          const byPath = new Map(stored.map(file => [file.path.toLowerCase(), file]));
          const entries: Record<string, Uint8Array> = {};
          for (const path of paths) {
            const file = byPath.get(path.toLowerCase());
            if (file) entries[file.path] = new Uint8Array(bytes(await access.send('read', {path: file.path})));
          }
          options.download(`${game}-replay-${new Date().toISOString().slice(0, 10)}.zip`, copyBuffer(zip.zipSync(entries, {level: 1})), 'application/zip');
        }
      }, {...sessionOptions(product), readOnly: true});
      if (!wasReady) await options.releasePrepared(product);
      feedback.toast(t('file.exportDownloadStarted', {kind: label}));
      feedback.playerStatus(t('file.exported', {kind: label}));
    } catch (error) {
      if (!wasReady) await options.releasePrepared(product);
      const missingSave = kind === 'save' && error !== null && typeof error === 'object' && 'errno' in error && error.errno === 44;
      const missingReplay = kind === 'replay' && message(error) === t('file.noReplayToExport');
      if (missingSave || missingReplay) {
        if (await options.confirm({message: t(missingSave ? 'file.missingSavePrompt' : 'file.missingReplayPrompt'), confirmText: t('file.selectImport')})) {
          const file = await options.pickFile(missingSave ? '.dat' : replay.replayImportAccept);
          if (file) await importFile(missingSave ? 'save' : 'replay', file, product);
        }
        return;
      }
      feedback.toast(t('file.exportFailed', {kind: label, reason: message(error)}));
      throw error;
    }
  }
  async function importExclusive(kind: ImportFileKind, file: File, product: ProductId, context: ImportContext): Promise<void> {
    if (!file.size) throw new Error(t('file.emptyImport'));
    if (file.size > maxImportBytes) throw new Error(t('file.importTooLarge'));
    // A queued import cannot consume a newer Player's Runtime while retaining an
    // older presentation callback. Check before preparation can close an owner,
    // and again after its acquisition await, immediately before the file lock.
    context.assertRuntimeOwnership();
    await options.prepareFiles(product, {retireRunning: kind !== 'replay', ...(context.ownsPresentation ? {ownsPresentation: context.ownsPresentation} : {})});
    context.assertRuntimeOwnership();
    feedback.playerStatus(t('file.importing'));
    let count = 0;
    await runtime.withFileSession(gameIdForProduct(product), async initial => {
      let access: RuntimeFileSession = initial;
      let files: {path: string; bytes: Uint8Array}[];
      const lowerName = file.name.toLowerCase();
      if (kind === 'save' && lowerName.endsWith('.dat')) {
        files = [{path: PRODUCT_GAMES[gameIdForProduct(product)].storage.scoreFile, bytes: new Uint8Array(await file.arrayBuffer())}];
      } else if (kind === 'hint' && lowerName.endsWith('.txt') && hints(product).length) {
        if (file.size > 16 * 1024 * 1024) throw new Error(t('file.hintTooLarge'));
        files = [{path: hints(product)[0]!, bytes: new Uint8Array(await file.arrayBuffer())}];
      } else if (kind === 'replay' && /\.rpyx?$/.test(lowerName)) {
        const existing = listing(await access.send('list', {})).map(item => item.path);
        const name = replay.allocateReplayName(prefix(product), existing, file.name);
        if (!name) throw new Error(t('file.replaySlotsExhausted'));
        files = [{path: `replay/${name}`, bytes: new Uint8Array(await file.arrayBuffer())}];
      } else if (kind === 'replay' && lowerName.endsWith('.zip')) {
        const zip = await import('fflate');
        const guard = replay.createReplayArchiveExtractionGuard({maxFileBytes: maxStoredFileBytes, maxExpandedBytes: maxReplayArchiveExpandedBytes});
        let archive: Record<string, Uint8Array>;
        try {archive = zip.unzipSync(new Uint8Array(await file.arrayBuffer()), {filter: guard.filter});}
        catch (error) {
          if (error instanceof replay.ReplayArchiveScanError) throw new Error(t(error.reason === 'unsafe-path' ? 'file.zipUnsafePath' : error.reason === 'duplicate-path' ? 'file.zipDuplicatePath' : error.reason === 'file-too-large' ? 'file.importStoredTooLarge' : 'file.importArchiveExpandedTooLarge'));
          throw error;
        }
        const existing = listing(await access.send('list', {})).map(item => item.path);
        const plan = replay.planReplayArchiveImport(prefix(product), guard.paths, existing);
        if (!plan.ok) throw new Error(t(plan.reason === 'unsafe-path' ? 'file.zipUnsafePath' : plan.reason === 'duplicate-path' ? 'file.zipDuplicatePath' : 'file.replaySlotsExhausted'));
        files = plan.entries.map(entry => ({path: entry.targetPath, bytes: archive[entry.sourcePath]}));
      } else throw new Error(t(kind === 'save' ? 'file.chooseSave' : kind === 'hint' ? 'file.chooseHint' : 'file.chooseReplay'));
      if (!files.length) throw new Error(t('file.importNoFiles'));
      if (new Set(files.map(item => item.path.toLowerCase())).size !== files.length) throw new Error(t('file.importDuplicatePaths'));
      if (files.some(item => item.bytes.length > maxStoredFileBytes)) throw new Error(t('file.importStoredTooLarge'));
      for (const item of files) await access.send('write', {path: item.path, bytes: Array.from(item.bytes)});
      if (kind !== 'replay') {
        access = await access.restart({sync: false});
        const expected = files[0].bytes;
        const actual = new Uint8Array(bytes(await access.send('read', {path: files[0].path})));
        if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) throw new Error(t('file.saveVerifyFailed'));
      }
      count = files.length;
      await access.retire();
    }, {...sessionOptions(product), replayMutation: kind === 'replay'});
    if (kind === 'replay' && options.replayManager.isOpen()) await options.replayManager.refresh();
    else if (options.replayManager.isOpen()) options.replayManager.close();
    context.complete();
    feedback.toast(t('file.importedRestart', {count}));
    feedback.status(t('file.importedRestart', {count}));
  }
  function importFile(kind: ImportFileKind, file: File, product: ProductId): Promise<void> {
    const context = options.captureImportContext(product);
    return kind === 'replay' ? options.replayMutations.run(() => importExclusive(kind, file, product, context)) : importExclusive(kind, file, product, context);
  }
  async function deleteHint(product: ProductId): Promise<void> {
    const paths = hints(product);
    if (!paths.length) return;
    await options.prepareFiles(product, {retireRunning: true});
    try {
      await runtime.withFileSession(gameIdForProduct(product), async access => {
        const stored = listing(await access.send('list', {})).map(file => file.path);
        for (const path of paths) if (stored.includes(path)) await access.send('remove', {path});
        const reopened = await access.restart({sync: false});
        const remaining = listing(await reopened.send('list', {})).map(file => file.path);
        if (paths.some(path => remaining.includes(path))) throw new Error(t('file.hintDeleteVerifyFailed'));
        feedback.toast(t('file.hintDeleted')); feedback.status(t('file.hintDeleted'));
      }, sessionOptions(product));
    } finally {await options.releasePrepared(product);}
  }
  async function run(action: SettingsFileAction, product: ProductId): Promise<void> {
    try {
      if (action === 'manage-replay') await options.replayManager.open(product);
      else if (action === 'delete-hint') await deleteHint(product);
      else if (action === 'export-save' || action === 'export-replay') await exportFiles(action === 'export-save' ? 'save' : 'replay', product);
      else {
        const kind = action === 'import-save' ? 'save' : 'hint';
        if (kind === 'save' && !await options.confirm({message: t('file.importSaveOverwrite'), confirmText: t('file.continueImport'), tone: 'danger'})) return;
        const file = await options.pickFile(kind === 'hint' ? '.txt' : '.dat');
        if (file) await importFile(kind, file, product);
      }
    } catch (error) {
      const reason = message(error);
      feedback.playerStatus(reason); feedback.status(t('status.errorReason', {reason})); feedback.toast(t('status.errorReason', {reason}));
    }
  }
  return {run, importFile};
}
