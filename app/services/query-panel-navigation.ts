export interface QueryPanelAddress {pathname: string; search: string; hash: string}
export interface QueryPanelLocation extends QueryPanelAddress {key: string; state: Record<string, unknown> | null}
export interface QueryPanelRouterSnapshot {location: QueryPanelLocation; navigation: {state: 'idle' | 'loading' | 'submitting'; location?: QueryPanelLocation}}
type Navigate = (target: QueryPanelAddress | number, options?: {replace?: boolean; state?: Record<string, unknown>; flushSync?: boolean}) => void | Promise<void>;
interface PanelAttempt {id: string; sourceKey: string; target: QueryPanelAddress; settled: boolean; closeRequested: boolean; cancelled: boolean}
export type QueryPanelKind = 'help' | 'donation';
export function queryPanelAddress(location: QueryPanelAddress, panel: QueryPanelKind | null): QueryPanelAddress {
  const query = new URLSearchParams(location.search);
  if (panel) query.set('panel', panel); else query.delete('panel');
  return {pathname: location.pathname, search: query.size ? `?${query}` : '', hash: location.hash};
}
const sameAddress = (a: QueryPanelAddress, b: QueryPanelAddress) =>
  a.pathname === b.pathname && a.search.replace(/^\?/, '') === b.search.replace(/^\?/, '') && a.hash === b.hash;

/** Shared Help/donation receipts for public Router navigation. Router alone owns
 * visibility and history; a held dismissal waits for its own committed entry. */
export function createQueryPanelNavigation(panel: QueryPanelKind, id: string, navigate: Navigate, initial: QueryPanelRouterSnapshot) {
  const stateKey = `${panel}RequestId`, receipts = new Map<string, QueryPanelAddress>();
  let current = initial, serial = 0, attempt: PanelAttempt | null = null, closing = false;
  const displayed = () => current.navigation.location ?? current.location;
  const requestId = (location: QueryPanelLocation) => typeof location.state?.[stateKey] === 'string' ? location.state[stateKey] as string : '';
  const isOpen = (location: QueryPanelAddress) => new URLSearchParams(location.search).get('panel') === panel;
  function acknowledgeClose(ticket: PanelAttempt) {
    if (attempt !== ticket || ticket.cancelled || !ticket.closeRequested || !ticket.settled || current.navigation.state !== 'idle') return;
    ticket.cancelled = true;
    if (requestId(current.location) === ticket.id && sameAddress(current.location, ticket.target)) {
      closing = true; void navigate(-1);
    }
  }
  return {
    update(snapshot: QueryPanelRouterSnapshot) {
      if (displayed().key !== (snapshot.navigation.location ?? snapshot.location).key) closing = false;
      current = snapshot;
      if (!attempt) return;
      if (current.navigation.location && requestId(current.navigation.location) !== attempt.id) {attempt.cancelled = true; return;}
      if (current.navigation.state === 'idle' && current.location.key !== attempt.sourceKey && requestId(current.location) !== attempt.id) {attempt.cancelled = true; return;}
      acknowledgeClose(attempt);
    },
    open() {
      if (attempt && !attempt.cancelled && !attempt.settled) {
        attempt.closeRequested = false; closing = false; return;
      }
      if (isOpen(displayed())) return;
      if (attempt) attempt.cancelled = true;
      const target = queryPanelAddress(current.location, panel);
      const ticket: PanelAttempt = {id: `${id}-${++serial}`, sourceKey: current.location.key, target, settled: false, closeRequested: false, cancelled: false};
      receipts.set(ticket.id, target); attempt = ticket; closing = false;
      void Promise.resolve(navigate(target, {state: {...current.location.state, [stateKey]: ticket.id}, flushSync: true})).then(() => {
        if (attempt !== ticket || ticket.cancelled) return;
        ticket.settled = true; acknowledgeClose(ticket);
      });
    },
    close() {
      const location = displayed();
      if (!isOpen(location) || closing) return;
      closing = true;
      const ticket = attempt;
      if (ticket && requestId(location) === ticket.id && !ticket.cancelled && sameAddress(location, ticket.target)) {
        ticket.closeRequested = true; acknowledgeClose(ticket); return;
      }
      const receipt = receipts.get(requestId(location));
      if (receipt && sameAddress(location, receipt)) void navigate(-1);
      else {
        const state = {...location.state}; delete state[stateKey];
        void navigate(queryPanelAddress(location, null), {replace: true, state, flushSync: true});
      }
    },
    dispose() {if (attempt) attempt.cancelled = true; attempt = null; receipts.clear(); closing = false;},
  };
}
