/** Read-only access to the Runtime-owned IDBFS score after its terminal sync.
 * Never creates an IDBFS database or writes outside the Runtime protocol.
 */
export async function readRuntimeSavedScore(root: string, file: string, factory: IDBFactory = indexedDB): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    let absent = false;
    const request = factory.open(root);
    request.onupgradeneeded = () => { absent = true; request.transaction?.abort(); };
    request.onerror = () => absent ? resolve(null) : reject(request.error);
    request.onblocked = () => reject(new Error('存档数据库正在被其他页面使用'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('FILE_DATA')) { db.close(); resolve(null); return; }
      const transaction = db.transaction('FILE_DATA', 'readonly');
      const read = transaction.objectStore('FILE_DATA').get(`${root}/${file}`);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const contents = read.result?.contents;
        if (contents == null) resolve(null);
        else if (contents instanceof Blob) void contents.arrayBuffer().then(value => resolve(new Uint8Array(value)), reject);
        else try { resolve(new Uint8Array(contents)); } catch (error) { reject(error); }
      };
    };
  });
}
