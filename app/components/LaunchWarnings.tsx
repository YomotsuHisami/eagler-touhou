import {useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {flushSync} from 'react-dom';
import {AnimatedDialog} from './AnimatedDialog';
import {useLocale} from './LocaleProvider';
import {createLaunchWarningGate, type LaunchWarningGate} from '../services/launch-warnings';

export function useLaunchWarningGate() {
  const [gate] = useState(() => {
    const owner = createLaunchWarningGate();
    return Object.freeze({...owner, request(request: Parameters<LaunchWarningGate['request']>[0]) {
      // Establish the Radix keyboard layer in the same opening intent. The
      // gate alone still validates/accepts, and an empty warning list retains
      // the original Start/MIDI event stack without a presentation commit.
      return request.warnings.length ? flushSync(() => owner.request(request)) : owner.request(request);
    }});
  });
  useLayoutEffect(() => () => gate.cancel(), [gate]);
  useLayoutEffect(() => gate.recheck());
  return gate;
}
export function LaunchWarnings({gate}: {gate: LaunchWarningGate}) {
  const {t} = useLocale(), cancel = useRef<HTMLButtonElement>(null);
  const prompt = useSyncExternalStore(gate.subscribe, gate.getSnapshot, () => null);
  const retained = useRef(prompt), wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (prompt) {
      retained.current = prompt;
      // Initial focus belongs to Radix so it can capture the actual opener.
      // Only a next warning within this same open scope needs renewed focus.
      if (wasOpen.current) cancel.current?.focus({preventScroll: true});
    }
    wasOpen.current = !!prompt;
  }, [prompt]);
  const displayed = prompt ?? retained.current;
  return <AnimatedDialog open={!!prompt} onOpenChange={open => {if (!open && prompt) gate.dismiss(prompt);}}
    title={t('dialog.confirmTitle')} description={displayed && <span className="whitespace-pre-line">{t(displayed.warning)}</span>}
    initialFocus={cancel} layer={65} onContentEscapeKeyDown={event => {
      // Radix may have handled it already. The exact gate snapshot fences
      // repeated keys, a retained exit, and a replacement warning request.
      if (!prompt || gate.getSnapshot() !== prompt) return;
      event.preventDefault();event.stopPropagation();gate.dismiss(prompt);
    }}>
    <div data-launch-warning={displayed?.warning} className="flex flex-wrap justify-end gap-3">
      <button ref={cancel} type="button" className="min-h-11 rounded-xl border border-line px-4 py-2" onClick={() => {if (prompt) gate.dismiss(prompt);}}>{t('action.cancel')}</button>
      <button type="button" className="min-h-11 rounded-xl bg-red px-4 py-2 font-bold" onClick={() => {if (prompt) gate.accept(prompt);}}>{t(displayed?.warning === 'touch.disabledInputWarning' ? 'touch.startAnyway' : 'music.startAnyway')}</button>
    </div>
  </AnimatedDialog>;
}
