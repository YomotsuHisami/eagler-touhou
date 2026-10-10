import {createNetworkDiagnosticsState, type NetworkDiagnosticsStateOptions} from '../../../src/launcher/network-diagnostics.mts';
export {initialNetworkDiagnosticsSnapshot, type NetworkDiagnosticsSnapshot} from '../../../src/launcher/network-diagnostics.mts';

export type NetworkDiagnosticsModelOptions = NetworkDiagnosticsStateOptions;

/** React consumes the same state as main's DOM controller without a detached
 * presentation or observer. Disposal fences publication, not already-started
 * probes: their original bounded waits and native finally cleanup still run. */
export function createNetworkDiagnosticsModel(options: NetworkDiagnosticsModelOptions) {
  const state = createNetworkDiagnosticsState(options);
  const listeners = new Set<() => void>();
  let active = true, queued = false, snapshot = state.getSnapshot();
  const sync = () => {
    if (!active) return;
    const next = state.getSnapshot();
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  // Keep the former observer's coalesced progress delivery without a DOM
  // bridge. Explicit run start/finally still synchronize immediately below.
  const unsubscribe = state.subscribe(() => {
    if (!active || queued) return;
    queued = true;
    queueMicrotask(() => {queued = false; sync();});
  });
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    async run() {
      if (!active) return;
      const operation = state.run(); sync();
      try {await operation;} finally {sync();}
    },
    dispose() {active = false; unsubscribe(); listeners.clear();},
  };
}
export type NetworkDiagnosticsModel = ReturnType<typeof createNetworkDiagnosticsModel>;
