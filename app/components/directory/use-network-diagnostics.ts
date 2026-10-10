import {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {useLocale} from '../../i18n';
import {createNetworkDiagnosticsModel, initialNetworkDiagnosticsSnapshot, type NetworkDiagnosticsModel} from './network-diagnostics-model';

export interface NetworkDiagnosticsPorts {
  /** Document-lived session owner. A borrowed model is never disposed here. */
  model?: NetworkDiagnosticsModel;
  getRelayUrl(): string;
  getFallbackIceServers?(): RTCIceServer[];
  onRunningChange?(running: boolean): void;
}
const noSubscription = () => () => {};
const initialSnapshot = () => initialNetworkDiagnosticsSnapshot;
/** Both original presentation locations share one lifecycle adapter. It never
 * runs a probe because a route was restored; only the action calls run(). */
export function useNetworkDiagnostics(ports: NetworkDiagnosticsPorts) {
  const {t} = useLocale(), owner = useRef<NetworkDiagnosticsModel | null>(null);
  const [ownedModel, setModel] = useState<NetworkDiagnosticsModel | null>(null);
  const model = ports.model ?? ownedModel;
  const latest = useRef({...ports, t}); latest.current = {...ports, t};
  const snapshot = useSyncExternalStore(model?.subscribe ?? noSubscription, model?.getSnapshot ?? initialSnapshot, initialSnapshot);
  useLayoutEffect(() => {
    const borrowed = ports.model;
    const current = borrowed ?? createNetworkDiagnosticsModel({
      getRelayUrl: () => latest.current.getRelayUrl(),
      getFallbackIceServers: () => latest.current.getFallbackIceServers?.() ?? [{urls: ['stun:stun.cloudflare.com:3478']}],
      translate: (key, params) => latest.current.t(key, params)});
    owner.current = current; setModel(current);
    const unsubscribe = current.subscribe(() => latest.current.onRunningChange?.(current.getSnapshot().running));
    if (borrowed) latest.current.onRunningChange?.(current.getSnapshot().running);
    return () => {unsubscribe(); if (!borrowed) current.dispose(); if (owner.current === current) {owner.current = null; latest.current.onRunningChange?.(false);}};
  }, [ports.model]);
  const actions = useRef({
    run() {if (!owner.current) return Promise.reject(new Error('Network diagnostics are not mounted')); return owner.current.run();},
    isRunning: () => owner.current?.getSnapshot().running ?? false,
  });
  return {snapshot, actions: actions.current};
}
