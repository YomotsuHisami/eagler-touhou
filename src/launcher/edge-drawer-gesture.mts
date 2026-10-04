export type EdgeDrawerSide = "left" | "right";

export interface EdgeDrawerGestureOptions {
  documentObj?: Document;
  windowObj?: Window;
  side: EdgeDrawerSide;
  drawer: Pick<HTMLElement, "contains">;
  isOpen: () => boolean;
  open: () => void | Promise<unknown>;
  close: () => void;
  enabled?: () => boolean;
  edgeSize?: number;
  threshold?: number;
}

type ActiveEdgeGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  opening: boolean;
  horizontal: boolean;
};

export function createEdgeDrawerGesture(options: EdgeDrawerGestureOptions) {
  const documentObj = options.documentObj ?? globalThis.document;
  const windowObj = options.windowObj ?? globalThis.window;
  const edgeSize = options.edgeSize ?? 28;
  const threshold = options.threshold ?? 54;
  if (!documentObj || !windowObj || !options.drawer) throw new Error("Edge drawer gesture requires a browser surface");
  if (options.side !== "left" && options.side !== "right") throw new Error("invalid edge drawer side");

  let active: ActiveEdgeGesture | null = null;
  const direction = options.side === "left" ? 1 : -1;

  const reset = () => { active = null; };
  const pointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button > 0 || options.enabled?.() === false) return;
    if (documentObj.body?.classList.contains("player-active")) return;
    const opening = !options.isOpen();
    if (opening) {
      const viewportWidth = Math.max(1, windowObj.innerWidth || documentObj.documentElement.clientWidth || 1);
      const atEdge = options.side === "left" ? event.clientX <= edgeSize : event.clientX >= viewportWidth - edgeSize;
      if (!atEdge) return;
    } else if (!options.drawer.contains(event.target as Node)) {
      return;
    }
    active = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, opening, horizontal: false };
  };
  const pointerMove = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.horizontal) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) { reset(); return; }
      active.horizontal = true;
    }
    const travel = dx * direction;
    const movingInGestureDirection = active.opening ? travel > 0 : travel < 0;
    if (movingInGestureDirection) event.preventDefault();
  };
  const pointerUp = (event: PointerEvent) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const gesture = active;
    reset();
    if (!gesture.horizontal) return;
    const dx = event.clientX - gesture.startX;
    const travel = dx * direction;
    if (gesture.opening ? travel >= threshold : travel <= -threshold) {
      event.preventDefault();
      if (gesture.opening) void options.open();
      else options.close();
    }
  };
  const dragStart = (event: DragEvent) => {
    // Native link/image dragging cancels the pointer stream before a drawer
    // swipe reaches pointerup. Suppress only a drag that began as an active
    // drawer gesture; ordinary clicks and drags outside the drawer keep working.
    if (active && options.drawer.contains(event.target as Node)) event.preventDefault();
  };

  documentObj.addEventListener("pointerdown", pointerDown, { capture: true, passive: true });
  documentObj.addEventListener("pointermove", pointerMove, { capture: true, passive: false });
  documentObj.addEventListener("pointerup", pointerUp, { capture: true, passive: false });
  documentObj.addEventListener("pointercancel", reset, { capture: true });
  documentObj.addEventListener("dragstart", dragStart, { capture: true });

  return Object.freeze({
    destroy() {
      reset();
      documentObj.removeEventListener("pointerdown", pointerDown, { capture: true });
      documentObj.removeEventListener("pointermove", pointerMove, { capture: true });
      documentObj.removeEventListener("pointerup", pointerUp, { capture: true });
      documentObj.removeEventListener("pointercancel", reset, { capture: true });
      documentObj.removeEventListener("dragstart", dragStart, { capture: true });
    },
  });
}
