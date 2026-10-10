import {useLocale} from '../../i18n';
import type {NetworkDiagnosticsSnapshot} from './network-diagnostics-model';
/** Same original result tree in index468–490 and lobby112–130. Root mounts
 * only the presentation belonging to its document context to keep IDs unique. */
export function NetworkDiagnosticResults({snapshot}: {snapshot: NetworkDiagnosticsSnapshot}) {
  const {t} = useLocale();
  const row = (kind: 'ws' | 'turn' | 'nat' | 'ipv6', label: string, id: string) => <div className="mp-network-result" data-network-result={kind} data-state={snapshot.rows[kind].state}><span>{label}</span><output id={id}>{snapshot.rows[kind].value}</output><i aria-hidden="true"/></div>;
  return <div className="mp-network-results" id="mpNetworkResults" role="status" aria-live="polite" hidden={snapshot.hidden}>
    <section className="mp-network-group"><h3>{t('networkCheck.serverCapability')}</h3><div className="mp-network-group-rows">{row('ws', 'WebSocket', 'mpNetworkWs')}{row('turn', 'TURN', 'mpNetworkTurn')}</div></section>
    <section className="mp-network-group"><h3>{t('networkCheck.directCapability')}</h3><div className="mp-network-group-rows">{row('nat', 'NAT', 'mpNetworkNat')}{row('ipv6', 'IPv6', 'mpNetworkIpv6')}</div></section>
  </div>;
}
