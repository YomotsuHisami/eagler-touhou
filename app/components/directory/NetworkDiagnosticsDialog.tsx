import {useImperativeHandle, type Ref} from 'react';
import {useLocale} from '../../i18n';
import {useMainDialog, type MainDialogProps} from '../notices/use-main-dialog';
import {useNetworkDiagnostics, type NetworkDiagnosticsPorts} from './use-network-diagnostics';
import {NetworkDiagnosticResults} from './NetworkDiagnosticResults';

export interface NetworkDiagnosticsHandle {run(): Promise<void>; isRunning(): boolean;}
export interface NetworkDiagnosticsDialogProps extends MainDialogProps, NetworkDiagnosticsPorts {
  /** Already normalized by original buildMultiplayerDiagnosticRelayUrl. */
  getRelayUrl(): string;
  getFallbackIceServers?(): RTCIceServer[];
  onRunningChange?(running: boolean): void;
  ref?: Ref<NetworkDiagnosticsHandle>;
}
/** Original lobby.html112–130. Forward restores the panel without rerunning;
 * only the original Network button action invokes the imperative run port.
 */
export function NetworkDiagnosticsDialog({model, getRelayUrl, getFallbackIceServers, onRunningChange, ref, ...props}: NetworkDiagnosticsDialogProps) {
  const {t} = useLocale(), dialog = useMainDialog(props, 0);
  const {snapshot, actions} = useNetworkDiagnostics({model, getRelayUrl, getFallbackIceServers, onRunningChange});
  useImperativeHandle(ref, () => actions, [actions]);
  return <dialog ref={dialog.ref} className="lobby-dialog" id="lobbyNetworkDialog" aria-labelledby="lobbyNetworkTitle" onCancel={dialog.onCancel} onClick={dialog.onClick}>
    <div className="lobby-dialog-head"><h2 id="lobbyNetworkTitle">{t('networkCheck.title')}</h2><button className="lobby-close" id="lobbyNetworkClose" type="button" aria-label={t('action.close')} onClick={dialog.requestClose}>×</button></div>
    <NetworkDiagnosticResults snapshot={snapshot}/>
  </dialog>;
}
