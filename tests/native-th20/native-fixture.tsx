/** TEST ONLY: real hidden native adapter, not public Launcher/product support.
 * No fake peer, synthetic native global, ready event or first-frame signal.
 */
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createBrowserRouter} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import {createRuntimeService, type RuntimeFrame, type RuntimeService} from '../../app/services/runtime.client';
import {RuntimeViewport, RuntimeViewportProvider} from '../../app/runtime/RuntimeViewport';
import {RuntimeTouchOverlayForContext} from '../../app/runtime/RuntimeTouchOverlay';
import {RuntimeControlsForService} from '../../app/runtime/RuntimeControls';
import {LocaleProvider} from '../../app/components/LocaleProvider';
import {NavigationDraftProvider} from '../../app/components/NavigationDrafts';
import {HelpProvider, GlobalHelpPanel} from '../../app/components/HelpPanel';
import {MotionPreferenceProvider} from '../../app/components/MotionPreferenceProvider';
import {HostedKeyboard} from '../../src/launcher/hosted-keyboard.mts';
import {bindRuntimeKeyboard} from '../../app/runtime/keyboard-binding';
import {prepareRuntimeLaunch} from '../../src/launcher/runtime-launch.mts';
import {componentFileIds} from '../../package/package-generation.mjs';
import type {InstalledPackageGeneration} from '../../src/contracts/package-read-models.mts';
import {verifyNativePublication, importVerifiedNativePackage, verifiedNativePlan, type VerifiedPublication} from './verified-plan';
import '../../app/styles.css';
const none = () => () => {}, empty = () => null;
function Fixture() {
  const frame = useRef<HTMLIFrameElement>(null);
  const nativeEvents = useRef<Array<{event: string; game: string; epoch: number}>>([]);
  const [service, setService] = useState<RuntimeService | null>(null);
  const [publication, setPublication] = useState<VerifiedPublication | null>(null);
  const [generation, setGeneration] = useState<InstalledPackageGeneration | null>(null);
  const [music, setMusic] = useState<'none' | 'ogg'>('none'), [touch, setTouch] = useState(false);
  const [movement, setMovement] = useState<'touch' | 'touch-unlimited'>('touch');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const snapshot = useSyncExternalStore(service?.subscribe ?? none, service?.getSnapshot ?? empty, empty);
  const context = service?.getLauncherControlContext();
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const pins = {baseUrl: query.get('publication') ?? '', hostSha256: query.get('hostSha256') ?? '',
      runtimeGeneration: query.get('runtimeGeneration') ?? '', packageSha256: query.get('packageSha256') ?? ''};
    let owner: RuntimeService | null = null, unbind: (() => void) | null = null, active = true;
    void verifyNativePublication(pins).then(verified => {
      if (!active || !frame.current) return;
      owner = createRuntimeService({frame: frame.current as unknown as RuntimeFrame, baseUrl: pins.baseUrl, worker: null,
        onEvent: message => {nativeEvents.current.push({event: message.event, game: message.game, epoch: message.epoch});},
        dependencies: {prepareCode: async (entry, options) => {
          const prepared = await prepareRuntimeLaunch(entry, {...options, worker: null});
          if (prepared.generation !== pins.runtimeGeneration) throw new Error('Exact native Runtime unavailable; fallback generations are not permitted in this lane');
          return prepared;
        }}});
      unbind = bindRuntimeKeyboard({host: window, document, element: Element, frame: () => frame.current,
        service: owner, keyboard: new HostedKeyboard()});
      setPublication(verified);setService(owner);
    }).catch(reason => {if (active) setError(String(reason));});
    return () => {active = false;unbind?.();if (owner && frame.current?.isConnected === false) owner.disposeDetachedFrame();};
  }, []);
  useEffect(() => {
    // Read-only diagnostics are derived from the real owner. No native status is fabricated.
    window.__th20NativeFixture = {inspect: () => ({scope: 'test-only-native-adapter', events: [...nativeEvents.current], snapshot: service?.getSnapshot() ?? null,
      context: service?.getLauncherControlContext() ?? null, imported: generation ? {id: generation.id,
        dataBytes: generation.descriptor.files['game-data'].bytes, oggIds: componentFileIds(generation.descriptor, 'ogg')} : null,
      publication: publication ? {hostSha256: publication.pins.hostSha256, runtimeGeneration: publication.pins.runtimeGeneration,
        packageSha256: publication.pins.packageSha256} : null})};
    return () => {delete window.__th20NativeFixture;};
  }, [service, generation, publication]);
  async function run(action: () => Promise<unknown>) {setBusy(true);setError(null);try {await action();} catch (reason) {setError(String(reason));} finally {setBusy(false);}}
  const active = !!snapshot && snapshot.phase !== 'idle' && snapshot.phase !== 'error';
  return <RuntimeViewportProvider service={service} frame={frame}>
    <main id="main-content" tabIndex={-1} className="p-4 text-paper"><h1>Test-only TH20 native adapter fixture</h1>
      <p>This exercises current Runtime components and a real supplied adapter. TH20 is hidden; this is not public Launcher support.</p>
      <p role="status">{publication ? generation ? 'Verified local Package imported' : 'Verified publication; choose the explicit Package' : 'Verifying explicit publication identities'}</p>
      <fieldset disabled={!publication || busy || !!active} className="grid gap-3 max-w-lg my-4">
        <label>Explicit TH20 Package ZIP<input type="file" accept=".zip" onChange={event => {const file = event.target.files?.[0];if (file && publication) void run(async () => setGeneration(await importVerifiedNativePackage(file, publication)));}}/></label>
        <label>Native test music<select value={music} onChange={event => setMusic(event.target.value as 'none' | 'ogg')}><option value="none">None</option>{generation && <option value="ogg">Imported OGG</option>}</select></label>
        <label><input type="checkbox" checked={touch} onChange={event => setTouch(event.target.checked)}/>Enable native test touch</label>
        <label>Native movement method<select value={movement} onChange={event => setMovement(event.target.value as 'touch' | 'touch-unlimited')}><option value="touch">Rate-limited direct touch</option><option value="touch-unlimited">Unlimited direct touch</option></select></label>
        <button type="button" disabled={!generation || !service} onClick={() => void run(async () => {
          if (!service || !generation || !publication) throw new Error('Verified inputs are required');
          await service.prepare(await verifiedNativePlan(generation, publication, {music, touch, movement}));
        })}>Prepare exact native adapter</button>
      </fieldset>
      {snapshot?.phase === 'prepared' && <button type="button" disabled={busy} onClick={() => void run(async () => {await service!.launch();frame.current?.focus();})}>Start native TH20</button>}
      {error && <p role="alert">{error}</p>}
    </main>
    <RuntimeControlsForService service={service}/><GlobalHelpPanel/>
    {service && context && snapshot?.launched && snapshot.ready && !snapshot.spectator && context.options.touchEnabled === true &&
      <RuntimeTouchOverlayForContext service={service} frame={frame} context={context}/>}
    <RuntimeViewport frame={frame} visible={!!snapshot && (snapshot.launched || snapshot.phase === 'launching' || snapshot.phase === 'error' && snapshot.ready)}/>
  </RuntimeViewportProvider>;
}
const router = createBrowserRouter([{path: '*', element: <LocaleProvider initialLocale="en" storage={null}><MotionPreferenceProvider><NavigationDraftProvider><HelpProvider><Fixture/></HelpProvider></NavigationDraftProvider></MotionPreferenceProvider></LocaleProvider>}]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>);
declare global {interface Window {__th20NativeFixture?: {inspect(): unknown}}}
