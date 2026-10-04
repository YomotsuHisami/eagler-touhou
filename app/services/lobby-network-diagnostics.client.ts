/** Read-only, user-triggered measurements. The directory supplies its existing
 * Host configuration; this service never fetches a manifest or owns membership. */
import {runNetworkDiagnostics, type NetworkDiagnosticKind, type NetworkDiagnosticMeasurement} from '../../src/launcher/network-diagnostics.mts';
export const LOBBY_DIAGNOSTIC_KINDS = Object.freeze(['ws', 'turn', 'nat', 'ipv6'] as const);
export interface LobbyNetworkSnapshot {
  readonly running: boolean;
  readonly results: Readonly<Record<NetworkDiagnosticKind, Readonly<NetworkDiagnosticMeasurement> | null>>;
}
export type LobbyNetworkProbe = typeof runNetworkDiagnostics;
const initial = (): LobbyNetworkSnapshot => Object.freeze({running: false, results: Object.freeze({ws: null, turn: null, nat: null, ipv6: null})});
export function createLobbyNetworkDiagnostics({probe = runNetworkDiagnostics}: {probe?: LobbyNetworkProbe} = {}) {
  let snapshot = initial(), request: AbortController | null = null;
  const listeners = new Set<() => void>();
  function update(next: LobbyNetworkSnapshot) {snapshot = Object.freeze(next);for (const listener of [...listeners]) listener();}
  function cancel() {
    const previous = request;request = null;previous?.abort();
    if (snapshot.running) update({...snapshot, running: false});
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {listeners.add(listener);return () => {listeners.delete(listener);};},
    async run(relayUrl: string | null): Promise<void> {
      if (request) return;
      const owner = new AbortController();request = owner;
      update({running: true, results: initial().results});
      try {
        await probe({relayUrl: relayUrl ?? '', fallbackIceServers: [{urls: ['stun:stun.cloudflare.com:3478']}], signal: owner.signal,
          onResult(result) {
            if (request !== owner || owner.signal.aborted) return;
            update({...snapshot, results: Object.freeze({...snapshot.results,
              [result.kind]: Object.freeze({...result, ...(result.params ? {params: Object.freeze({...result.params})} : {})})})});
          }});
      } catch {
        if (request !== owner || owner.signal.aborted) return;
        const results = {...snapshot.results};
        for (const kind of LOBBY_DIAGNOSTIC_KINDS) results[kind] ??= Object.freeze({kind, good: false, message: 'networkCheck.failed'});
        update({...snapshot, results: Object.freeze(results)});
      } finally {
        if (request === owner) {request = null;update({...snapshot, running: false});}
      }
    },
    cancel,
    reset() {cancel();update(initial());},
  });
}
