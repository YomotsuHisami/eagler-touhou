import {useSyncExternalStore, type ReactNode} from 'react';
import {useLocale} from '../../i18n';
import type {createRuntimeDiagnostics} from '../../models/runtime-diagnostics';

const netplayRows = [
  ['session', 'runtimeNetplaySessionDiag', '联机 --'],
  ['inputDelay', 'runtimeNetplayInputDelayDiag', '输入延迟 --f'],
  ['route', 'runtimeNetplayRouteDiag', '网络 --'],
  ['frame', 'runtimeNetplayFrameDiag', '同步 --'],
  ['rollback', 'runtimeNetplayRollbackDiag', '回滚 --'],
  ['quality', 'runtimeNetplayQualityDiag', '质量 --'],
  ['ice', 'runtimeNetplayIceDiag', 'ICE --'],
] as const;
export type NetplayDiagnosticLines = Partial<Record<typeof netplayRows[number][1], string>>;
/** Original index1066–1078. Model owns actual Runtime health; optional MP lines
 * must come from the real room diagnostics owner, never inferred measurements. */
export function RuntimeDiagnostics({model, netplay, children}: {
  model: Pick<ReturnType<typeof createRuntimeDiagnostics>, 'subscribe' | 'getSnapshot'>;
  netplay?: NetplayDiagnosticLines;
  /** Actual original calibration report trigger, when its owner has a report. */
  children?: ReactNode;
}) {
  const {t} = useLocale(), state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  return <aside className={`runtime-diagnostics${state.severity ? ` ${state.severity}` : ''}`} id="runtimeDiagnostics" aria-label={t('diagnostics.aria')} hidden={!state.visible}>
    <span id="runtimeBrowserDiag">{state.browser}</span><span id="runtimeAudioDiag">{state.audio}</span>
    <span id="runtimeRendererDiag">{state.renderer}</span><span id="runtimeGapDiag">{state.frame}</span>
    {netplayRows.map(([key, id, initial]) => <span key={key} id={id} hidden={netplay?.[id] === undefined}>{netplay?.[id] ?? initial}</span>)}{children}
  </aside>;
}
