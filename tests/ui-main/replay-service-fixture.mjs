/** Synthetic Runtime port only: no browser storage or original-game fixtures. */
export function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
export function upload(name, values) {
  const bytes = Uint8Array.from(values);
  return {name, size: bytes.length, async arrayBuffer() {return bytes.slice().buffer;}};
}
function fileIdentity(game, runtimeVariant = 'normal') {
  if (!game) return {runtimeVariant: undefined, saveRoot: null, scoreFile: null};
  const scoreFile = ['th10', 'th11', 'th15', 'th20'].includes(game) ? `score${game}.dat` : 'score.dat';
  return {runtimeVariant, saveRoot: `/saves${game}`, scoreFile};
}
export function runtimeFixture(initial = {}) {
  const files = new Map(Object.entries(initial).map(([path, values]) => [path, Uint8Array.from(values)]));
  const calls = [], listeners = new Set();
  let snapshot = {phase: 'prepared', fileOperationBusy: false, game: 'th06', ...fileIdentity('th06'), epoch: 1, ready: true, launched: false, saveUnavailable: false};
  let lease = null, overrides = {}, closeResult = true;
  function change(patch) {
    snapshot = {...snapshot, ...patch};
    if (Object.hasOwn(patch, 'game')) Object.assign(snapshot, fileIdentity(patch.game, patch.game ? patch.runtimeVariant ?? 'normal' : undefined));
    for (const listener of [...listeners]) listener();
  }
  const runtime = {
    getSnapshot: () => snapshot,
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
    close: async () => {calls.push(['close']); if (!closeResult) return false; change({phase: 'idle', fileOperationBusy: false, game: null, epoch: null, ready: false, launched: false}); return true;},
    withFileSession(game, work, options = {}) {
      const readOnly = options.readOnly === true;
      const variant = options.runtimeVariant ?? 'normal';
      const runningRead = readOnly && snapshot.phase === 'running' && snapshot.launched;
      if (lease || snapshot.game !== game || snapshot.runtimeVariant !== variant || (options.epoch !== undefined && options.epoch !== snapshot.epoch) ||
          snapshot.saveRoot !== `/saves${game}` || snapshot.scoreFile !== fileIdentity(game, variant).scoreFile ||
          (!runningRead && (snapshot.phase !== 'prepared' || snapshot.launched)) || !snapshot.ready || snapshot.saveUnavailable) return Promise.reject(new Error('Runtime unavailable'));
      const token = lease = {epoch: snapshot.epoch, game, runtimeVariant: variant, saveRoot: snapshot.saveRoot, scoreFile: snapshot.scoreFile, readOnly};
      function makeAccess(epoch) {
        const check = () => {
          const identityMatches = snapshot.game === token.game && snapshot.runtimeVariant === token.runtimeVariant &&
            snapshot.saveRoot === token.saveRoot && snapshot.scoreFile === token.scoreFile;
          const phaseAllowed = snapshot.phase === 'prepared' && !snapshot.launched || token.readOnly && snapshot.phase === 'running' && snapshot.launched;
          if (lease !== token || epoch !== snapshot.epoch || !identityMatches || !phaseAllowed || !snapshot.ready || snapshot.saveUnavailable) throw new Error('Session replaced');
        };
        return {
          epoch,
          async sync() {check(); calls.push(['sync']); if (overrides.sync) await overrides.sync(); check();},
          async send(command, payload) {
            check();
            if (token.readOnly && !['list', 'read'].includes(command)) throw new Error('Read-only Runtime file session');
            calls.push([command, payload]);
            if (overrides[command]) {const result = await overrides[command](payload); check(); return result;}
            if (command === 'list') return {files: [...files].map(([path, bytes]) => ({path, size: bytes.length}))};
            if (command === 'read') {if (!files.has(payload.path)) throw new Error('Missing file'); return {bytes: [...files.get(payload.path)]};}
            if (command === 'write') {files.set(payload.path, Uint8Array.from(payload.bytes)); return {ok: true};}
            if (command === 'remove') {if (!files.delete(payload.path)) throw new Error('Missing file'); return {ok: true};}
            throw new Error('Unexpected file command');
          },
          async restart() {
            if (token.readOnly) throw new Error('Read-only Runtime file session cannot restart');
            check(); calls.push(['restart']);
            change({phase: 'loading', ready: false, launched: false});
            const nextEpoch = epoch + 1;
            change({phase: 'prepared', epoch: nextEpoch, ready: true, launched: false});
            return makeAccess(nextEpoch);
          },
        };
      }
      change({fileOperationBusy: true});
      return Promise.resolve().then(() => {const access = makeAccess(token.epoch); return work(access);})
        .finally(() => {if (lease === token) {lease = null; change({fileOperationBusy: false});}});
    },
  };
  return {runtime, files, calls, change, override(next) {overrides = next;}, setCloseResult(value) {closeResult = value;}, listenerCount: () => listeners.size};
}
