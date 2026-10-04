import {createContext, useContext, useId, useLayoutEffect, useRef, type ComponentProps, type ReactNode} from 'react';
import {Link, useLocation, useNavigate, useNavigation} from 'react-router';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';

interface HelpAttempt {
  id: string;
  target: {pathname: string; search: string; hash: string};
  settled: boolean;
  closeRequested: boolean;
  cancelled: boolean;
}
interface HelpNavigation {
  open: boolean;
  target: HelpAttempt['target'];
  openHelp(): void;
  closeHelp(): void;
}
const HelpNavigationContext = createContext<HelpNavigation | null>(null);
const sameAddress = (a: HelpAttempt['target'], b: HelpAttempt['target']) =>
  a.pathname === b.pathname && a.search.replace(/^\?/, '') === b.search.replace(/^\?/, '') && a.hash === b.hash;

/**
 * Router remains the only open-state/history owner. A synchronous pending
 * navigation renders Help before the next input event, even in Framework mode
 * where the async dataStrategy's final location commit is a React transition.
 * The ref tracks only the lifetime of our public navigate() call, not UI state.
 */
export function HelpProvider({children}: {children: ReactNode}) {
  const location = useLocation(), navigation = useNavigation(), navigate = useNavigate();
  const providerId = useId(), nextAttempt = useRef(0);
  const dialogLocation = navigation.location ?? location;
  const open = new URLSearchParams(dialogLocation.search).get('panel') === 'help';
  const query = new URLSearchParams(location.search); query.set('panel', 'help');
  const target = {pathname: location.pathname, search: query.toString(), hash: location.hash};
  const attempt = useRef<HelpAttempt | null>(null);
  const committed = useRef({location, navigation});
  const closing = useRef(false);
  useLayoutEffect(() => () => {
    // A late navigation promise belongs to this provider instance only.
    if (attempt.current) attempt.current.cancelled = true;
    attempt.current = null;
  }, []);
  useLayoutEffect(() => {closing.current = false;}, [dialogLocation.key]);

  function acknowledgeClose(ticket: HelpAttempt) {
    if (attempt.current !== ticket || ticket.cancelled || !ticket.closeRequested || !ticket.settled) return;
    const current = committed.current;
    if (current.navigation.state !== 'idle') return;
    // A public navigate promise also resolves when aborted. Only a matching
    // committed entry proves that Back belongs to this Help attempt.
    ticket.cancelled = true;
    if (current.location.state?.helpRequestId === ticket.id && sameAddress(current.location, ticket.target)) void navigate(-1);
  }

  useLayoutEffect(() => {
    committed.current = {location, navigation};
    const ticket = attempt.current;
    if (!ticket) return;
    if (ticket.cancelled) {
      if (navigation.state === 'idle' && location.state?.helpRequestId !== ticket.id) attempt.current = null;
      return;
    }
    if (navigation.location && navigation.location.state?.helpRequestId !== ticket.id) {
      ticket.cancelled = true;
      return;
    }
    acknowledgeClose(ticket);
  }, [location, navigation]);

  function openHelp() {
    if (open) return;
    const ticket: HelpAttempt = {id: `${providerId}-${++nextAttempt.current}`, target, settled: false, closeRequested: false, cancelled: false};
    attempt.current = ticket;
    closing.current = false;
    void Promise.resolve(navigate(target, {state: {returnTo: location.pathname, helpRequestId: ticket.id}, flushSync: true})).then(() => {
      if (attempt.current !== ticket || ticket.cancelled) return;
      ticket.settled = true;
      acknowledgeClose(ticket);
    });
  }

  function closeHelp() {
    if (!open || closing.current) return;
    closing.current = true;
    const ticket = attempt.current;
    if (ticket && dialogLocation.state?.helpRequestId === ticket.id) {
      if (ticket.cancelled) return;
      ticket.closeRequested = true;
      // While Framework data work is pending, retain this one dismissal until
      // Router acknowledges the matching entry. Replacing a presumed unchanged
      // parent could clobber a newer navigation whose React render is deferred.
      // A deliberately held strategy therefore leaves Help visible until that
      // acknowledgment; open is still derived solely from Router state.
      acknowledgeClose(ticket);
      return;
    }
    if (dialogLocation.state?.returnTo === dialogLocation.pathname) void navigate(-1);
    else {
      const next = new URLSearchParams(dialogLocation.search); next.delete('panel');
      void navigate({pathname: dialogLocation.pathname, search: next.toString(), hash: dialogLocation.hash}, {replace: true, flushSync: true});
    }
  }

  return <HelpNavigationContext.Provider value={{open, target, openHelp, closeHelp}}>{children}</HelpNavigationContext.Provider>;
}

function useHelpNavigation() {
  const value = useContext(HelpNavigationContext);
  if (!value) throw new Error('Help UI must be inside HelpProvider');
  return value;
}

type HelpLinkProps = Omit<ComponentProps<typeof Link>, 'to' | 'state' | 'replace' | 'mask' | 'reloadDocument' | 'relative' | 'viewTransition' | 'preventScrollReset' | 'defaultShouldRevalidate'>;
/** A real link for native modified/new-tab clicks, synchronous local modal intent otherwise. */
export function HelpLink({onClick, target, download, ...props}: HelpLinkProps) {
  const help = useHelpNavigation();
  const isDownload = download !== undefined && download !== false;
  return <Link {...props} target={target} download={download} reloadDocument={isDownload} to={help.target} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
        (target && target !== '_self') || isDownload) return;
    event.preventDefault();
    event.currentTarget.focus({preventScroll: true});
    help.openHelp();
  }}/>;
}

/** Router owns open state; the stable shell retains only its visual exit. */
export function GlobalHelpPanel() {
  const {open, closeHelp} = useHelpNavigation();
  return <AnimatedDialog open={open} onOpenChange={next => {if (!next) closeHelp();}} title="操作说明"
    description="方向键移动，Z 射击，X 使用 Bomb，Shift 低速移动。具体规则以作品能力为准。">
    <p className="mb-5 text-sm text-muted">当前原版验证入口限定日文、无音乐和键盘。真实游戏及手机验收范围见开发文档。</p>
    <AnimatedDialogClose className="rounded-xl border border-white/20 px-4 py-2">关闭</AnimatedDialogClose>
  </AnimatedDialog>;
}
