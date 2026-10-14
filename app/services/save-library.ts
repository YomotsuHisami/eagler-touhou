import {gameIdForProduct, type ProductId} from '../../src/contracts/product-catalog.mts';
import {MAX_SCORE_BYTES, parseScoreDat} from '../../src/launcher/score-dat.mts';
import {supportsScore} from './score-storage';

export const SAVE_LIBRARY_DATABASE = 'eagler-touhou-save-library-v1';
export const MAX_SAVED_ARCHIVES = 20;
export type SaveLibraryErrorCode = 'unsupported' | 'invalid' | 'storage' | 'full' | 'backupFull' | 'name' | 'missing' | 'busy' | 'download' | 'pending' | 'verify' | 'conflict';
export class SaveLibraryError extends Error {
  constructor(public readonly code: SaveLibraryErrorCode) {super(code);}
}
export interface SaveArchive {
  id: string;
  product: ProductId;
  name: string;
  filename: string;
  bytes: Uint8Array;
  created: number;
  revision?: number;
  updated?: number;
}
export interface SaveBackup {
  id: string; product: ProductId; archiveId: string; archiveName: string;
  bytes: Uint8Array | null; archiveBytes: Uint8Array; created: number;
  edition: 'jp' | 'chs' | null;
}
export interface SaveRun {
  id: string; archiveId: string; revision: number;
  edition: SaveBackup['edition']; stage: 'applying' | 'running' | 'pending';
}
export interface SaveBinding {product: ProductId; selectedId: string | null; run: SaveRun | null;}
const cleanName = (name: string) => name.trim();
function validateName(name: string) {
  const value = cleanName(name);
  if (!value || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) throw new SaveLibraryError('name');
  return value;
}
function validateProduct(product: ProductId) {if (!supportsScore(product)) throw new SaveLibraryError('unsupported');}
export function sameSaveBytes(left: Uint8Array, right: Uint8Array) {return left.length === right.length && left.every((byte, index) => byte === right[index]);}
function record(value: unknown, product: ProductId): SaveArchive {
  const row = value as SaveArchive;
  if (!row || row.product !== product || typeof row.id !== 'string' || typeof row.filename !== 'string' || typeof row.name !== 'string' || !Number.isFinite(row.created) || !(row.bytes instanceof Uint8Array) || !row.bytes.length || row.bytes.length > MAX_SCORE_BYTES) throw new SaveLibraryError('storage');
  validateName(row.name);
  if (row.revision !== undefined && (!Number.isInteger(row.revision) || row.revision < 0) || row.updated !== undefined && !Number.isFinite(row.updated)) throw new SaveLibraryError('storage');
  return {...row, bytes: new Uint8Array(row.bytes)};
}

/** This database stores independent archive copies. It never accesses IDBFS,
 * launches a Runtime, selects an active save, or applies an archive to a game. */
