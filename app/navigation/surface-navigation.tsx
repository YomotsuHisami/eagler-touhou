import {createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useBlocker, useLocation, useNavigate, useNavigationType, type Location} from 'react-router';
import {isProductId, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {ConfirmationDialog} from '../components/ConfirmationDialog';
import {useLocale} from '../i18n';
import type {DecisionStore} from '../models/decisions';
const noDecisionSubscription = () => () => {};
const noDecisionSnapshot = () => null;
let dialogSessionSequence = 0;
// UI lifetime provenance only, matching main; also works on insecure HTTP.
const newDialogSession = () => `${Date.now().toString(36)}-${++dialogSessionSequence}`;

export type Surface = 'library' | 'options' | 'touch';
export type SurfaceContext = 'library' | 'lobby';
export const INFORMATION_DIALOG_IDS = ['mpGuideDialog', 'firstUseNoticeDialog', 'donationDialog', 'appleRefreshDialog', 'replayDialog', 'lobbyNetworkDialog'] as const;
export type InformationDialogId = typeof INFORMATION_DIALOG_IDS[number];
export interface SurfaceAddress {
  surface: Surface;
  productId: ProductId | null;
  context: SurfaceContext;
}
export function readSurface(location: Pick<Location, 'pathname' | 'search'>): SurfaceAddress {
  const params = new URLSearchParams(location.search);
  const game = params.get('game') || '';
  const productId = isProductId(game) ? game : null;
  const context = /\/(?:lobby|lobby\.html)\/?$/.test(location.pathname) ? 'lobby' : 'library';
  const options = productId !== null && context === 'library';
  return {productId, context, surface: options ? 'options' : 'library'};
}
const entryKey = 'launcherSurfaceEntry';
const touchEntryKey = 'launcherTouchEntry';
const infoEntryKey = 'launcherInformationDialogs';
const href = (location: Pick<Location, 'pathname' | 'search' | 'hash'>) => location.pathname + location.search + location.hash;
function plainState(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? {...value} : {};
}
function withoutEntry(value: unknown) {
  const state = plainState(value);
  delete state[entryKey];
  delete state[touchEntryKey];
  delete state[infoEntryKey];
  return state;
}
interface SurfaceNavigation extends SurfaceAddress {
  filterProductId: ProductId | null;
  openOptions(productId: ProductId): void;
  selectLobbyProduct(productId: ProductId): void;
  openTouchLayout(): void;
  closeSurface(): void;
  infoDialogOpen(id: InformationDialogId): boolean;
  openInfoDialog(id: InformationDialogId): void;
  closeInfoDialog(id?: InformationDialogId): void;
}
const NavigationContext = createContext<SurfaceNavigation | null>(null);
export function useSurfaceNavigation(): SurfaceNavigation {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('SurfaceNavigationProvider is required');
  return value;
}

/** Sole UI history owner. State is immediate-entry provenance, never a second stack. */
export function SurfaceNavigationProvider({dirty, isEditing, onDiscard, decisions, children}: {
  dirty: boolean;
  isEditing: boolean;
  onDiscard(): void;
  decisions?: DecisionStore;
  children: ReactNode;
}) {
  const applicationDecision = useSyncExternalStore(decisions?.subscribe ?? noDecisionSubscription,
    decisions?.getSnapshot ?? noDecisionSnapshot, decisions?.getSnapshot ?? noDecisionSnapshot);
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [dialogSession] = useState(newDialogSession);
  const infoEntry = plainState(plainState(location.state)[infoEntryKey]);
  const activeInfo = INFORMATION_DIALOG_IDS.includes(infoEntry.active as InformationDialogId)
    ? infoEntry.active as InformationDialogId : null;
  const infoVisible = plainState(infoEntry.visible);
  const validInfo = infoEntry.session === dialogSession && infoEntry.href === href(location) &&
    activeInfo !== null && infoVisible[activeInfo] === true;
  const staleInfo = Object.keys(infoEntry).length > 0 && !validInfo;
  const urlAddress = readSurface(location);
  const optionEntry = plainState(plainState(location.state)[entryKey]);
  // main lobby.mts58–65 retires its options sheet on a document reload.
  // Library ?game remains a durable options address.
  const retiredLobbyOptions = urlAddress.context === 'lobby' && optionEntry.surface === 'options' &&
    optionEntry.session !== dialogSession;
  const ownedOptions = !retiredLobbyOptions && optionEntry.version === 1 && optionEntry.surface === 'options' &&
    optionEntry.href === href(location) && typeof optionEntry.productId === 'string' && isProductId(optionEntry.productId);
  const baseAddress: SurfaceAddress = ownedOptions ? {...urlAddress, surface: 'options', productId: optionEntry.productId as ProductId} : urlAddress;
  const currentEntry = plainState(plainState(location.state)[touchEntryKey]);
  const ownedTouch = baseAddress.surface === 'options' && currentEntry.version === 1 &&
    currentEntry.surface === 'touch' && currentEntry.href === href(location);
  // Main's touch editor is a live draft, not a bookmark. Forward/reload of a
  // retired same-URL entry must never recreate it.
  const staleTouch = ownedTouch && navigationType === 'POP' && !isEditing;
  const address: SurfaceAddress = {...baseAddress,
    surface: ownedTouch && !staleTouch ? 'touch' : baseAddress.surface};
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const obsoleteTouchQuery = params.has('touchLayout');
    if (!staleTouch && !staleInfo && !retiredLobbyOptions && !obsoleteTouchQuery) return;
    params.delete('touchLayout');
    const normalizedSearch = params.toString();
    const search = obsoleteTouchQuery ? (normalizedSearch ? `?${normalizedSearch}` : '') : location.search;
    void navigate({pathname: location.pathname, search, hash: location.hash},
      {replace: true, preventScrollReset: true, state: (() => {
        const state = plainState(location.state);
        if (staleTouch || retiredLobbyOptions || obsoleteTouchQuery) delete state[touchEntryKey];
        if (retiredLobbyOptions) delete state[entryKey];
        if (staleInfo) delete state[infoEntryKey];
        return state;
      })()});
  }, [staleTouch, staleInfo, retiredLobbyOptions, location, navigate]);
  const {t} = useLocale();
  const blocker = useBlocker(({currentLocation, nextLocation}) => {
    if (!dirty || !isEditing || !ownedTouch || currentLocation.key === nextLocation.key) return false;
    const nextTouch = plainState(plainState(nextLocation.state)[touchEntryKey]);
    // Main informational windows consume Back before the touch owner. Their
    // descendants retain the exact underlying touch lifetime, not its draft.
    const sameTouch = nextTouch.version === currentEntry.version && nextTouch.surface === 'touch' &&
      nextTouch.parentKey === currentEntry.parentKey && nextTouch.href === currentEntry.href &&
      href(nextLocation) === href(currentLocation);
    return !sameTouch;
  });
  // A second navigation must not reuse consent for the first destination.
  const pendingKey = useRef<string | null>(null);
  const closeIssuedKey = useRef<string | null>(null);
  const infoOpenIssuedKey = useRef<string | null>(null);
  const surfaceOpenIssuedKey = useRef<string | null>(null);
  useEffect(() => {
    closeIssuedKey.current = null; infoOpenIssuedKey.current = null; surfaceOpenIssuedKey.current = null;
  }, [location.key]);
  useEffect(() => {
    if (blocker.state !== 'blocked') { pendingKey.current = null; return; }
    if (pendingKey.current !== null && pendingKey.current !== blocker.location.key) {
      pendingKey.current = null;
      closeIssuedKey.current = null;
      surfaceOpenIssuedKey.current = null;
      blocker.reset();
      return;
    }
    pendingKey.current = blocker.location.key;
  }, [blocker]);

  useEffect(() => {
    // A decision already on screen wins. Main rejects a new confirmation while
    // its decisionResolver/native dialog is occupied, rather than replacing it.
    if (applicationDecision && blocker.state === 'blocked') {
      closeIssuedKey.current = null;
      surfaceOpenIssuedKey.current = null;
      blocker.reset();
    }
    decisions?.setNavigationDecisionOpen(!applicationDecision && blocker.state === 'blocked');
    return () => { decisions?.setNavigationDecisionOpen(false); };
  }, [applicationDecision, blocker, decisions]);

  function target(params: URLSearchParams) {
    const search = params.toString();
    return {pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash};
  }
  function infoDialogOpen(id: InformationDialogId) {
    return validInfo && infoVisible[id] === true;
  }
  function openInfoDialog(id: InformationDialogId) {
    if (!INFORMATION_DIALOG_IDS.includes(id) || infoDialogOpen(id) || blocker.state !== 'unblocked' ||
        infoOpenIssuedKey.current === location.key) return;
    infoOpenIssuedKey.current = location.key;
    // Bounded visible flags are the current Router-rendered UI, not retained
    // history receipts. Main keeps an open parent native dialog beneath child.
    const visible = Object.fromEntries(INFORMATION_DIALOG_IDS.map(name => [name, infoDialogOpen(name)]));
    visible[id] = true;
    const next = {pathname: location.pathname, search: location.search, hash: location.hash};
    void navigate(next, {preventScrollReset: true, state: {
      ...plainState(location.state),
      [infoEntryKey]: {session: dialogSession, active: id, visible, parentKey: location.key, href: href(next)},
    }});
  }
  function closeInfoDialog(id?: InformationDialogId) {
    if (!validInfo || (id && id !== activeInfo) || blocker.state !== 'unblocked' ||
        closeIssuedKey.current === location.key) return;
    closeIssuedKey.current = location.key;
    if (typeof infoEntry.parentKey === 'string' && infoEntry.parentKey !== location.key) {
      void navigate(-1);
    } else {
      const state = plainState(location.state); delete state[infoEntryKey];
      void navigate({pathname: location.pathname, search: location.search, hash: location.hash},
        {replace: true, preventScrollReset: true, state});
    }
  }
  function selectLobbyProduct(productId: ProductId) {
    if (address.context !== 'lobby' || address.surface !== 'library' ||
        !isMultiplayerProductId(productId) || address.productId === productId || blocker.state !== 'unblocked') return;
    const params = new URLSearchParams(location.search);
    params.set('game', productId);
    void navigate(target(params), {replace: true, preventScrollReset: true, state: withoutEntry(location.state)});
  }
  function openOptions(productId: ProductId) {
    if (!isProductId(productId) || blocker.state !== 'unblocked' || surfaceOpenIssuedKey.current === location.key ||
        (address.context === 'lobby' && !isMultiplayerProductId(productId))) return;
    const params = new URLSearchParams(location.search);
    params.set('game', productId);
    // Directory selection and opening its settings carrier are separate main
    // intents. Replacing the iframe must not mutate the directory's filter URL.
    const next = address.context === 'lobby'
      ? {pathname: location.pathname, search: location.search, hash: location.hash}
      : target(params);
    if (address.surface === 'options' && address.productId === productId) return;
    surfaceOpenIssuedKey.current = location.key;
    const replace = address.surface !== 'library';
    void navigate(next, {replace, preventScrollReset: true, state: {
      ...withoutEntry(location.state),
      [entryKey]: {version: 1, surface: 'options', productId, session: dialogSession,
        parentKey: replace && ownedOptions ? optionEntry.parentKey : location.key, href: href(next)},
    }});
  }
  function openTouchLayout() {
    if (address.surface !== 'options' || blocker.state !== 'unblocked' || surfaceOpenIssuedKey.current === location.key) return;
    surfaceOpenIssuedKey.current = location.key;
    const next = {pathname: location.pathname, search: location.search, hash: location.hash};
    // Flat native-entry flags retain the parent's identity, as main's
    // {...history.state, touchLayout: true} does. There is no saved route stack.
    void navigate(next, {preventScrollReset: true, state: {
      ...plainState(location.state),
      [touchEntryKey]: {version: 1, surface: 'touch', parentKey: location.key, href: href(next)},
    }});
  }
  function closeSurface() {
    if (validInfo) { closeInfoDialog(); return; }
    if (address.surface === 'library' || blocker.state !== 'unblocked' || closeIssuedKey.current === location.key) return;
    closeIssuedKey.current = location.key;
    const entry = plainState(plainState(location.state)[address.surface === 'touch' ? touchEntryKey : entryKey]);
    if (entry.version === 1 && entry.surface === address.surface && entry.href === href(location) &&
        typeof entry.parentKey === 'string' && entry.parentKey !== location.key) {
      void navigate(-1);
      return;
    }
    // Direct URLs have no owned parent entry. Replace with a known parent,
    // preserving locale, unrelated query values and the fragment.
    const params = new URLSearchParams(location.search);
    params.delete('touchLayout');
    if (address.surface === 'options') {
      if (address.context === 'library') params.delete('game');
    }
    void navigate(target(params), {replace: true, preventScrollReset: true, state: withoutEntry(location.state)});
  }
  return <NavigationContext.Provider value={{...address, filterProductId: urlAddress.context === 'lobby' ? urlAddress.productId : null, openOptions, selectLobbyProduct, openTouchLayout, closeSurface, infoDialogOpen, openInfoDialog, closeInfoDialog}}>
    {children}
    <ConfirmationDialog key={applicationDecision ? `application:${applicationDecision.requestId}` : 'navigation'}
      open={applicationDecision !== null || blocker.state === 'blocked'}
      title={applicationDecision?.title || t('dialog.confirmTitle')}
      message={applicationDecision ? applicationDecision.message || '' : t('touch.layoutDiscardConfirm')}
      confirmText={applicationDecision ? applicationDecision.confirmText || t('action.confirm') : t('touch.discardChanges')}
      cancelText={applicationDecision?.cancelText || t('action.cancel')}
      secondaryText={applicationDecision?.secondaryText || ''}
      tone={applicationDecision ? applicationDecision.tone || 'normal' : 'danger'}
      variant={applicationDecision?.variant || ''} hideCancel={applicationDecision?.hideCancel || false}
      confirmOnEnter={applicationDecision?.confirmOnEnter || false}
      onSecondary={() => {if (applicationDecision) decisions?.resolve('secondary');}}
      onCancel={() => {
        if (applicationDecision) decisions?.resolve('cancel');
        else if (blocker.state === 'blocked') {
          closeIssuedKey.current = null; surfaceOpenIssuedKey.current = null; blocker.reset();
        }
      }}
      onConfirm={() => {
        if (applicationDecision) {decisions?.resolve('confirm'); return;}
        if (blocker.state !== 'blocked' || pendingKey.current !== blocker.location.key) return;
        onDiscard();
        blocker.proceed();
      }}/>

  </NavigationContext.Provider>;
}
