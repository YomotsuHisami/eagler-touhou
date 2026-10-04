/** Close-only counterpart of main's right settings drawer gesture. Router
 * ownership is injected; no drawer visibility, history or input owner lives here. */
export interface DrawerPointer {pointerId: number; isPrimary: boolean; button: number; clientX: number; clientY: number; target?: unknown; defaultPrevented?: boolean}
export function createRoomOptionsSwipe({allowed, canStart, close}: {allowed(): boolean; canStart(target: unknown): boolean; close(): void}) {
  let active: {id: number; x: number; y: number; horizontal: boolean} | null = null;
  const cancel = () => {active = null;};
  function valid() {if (!allowed()) cancel(); return active;}
  return {
    down(event: DrawerPointer) {
      if (!event.isPrimary || event.button > 0) return;
      cancel();
      if (event.defaultPrevented || !allowed() || !canStart(event.target)) return;
      active = {id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false};
    },
    move(event: DrawerPointer) {
      const gesture = valid(); if (!gesture || gesture.id !== event.pointerId) return false;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (!gesture.horizontal) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return false;
        if (Math.abs(dx) <= Math.abs(dy) * 1.2) {cancel(); return false;}
        gesture.horizontal = true;
      }
      return dx > 0;
    },
    up(event: DrawerPointer) {
      const gesture = valid(); if (!gesture || gesture.id !== event.pointerId) return false;
      cancel();
      if (!gesture.horizontal || event.clientX - gesture.x < 54) return false;
      close(); return true;
    },
    drag(target: unknown) {return !!valid() && canStart(target);},
    cancel,
  };
}
