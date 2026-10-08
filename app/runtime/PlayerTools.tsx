import {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {AnimatedDialog} from '../components/AnimatedDialog';
import {useLocation} from 'react-router';
import {createPortal} from 'react-dom';
import {runtimeDiagnosticsVisibleByDefault} from '../../src/launcher/runtime-diagnostics-model.mts';
import {HelpLink, usePlayerHelp} from '../components/HelpPanel';
import {useLocale} from '../components/LocaleProvider';
import {PlayerOrientationControl} from '../components/PlayerOrientationControl';
import {useDiagnosticsPreference} from '../components/RuntimeDiagnosticsToggle';
import {useRuntimeFrame, useRuntimeService, useRuntimeSnapshot} from './RuntimeHost';
import {useRuntimeViewport, useRuntimeViewportSnapshot} from './RuntimeViewport';
import {usePlayerSurface} from './PlayerToolsSurface';
import {bindPlayerFullscreenShortcut, createPlayerEscapeController, createPlayerFullscreenController, createPlayerInputHelpGate,
  type PlayerFullscreenController, type PlayerFullscreenDocument, type PlayerFullscreenTarget, type PlayerKeyboardLock} from '../services/player-tools.client';
import {createPlayerDiagnosticReport, createPlayerReportTransfer, playerDiagnosticReportText, readPlayerNativeDiagnostics,
  createPlayerSchedulingSampler,
  type PlayerSchedulingSnapshot, type PlayerDiagnosticReport} from '../services/player-tools-diagnostics';
import type {RuntimeService, RuntimeSnapshot} from '../services/runtime.client';

const subscribeNone = () => () => {}, noSnapshot = () => null;
const defaultButton = 'min-h-11 rounded-xl border border-line px-3 py-2 text-sm font-bold hover:bg-nav-hover hover:text-nav-ink disabled:opacity-50';
const helpGates = new WeakMap<Document, ReturnType<typeof createPlayerInputHelpGate>>();

/** Toolbar children only. Root owns placement, Runtime and navigation. */
export function PlayerTools({buttonClass = defaultButton, compact = false, testBuild = false}: {buttonClass?: string; compact?: boolean; testBuild?: boolean}) {
  const service = useRuntimeService(), frame = useRuntimeFrame(), snapshot = useRuntimeSnapshot();
  if (!service || !frame || !snapshot) return null;
  return <PlayerToolsForService service={service} frame={frame} snapshot={snapshot} buttonClass={buttonClass} compact={compact} testBuild={testBuild}/>;
}

export function PlayerToolsForService({service, frame, snapshot, buttonClass = defaultButton, compact = false, testBuild = false}: {
  service: RuntimeService; frame: RefObject<HTMLIFrameElement | null>; snapshot: RuntimeSnapshot; buttonClass?: string; compact?: boolean; testBuild?: boolean;
}) {
  const {t} = useLocale(), surface = usePlayerSurface(), viewport = useRuntimeViewport(), viewportSnapshot = useRuntimeViewportSnapshot(), help = usePlayerHelp(), location = useLocation();
  const [fullscreen, setFullscreen] = useState<PlayerFullscreenController | null>(null);
  const fullscreenState = useSyncExternalStore(fullscreen?.subscribe ?? subscribeNone, fullscreen?.getSnapshot ?? noSnapshot, noSnapshot);
  const escape = useRef<ReturnType<typeof createPlayerEscapeController> | null>(null), menu = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => {
    const target = menu.current;if (!target?.open) return;target.open = false;
    if (target.firstElementChild instanceof HTMLElement) target.firstElementChild.focus({preventScroll: true});
  };
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false), [inputError, setInputError] = useState(false);
  const {snapshot: preference, store: diagnosticsPreference} = useDiagnosticsPreference();
  const [pageVisible, setPageVisible] = useState(true);
  const [sampler, setSampler] = useState<ReturnType<typeof createPlayerSchedulingSampler> | null>(null);
  const scheduling = useSyncExternalStore(sampler?.subscribe ?? subscribeNone, sampler?.getSnapshot ?? noSnapshot, noSnapshot);
  const hudEnabled = preference.preference ?? testBuild === true;
  const hudVisible = runtimeDiagnosticsVisibleByDefault(testBuild, snapshot.launched, preference.preference);
  const live = snapshot.launched && snapshot.ready && !snapshot.saveUnavailable;
  const current = useRef({service, frame, snapshot, live, diagnosticsOpen, helpOpen: help.open, locationKey: location.key});
  useLayoutEffect(() => {current.current = {service, frame, snapshot, live, diagnosticsOpen, helpOpen: help.open, locationKey: location.key};});
  const diagnosticFocus = useRef<{epoch: number | null; frame: HTMLIFrameElement | null; locationKey: string} | null>(null);

  useEffect(() => {
    const visibility = () => setPageVisible(document.visibilityState !== 'hidden');visibility();
    document.addEventListener('visibilitychange', visibility);return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    const target = frame.current?.contentWindow, epoch = snapshot.epoch;
    if (!live || !pageVisible || !(hudVisible || diagnosticsOpen) || !target || service.getInputContext().target !== target) {setSampler(null);return;}
    const owner = createPlayerSchedulingSampler({host: window, child: target, now: () => performance.now(), current: () => {
      const context = service.getInputContext();return context.epoch === epoch && context.target === target && context.launched && context.ready && document.visibilityState !== 'hidden';
    }});
    setSampler(owner);owner.start();return () => owner.dispose();
  }, [service, frame, snapshot.epoch, live, pageVisible, hudVisible, diagnosticsOpen]);

  function focusCurrentGame() {
    const value = current.current, target = value.frame.current, context = value.service.getInputContext();
    if (value.live && !value.diagnosticsOpen && !value.helpOpen && target?.isConnected && context.epoch === value.snapshot.epoch && context.target === target.contentWindow && document.activeElement !== target) target.focus({preventScroll: true});
  }
  useEffect(() => {
    if (!surface?.element) return;
    const controller = createPlayerFullscreenController({document: document as PlayerFullscreenDocument,
      target: () => surface.element as PlayerFullscreenTarget,
      keyboard: (navigator as Navigator & {keyboard?: PlayerKeyboardLock}).keyboard,
      focus: focusCurrentGame, cancelGesture: () => viewport?.cancelGesture()});
    setFullscreen(controller);
    return () => {controller.dispose();};
  }, [surface?.element, viewport]);
  useLayoutEffect(() => {fullscreen?.setSession(snapshot.epoch, live);}, [fullscreen, snapshot.epoch, live]);
  useEffect(() => {
    const owner = createPlayerEscapeController(service);escape.current = owner;
    const clear = () => owner.cancel(), visibility = () => {if (document.visibilityState === 'hidden') clear();};
    window.addEventListener('blur', clear);document.addEventListener('visibilitychange', visibility);
    return () => {owner.dispose();if (escape.current === owner) escape.current = null;window.removeEventListener('blur', clear);document.removeEventListener('visibilitychange', visibility);};
  }, [service, snapshot.epoch]);
  useEffect(() => {setDiagnosticsOpen(false);closeMenu();diagnosticFocus.current = null;}, [snapshot.epoch, location.key]);
  useEffect(() => {setInputError(false);}, [snapshot.epoch]);
  useEffect(() => {
    if (!live) return;
    let gate = helpGates.get(document);
    if (!gate) {let storage: Storage | null;try {storage = localStorage;} catch {storage = null;}gate = createPlayerInputHelpGate(storage);helpGates.set(document, gate);}
    if (gate.shouldOpen({launched: live, spectator: snapshot.spectator, touchEnabled: service.getLauncherControlContext()?.options.touchEnabled === true})) help.openHelp({returnToGame: true});
  }, [service, live, snapshot.epoch, snapshot.spectator, help]);
  useEffect(() => {
    if (!fullscreen || !snapshot.ready) return;
    // Bind the prepared document before launch when possible; live/modal checks
    // remain event-time guards, so launching does not reorder its capture owner.
    const boundFrame = frame.current, epoch = snapshot.epoch, context = service.getInputContext();
    if (!boundFrame || !epoch) return;
    let target: Window | null, nativeDocument: Document | null;
    try {target = boundFrame.contentWindow;nativeDocument = boundFrame.contentDocument;} catch {return;}
    if (!target || !nativeDocument || context.target !== target || context.epoch !== epoch) return;
    const owner = bindPlayerFullscreenShortcut({host: window, child: target, toggle: () => {void fullscreen.toggle();}, current: () => {
      const now = current.current, input = service.getInputContext();
      if (!now.live || now.helpOpen || now.diagnosticsOpen || frame.current !== boundFrame || !boundFrame.isConnected ||
        input.epoch !== epoch || input.target !== target || !input.ready || !input.launched) return false;
      try {return boundFrame.contentWindow === target && boundFrame.contentDocument === nativeDocument;} catch {return false;}
    }});
    return () => owner.dispose();
  }, [fullscreen, frame, service, snapshot.epoch, snapshot.ready]);

  const failure = fullscreenState?.failure;
  const fullscreenError = failure === 'unsupported' ? t('fullscreen.unsupported') : failure === 'unconfirmed' ? t('ui.playerTools.fullscreenUnconfirmed')
    : failure === 'foreign' ? t('ui.playerTools.fullscreenForeign') : failure ? t('fullscreen.switchFailed', {reason: fullscreenState?.reason ?? ''}) : null;
  const actionClass = compact ? defaultButton : buttonClass;
  const actions = <>
    <HelpLink returnToGame onClick={closeMenu} className={actionClass} aria-label={t('ui.playerTools.inputHelp')}>{t('ui.playerTools.inputHelp')}</HelpLink>
    <button type="button" className={actionClass} disabled={!live || snapshot.spectator} title={t('touch.escapeTitle')} onClick={() => {closeMenu();focusCurrentGame();const accepted = escape.current?.activate() === true;setInputError(!accepted);if (!accepted && menu.current) menu.current.open = true;}}>{t('touch.escapeAria')}</button>
    <button type="button" className={actionClass} disabled={!live || !fullscreen || fullscreenState?.busy} aria-pressed={fullscreenState?.fullscreen ?? false}
      title={t(fullscreenState?.fullscreen ? 'player.exitFullscreenTitle' : 'player.enterFullscreenTitle')}
      onClick={() => {closeMenu();const epoch = snapshot.epoch;void fullscreen?.toggle().then(success => {if (!success && current.current.snapshot.epoch === epoch && menu.current) menu.current.open = true;});}}>{fullscreenState?.busy ? t('ui.playerTools.fullscreenPending') : failure ? t('ui.playerTools.retryFullscreen') : t(fullscreenState?.fullscreen ? 'player.exitFullscreen' : 'player.enterFullscreen')}</button>
    <button type="button" className={actionClass} onClick={() => {closeMenu();diagnosticFocus.current = {epoch: snapshot.epoch, frame: frame.current, locationKey: location.key};setDiagnosticsOpen(true);}}>{t('ui.playerTools.diagnostics')}</button>
    <button type="button" role="switch" aria-checked={hudEnabled} className={actionClass} onClick={() => {closeMenu();diagnosticsPreference.setEnabled(!hudEnabled);}}>{t('diagnostics.toggle')}</button>
    {(fullscreenError || inputError) && <p role="alert" className="col-span-full basis-full break-words px-2 text-sm text-accent">{fullscreenError}{inputError && t('ui.playerTools.pauseUnavailable')}</p>}
    {fullscreenState?.fullscreen && ['unavailable', 'failed'].includes(fullscreenState.keyboard) && <p role="status" className="col-span-full basis-full px-2 text-xs text-muted">
      {fullscreenState.keyboard === 'unavailable' ? t('ui.playerTools.keyboardUnsupported') : t('ui.playerTools.keyboardFailed', {reason: fullscreenState.keyboardReason ?? ''})}</p>}
  </>;
  return <>
    {compact ? <details ref={menu} className="relative min-w-0" data-player-tools-menu onKeyDown={event => {if (event.key === 'Escape' && menu.current?.open) {event.preventDefault();event.stopPropagation();closeMenu();}}}>
      <summary className={`${buttonClass} flex h-full cursor-pointer list-none items-center justify-center text-center`}>{t('ui.playerTools.tools')}</summary>
      <div className="absolute top-full right-0 z-[45] mt-2 grid w-[min(320px,calc(100vw-16px))] grid-cols-2 gap-2 rounded-2xl border border-line bg-panel p-3 shadow-menu">{actions}</div>
    </details> : actions}
    {surface?.element && live && createPortal(<PlayerOrientationControl epoch={snapshot.epoch}
      orientation={viewportSnapshot?.orientation ?? 'landscape'} fullscreen={fullscreenState?.fullscreen === true}
      hostControls={viewportSnapshot?.systemControls} enterFullscreen={async () => await fullscreen?.toggle() === true} placement="floating"
      enabled={live && new URLSearchParams(location.search).get('touchLayout') !== '1'}/>, surface.element)}
    {hudVisible && <PlayerToolsHud runtime={snapshot} service={service} frame={frame} scheduling={scheduling}/>}
    <PlayerToolsDiagnostics open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} service={service} runtime={snapshot} frame={frame} scheduling={scheduling}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const captured = diagnosticFocus.current;diagnosticFocus.current = null;
        if (captured && captured.locationKey === current.current.locationKey && captured.epoch === current.current.snapshot.epoch && captured.frame === frame.current && current.current.live && !current.current.helpOpen) {event.preventDefault();focusCurrentGame();}
      }}/>
  </>;
}

