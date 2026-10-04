import {roomPanelAddress, roomPanelKind, sameRoomPanelAddress, type RoomPanelAddress, type RoomPanelKind} from './room-panel-route';
export interface PanelLocation extends RoomPanelAddress {key: string; state: Record<string, unknown> | null}
export interface PanelRouterSnapshot {location: PanelLocation; navigation: {state: 'idle' | 'loading' | 'submitting'; location?: PanelLocation}}
type Navigate = (target: RoomPanelAddress | number, options?: {replace?: boolean; state?: Record<string, unknown>; flushSync?: boolean}) => void | Promise<void>;
interface PanelAttempt {id: string; target: RoomPanelAddress; settled: boolean; closeRequested: boolean; cancelled: boolean}

/** A receipt for public Router navigation, never a second visibility/history
 * owner. Kept separate from React so aborted/deferred navigation is testable. */
export function createRoomPanelNavigation(id: string, navigate: Navigate, initial: PanelRouterSnapshot) {
  let current = initial, serial = 0, attempt: PanelAttempt | null = null, closing = false;
  const receipts = new Map<string, RoomPanelAddress>();
  const displayed = () => current.navigation.location ?? current.location;
  const receiptId = (location: PanelLocation) => typeof location.state?.roomPanelRequestId === 'string' ? location.state.roomPanelRequestId : '';
  function replaceWithoutPanel(location: PanelLocation) {
    const state = {...location.state}; delete state.roomPanelRequestId;
    void navigate(roomPanelAddress(location, null), {replace: true, state, flushSync: true});
  }
  function acknowledgeClose(ticket: PanelAttempt) {
    if (attempt !== ticket || ticket.cancelled || !ticket.closeRequested || !ticket.settled || current.navigation.state !== 'idle') return;
    ticket.cancelled = true;
    if (receiptId(current.location) === ticket.id && sameRoomPanelAddress(current.location, ticket.target)) {
      closing = true; void navigate(-1);
    }
  }
  return {
    update(snapshot: PanelRouterSnapshot) {
      if (displayed().key !== (snapshot.navigation.location ?? snapshot.location).key) closing = false;
      current = snapshot;
      if (!attempt) return;
      if (current.navigation.location && receiptId(current.navigation.location) !== attempt.id) {attempt.cancelled = true; return;}
      acknowledgeClose(attempt);
    },
    open(next: RoomPanelKind) {
      const pending = attempt, location = displayed(), kind = roomPanelKind(location.search);
      if (pending && !pending.cancelled && !pending.settled && roomPanelKind(pending.target.search) === next) {
        pending.closeRequested = false; closing = false; return;
      }
      if (kind === next && !closing) return;
      const uncommitted = pending && !pending.cancelled && receiptId(current.location) !== pending.id;
      if (pending) pending.cancelled = true;
      const target = roomPanelAddress(location, next);
      const ticket: PanelAttempt = {id: `${id}-${++serial}`, target, settled: false, closeRequested: false, cancelled: false};
      // Sections share one entry. When an earlier push is still pending,
      // superseding it must also push, never replace the room's own entry.
      const replace = kind !== null && !closing && !uncommitted;
      const ownsParent = !replace || receipts.has(receiptId(location));
      if (ownsParent) receipts.set(ticket.id, target);
      attempt = ticket; closing = false;
      void Promise.resolve(navigate(target, {replace, state: {...location.state, roomPanelRequestId: ticket.id}, flushSync: true})).then(() => {
        if (attempt !== ticket || ticket.cancelled) return;
        ticket.settled = true; acknowledgeClose(ticket);
      });
    },
    close() {
      const location = displayed();
      if (!roomPanelKind(location.search) || closing) return;
      closing = true;
      const ticket = attempt;
      if (ticket && receiptId(location) === ticket.id && !ticket.cancelled && receipts.has(ticket.id) && sameRoomPanelAddress(location, ticket.target)) {
        ticket.closeRequested = true; acknowledgeClose(ticket); return;
      }
      const receipt = receipts.get(receiptId(location));
      if (receipt && sameRoomPanelAddress(location, receipt)) void navigate(-1);
      else replaceWithoutPanel(location);
    },
    dispose() {if (attempt) attempt.cancelled = true; attempt = null; receipts.clear(); closing = false;},
  };
}
