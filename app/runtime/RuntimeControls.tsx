import {useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {AnimatedDialog} from '../components/AnimatedDialog';
import {Link, useBlocker, useLocation, type BlockerFunction, type Location} from 'react-router';
import {motion} from 'motion/react';
import type {RuntimeService, RuntimeSnapshot} from '../services/runtime.client';
import {useRuntimeService} from './RuntimeHost';

const subscribeNone = () => () => {};
const emptySnapshot = () => null;
const buttonClass = 'min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-bold transition-colors hover:bg-nav-hover hover:text-nav-ink disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none';

/** Preparation owns a session too, even before a Runtime has reported ready. */
export function isRuntimeSessionActive(snapshot: RuntimeSnapshot | null): boolean {
  return !!snapshot && (snapshot.epoch !== null || snapshot.ready || snapshot.launched ||
    ['loading', 'configuring', 'prepared', 'launching', 'running', 'saving'].includes(snapshot.phase));
}

interface NavigationAttempt {serial: number; location: Location}
interface CloseIntent {
  serial: number;
  navigation?: {location: Location; proceed(): void; reset(): void};
}
interface CloseOperation {intent: CloseIntent; service: RuntimeService; discardUnsaved: boolean}

export function RuntimeControls() {
  return <RuntimeControlsForService service={useRuntimeService()}/>;
}

/** Injection seam for synthetic UI tests; production has one root-owned service. */
export function RuntimeControlsForService({service}: {service: RuntimeService | null}) {
  const snapshot = useSyncExternalStore(service?.subscribe ?? subscribeNone, service?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const location = useLocation();
  const [intent, setIntent] = useState<CloseIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
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
    const blocked = currentLocation.pathname !== nextLocation.pathname &&
      (isRuntimeSessionActive(current) || !!current?.saveError || operation.current !== null || currentIntent.current !== null);
    attempt.current = blocked ? {serial: ticket, location: nextLocation} : null;
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
        showIntent({serial: next.serial, navigation: {location: blocker.location, proceed: blocker.proceed, reset: blocker.reset}});
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
    if (!target || operation.current || !ownsIntent(target)) return;
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

  async function close(discardUnsaved = false) {
    const target = currentIntent.current;
    if (!service || !target || !ownsIntent(target) || operation.current) return;
    const before = service.getSnapshot();
    if (!isRuntimeSessionActive(before)) {
      if (!before.saveError) {finish(target);return;}
      // A lost native session cannot save again. Absence of a live iframe/session
      // is not evidence of a successful save or consent to leave its warning.
      if (!discardUnsaved) {setFailure(before.saveError);return;}
    }
    const task: CloseOperation = {intent: target, service, discardUnsaved};
    operation.current = task;
    setBusy(true);
    setFailure(null);
    try {
      // A failed save defaults to stay in the service. Retry and explicit
      // discard re-enter this same path; the UI never calls cancel/dispose.
      const closed = await service.close({discardUnsaved});
      if (!mounted.current || currentService.current !== service) return;
      if (!ownsIntent(target)) return;
      if (closed && !isRuntimeSessionActive(service.getSnapshot()) && !service.getSnapshot().saveError) finish(target);
      else setFailure(service.getSnapshot().saveError ?? (closed
        ? '游戏会话已更改，请重新确认。'
        : '保存未完成，游戏仍保留。请重试，或选择留在游戏中。'));
    } catch (error) {
      if (ownsIntent(target) && currentService.current === service) setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (operation.current === task) {
        operation.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  const active = isRuntimeSessionActive(snapshot);
  const terminalSaveLoss = !active && !!snapshot?.saveError;
  const discarding = busy && operation.current?.discardUnsaved === true;
  const saveFailure = failure ?? snapshot?.saveError;
  const helpQuery = new URLSearchParams(location.search);
  helpQuery.set('panel', 'help');
  const stateLabel = terminalSaveLoss ? '游戏已意外结束'
    : snapshot?.phase === 'saving' ? '正在保存'
    : snapshot?.phase === 'launching' ? '正在启动'
    : snapshot?.phase === 'running' ? '游戏运行中'
    : snapshot?.phase === 'prepared' ? '准备完成，尚未启动'
    : snapshot?.phase === 'error' ? '游戏需要处理'
    : '正在准备游戏';

  return <>
    {(active || terminalSaveLoss) && <motion.div role="toolbar" aria-label="游戏会话控制" initial={{opacity: 0, y: -8}} animate={{opacity: 1, y: 0}} transition={{duration: .18}}
      className="fixed top-[max(8px,env(safe-area-inset-top))] right-[max(8px,env(safe-area-inset-right))] left-[max(8px,env(safe-area-inset-left))] z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel/95 p-2 text-paper shadow-menu sm:left-auto sm:max-w-xl">
      <span role="status" className="mr-auto px-2 text-sm">{stateLabel}</span>
      <Link to={{pathname: location.pathname, search: helpQuery.toString(), hash: location.hash}} state={{returnTo: location.pathname}} aria-label="游戏操作说明" className={buttonClass}>操作说明</Link>
      <button ref={exitButton} type="button" className={buttonClass} onClick={() => {
        if (currentIntent.current || operation.current) return;
        showIntent({serial: ++serial.current});
      }}>{terminalSaveLoss ? '处理保存失败' : '退出游戏'}</button>
      {terminalSaveLoss
        ? <p role="alert" className="basis-full px-2 text-sm text-accent">{snapshot?.saveError}。会话已结束，无法重试保存；未保存的进度可能已丢失。</p>
        : snapshot?.phase === 'error' && snapshot.error && <p role="alert" className="basis-full px-2 text-sm text-accent">{snapshot.error}。游戏仍保留，可尝试保存后退出。</p>}
    </motion.div>}
    <AnimatedDialog open={!!intent} onOpenChange={open => {if (!open) stay();}} layer={70}
      title={terminalSaveLoss ? '游戏已结束，保存未完成' : saveFailure ? '保存未完成' : '结束当前游戏？'}
      description={terminalSaveLoss ? '游戏会话已意外结束，无法再重试保存。离开前请确认你已了解未保存进度可能丢失。' : <>
        {intent?.navigation ? '离开当前页面前，需要结束当前游戏会话。' : '退出前会尝试保存当前游戏进度。'}
        {active ? '保存成功后才会结束；准备中的会话也会一并关闭。' : '游戏会话已结束，请确认是否继续离开。'}
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
            {intent?.navigation && <p className="mb-4 break-all text-sm text-muted">目标页面：{intent.navigation.location.pathname}{intent.navigation.location.search}{intent.navigation.location.hash}</p>}
            {saveFailure && <p role="alert" className="mb-4 text-sm text-accent">{saveFailure} {terminalSaveLoss ? '确认丢失风险并离开不会重新保存。' : '未保存的进度可能丢失，请谨慎选择不保存退出。'}</p>}
            {busy && <p role="status" className="mb-4 text-sm text-nav">{discarding ? '正在确认退出，请稍候。' : '正在保存，请稍候。完成前请不要关闭此页面。'}</p>}
            <div className="flex flex-wrap gap-2">
              {!terminalSaveLoss && <button type="button" disabled={busy} className={buttonClass} onClick={() => void close()}>{busy ? discarding ? '正在退出…' : '正在保存…' : !active ? '确认离开' : saveFailure ? '重试保存并退出' : '保存并退出'}</button>}
              <button type="button" disabled={busy} className={buttonClass} onClick={stay}>{terminalSaveLoss ? '留在此页' : saveFailure ? '留在游戏中' : '取消'}</button>
              {saveFailure && (active || terminalSaveLoss) && <button type="button" disabled={busy} className={`${buttonClass} text-accent`} onClick={() => void close(true)}>{terminalSaveLoss ? '确认丢失风险并离开' : '不保存退出'}</button>}
            </div>
    </AnimatedDialog>
  </>;
}
