import {useImperativeHandle, type Ref} from 'react';
import {useLocale} from '../../i18n';
import {useNetworkDiagnostics, type NetworkDiagnosticsPorts} from '../directory/use-network-diagnostics';
import {NetworkDiagnosticResults} from '../directory/NetworkDiagnosticResults';
import type {NetworkDiagnosticsHandle} from '../directory/NetworkDiagnosticsDialog';

export interface MultiplayerDiagnosticsProps extends NetworkDiagnosticsPorts {
  onGuide(): void;
  ref?: Ref<NetworkDiagnosticsHandle>;
}
/** Main index468–490. The library's original inline check uses the same real
 * probe adapter/results as the directory modal, in exclusive root contexts. */
export function MultiplayerDiagnostics({onGuide, ref, ...ports}: MultiplayerDiagnosticsProps) {
  const {t} = useLocale(), {snapshot, actions} = useNetworkDiagnostics(ports);
  useImperativeHandle(ref, () => actions, [actions]);
  return <section className="mp-network-diagnostics" id="mpNetworkDiagnostics">
    <div className="mp-network-actions">
      <button className="mp-network-guide-open" id="mpGuideOpen" type="button" onClick={onGuide}><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M240-80q-50 0-85-35t-35-85v-560q0-50 35-85t85-35h400q50 0 85 35t35 85v560q0 50-35 85t-85 35H240Zm0-80h400q17 0 28.5-11.5T680-200v-560q0-17-11.5-28.5T640-800H240q-17 0-28.5 11.5T200-760v560q0 17 11.5 28.5T240-160Zm80-120h240v-80H320v80Zm0-160h240v-80H320v80Zm0-160h160v-80H320v80Z"/></svg><span>{t('multiplayerGuide.action')}</span></button>
      <button className={`mp-network-check${snapshot.running ? ' running' : ''}`} id="mpNetworkCheck" type="button" aria-disabled={snapshot.running ? true : undefined} onClick={() => {void actions.run();}}><svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M120-160v-120q0-33 23.5-56.5T200-360h40v-80q0-33 23.5-56.5T320-520h120v-80h-40q-33 0-56.5-23.5T320-680v-120q0-33 23.5-56.5T400-880h160q33 0 56.5 23.5T640-800v120q0 33-23.5 56.5T560-600h-40v80h120q33 0 56.5 23.5T720-440v80h40q33 0 56.5 23.5T840-280v120q0 33-23.5 56.5T760-80H600q-33 0-56.5-23.5T520-160v-120q0-33 23.5-56.5T600-360h40v-80H320v80h40q33 0 56.5 23.5T440-280v120q0 33-23.5 56.5T360-80H200q-33 0-56.5-23.5T120-160Zm280-520h160v-120H400v120ZM200-160h160v-120H200v120Zm400 0h160v-120H600v120Z"/></svg><span>{t('networkCheck.action')}</span></button>
    </div>
    <NetworkDiagnosticResults snapshot={snapshot}/>
  </section>;
}
