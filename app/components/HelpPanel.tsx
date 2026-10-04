import {createContext, useContext, useLayoutEffect, useRef, type ComponentProps, type ReactNode, type RefObject} from 'react';
import {Link, useLocation, useNavigation} from 'react-router';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';
import {useQueryPanelNavigation} from './QueryPanelNavigation';
import type {QueryPanelAddress} from '../services/query-panel-navigation';
import {CanonicalHelpContent} from './Notices';
import {useLocale} from './LocaleProvider';
import {useResourcePreferences} from './ResourceManagerProvider';
import {useRuntimeFrame, useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {canRestorePlayerHelpFocus} from '../services/player-tools.client';
import type {RuntimeService} from '../services/runtime.client';
import {productManagementRoute} from '../runtime/route-session.mts';
import {isProductId, gameIdForProduct, productFeatureAvailable} from '../../src/contracts/product-catalog.mts';

interface HelpNavigation {
  open: boolean;
  target: QueryPanelAddress;
  openHelp(options?: {returnToGame?: boolean}): void;
  restoreGameFocus(event: Event): void;
  closeHelp(): void;
}
const HelpNavigationContext = createContext<HelpNavigation | null>(null);
/**
 * Router remains the only open-state/history owner. A synchronous pending
 * navigation renders Help before the next input event, even in Framework mode
 * where the async dataStrategy's final location commit is a React transition.
 * The ref tracks only the lifetime of our public navigate() call, not UI state.
 */
export function HelpProvider({children, runtimeFocus}: {children: ReactNode;
  /** Empty-frame synthetic fixtures can validate focus without preparing a Runtime. */
  runtimeFocus?: {service: Pick<RuntimeService, 'getInputContext'>; frame: RefObject<HTMLIFrameElement | null>};
}) {
  const location = useLocation(), navigation = useNavigation();
  const {open, target, openPanel, closePanel: closeHelp} = useQueryPanelNavigation('help');
  const hostedService = useRuntimeService(), hostedFrame = useRuntimeFrame();
  const runtimeService = runtimeFocus?.service ?? hostedService, runtimeFrame = runtimeFocus?.frame ?? hostedFrame;
  const gameReturn = useRef<{sourceKey: string; frame: HTMLIFrameElement; target: object; epoch: number} | null>(null);
  const committed = useRef({location, navigation});
  useLayoutEffect(() => {committed.current = {location, navigation};}, [location, navigation]);

  function openHelp(options: {returnToGame?: boolean} = {}) {
    if (open) return;
    const input = runtimeService?.getInputContext(), frame = runtimeFrame?.current;
    gameReturn.current = options.returnToGame && frame && input?.launched && input.ready && input.target && input.target === frame.contentWindow
      ? {sourceKey: location.key, frame, target: input.target, epoch: input.epoch} : null;
    openPanel();
  }

  function restoreGameFocus(event: Event) {
    const captured = gameReturn.current;gameReturn.current = null;
    if (captured) event.preventDefault();
    const input = runtimeService?.getInputContext(), current = committed.current;
    // The original history entry, exact frame and native epoch must all survive.
    // Delayed close animation never steals focus from another route/session.
    if (!canRestorePlayerHelpFocus(captured, {navigationIdle: current.navigation.state === 'idle', locationKey: current.location.key,
      helpOpen: new URLSearchParams(current.location.search).get('panel') === 'help', frame: runtimeFrame?.current ?? null,
      frameConnected: captured?.frame.isConnected ?? false, input: input ?? null})) return;
    event.preventDefault();captured!.frame.focus({preventScroll: true});
  }

  return <HelpNavigationContext.Provider value={{open, target, openHelp, closeHelp, restoreGameFocus}}>{children}</HelpNavigationContext.Provider>;
}

function useHelpNavigation() {
  const value = useContext(HelpNavigationContext);
  if (!value) throw new Error('Help UI must be inside HelpProvider');
  return value;
}

type HelpLinkProps = Omit<ComponentProps<typeof Link>, 'to' | 'state' | 'replace' | 'mask' | 'reloadDocument' | 'relative' | 'viewTransition' | 'preventScrollReset' | 'defaultShouldRevalidate'> & {returnToGame?: boolean};
/** A real link for native modified/new-tab clicks, synchronous local modal intent otherwise. */
export function HelpLink({onClick, target, download, returnToGame = false, ...props}: HelpLinkProps) {
  const help = useHelpNavigation();
  const isDownload = download !== undefined && download !== false;
  return <Link {...props} target={target} download={download} reloadDocument={isDownload} to={help.target} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
        (target && target !== '_self') || isDownload) return;
    event.preventDefault();
    event.currentTarget.focus({preventScroll: true});
    help.openHelp({returnToGame});
  }}/>;
}

/** Router owns open state; the stable shell retains only its visual exit. */
export function GlobalHelpPanel() {
  const {open, closeHelp, restoreGameFocus} = useHelpNavigation();
  const location = useLocation(), runtime = useRuntimeSnapshot(), metadata = useResourcePreferences(), {t} = useLocale();
  const product = productManagementRoute(location.pathname);
  const game = runtime?.game ?? (product && isProductId(product) ? gameIdForProduct(product) : undefined);
  const hostFeatures = game ? metadata(game).hostFeatures : undefined;
  return <AnimatedDialog open={open} onOpenChange={next => {if (!next) closeHelp();}} title={t('help.controlsTitle')}
    description={t('help.gameControlsIntro')} onCloseAutoFocus={restoreGameFocus}>
    <CanonicalHelpContent gameId={game} thpracAvailable={!!game && hostFeatures !== undefined && productFeatureAvailable(game,'thprac',hostFeatures)}/>
    <AnimatedDialogClose className="mt-5 rounded-xl border border-white/20 px-4 py-2">{t('action.close')}</AnimatedDialogClose>
  </AnimatedDialog>;
}

/** Player entry points share the root Router-owned Help flow. */
export function usePlayerHelp() {return useHelpNavigation();}
