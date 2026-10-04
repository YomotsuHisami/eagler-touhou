import {useLocale} from '../components/LocaleProvider';
import {useEffect, useRef, useState} from 'react';
import {useRuntimeService, useRuntimeSnapshot} from './RuntimeHost';
import {preparedRuntimeNeedsMidi, startPreparedRuntime} from '../runtime/prepared-start';
import {useMidi} from '../components/MidiProvider';
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
/** One explicit Start for any current prepared Runtime, including a same-plan
 * save-import restart. This view never adopts acquisition/cancellation ownership. */
export function PreparedRuntimeStart({warnings = []}: {warnings?: readonly string[]}) {
  const {t} = useLocale();
  const service = useRuntimeService(), live = useRuntimeSnapshot();
  const {controller: midi, snapshot: audio} = useMidi();
  const [starting, setStarting] = useState(false);
  const intent = useRef(0);
  const epoch = live?.phase === 'prepared' && live.runtimeVariant !== 'multiplayer' ? live.epoch : null;
  useEffect(() => {intent.current++; setStarting(false); return () => {intent.current++;};}, [epoch]);
  if (!service || !live || epoch === null) return null;
  const needsMidi = preparedRuntimeNeedsMidi(service, epoch);
  return <aside aria-label={t('react.prepared.aria')} className="fixed right-3 bottom-3 left-3 z-30 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu sm:left-auto sm:max-w-lg">
    {warnings.map((warning, index) => <p key={index} role="status" className="basis-full text-accent">{warning}</p>)}
    <p role="status">{t('react.prepared.ready', {game:live.game?.toUpperCase()})}</p>
    <button type="button" className={button} disabled={live.fileOperationBusy || starting || (needsMidi && !midi)} onClick={() => {
      const actual = service.getSnapshot();
      if (actual.phase !== 'prepared' || actual.epoch !== epoch || actual.fileOperationBusy) return;
      const ticket = ++intent.current;
      setStarting(true);
      void startPreparedRuntime({runtime: service, midi, epoch, currentIntent: () => ticket === intent.current})
        .catch(() => {}).finally(() => {if (ticket === intent.current) setStarting(false);});
    }}>{starting ? t('react.prepared.starting') : needsMidi && !audio?.ready ? t('react.prepared.prepareMidi') : t('react.prepared.startGame', {game:live.game?.toUpperCase()})}</button>
    {audio?.activeEpoch === epoch && audio.error && <p role="alert" className="basis-full text-accent">{audio.error}</p>}
  </aside>;
}
