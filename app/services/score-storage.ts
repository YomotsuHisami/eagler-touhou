import {PRODUCT_GAMES, gameIdForProduct, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {MAX_SCORE_BYTES} from '../../src/launcher/score-dat.mts';

export interface StoredScore {
  bytes: Uint8Array;
  modified: number;
  /** TH10 maintains separate native save directories for these two editions. */
  edition: 'chs' | 'jp' | null;
  sourceName?: string;
}
export const scoreGames = ['th06', 'th07', 'th08', 'th09', 'th10'] as const;
export function supportsScore(product: ProductId) {
  return !isMultiplayerProductId(product) && (scoreGames as readonly string[]).includes(gameIdForProduct(product));
}

/** Read the Runtime's published IDBFS layout without booting it or owning writes.
 * An absent database upgrade is aborted, and only readonly transactions run.
 * TH10's most recently modified durable edition wins; the requested language
 * breaks equal timestamps. Its source edition remains visible in the UI.
 */
export async function readStoredScore(product: ProductId, language: string, factory: IDBFactory | undefined = globalThis.indexedDB, timeoutMs = 8000, exactEdition?: 'chs' | 'jp'): Promise<StoredScore | null> {
  if (!supportsScore(product)) return null;
  if (!factory) throw new Error('Browser save storage is unavailable');
  const game = gameIdForProduct(product), {saveRoot: root, scoreFile} = PRODUCT_GAMES[game].storage;
  const preferred = language === 'lang_zh-hans' ? 'chs' : 'jp';
  const paths = game === 'th10' ? (exactEdition ? [exactEdition] : [preferred, preferred === 'chs' ? 'jp' : 'chs']).map(edition => ({path: `${root}/${edition}/${scoreFile}`, edition: edition as 'chs' | 'jp'})) : [{path: `${root}/${scoreFile}`, edition: null}];
  return new Promise((resolve, reject) => {
    let settled = false, missing = false, db: IDBDatabase | null = null, tx: IDBTransaction | null = null;
    const finish = (error: unknown, value: StoredScore | null = null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {finish(new Error('Save storage read timed out')); try {tx?.abort();} catch {}}, timeoutMs);
    void (async () => {
      try {
        if (typeof factory.databases === 'function') {
          const names = await factory.databases();
          if (settled) return;
          if (!names.some(entry => entry.name === root)) {finish(null); return;}
        }
        if (settled) return;
        const request = factory.open(root);
        request.onupgradeneeded = event => {missing = event.oldVersion === 0; request.transaction?.abort();};
        request.onerror = () => finish(missing ? null : request.error || new Error('Save storage open failed'));
        request.onblocked = () => finish(new Error('Save storage is busy'));
        request.onsuccess = () => {
          db = request.result;
          if (settled) {db.close(); return;}
          if (!db.objectStoreNames.contains('FILE_DATA')) {finish(new Error('Unsupported save storage layout')); return;}
          const candidates: Array<{contents: unknown; modified: number; edition: StoredScore['edition']}> = [];
          try {
            tx = db.transaction('FILE_DATA', 'readonly');
            tx.onabort = tx.onerror = () => finish(tx?.error || new Error('Save storage read failed'));
            for (const entry of paths) {
              const read = tx.objectStore('FILE_DATA').get(entry.path);
              read.onerror = () => finish(read.error || new Error('Save file read failed'));
              read.onsuccess = () => {
                if (settled || read.result === undefined) return;
                if (!read.result || typeof read.result !== 'object' || !('contents' in read.result)) {finish(new Error('Invalid persisted score record')); return;}
                const stamp = read.result.timestamp instanceof Date ? read.result.timestamp.getTime() : Number(read.result.timestamp);
                candidates.push({contents: read.result.contents, modified: Number.isFinite(stamp) ? stamp : 0, edition: entry.edition});
              };
            }
            tx.oncomplete = () => {
              db?.close();
              if (settled) return;
              candidates.sort((a, b) => b.modified - a.modified || Number(b.edition === preferred) - Number(a.edition === preferred));
              const selected = candidates[0];
              if (!selected) {finish(null); return;}
              void scoreBytes(selected.contents).then(bytes => finish(null, {bytes, modified: selected.modified, edition: selected.edition}), error => finish(error));
            };
          } catch (error) {finish(error);}
        };
      } catch (error) {finish(error);}
    })();
  });
}

async function scoreBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof Blob) {
    if (value.size > MAX_SCORE_BYTES) throw new Error('Save exceeds the score size limit');
    return new Uint8Array(await value.arrayBuffer());
  }
  const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value instanceof ArrayBuffer ? new Uint8Array(value) : Array.isArray(value) && value.length <= MAX_SCORE_BYTES && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255) ? Uint8Array.from(value) : null;
  if (!bytes || bytes.byteLength > MAX_SCORE_BYTES) throw new Error('Invalid persisted score bytes');
  return new Uint8Array(bytes);
}