function PlayerToolsDiagnostics({open, onOpenChange, service, runtime, frame, scheduling, onCloseAutoFocus}: {
  open: boolean; onOpenChange(open: boolean): void; service: RuntimeService; runtime: RuntimeSnapshot;
  frame: RefObject<HTMLIFrameElement | null>; scheduling: PlayerSchedulingSnapshot | null; onCloseAutoFocus(event: Event): void;
}) {
  const {t} = useLocale(), [revision, setRevision] = useState(0), [exportError, setExportError] = useState<string | null>(null);
  const transfer = useMemo(() => createPlayerReportTransfer({
    copy: contents => navigator.clipboard?.writeText ? navigator.clipboard.writeText(contents) : Promise.reject(new Error('Clipboard API unavailable')),
    createUrl: contents => URL.createObjectURL(new Blob([contents], {type: 'application/json;charset=utf-8'})), revokeUrl: url => URL.revokeObjectURL(url),
  }), []);
  const transferState = useSyncExternalStore(transfer.subscribe, transfer.getSnapshot, transfer.getSnapshot);
  const download = useRef<HTMLAnchorElement>(null);
  const report: PlayerDiagnosticReport | null = useMemo(() => {
    if (!open) return null;
    const context = service.getInputContext(), target = frame.current?.contentWindow;
    const native = target && target === context.target && context.epoch === runtime.epoch && runtime.ready ? readPlayerNativeDiagnostics(target, runtime.runtimeVariant === 'multiplayer') : null;
    return createPlayerDiagnosticReport({runtime, network: service.getNetworkSnapshot(), native, scheduling,
      browser: typeof navigator === 'undefined' ? {} : {userAgent: navigator.userAgent, platform: navigator.platform}});
  }, [open, service, runtime.epoch, frame, revision]);
  // Report identity changes only on open/close, session replacement or explicit refresh.
  // Periodic native telemetry must not erase a successful copy or interrupt one.
  useLayoutEffect(() => {setExportError(null);transfer.setReport(open ? `${runtime.epoch}:${revision}` : null);}, [transfer, open, runtime.epoch, revision]);
  const transferLifetime = useRef(0);
  useEffect(() => {
    const lifetime = ++transferLifetime.current;
    return () => {queueMicrotask(() => {if (transferLifetime.current === lifetime) transfer.dispose();});};
  }, [transfer]);
  const contents = report ? playerDiagnosticReportText(report) : '';
  const missing = t('ui.playerTools.unavailable'), value = (input: unknown) => input == null ? missing : String(input);
  const net = report?.network.native;
  return <AnimatedDialog open={open} onOpenChange={onOpenChange} title={t('ui.playerTools.diagnostics')} description={t('ui.playerTools.measurementNote')} layer={70} onCloseAutoFocus={onCloseAutoFocus}>
    {report && <>
      <div className="space-y-2 break-words text-sm" data-diagnostic-health={report.health}>
        <p>{t('ui.playerTools.session', {game: value(report.session.game), phase: report.session.phase, epoch: value(report.session.epoch)})}</p>
        <p>{t('diagnostics.browser', {value: value(report.browser.name)})}</p>
        <p>{t('diagnostics.environment', {value: value(report.browser.platform)})}</p>
        <p>{t('ui.playerTools.browserFrames', {host: value(report.browserScheduling.hostRafHz === null ? null : Math.round(report.browserScheduling.hostRafHz)), child: value(report.browserScheduling.childRafHz === null ? null : Math.round(report.browserScheduling.childRafHz))})}</p>
        <p>{t('ui.playerTools.frame', {fps: value(report.frame.fps), gap: value(report.frame.maxGapMs)})}</p>
        <p>{t('diagnostics.audio', {value: `${value(report.audio.minQueuedMs)} ms · ${value(report.audio.backend)}${report.audio.robust ? ` · ${t('diagnostics.audioRobust')}` : ''}${report.audio.underruns !== null ? ` · ${t('diagnostics.audioUnderruns', {count: report.audio.underruns})}` : ''}`})}</p>
        <p>{t('diagnostics.graphics', {value: report.renderer.name ? report.renderer.compact : missing})}</p>
        <p>{t('ui.playerTools.downloads', {count: value(report.network.count), loaded: value(report.network.loaded), total: value(report.network.total)})}</p>
        {net ? <>
          <p>{t('diagnostics.network', {transport: value(net.transport), route: value(net.path), peers: net.peers.length, failure: ''})}</p>
          <p>{net.inputDelay === null ? missing : t('diagnostics.inputDelay', {frames: net.inputDelay})}</p>
          <p>{net.active ? t('diagnostics.sync', {frame: value(net.frame), confirmed: value(net.confirmed), peers: ''}) : t('diagnostics.syncWaiting')}</p>
          <p>{net.spectator ? t('diagnostics.spectatorRollback') : t('diagnostics.rollback', {rollback: value(net.rollback), resimulated: value(net.resimulated), advantage: value(net.advantage), pacing: value(net.pacing)})}</p>
        </> : report.session.runtimeVariant === 'multiplayer' && <p>{t('ui.playerTools.netplayUnavailable')}</p>}
      </div>
      <details className="mt-4"><summary className="cursor-pointer text-sm">{t('ui.playerTools.report')}</summary>
        <textarea readOnly aria-label={t('ui.playerTools.report')} className="mt-2 h-64 w-full rounded-xl border border-line bg-background p-3 font-mono text-xs" value={contents}/>
      </details>
      {transferState.status === 'failed' && <><p role="alert" className="mt-3 text-sm text-accent">{t('ui.playerTools.copyFailed', {reason: transferState.error ?? ''})}</p><textarea readOnly aria-label={t('ui.playerTools.report')} className="mt-2 h-40 w-full rounded-xl border border-line bg-background p-3 font-mono text-xs" value={contents} onFocus={event => event.currentTarget.select()}/></>}
      {exportError && <p role="alert" className="mt-3 text-sm text-accent">{t('ui.playerTools.exportFailed', {reason: exportError})}</p>}
      {transferState.status === 'copied' && <p role="status" className="mt-3 text-sm">{t('ui.playerTools.copied')}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={defaultButton} onClick={() => setRevision(value => value + 1)}>{t('ui.playerTools.refresh')}</button>
        <button type="button" disabled={transferState.status === 'copying'} className={defaultButton} onClick={() => void transfer.copy(contents)}>{t(transferState.status === 'copying' ? 'ui.playerTools.copying' : 'ui.playerTools.copy')}</button>
        <button type="button" className={defaultButton} onClick={() => {
          try {
            setExportError(null);const href = transfer.download(contents);if (!href || !download.current) return;
            download.current.href = href;download.current.download = `eagler-${runtime.game ?? 'runtime'}-diagnostics-${runtime.epoch ?? 0}.json`;download.current.click();
          } catch (error) {setExportError(error instanceof Error ? error.message : String(error));}
        }}>{t('ui.playerTools.export')}</button>
        <a ref={download} hidden aria-hidden="true"/>
        <button type="button" className={defaultButton} onClick={() => onOpenChange(false)}>{t('ui.playerTools.close')}</button>
      </div>
    </>}
  </AnimatedDialog>;
}

function PlayerToolsHud({runtime, service, frame, scheduling}: {runtime: RuntimeSnapshot; service: RuntimeService;
  frame: RefObject<HTMLIFrameElement | null>; scheduling: PlayerSchedulingSnapshot | null;
}) {
  const {t} = useLocale(), surface = usePlayerSurface();
  if (!surface?.element) return null;
  const context = service.getInputContext(), target = frame.current?.contentWindow;
  const native = target && context.target === target && context.epoch === runtime.epoch && runtime.ready ? readPlayerNativeDiagnostics(target, runtime.runtimeVariant === 'multiplayer') : null;
  const report = createPlayerDiagnosticReport({runtime, network: service.getNetworkSnapshot(), native, scheduling,
    browser: {userAgent: navigator.userAgent, platform: navigator.platform}});
  const value = (number: number | null | undefined) => number == null ? '--' : Math.round(number);
  const net = report.network.native;
  return createPortal(<aside aria-label={t('diagnostics.aria')} data-player-diagnostics-hud data-diagnostic-health={report.health}
    className={`pointer-events-none fixed right-[max(8px,env(safe-area-inset-right))] bottom-[max(8px,env(safe-area-inset-bottom))] z-[31] grid max-w-[min(430px,72vw)] justify-items-end gap-0.5 overflow-hidden px-2 py-1 text-right font-mono text-[8px] leading-tight ${report.health === 'bad' ? 'text-red-300' : report.health === 'warn' ? 'text-amber-200' : 'text-white/75'}`}>
    <span>{t('diagnostics.browser', {value: report.browser.name ?? '--'})}</span>
    <span>{t('ui.playerTools.browserFrames', {host: value(scheduling?.hostRafHz), child: value(scheduling?.childRafHz)})}</span>
    <span>{t('ui.playerTools.frame', {fps: value(report.frame.fps), gap: value(report.frame.maxGapMs)})}</span>
    <span>{t('diagnostics.audio', {value: `${value(report.audio.minQueuedMs)}ms ${report.audio.backend ?? '--'} ${report.audio.robust ? t('diagnostics.audioRobust') : ''} ${report.audio.underruns !== null ? t('diagnostics.audioUnderruns', {count: report.audio.underruns}) : ''}`})}</span>
    <span className="max-w-full truncate">{t('diagnostics.graphics', {value: report.renderer.compact})}</span>
    {net && <><span>{t('diagnostics.network', {transport: net.transport ?? '--', route: net.path ?? '--', peers: net.peers.length, failure: ''})}</span>
      <span>{t('diagnostics.sync', {frame: value(net.frame), confirmed: value(net.confirmed), peers: ''})}</span></>}
  </aside>, surface.element);
}
