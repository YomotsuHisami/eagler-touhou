import {isProductId, productEnabledForBuild, type ProductId} from '../../src/contracts/product-catalog.mts';

export interface LibraryAddress {pathname: string; search: string; hash: string}
export interface LibraryLocation extends LibraryAddress {key: string; state: Record<string, unknown> | null}
export interface LibraryRouterSnapshot {location: LibraryLocation; navigation: {state: 'idle' | 'loading' | 'submitting'; location?: LibraryLocation}}
type Navigate = (target: LibraryAddress | number, options?: {replace?: boolean; state?: Record<string, unknown>; flushSync?: boolean; preventScrollReset?: boolean}) => void | Promise<void>;
interface Receipt {id: string; target: LibraryAddress; parent: LibraryAddress; root: LibraryAddress | null; depth: number}
interface Attempt {receipt: Receipt; settled: boolean; closeRequested: boolean; cancelled: boolean}

export function libraryPanelProduct(pathname: string): ProductId | null {
  const match = /^\/play\/([^/]+)(?:\/(resources|replays|saves))?\/?$/.exec(pathname);
  return match && isProductId(match[1]) && productEnabledForBuild(match[1], false) ? match[1] : null;
}
const address = ({pathname, search, hash}: LibraryAddress): LibraryAddress => ({pathname, search, hash});
const sameAddress = (a: LibraryAddress, b: LibraryAddress) => a.pathname === b.pathname && a.search.replace(/^\?/, '') === b.search.replace(/^\?/, '') && a.hash === b.hash;
export function libraryPanelParent(location: LibraryAddress): LibraryAddress {
  const product = libraryPanelProduct(location.pathname), home = product && `/play/${product}`;
  const query = new URLSearchParams(location.search);
  for (const key of ['panel', 'touchLayout', 'lobbyDialog', 'roomPanel', 'roomOptions']) query.delete(key);
  if (location.pathname.replace(/\/$/, '') === home) for (const key of ['mpRoom', 'room', 'titleRoom']) query.delete(key);
  const search = query.toString();
  return {pathname: home && location.pathname.replace(/\/$/, '') !== home ? home : '/', search: search ? `?${search}` : '', hash: location.hash};
}

/** Receipts acknowledge only this mounted Router owner's pushes. They never
 * become an alternate route/open state, and stale state after reload is inert. */
export function createLibraryPanelNavigation(id: string, navigate: Navigate, initial: LibraryRouterSnapshot) {
  let current = initial, sequence = 0, attempt: Attempt | null = null, closing = false;
  const receipts = new Map<string, Receipt>();
  const displayed = () => current.navigation.location ?? current.location;
  function owned(location: LibraryLocation) {
    const key = location.state?.libraryPanelRequestId;
    const receipt = typeof key === 'string' ? receipts.get(key) : undefined;
    return receipt && sameAddress(receipt.target, location) ? receipt : null;
  }
  function requestDismiss(target: LibraryAddress | number, options?: Parameters<Navigate>[1]) {
    const sourceKey = current.location.key;
    void Promise.resolve(navigate(target, options)).then(() => {
      // The one root draft/Runtime blocker may reject this attempt without any
      // location change. A later deliberate close must remain possible.
      if (current.location.key === sourceKey && current.navigation.state === 'idle') closing = false;
    });
  }
  function replaceParent(location: LibraryLocation, target: LibraryAddress, previous: Receipt | null) {
    const state = {...location.state}; delete state.libraryPanelRequestId;
    if (previous && target.pathname !== '/') {
      const receipt: Receipt = {...previous, id: `${id}-${++sequence}`, target};
      receipts.set(receipt.id, receipt); state.libraryPanelRequestId = receipt.id;
    }
    requestDismiss(target, {replace: true, state, flushSync: true, preventScrollReset: true});
  }
  function dismiss(location: LibraryLocation) {
    const parent = libraryPanelParent(location), receipt = owned(location);
    if (parent.pathname !== '/') {
      if (receipt && sameAddress(receipt.parent, parent)) requestDismiss(-1);
      else replaceParent(location, parent, receipt);
    } else if (receipt?.root) requestDismiss(-receipt.depth);
    else replaceParent(location, parent, null);
  }
  function acknowledge(ticket: Attempt) {
    if (attempt !== ticket || ticket.cancelled || !ticket.settled || !ticket.closeRequested || current.navigation.state !== 'idle') return;
    ticket.cancelled = true;
    if (owned(current.location)?.id === ticket.receipt.id) dismiss(current.location);
  }
  return {
    update(snapshot: LibraryRouterSnapshot) {
      if (displayed().key !== (snapshot.navigation.location ?? snapshot.location).key) closing = false;
      current = snapshot;
      if (!attempt) return;
      if (current.navigation.location && current.navigation.location.state?.libraryPanelRequestId !== attempt.receipt.id) {attempt.cancelled = true; return;}
      acknowledge(attempt);
    },
    open(target: LibraryAddress) {
      if (!libraryPanelProduct(target.pathname)) return;
      if (attempt && !attempt.cancelled && !attempt.settled && sameAddress(attempt.receipt.target, target)) {
        attempt.closeRequested = false; closing = false; return;
      }
      if (sameAddress(displayed(), target) && !closing) return;
      if (attempt) attempt.cancelled = true;
      // A superseded, uncommitted push has no history entry to inherit.
      const parent = current.location, previous = owned(parent);
      const receipt: Receipt = {id: `${id}-${++sequence}`, target, parent: address(parent),
        root: parent.pathname === '/' ? address(parent) : previous?.root ?? null,
        depth: previous ? previous.depth + 1 : 1};
      receipts.set(receipt.id, receipt);
      const ticket: Attempt = {receipt, settled: false, closeRequested: false, cancelled: false};
      attempt = ticket; closing = false;
      void Promise.resolve(navigate(target, {state: {...parent.state, libraryPanelRequestId: receipt.id}, flushSync: true, preventScrollReset: true})).then(() => {
        if (attempt !== ticket || ticket.cancelled) return;
        ticket.settled = true; acknowledge(ticket);
      });
    },
    close() {
      const location = displayed();
      if (!libraryPanelProduct(location.pathname) || closing) return;
      closing = true;
      if (attempt && !attempt.cancelled && owned(location)?.id === attempt.receipt.id) {
        attempt.closeRequested = true; acknowledge(attempt); return;
      }
      dismiss(location);
    },
    dispose() {if (attempt) attempt.cancelled = true; attempt = null; receipts.clear(); closing = false;},
  };
}
