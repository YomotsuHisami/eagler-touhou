import {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {AnimatedDialog} from './AnimatedDialog';
import {useLocale} from './LocaleProvider';
import {createLaunchWarningGate, type LaunchWarningGate} from '../services/launch-warnings';

export function useLaunchWarningGate() {
  const [gate] = useState(createLaunchWarningGate);
  useLayoutEffect(() => () => gate.cancel(), [gate]);
  useLayoutEffect(() => gate.recheck());
  return gate;
}
export function LaunchWarnings({gate}: {gate: LaunchWarningGate}) {
  const {t} = useLocale(), cancel = useRef<HTMLButtonElement>(null);
  const prompt = useSyncExternalStore(gate.subscribe, gate.getSnapshot, () => null);
  const retained = useRef(prompt);
  useLayoutEffect(() => {if (prompt) {retained.current = prompt; cancel.current?.focus({preventScroll: true});}}, [prompt]);
  const displayed = prompt ?? retained.current;
  return <AnimatedDialog open={!!prompt} onOpenChange={open => {if (!open && prompt) gate.dismiss(prompt);}}
    title={t('dialog.confirmTitle')} description={displayed && <span className="whitespace-pre-line">{t(displayed.warning)}</span>}
    initialFocus={cancel} layer={65}>
    <div data-launch-warning={displayed?.warning} className="flex flex-wrap justify-end gap-3">
      <button ref={cancel} type="button" className="min-h-11 rounded-xl border border-line px-4 py-2" onClick={() => {if (prompt) gate.dismiss(prompt);}}>{t('action.cancel')}</button>
      <button type="button" className="min-h-11 rounded-xl bg-red px-4 py-2 font-bold" onClick={() => {if (prompt) gate.accept(prompt);}}>{t(displayed?.warning === 'touch.disabledInputWarning' ? 'touch.startAnyway' : 'music.startAnyway')}</button>
    </div>
  </AnimatedDialog>;
}
