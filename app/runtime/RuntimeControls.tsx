import {useLocale} from '../components/LocaleProvider';
import {useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {PlayerTools} from './PlayerTools';
import {useHostPublication} from '../components/ResourceManagerProvider';
import {HelpLink} from '../components/HelpPanel';
import {AnimatedDialog} from '../components/AnimatedDialog';
import {ManagementSurfacePortal} from '../components/ManagementSurface';
import {useBlocker, useLocation, type BlockerFunction, type Location} from 'react-router';
import {MotionConfig, motion, useAnimationControls} from 'motion/react';
import {useMotionPreference} from '../components/MotionPreferenceProvider';
import type {RuntimeService, RuntimeSnapshot} from '../services/runtime.client';
import {useRuntimeService} from './RuntimeHost';
import {useRuntimeViewportSnapshot} from './RuntimeViewport';
import {leavesProductManagement} from './route-session.mts';
import {useNavigationDraftRegistry} from '../components/NavigationDrafts';
import type {NavigationDraft} from '../services/navigation-drafts';

const subscribeNone = () => () => {};
const emptySnapshot = () => null;
const buttonClass = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-bold transition-colors hover:bg-nav-hover hover:text-nav-ink disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none';

/** Preparation owns a session too, even before a Runtime has reported ready. */
export function isRuntimeSessionActive(snapshot: RuntimeSnapshot | null): boolean {
  return !!snapshot && (snapshot.epoch !== null || snapshot.ready || snapshot.launched ||
    ['loading', 'configuring', 'prepared', 'launching', 'running', 'saving'].includes(snapshot.phase));
}

function hasTerminalSaveLoss(snapshot: RuntimeSnapshot | null): boolean {
  return !!snapshot?.saveError && (snapshot.saveUnavailable || !isRuntimeSessionActive(snapshot));
}

function hasCloseWarning(snapshot: RuntimeSnapshot | null): boolean {
  return !!snapshot && (!!snapshot.saveError || !!snapshot.closeError);
}

interface CloseFailure {kind: 'save' | 'close'; message: string}
function closeFailure(snapshot: RuntimeSnapshot, fallback: string): CloseFailure {
  return {kind: snapshot.saveError ? 'save' : 'close',
    message: snapshot.saveError ?? snapshot.closeError ?? fallback};
}

interface NavigationAttempt {serial: number; location: Location; drafts: NavigationDraft[]; runtimeExit: boolean}
interface CloseIntent {
  serial: number;
  drafts?: NavigationDraft[];
  runtimeExit?: boolean;
  navigation?: {location: Location; proceed(): void; reset(): void};
}
interface CloseOperation {intent: CloseIntent; service: RuntimeService; saving: boolean}

export function RuntimeControls() {
  const publication = useHostPublication();
  return <RuntimeControlsForService service={useRuntimeService()} tools={(buttonClass,compact)=><PlayerTools buttonClass={buttonClass} compact={compact} testBuild={publication?.testBuild === true}/>}/>;
}

/** Injection seam for synthetic UI tests; production has one root-owned service. */
export function RuntimeControlsForService({service, tools}: {service: RuntimeService | null; tools?: (buttonClass: string, compact: boolean) => ReactNode}) {
  const {t} = useLocale();
  const {reducedMotion} = useMotionPreference();
  const toolbarAnimation = useAnimationControls();
  const snapshot = useSyncExternalStore(service?.subscribe ?? subscribeNone, service?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const viewport = useRuntimeViewportSnapshot();
  const location = useLocation();
  const drafts = useNavigationDraftRegistry();
  const draftRegistry = useRef(drafts);
  useLayoutEffect(() => {draftRegistry.current = drafts;}, [drafts]);
  const draftOperation = useRef<CloseIntent | null>(null);
  const [draftFailure, setDraftFailure] = useState<string | null>(null);
  const [intent, setIntent] = useState<CloseIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CloseFailure | null>(null);
  const mounted = useRef(false);
  const currentService = useRef(service);
  const serial = useRef(0);
  const attempt = useRef<NavigationAttempt | null>(null);
  const currentIntent = useRef<CloseIntent | null>(null);
  const operation = useRef<CloseOperation | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const exitButton = useRef<HTMLButtonElement>(null);

  // The public predicate runs synchronously on every navigation attempt. A
  // promise finishing before React commits the next blocker render must still
  // see that its original destination has been superseded (including query-only
  // navigation). No private Router context, subscription or history owner.
  const shouldBlock = useCallback<BlockerFunction>(({currentLocation, nextLocation}) => {
    const ticket = ++serial.current;
    const current = currentService.current?.getSnapshot() ?? null;
    const blockedDrafts = draftRegistry.current?.blocking(currentLocation, nextLocation) ?? [];
    const runtimeExit = leavesProductManagement(currentLocation.pathname, nextLocation.pathname) &&
      (isRuntimeSessionActive(current) || hasCloseWarning(current) || operation.current !== null || (currentIntent.current !== null && !currentIntent.current.drafts?.length));
    const blocked = runtimeExit || blockedDrafts.length > 0;
    attempt.current = blocked ? {serial: ticket, location: nextLocation, drafts: blockedDrafts, runtimeExit} : null;
    return blocked;
  }, []);
  const blocker = useBlocker(shouldBlock);

  function showIntent(next: CloseIntent) {
    if (!currentIntent.current) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    restoreFocus.current = true;
    currentIntent.current = next;
    setFailure(null);
    setDraftFailure(null);
    setIntent(next);
  }

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      serial.current++;
      currentIntent.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    currentService.current = service;
    // A replacement owner cannot inherit consent or completion from the old one.
    serial.current++;
    currentIntent.current = null;
    attempt.current = null;
    operation.current = null;
    draftOperation.current = null;
    setBusy(false);
    setIntent(null);
    setFailure(null);
    if (blocker.state === 'blocked') blocker.reset();
    // This invalidation belongs to owner replacement, not blocker updates.
  }, [service]);

  useEffect(() => {
    const next = attempt.current;
    if (blocker.state === 'blocked' && next && next.location.key === blocker.location.key) {
      if (currentIntent.current?.serial !== next.serial) {
        showIntent({serial: next.serial, drafts: next.drafts, runtimeExit: next.runtimeExit, navigation: {location: blocker.location, proceed: blocker.proceed, reset: blocker.reset}});
      }
    } else if (currentIntent.current && currentIntent.current.serial !== serial.current) {
      // An allowed same-path Help/Back navigation supersedes an older intent.
      restoreFocus.current = false;
      currentIntent.current = null;
      setIntent(null);
      setFailure(null);
    }
  }, [blocker, location.key]);

  const ownsIntent = (target: CloseIntent) => mounted.current && currentIntent.current === target && serial.current === target.serial;

  function stay() {
    const target = currentIntent.current;
    if (!target || operation.current || draftOperation.current || !ownsIntent(target)) return;
    target.navigation?.reset();
    serial.current++;
    attempt.current = null;
    currentIntent.current = null;
    restoreFocus.current = true;
    setIntent(null);
    setFailure(null);
  }

  function finish(target: CloseIntent) {
    if (!ownsIntent(target)) return;
    restoreFocus.current = !target.navigation;
    // Toolbar exit removes its own trigger without changing routes. Keep a
    // keyboard user on the stable launcher content rather than the document body.
    if (!target.navigation) returnFocus.current = document.getElementById('main-content');
    currentIntent.current = null;
    attempt.current = null;
    setIntent(null);
    setFailure(null);
    target.navigation?.proceed();
  }

  async function resolveDrafts(discard = false) {
    const target = currentIntent.current;
    if (!target || !ownsIntent(target) || operation.current || draftOperation.current) return;
    draftOperation.current = target; setBusy(true); setDraftFailure(null);
    try {
      for (const draft of target.drafts ?? []) {
        if (!ownsIntent(target)) return;
        if (!draftRegistry.current?.owns(draft)) throw new Error(t('react.runtime.draftChanged'));
        if (discard) draft.discard(); else await draft.save();
      }
      if (!ownsIntent(target)) return;
      const live = currentService.current?.getSnapshot() ?? null;
      const needsRuntimeExit = !!target.navigation && leavesProductManagement(location.pathname, target.navigation.location.pathname) &&
        (isRuntimeSessionActive(live) || hasCloseWarning(live) || operation.current !== null);
      if (needsRuntimeExit) {
        const next = {...target, drafts: [], runtimeExit: true};
        currentIntent.current = next; setIntent(next);
      } else finish(target);
    } catch (error) {
      if (ownsIntent(target)) setDraftFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (draftOperation.current === target) {draftOperation.current = null;if (mounted.current) setBusy(false);}
    }
  }

  async function close(discardUnsaved = false) {
    const target = currentIntent.current;
    if (!service || !target || !ownsIntent(target) || operation.current) return;
    const before = service.getSnapshot();
    // Cleanup can retain an epoch after the native document is already lost.
    // That retained ownership is never evidence that another save is possible.
    if (hasTerminalSaveLoss(before) && !discardUnsaved) {
      setFailure(closeFailure(before, t('react.runtime.endedSave')));return;
    }
    if (!isRuntimeSessionActive(before) && !hasCloseWarning(before)) {finish(target);return;}
    const task: CloseOperation = {intent: target, service, saving: !discardUnsaved && !before.saveUnavailable && before.ready};
    operation.current = task;
    setBusy(true);
    setFailure(null);
    try {
      // A failed save defaults to stay in the service. Retry and explicit
      // discard re-enter this same path; the UI never calls cancel/dispose.
      const closed = await service.close({discardUnsaved});
      if (!mounted.current || currentService.current !== service) return;
      if (!ownsIntent(target)) return;
      const after = service.getSnapshot();
      if (closed && !isRuntimeSessionActive(after) && !hasCloseWarning(after)) finish(target);
      else setFailure(closeFailure(after, closed
        ? t('react.runtime.sessionChanged')
        : t('react.runtime.closeIncompleteHint')));
    } catch (error) {
      if (ownsIntent(target) && currentService.current === service) setFailure(closeFailure(service.getSnapshot(), error instanceof Error ? error.message : String(error)));
    } finally {
      if (operation.current === task) {
        operation.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  const draftPending = !!intent?.drafts?.length;
  const active = isRuntimeSessionActive(snapshot);
  const terminalSaveLoss = hasTerminalSaveLoss(snapshot);
  const closingWithoutSave = busy && operation.current?.saving === false;
  const saveFailure = snapshot?.saveError ?? (failure?.kind === 'save' ? failure.message : null);
  const exitFailure = snapshot?.closeError ?? (failure?.kind === 'close' ? failure.message : null)
    ?? (active && snapshot?.saveUnavailable && !snapshot.saveError ? t('react.runtime.cleanupIncomplete') : null);
  const stateLabel = terminalSaveLoss ? t('react.runtime.endedUnexpectedly')
    : exitFailure ? t('react.runtime.exitIncomplete')
    : snapshot?.fileOperationBusy ? t('react.runtime.fileBusy')
    : snapshot?.phase === 'saving' ? t('react.runtime.saving')
    : snapshot?.phase === 'launching' ? t('room.starting')
    : snapshot?.phase === 'running' ? t('react.runtime.running')
    : snapshot?.phase === 'prepared' ? t('react.runtime.prepared')
    : snapshot?.phase === 'error' ? t('react.runtime.attention')
    : t('react.runtime.preparing');

  const touchToolbar = snapshot?.launched && viewport?.epoch === snapshot.epoch &&
    service?.getLauncherControlContext()?.options.touchEnabled === true ? viewport?.systemControls : null;
  const toolbarVisible = active || terminalSaveLoss || !!exitFailure;
  useLayoutEffect(() => {
    // Restart only this decorative transition when preference changes, including
    // an in-flight entrance. No Runtime, toolbar child or focus owner remounts.
    if (toolbarVisible) void toolbarAnimation.start({opacity: 1, y: 0, transition: {duration: reducedMotion ? 0 : .18}});
  }, [toolbarAnimation, toolbarVisible, reducedMotion]);
  const toolbarButtonClass = touchToolbar ? 'min-h-11 min-w-0 rounded-xl bg-panel/95 px-1 py-2 text-[10px] font-bold leading-tight hover:bg-nav-hover hover:text-nav-ink' : buttonClass;
  return <>
    {toolbarVisible && <ManagementSurfacePortal>{docked => <MotionConfig reducedMotion="never"><motion.div role="toolbar" data-runtime-toolbar="" data-reduced-motion={reducedMotion} aria-label={t('react.runtime.toolbar')} initial={{opacity: 0, y: reducedMotion ? 0 : -8}} animate={toolbarAnimation}
      style={!docked && touchToolbar ? {left: touchToolbar.left, top: touchToolbar.top, width: touchToolbar.width, minHeight: touchToolbar.height, right: 'auto'} : undefined}
      className={docked ? 'flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel p-2 text-paper' : touchToolbar ? 'fixed z-30 grid grid-cols-2 gap-2 text-paper' : 'fixed top-[max(8px,env(safe-area-inset-top))] right-[max(8px,env(safe-area-inset-right))] left-[max(8px,env(safe-area-inset-left))] z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel/95 p-2 text-paper shadow-menu sm:left-auto sm:max-w-xl'}>
      <span role="status" className={touchToolbar ? 'sr-only' : 'mr-auto px-2 text-sm'}>{stateLabel}</span>
      {tools ? tools(toolbarButtonClass,!!touchToolbar) : <HelpLink aria-label={t('react.runtime.helpAria')} className={toolbarButtonClass}>{t('help.controlsTitle')}</HelpLink>}
      <button ref={exitButton} type="button" className={toolbarButtonClass} onClick={() => {
        if (currentIntent.current || operation.current) return;
        showIntent({serial: ++serial.current});
      }}>{terminalSaveLoss ? t('react.runtime.resolveSave') : exitFailure ? t('react.runtime.resolveExit') : t('react.runtime.exit')}</button>
      <div className={touchToolbar ? 'absolute top-full right-0 mt-2 w-[min(320px,calc(100vw-16px))] rounded-xl bg-panel/95' : 'contents'}>
        {snapshot?.epoch != null && snapshot.musicWarning && <p role="status" data-runtime-music-warning={snapshot.epoch} className="basis-full px-2 text-xs leading-relaxed text-accent">{snapshot.musicWarning}</p>}
        {terminalSaveLoss
        ? <p role="alert" className="basis-full px-2 text-sm text-accent">{t('react.runtime.terminalWarning', {reason:snapshot?.saveError})}</p>
        : exitFailure ? <p role="alert" className="basis-full px-2 text-sm text-accent">{t('react.runtime.exitWarning', {reason:exitFailure})}</p>
          : snapshot?.phase === 'error' && snapshot.error && <p role="alert" className="basis-full px-2 text-sm text-accent">{t('react.runtime.errorWarning', {reason:snapshot.error})}</p>}</div>
    </motion.div></MotionConfig>}</ManagementSurfacePortal>}
    <AnimatedDialog open={!!intent} onOpenChange={open => {if (!open) stay();}} layer={90}
      title={draftPending ? t('react.runtime.saveDraftTitle') : terminalSaveLoss ? t('react.runtime.endedSaveTitle') : saveFailure ? t('react.runtime.saveIncomplete') : exitFailure ? t('react.runtime.exitIncomplete') : t('react.runtime.endTitle')}
      description={draftPending ? t('react.runtime.draftHint') : terminalSaveLoss ? t('react.runtime.lossHint') : exitFailure && !saveFailure ? snapshot?.saveUnavailable
        ? t('react.runtime.cleanupHint')
        : t('react.runtime.retryHint') : <>
        {intent?.navigation ? t('react.runtime.leaveHint') : t('react.runtime.saveBeforeExit')}
        {active ? t('react.runtime.saveFirst') : t('react.runtime.alreadyEnded')}
      </>}
      onEscapeKeyDown={event => {if (busy) event.preventDefault();}}
      onPointerDownOutside={event => event.preventDefault()}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (restoreFocus.current) {
          const target = returnFocus.current?.isConnected ? returnFocus.current : exitButton.current;
          target?.focus({preventScroll: true});
        }
      }}>
            {draftPending ? <>
              <p className="mb-4 text-sm">{intent?.drafts?.map(draft => draft.label).join(t('react.shell.creditSeparator'))}</p>
              {draftFailure && <p role="alert" className="mb-4 text-sm text-accent">{draftFailure}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={buttonClass} onClick={() => void resolveDrafts()}>{busy ? t('react.runtime.processing') : t('react.runtime.saveContinue')}</button>
                <button type="button" disabled={busy} className={buttonClass} onClick={stay}>{t('react.runtime.keepEditing')}</button>
                <button type="button" disabled={busy} className={buttonClass} onClick={() => void resolveDrafts(true)}>{t('react.runtime.discardContinue')}</button>
              </div>
            </> : <>
            {intent?.navigation && <p className="mb-4 break-all text-sm text-muted">{t('react.runtime.targetPage')}{intent.navigation.location.pathname}{intent.navigation.location.search}{intent.navigation.location.hash}</p>}
            {saveFailure && <p role="alert" className="mb-4 text-sm text-accent">{saveFailure} {terminalSaveLoss ? t('react.runtime.noResave') : t('react.runtime.unsavedRisk')}</p>}
            {exitFailure && <p role="alert" className="mb-4 text-sm text-accent">{exitFailure} {terminalSaveLoss ? t('react.runtime.cleanupRisk') : t('react.runtime.noAutoNavigate')}</p>}
            {busy && <p role="status" className="mb-4 text-sm text-nav">{closingWithoutSave ? t('react.runtime.confirmingExit') : t('react.runtime.savingWait')}</p>}
            <div className="flex flex-wrap gap-2">
              {!terminalSaveLoss && <button type="button" disabled={busy} className={buttonClass} onClick={() => void close()}>{busy ? closingWithoutSave ? t('lobby.releasing') : t('react.runtime.savingProgress') : saveFailure ? t('react.runtime.retrySaveExit') : exitFailure ? t('react.runtime.retryExit') : !active ? t('react.runtime.confirmLeave') : t('react.runtime.saveExit')}</button>}
              <button type="button" disabled={busy} className={buttonClass} onClick={stay}>{terminalSaveLoss || exitFailure && !saveFailure ? t('react.runtime.stayHere') : saveFailure ? t('react.runtime.stayGame') : t('lobby.cancel')}</button>
              {(terminalSaveLoss || !!snapshot?.saveError) && <button type="button" disabled={busy} className={`${buttonClass} text-accent`} onClick={() => void close(true)}>{terminalSaveLoss ? t('react.runtime.acknowledgeLoss') : t('react.runtime.exitWithoutSave')}</button>}
            </div>
            </>}
    </AnimatedDialog>
  </>;
}
