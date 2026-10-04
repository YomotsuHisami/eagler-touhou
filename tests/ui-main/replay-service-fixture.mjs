/** Synthetic Runtime port only: no browser storage or original-game fixtures. */
export function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
export function upload(name, values) {
  const bytes = Uint8Array.from(values);
  return {name, size: bytes.length, async arrayBuffer() {return bytes.slice().buffer;}};
}
export function runtimeFixture(initial = {}) {
  const files = new Map(Object.entries(initial).map(([path, values]) => [path, Uint8Array.from(values)]));
  const calls = [], listeners = new Set();
  let snapshot = {phase: 'prepared', fileOperationBusy: false, game: 'th06', epoch: 1, ready: true, launched: false, saveUnavailable: false};
  let lease = null, overrides = {};
  function change(patch) {snapshot = {...snapshot, ...patch}; for (const listener of [...listeners]) listener();}
  const runtime = {
    getSnapshot: () => snapshot,
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    withFileSession(game, work) {
      if (lease || snapshot.game !== game || snapshot.phase !== 'prepared' || !snapshot.ready || snapshot.launched || snapshot.saveUnavailable) return Promise.reject(new Error('Runtime unavailable'));
      const token = lease = {epoch: snapshot.epoch};
      const check = () => {if (lease !== token || token.epoch !== snapshot.epoch || snapshot.phase !== 'prepared' || snapshot.launched) throw new Error('Session replaced');};
      change({fileOperationBusy: true});
      const access = {
        epoch: token.epoch,
        async sync() {check(); calls.push(['sync']); if (overrides.sync) await overrides.sync(); check();},
        async send(command, payload) {
          check(); calls.push([command, payload]);
          if (overrides[command]) {const result = await overrides[command](payload); check(); return result;}
          if (command === 'list') return {files: [...files].map(([path, bytes]) => ({path, size: bytes.length}))};
          if (command === 'read') {if (!files.has(payload.path)) throw new Error('Missing file'); return {bytes: [...files.get(payload.path)]};}
          if (command === 'write') {files.set(payload.path, Uint8Array.from(payload.bytes)); return {ok: true};}
          if (command === 'remove') {if (!files.delete(payload.path)) throw new Error('Missing file'); return {ok: true};}
          throw new Error('Unexpected file command');
        },
      };
      return Promise.resolve().then(() => {check(); return work(access);}).finally(() => {if (lease === token) {lease = null; change({fileOperationBusy: false});}});
    },
  };
  return {runtime, files, calls, change, override(next) {overrides = next;}, listenerCount: () => listeners.size};
}
