import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {useLocation, useNavigate} from 'react-router';
import {useBrowserServices} from '../services/browser-services';
import {useUiPreferences, useUiText} from '../services/ui-preferences';
import {compactRendererLabel, runtimeDiagnosticsVisibleByDefault} from '../../src/launcher/runtime-diagnostics-model.mts';
import {Button, Dialog} from '../ui';
import {createRuntimeInput} from './input-controller';
import {bindRuntimeKeyboard} from './input-dom';
import {TouchControls} from './input-controls';
import styles from './runtime.module.css';
import {runtimePresentationActive} from './presentation';
const emptySubscribe = () => () => {};

/** One permanent iframe, outside the route tree. Neither route overlays,
 * orientation/layout changes nor failed saves can replace its browsing context. */
export function RuntimeHost() {
  const services = useBrowserServices();
  const t = useUiText(); const ui = useUiPreferences();
  const frame = useRef<HTMLIFrameElement>(null);
  const location = useLocation(); const navigate = useNavigate();
  const [saveError, setSaveError] = useState('');
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const [modalPresent, setModalPresent] = useState(false);
  const [viewportOffset, setViewportOffset] = useState(0);
  const snapshot = useSyncExternalStore(services?.runtime.subscribe ?? emptySubscribe, () => services?.runtime.getSnapshot() ?? null, () => null);
  const input = useMemo(() => services ? createRuntimeInput(services.runtime) : null, [services]);
  // Preflight may initialize Runtime before a room starts. Preserve full layout
  // dimensions while invisible and inert; it must not cover or focus the room.
  const active = runtimePresentationActive(snapshot);
  const routeOverlay = /\/(help|resources|replays)\/?$/.test(location.pathname);
  const diagnosticsVisible = runtimeDiagnosticsVisibleByDefault(snapshot?.metadata?.hostManifest?.shared.testBuild, snapshot?.launched, ui.diagnostics);
  const diagnostic = (name: string): Record<string, unknown> => (snapshot?.diagnostics?.[name] as Record<string, unknown>) ?? {};
  const health = diagnostic('frame-health'); const audio = diagnostic('audio-health'); const info = diagnostic('runtime-info');
  const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : '--';
  const blocked = modalPresent || routeOverlay || !!saveError || discardConfirmation || busy;
  useEffect(() => {if (services && frame.current) services.runtime.bindFrame(frame.current);}, [services]);
  useEffect(() => {
    if (!input || !services) return;
    input.synchronizeSession();
    const unsubscribe = services.runtime.subscribe(input.synchronizeSession);
    const unbind = bindRuntimeKeyboard(input);
    return () => {unsubscribe(); unbind(); input.dispose();};
  }, [input, services]);
  useEffect(() => {
    const update = () => setModalPresent(!!document.querySelector('[data-ui-dialog-live]'));
    const observer = new MutationObserver(update); update();
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-ui-dialog-live']});
    return () => observer.disconnect();
  }, []);
  useEffect(() => {input?.setSuspended(!active || blocked);}, [active, blocked, input]);
  useEffect(() => {if (snapshot?.firstFrame) input?.syncControls();}, [snapshot?.firstFrame, snapshot?.epoch, input]);
  useEffect(() => {
    if (!active || blocked || !snapshot?.ready || snapshot.spectator) return;
    const id = requestAnimationFrame(() => {if (document.hasFocus() && !document.querySelector('[data-ui-dialog-live]')) frame.current?.focus({preventScroll: true});});
    return () => cancelAnimationFrame(id);
  }, [active, blocked, snapshot?.ready, snapshot?.epoch, snapshot?.spectator, snapshot?.phase]);
  useEffect(() => {
    if (!snapshot?.launched && snapshot?.phase !== 'saving') return;
    const guard = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [snapshot?.launched, snapshot?.phase]);
  useEffect(() => {setSaveError(''); setDiscardConfirmation(false); setViewportOffset(0);}, [snapshot?.epoch]);
  const offset = useCallback((value: number) => setViewportOffset(value), []);
  function help() {
    if (!snapshot?.productId || routeOverlay) return;
    input?.setSuspended(true);
    void navigate(`/games/${snapshot.productId}/help`, {state: {from: `${location.pathname}${location.search}`}});
  }
  async function close(discardUnsaved = false) {
    if (!services || busy) return;
    setBusy(true); input?.setSuspended(true);
    try {await services.runtime.close({discardUnsaved}); setSaveError(''); setDiscardConfirmation(false);}
    catch (reason) {setSaveError(reason instanceof Error ? reason.message : String(reason));}
    finally {setBusy(false);}
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError(false);
    } catch {setFullscreenError(true);}
  }
  return <section className={styles.host} data-runtime-active={active ? 'true' : 'false'} aria-hidden={!active || undefined} inert={!active || undefined} aria-label="运行中的游戏">
    <div className={styles.toolbar}>
      <div className={styles.identity}><strong>{snapshot?.productId?.toUpperCase()}</strong><span>{snapshot?.spectator ? t('ui.runtime.readOnly') : snapshot?.phase === 'saving' ? t('ui.runtime.saving') : t('ui.runtime.running')}</span></div>
      <Button size="sm" onClick={() => void fullscreen()} aria-label={t('ui.runtime.fullscreen')}>{t('ui.runtime.fullscreen')}</Button>
      <Button size="sm" onClick={help} disabled={routeOverlay}>{t('ui.runtime.help')}</Button>
      <Button size="sm" onClick={() => void close()} disabled={busy}>{snapshot?.phase === 'saving' ? t('ui.runtime.saving') : t('ui.runtime.saveExit')}</Button>
    </div>
    <div className={styles.stage}>
      <iframe ref={frame} title="东方游戏 Runtime" className={styles.frame} style={{transform: `translateX(${viewportOffset * 100}%)`}} allow="autoplay; fullscreen; gamepad" allowFullScreen />
      {input && snapshot?.game && <TouchControls input={input} frame={frame} game={snapshot.game} options={snapshot.inputOptions}
        enabled={active && snapshot.launched && snapshot.inputOptions.touchEnabled && !snapshot.spectator && !blocked} onViewportOffset={offset}/>} 
      {active && !snapshot?.firstFrame && <div className={styles.loading} role="status">{t('ui.runtime.firstFrame')}</div>}
      {snapshot?.spectator && <div className={styles.spectator} role="status">{t('ui.runtime.readOnly')}</div>}
    </div>
    {diagnosticsVisible && <aside className={styles.diagnostics} aria-label={t('diagnostics.aria')}>
      <span>FPS {numeric(health.fps)} · {t('diagnostics.maxGap', {value: `${numeric(health.maxGapMs)} ms`})}</span>
      <span>{t('diagnostics.graphics', {value: compactRendererLabel(info.renderer)})}</span>
      <span>{t('diagnostics.audio', {value: `${audio.backend ?? '--'} · ${numeric(audio.minQueuedMs)} ms`})} · {t('diagnostics.audioUnderruns', {count: numeric(audio.underruns)})}</span>
    </aside>}
    {(fullscreenError || snapshot?.error) && <p className={styles.notice} role="alert">{fullscreenError ? t('ui.runtime.fullscreenBlocked') : snapshot?.error}</p>}
    <Dialog open={!!saveError} onOpenChange={open => {if (!open && !busy) {setSaveError(''); setDiscardConfirmation(false);}}} title={t(discardConfirmation ? 'ui.runtime.discardQuestion' : 'ui.runtime.saveFailed')}
      description={t('ui.runtime.saveRetained')} footer={<>
        <Button disabled={busy} onClick={() => {setSaveError(''); setDiscardConfirmation(false);}}>{t('action.stayInGame')}</Button>
        {discardConfirmation ? <Button disabled={busy} variant="danger" onClick={() => void close(true)}>{t('ui.runtime.discardConfirm')}</Button> : <>
          <Button disabled={busy} variant="danger" onClick={() => setDiscardConfirmation(true)}>{t('ui.runtime.discard')}</Button>
          <Button disabled={busy} variant="primary" onClick={() => void close()}>{t('action.retrySave')}</Button>
        </>}
      </>}><p role="alert">{discardConfirmation ? t('ui.runtime.discardWarning') : saveError}</p></Dialog>
  </section>;
}
