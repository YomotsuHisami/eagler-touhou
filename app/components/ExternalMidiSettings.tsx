import {MainSelect} from './MainSelect';
import {useEffect, useId, useRef, useState} from 'react';
import {PRODUCT_GAMES, gameIdForProduct} from '../../src/contracts/product-catalog.mts';
import type {UiMessageKey} from '../../src/launcher/i18n.mts';
import {externalMidiOffered, webMidiAvailable} from '../../src/launcher/external-midi.mts';
import type {PreferencesSnapshot, PreferencesStore} from '../services/preferences.client';
import {useMidi} from './MidiProvider';
import {useLocale} from './LocaleProvider';

const selectClass = 'min-h-11 w-full rounded-xl border border-line bg-background px-3 py-2 text-paper disabled:cursor-not-allowed disabled:opacity-50';
type MidiNotice = {key: UiMessageKey; values?: Record<string, string | number>} | null;

function errorNotice(error: unknown): MidiNotice {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String(error.name);
    if (name === 'AbortError') return null;
    if (name === 'NotAllowedError' || name === 'SecurityError') return {key: 'settings.externalMidiDenied'};
    if (name === 'NotSupportedError') return {key: 'settings.externalMidiUnsupported'};
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('web-midi-unsupported')) return {key: 'settings.externalMidiUnsupported'};
  if (message.includes('web-midi-sysex-denied')) return {key: 'settings.externalMidiSysexDenied'};
  if (message.includes('web-midi-no-device')) return {key: 'settings.externalMidiNoDevice'};
  return {key: 'settings.externalMidiFailed', values: {reason: message}};
}

/** External MIDI is a separate settings row so the pure settings form does not
 * acquire a Runtime/MidiProvider dependency. The session switch stays in the
 * root MIDI owner; only the chosen output id is persisted in game preferences. */
export function ExternalMidiSettings({settings, store}: {settings: PreferencesSnapshot; store: PreferencesStore}) {
  const {t} = useLocale();
  const {controller, snapshot} = useMidi();
  const id = useId();
  const [requesting, setRequesting] = useState(false), [notice, setNotice] = useState<MidiNotice>(null);
  const requestSerial = useRef(0);
  const game = gameIdForProduct(settings.productId);
  const offered = externalMidiOffered(PRODUCT_GAMES[game].musicCapabilities.midi, settings.music ?? '');
  const scope = `${settings.productId}:${offered}`;
  const scopeRef = useRef(scope);
  const stateRef = useRef({offered, scope});
  stateRef.current = {offered, scope};

  useEffect(() => {
    controller?.setExternalMidiDeviceId(settings.options.externalMidiDeviceId);
  }, [controller, settings.options.externalMidiDeviceId]);
  useEffect(() => {
    if (!offered && snapshot?.externalMidiEnabled) void controller?.setExternalMidiEnabled(false);
  }, [controller, offered, snapshot?.externalMidiEnabled]);
  useEffect(() => {
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;requestSerial.current++;setRequesting(false);setNotice(null);
  }, [scope]);
  useEffect(() => () => {requestSerial.current++;}, []);

  if (!offered) return null;
  const supported = snapshot?.externalMidiSupported ?? (typeof navigator !== 'undefined' && webMidiAvailable(navigator));
  const enabled = snapshot?.externalMidiEnabled === true;
  const outputs = enabled && snapshot?.externalMidiGranted ? snapshot.externalMidiOutputs : [];
  const effectiveId = outputs.length ? snapshot?.externalMidiEffectiveId || settings.options.externalMidiDeviceId : '';
  const backendError = snapshot?.externalMidiError;
  const status: MidiNotice = notice ?? (backendError
    ? errorNotice(backendError)
    : !supported ? {key: 'settings.externalMidiUnsupported'}
      : !enabled ? {key: 'settings.externalMidiHint'}
        : !snapshot?.externalMidiGranted ? {key: 'settings.externalMidiPending'}
          : !snapshot.externalMidiSysexEnabled ? {key: 'settings.externalMidiSysexDenied'}
            : !outputs.length ? {key: 'settings.externalMidiNoDevice'}
              : {key: 'settings.externalMidiConnected', values: {count: outputs.length}});

  function changeEnabled(next: boolean) {
    if (!controller || requesting) return;
    const ticket = ++requestSerial.current;
    setNotice(null);
    if (!next) {
      setRequesting(false);
      void controller.setExternalMidiEnabled(false);
      return;
    }
    setRequesting(true);
    const requestedScope = scope;
    void controller.setExternalMidiEnabled(true, () => stateRef.current.offered && stateRef.current.scope === requestedScope)
      .catch(error => {if (ticket === requestSerial.current) setNotice(errorNotice(error));})
      .finally(() => {if (ticket === requestSerial.current) setRequesting(false);});
  }

  return <>
    <div className="game-settings-option">
      <label htmlFor={`${id}-enabled`} className="game-settings-option-label">
        <span className="game-settings-option-copy">
          <span>{t('settings.externalMidi')}</span>
          {status && <small id={`${id}-hint`} role="status" className={`game-settings-option-hint${notice || backendError ? ' game-settings-option-warning' : ''}`}>{t(status.key, status.values)}</small>}
        </span>
        <input id={`${id}-enabled`} type="checkbox" role="switch" checked={enabled} disabled={!controller || !supported || requesting}
          aria-checked={enabled} aria-describedby={`${id}-hint`} onChange={event => changeEnabled(event.currentTarget.checked)}/>
      </label>
    </div>
    {enabled && snapshot?.externalMidiGranted && <div className="game-settings-select-item">
      <label htmlFor={`${id}-device`}>{t('settings.externalMidiDevice')}</label>
      <MainSelect id={`${id}-device`} className={selectClass} value={effectiveId} disabled={!outputs.length || requesting}
        onChange={event => {
          const deviceId = event.currentTarget.value;
          store.setOption(settings.productId, 'externalMidiDeviceId', deviceId);
          controller?.setExternalMidiDeviceId(deviceId);
        }}>
        {outputs.length ? outputs.map(output => <option key={output.id} value={output.id}>{output.name}</option>)
          : <option value="" disabled>{t('settings.externalMidiNoDeviceOption')}</option>}
      </MainSelect>
    </div>}
  </>;
}
