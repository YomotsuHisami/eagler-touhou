import {useLocale} from '../components/LocaleProvider';
import {ManagementSurfacePortal} from '../components/ManagementSurface';
import {useLayoutEffect, useRef, useState} from 'react';
import {useRuntimeService, useRuntimeSnapshot} from './RuntimeHost';
import {preparedRuntimeNeedsMidi, startPreparedRuntime, type PreparedStartRuntime} from '../runtime/prepared-start';
import type {RuntimeSnapshot} from '../services/runtime.client';
import type {MidiController, MidiSnapshot} from '../services/midi.client';
import {LaunchWarnings, useLaunchWarningGate} from '../components/LaunchWarnings';
import {browserLaunchInputDevice, launchInputWarnings} from '../services/launch-warnings';
import {useMidi} from '../components/MidiProvider';
const button = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm hover:bg-nav-hover hover:text-nav-ink disabled:cursor-not-allowed disabled:opacity-50';
/** One explicit Start for any current prepared Runtime, including a same-plan
 * save-import restart. This view never adopts acquisition/cancellation ownership. */
export function PreparedRuntimeStart({warnings = []}: {warnings?: readonly string[]}) {
  const service = useRuntimeService(), live = useRuntimeSnapshot();
  const {controller: midi, snapshot: audio} = useMidi();
  return <PreparedRuntimeStartForService service={service} live={live} midi={midi} audio={audio} warnings={warnings}/>;
}
/** Synthetic-control seam; production supplies only its existing root owners. */
export function PreparedRuntimeStartForService({service, live, midi, audio, warnings = []}: {
  service: PreparedStartRuntime | null; live: RuntimeSnapshot | null; midi: MidiController | null; audio: MidiSnapshot | null; warnings?: readonly string[];
}) {
  const {t} = useLocale();
  const [starting, setStarting] = useState(false);
  const intent = useRef(0), gate = useLaunchWarningGate();
  const epoch = live?.phase === 'prepared' && live.runtimeVariant !== 'multiplayer' ? live.epoch : null;
  useLayoutEffect(() => {intent.current++; gate.cancel(); setStarting(false); return () => {intent.current++; gate.cancel();};}, [service, epoch, live?.fileOperationBusy, live?.saveError, gate]);
  if (!service || !live || epoch === null) return null;
  const needsMidi = preparedRuntimeNeedsMidi(service, epoch);
  return <><LaunchWarnings gate={gate}/><ManagementSurfacePortal>{docked => <aside aria-label={t('react.prepared.aria')} className={`${docked ? '' : 'fixed right-3 bottom-3 left-3 z-30 sm:left-auto sm:max-w-lg'} flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-sm text-paper shadow-menu`}>
    {warnings.map((warning, index) => <p key={index} role="status" className="basis-full text-accent">{warning}</p>)}
    <p role="status">{t('react.prepared.ready', {game:live.game?.toUpperCase()})}</p>
    <button type="button" className={button} disabled={live.fileOperationBusy || !!live.saveError || starting || (needsMidi && !midi)} onClick={() => {
      const actual = service.getSnapshot();
      if (actual.phase !== 'prepared' || actual.epoch !== epoch || actual.fileOperationBusy || actual.saveError) return;
      const ticket = ++intent.current;
      setStarting(true);
      const controls = service.getLauncherControlContext(), context = service.getMidiEventContext();
      const current = () => {const now = service.getSnapshot(); return ticket === intent.current && now.epoch === epoch && now.phase === 'prepared' && !now.fileOperationBusy && !now.saveError;};
      // The exact prepared configuration includes launch-local fallback. Saved
      // preferences may already belong to a different selection or generation.
      const music = actual.music ?? (context?.epoch === epoch ? context.music : null);
      void gate.request({warnings: music ? launchInputWarnings({music, touchEnabled: controls?.epoch === epoch ? controls.options.touchEnabled === true : true}, browserLaunchInputDevice()) : [],
        current, accept: () => startPreparedRuntime({runtime: service, midi, epoch, currentIntent: current})})
        .catch(() => {}).finally(() => {if (ticket === intent.current) setStarting(false);});
    }}>{starting ? t('react.prepared.starting') : needsMidi && !audio?.ready ? t('react.prepared.prepareMidi') : t('react.prepared.startGame', {game:live.game?.toUpperCase()})}</button>
    {audio?.activeEpoch === epoch && audio.error && <p role="alert" className="basis-full text-accent">{audio.error}</p>}
  </aside>}</ManagementSurfacePortal></>;
}
