import {ExternalMidiDevice, externalMidiOffered, navigatorMidiAccessRequest} from '../../src/launcher/external-midi.mts';
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import type {GameSettingsModel} from '../models/game-settings';
import type {Translate} from '../i18n';
import type {ExternalMidiPort, ExternalMidiSnapshot} from '../components/settings/types';

export interface ExternalMidiController extends ExternalMidiPort {
  /** Called by the existing launch owner, never by rendering or hydration. */
  prepare(): Promise<void>;
  /** Caller already owns/authenticates the Runtime event and its epoch. Returns
   * true if this device owns this event; false leaves it to the existing synth. */
  deliver(bytes: readonly number[]): boolean;
  panic(): void;
  refreshLocale(translate?: Translate): void;
  dispose(): void;
}
export function createExternalMidiPort({settings, navigator: navigatorLike, translate, feedback, onConfigurationChange,
  beforeExternalTakeover, pageLifecycle}: {
  settings: GameSettingsModel;
  navigator: unknown;
  translate: Translate;
  feedback(message: string): void;
  /** Same main resetRuntime boundary, supplied by the one Runtime owner. */
  onConfigurationChange(): void;
  /** Releases the built-in synth's held notes before external takeover. */
  beforeExternalTakeover(): void;
  pageLifecycle?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): ExternalMidiController {
  const listeners = new Set<() => void>();
  let enabled = false, busy = false, disposed = false, intent = 0, wasActive = false;
  let snapshot: ExternalMidiSnapshot;
  const device = new ExternalMidiDevice({requestAccess: navigatorMidiAccessRequest(navigatorLike), onChange() {
    // Canonical device access may settle after this wrapper has been retired.
    if (disposed) {device.panic(); device.release(); return;}
    publish();
  }});
  function offered() {
    const state = settings.getSnapshot();
    return !!state && externalMidiOffered(PRODUCT_GAMES[state.gameId].musicCapabilities.midi, state.music);
  }
  function statusText() {
    if (!device.supported) return translate('settings.externalMidiUnsupported');
    if (!enabled) return translate('settings.externalMidiHint');
    if (!device.granted) return translate('settings.externalMidiPending');
    if (!device.sysexEnabled) return translate('settings.externalMidiSysexDenied');
    const count = device.outputCount();
    return count ? translate('settings.externalMidiConnected', {count}) : translate('settings.externalMidiNoDevice');
  }
  function publish() {
    if (disposed) return;
    const outputs = enabled && device.granted ? device.outputInfo() : [];
    snapshot = Object.freeze({enabled: offered() && enabled, granted: device.granted, busy, supported: device.supported,
      outputs: Object.freeze(outputs), selectedId: outputs.length ? device.effectiveOutputId() : '', hint: statusText()});
    for (const listener of listeners) listener();
  }
  function errorText(error: unknown) {
    const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return translate('settings.externalMidiDenied');
    if (name === 'NotSupportedError') return translate('settings.externalMidiUnsupported');
    return translate('settings.externalMidiFailed', {reason: error instanceof Error ? error.message : String(error)});
  }
  let contextKey = '';
  function syncSettings() {
    const state = settings.getSnapshot();
    const key = `${state?.context.productId ?? ''}\u0000${state?.music ?? ''}`;
    if (key !== contextKey) {contextKey = key; intent++; busy = false;}
    device.setSelectedId(state?.options.externalMidiDeviceId ?? '');
    if (!offered() && enabled) {enabled = false; device.panic(); wasActive = false;}
    publish();
  }
  const unsubscribe = settings.subscribe(syncSettings);
  const pagehide = () => {device.panic(); wasActive = false;};
  pageLifecycle?.addEventListener('pagehide', pagehide);
  syncSettings();
  return Object.freeze({
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    async setEnabled(value: boolean) {
      if (disposed) return;
      if (!value) {
        intent++; busy = false;
        if (enabled) {enabled = false; device.panic(); wasActive = false; onConfigurationChange();}
        publish(); return;
      }
      if (!offered() || !device.supported || enabled || busy) return;
      const ticket = ++intent; busy = true; publish();
      try {
        // Called directly from the click handler; no render effect requests
        // permission. The existing parser/framer/device is the sole transport.
        if (!device.granted) await device.ensureAccess();
        if (disposed || ticket !== intent || !offered()) return;
        if (!device.sysexEnabled) {device.release(); feedback(translate('settings.externalMidiSysexDenied')); return;}
        enabled = true; onConfigurationChange();
      } catch (error) {if (!disposed && ticket === intent) feedback(errorText(error));}
      finally {if (!disposed && ticket === intent) {busy = false; publish();}}
    },
    async selectOutput(id: string) {
      if (disposed || !offered() || !device.supported || !enabled) return;
      // No permission request or eager port open on selection. The canonical
      // preference may outlive a disconnected port; playback falls back first.
      settings.setOption('externalMidiDeviceId', id);
    },
    async prepare() {
      if (disposed || !offered() || !enabled) return;
      const ticket = intent;
      try {
        await device.ensureAccess();
        if (disposed || ticket !== intent || !offered() || !enabled) return;
        if (!device.sysexEnabled) {feedback(translate('settings.externalMidiSysexDenied')); return;}
        const outputs = await device.openOutputs();
        if (disposed || ticket !== intent) return;
        if (!outputs) feedback(translate('settings.externalMidiNoDevice'));
      } catch (error) {if (!disposed && ticket === intent) feedback(errorText(error));}
      finally {publish();}
    },
    deliver(bytes: readonly number[]) {
      const active = !disposed && offered() && enabled && device.granted && device.sysexEnabled && device.outputCount() > 0;
      if (active && !wasActive) beforeExternalTakeover();
      wasActive = active;
      if (active) device.send(bytes);
      return active;
    },
    panic: pagehide,
    refreshLocale(next?: Translate) {if (next) translate = next; publish();},
    dispose() {
      if (disposed) return;
      disposed = true; intent++; enabled = false; busy = false; unsubscribe();
      pageLifecycle?.removeEventListener('pagehide', pagehide); device.panic(); device.release(); listeners.clear();
    },
  });
}