export function createSaveLibraryStorage(factory: IDBFactory | undefined = globalThis.indexedDB, timeoutMs = 8000) {
  function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void, tx: IDBTransaction) => void, extra: string[] = []): Promise<T> {
    if (!factory) return Promise.reject(new SaveLibraryError('storage'));
    return new Promise((resolve, reject) => {
      let settled = false, db: IDBDatabase | null = null, tx: IDBTransaction | null = null, result: T, completed = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); db?.close();
        if (error || !completed) reject(error instanceof SaveLibraryError ? error : new SaveLibraryError('storage')); else resolve(result);
      };
      const fail = (error: unknown) => {finish(error); try {tx?.abort();} catch {}};
      const timer = setTimeout(() => fail(new SaveLibraryError('storage')), timeoutMs);
      try {
        const request = factory.open(SAVE_LIBRARY_DATABASE, 2);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('archives')) {const store = database.createObjectStore('archives', {keyPath: 'id'}); store.createIndex('product', 'product');}
          if (!database.objectStoreNames.contains('bindings')) database.createObjectStore('bindings', {keyPath: 'product'});
          if (!database.objectStoreNames.contains('backups')) {const store = database.createObjectStore('backups', {keyPath: 'id'}); store.createIndex('product', 'product');}
        };
        request.onerror = request.onblocked = () => fail(new SaveLibraryError('storage'));
        request.onsuccess = () => {
          db = request.result;
          if (settled) {db.close(); return;}
          db.onversionchange = () => db?.close();
          try {
            tx = db.transaction(['archives', ...extra], mode);
            tx.onabort = tx.onerror = () => fail(new SaveLibraryError('storage'));
            tx.oncomplete = () => finish();
            run(tx.objectStore('archives'), value => {result = value; completed = true;}, fail, tx);
          } catch (error) {fail(error);}
        };
      } catch (error) {fail(error);}
    });
  }
  function binding(value: unknown, product: ProductId): SaveBinding {
    if (value === undefined) return {product, selectedId: null, run: null};
    const row = value as SaveBinding;
    if (!row || row.product !== product || !(row.selectedId === null || typeof row.selectedId === 'string') || row.run && (typeof row.run.id !== 'string' || typeof row.run.archiveId !== 'string' || !Number.isInteger(row.run.revision) || !['applying', 'running', 'pending'].includes(row.run.stage) || ![null, 'jp', 'chs'].includes(row.run.edition))) throw new SaveLibraryError('storage');
    return {...row, run: row.run ? {...row.run} : null};
  }
  function copied(bytes: Uint8Array | null) {
    if (bytes === null) return null;
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_SCORE_BYTES) throw new SaveLibraryError('invalid');
    return new Uint8Array(bytes);
  }
  return {
    async state(product: ProductId): Promise<SaveBinding> {
      validateProduct(product);
      return transaction('readonly', (store, done, fail, tx) => {
        const request = tx.objectStore('bindings').get(product);
        request.onsuccess = () => {try {
          if (request.result !== undefined) {done(binding(request.result, product)); return;}
          // A single imported archive is the initial preview/launch choice.
          // Explicitly choosing the current game save persists a null choice.
          const archives = store.index('product').getAll(product, 2);
          archives.onsuccess = () => {try {done({product, selectedId: archives.result.length === 1 ? record(archives.result[0], product).id : null, run: null});} catch (error) {fail(error);}};
        } catch (error) {fail(error);}};
      }, ['bindings']);
    },
    async choose(product: ProductId, id: string | null): Promise<void> {
      validateProduct(product);
      return transaction('readwrite', (store, done, fail, tx) => {
        const rows = tx.objectStore('bindings'), request = rows.get(product);
        request.onsuccess = () => {try {
          if (binding(request.result, product).run) throw new SaveLibraryError('pending');
          const write = () => {rows.put({product, selectedId: id, run: null}); done(undefined);};
          if (id === null) {write(); return;}
          const archive = store.get(id); archive.onsuccess = () => {try {if (!archive.result || archive.result.product !== product) throw new SaveLibraryError('missing'); record(archive.result, product); write();} catch (error) {fail(error);}};
        } catch (error) {fail(error);}};
      }, ['bindings']);
    },
    async begin(product: ProductId, id: string, before: Uint8Array | null, edition: SaveBackup['edition']): Promise<{run: SaveRun; archive: SaveArchive}> {
      validateProduct(product); const beforeBytes = copied(before);
      return transaction('readwrite', (store, done, fail, tx) => {
        const rows = tx.objectStore('bindings'), request = rows.get(product);
        request.onsuccess = () => {try {
          const state = binding(request.result, product);
          if (state.run) throw new SaveLibraryError('pending');
          if (request.result !== undefined && state.selectedId !== id) throw new SaveLibraryError('conflict');
          const archive = store.get(id); archive.onsuccess = () => {try {
            if (!archive.result || archive.result.product !== product) throw new SaveLibraryError('missing');
            const entry = record(archive.result, product); parseScoreDat(gameIdForProduct(product), entry.bytes);
            const backups = tx.objectStore('backups'), count = backups.index('product').count(product);
            count.onsuccess = () => {try {
              if (count.result >= 100) throw new SaveLibraryError('backupFull');
              const run: SaveRun = {id: globalThis.crypto.randomUUID(), archiveId: id, revision: entry.revision ?? 0, edition, stage: 'applying'};
              backups.add({id: run.id, product, archiveId: id, archiveName: entry.name, bytes: beforeBytes, archiveBytes: new Uint8Array(entry.bytes), created: Date.now(), edition} satisfies SaveBackup);
              rows.put({product, selectedId: id, run}); done({run, archive: entry});
            } catch (error) {fail(error);}};
          } catch (error) {fail(error);}};
        } catch (error) {fail(error);}};
      }, ['bindings', 'backups']);
    },
    async stage(product: ProductId, runId: string, stage: SaveRun['stage']): Promise<void> {
      return transaction('readwrite', (_store, done, fail, tx) => {
        const rows = tx.objectStore('bindings'), request = rows.get(product);
        request.onsuccess = () => {try {const state = binding(request.result, product); if (state.run?.id !== runId) throw new SaveLibraryError('conflict'); rows.put({...state, run: {...state.run, stage}}); done(undefined);} catch (error) {fail(error);}};
      }, ['bindings']);
    },
    async complete(product: ProductId, runId: string, bytes: Uint8Array | null): Promise<void> {
      if (bytes) {try {parseScoreDat(gameIdForProduct(product), bytes);} catch {throw new SaveLibraryError('invalid');}}
      const data = copied(bytes);
      return transaction('readwrite', (store, done, fail, tx) => {
        const rows = tx.objectStore('bindings'), request = rows.get(product);
        request.onsuccess = () => {try {
          const state = binding(request.result, product), run = state.run;
          if (run?.id !== runId) throw new SaveLibraryError('conflict');
          const finish = () => {rows.put({...state, run: null}); done(undefined);};
          if (data === null) {finish(); return;}
          const archive = store.get(run.archiveId); archive.onsuccess = () => {try {
            if (!archive.result || archive.result.product !== product) throw new SaveLibraryError('missing');
            const entry = record(archive.result, product);
            if ((entry.revision ?? 0) !== run.revision) throw new SaveLibraryError('conflict');
            store.put({...entry, bytes: data, revision: run.revision + 1, updated: Date.now()}); finish();
          } catch (error) {fail(error);}};
        } catch (error) {fail(error);}};
      }, ['bindings']);
    },
    async backups(product: ProductId): Promise<SaveBackup[]> {
      validateProduct(product);
      return transaction('readonly', (_store, done, fail, tx) => {
        const latest: SaveBackup[] = []; let count = 0;
        const request = tx.objectStore('backups').index('product').openCursor(product);
        request.onsuccess = () => {try {
          const cursor = request.result;
          if (!cursor) {done(latest); return;}
          if (++count > 100) throw new SaveLibraryError('storage');
          const row = cursor.value;
          latest.push({...row, bytes: copied(row.bytes), archiveBytes: copied(row.archiveBytes)!});
          latest.sort((a, b) => b.created - a.created); latest.splice(10); cursor.continue();
        } catch (error) {fail(error);}};
      }, ['backups']);
    },
    async backup(product: ProductId, id: string): Promise<SaveBackup> {
      validateProduct(product);
      return transaction('readonly', (_store, done, fail, tx) => {
        const request = tx.objectStore('backups').get(id);
        request.onsuccess = () => {try {const row = request.result; if (!row || row.product !== product) throw new SaveLibraryError('missing'); done({...row, bytes: copied(row.bytes), archiveBytes: copied(row.archiveBytes)!});} catch (error) {fail(error);}};
      }, ['backups']);
    },
    async list(product: ProductId): Promise<SaveArchive[]> {
      validateProduct(product);
      return transaction('readonly', (store, done, fail) => {
        const request = store.index('product').getAll(product, MAX_SAVED_ARCHIVES + 1);
        request.onsuccess = () => {try {if (request.result.length > MAX_SAVED_ARCHIVES) throw new SaveLibraryError('storage'); done(request.result.map(value => record(value, product)).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id)));} catch (error) {fail(error);}};
      });
    },
    async add(product: ProductId, name: string, filename: string, input: Uint8Array): Promise<{archive: SaveArchive; duplicate: boolean}> {
      validateProduct(product); name = validateName(name);
      if (!input.byteLength || input.byteLength > MAX_SCORE_BYTES) throw new SaveLibraryError('invalid');
      const bytes = new Uint8Array(input);
      try {parseScoreDat(gameIdForProduct(product), bytes);} catch {throw new SaveLibraryError('invalid');}
      const archive: SaveArchive = {id: globalThis.crypto.randomUUID(), product, name, filename: filename.replace(/[/\\\u0000-\u001f\u007f]/g, '_').slice(0, 200), bytes, created: Date.now()};
      return transaction('readwrite', (store, done, fail) => {
        // Validation, duplicate detection and capacity enforcement share one
        // write transaction, including across independent browser tabs.
        const request = store.index('product').getAll(product, MAX_SAVED_ARCHIVES + 1);
        request.onsuccess = () => {
          try {
            const rows = request.result.map(value => record(value, product));
            const existing = rows.find(row => sameSaveBytes(row.bytes, bytes));
            if (existing) {done({archive: existing, duplicate: true}); return;}
            if (rows.length >= MAX_SAVED_ARCHIVES) throw new SaveLibraryError('full');
            store.add(archive); done({archive, duplicate: false});
          } catch (error) {fail(error);}
        };
      });
    },
    async rename(product: ProductId, id: string, name: string): Promise<void> {
      validateProduct(product); name = validateName(name);
      return transaction('readwrite', (store, done, fail) => {
        const request = store.get(id);
        request.onsuccess = () => {try {if (!request.result || request.result.product !== product) throw new SaveLibraryError('missing'); const row = record(request.result, product); store.put({...row, name}); done(undefined);} catch (error) {fail(error);}};
      });
    },
    async remove(product: ProductId, id: string): Promise<void> {
      validateProduct(product);
      return transaction('readwrite', (store, done, fail, tx) => {
        const bindings = tx.objectStore('bindings'), current = bindings.get(product);
        current.onsuccess = () => {try {
          const state = binding(current.result, product);
          // Never remove an archive involved in an unfinished native writeback.
          if (state.run) throw new SaveLibraryError('pending');
          const request = store.get(id);
          request.onsuccess = () => {try {
            if (!request.result || request.result.product !== product) throw new SaveLibraryError('missing');
            record(request.result, product);
            store.delete(id);
            // Persist an explicit native choice, including the implicit one-copy
            // default. Adding another archive must not resurrect this choice.
            if (state.selectedId === id || current.result === undefined) bindings.put({...state,selectedId:null});
            done(undefined);
          } catch(error) {fail(error);}};
        } catch(error) {fail(error);}};
      }, ['bindings']);
    },
  };
}
export type SaveLibraryStorage = ReturnType<typeof createSaveLibraryStorage>;
