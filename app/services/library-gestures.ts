/** Main library's deliberate gestures, independent of DOM, Router and React.
 * Each shelf supplies its own geometry, pointer-capture and motion ports. */
export interface LibraryPointer {
  pointerId: number; pointerType: string; clientX: number; clientY: number;
  isPrimary: boolean; button: number; buttons: number;
  ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean;
}
export interface LibraryGestureState {dragging: boolean; holding: boolean; scrubbing: boolean}
interface Clock {now(): number; set(callback: () => void, delay: number): unknown; clear(handle: unknown): void}
export interface LibraryGesturePorts {
  clock: Clock; selected(): string | undefined; select(id: string, focus?: boolean, instant?: boolean): void; open(id: string, instant: boolean): void;
  scrollLeft(): number; scrollTo(left: number): void; cancelMotion(): void;
  visible(owner: 'rail' | 'dock', id?: string): boolean;
  capture(owner: 'rail' | 'dock', pointerId: number, id?: string): void;
  release(owner: 'rail' | 'dock', pointerId: number, id?: string): void;
  dockBounds(): {top: number; bottom: number}; dockChoices(): Array<{id: string; center: number}>;
  changed(state: LibraryGestureState): void;
}
const modified = (event: Pick<LibraryPointer, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>) => !!(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
export function createLibraryGestures(ports: LibraryGesturePorts) {
  let railTimer: unknown = null, dockTimer: unknown = null;
  let railGuard = 0, dockGuard = 0;
  let rail: {id: number; startX: number; startY: number; left: number; held: boolean; moved: boolean} | null = null;
  let dock: {id: number; owner: string; x: number; y: number; touch: boolean; held: boolean; choice: string | null} | null = null;
  let previous: LibraryGestureState = {dragging: false, holding: false, scrubbing: false};
  function publish() {
    const next = {dragging: rail?.held ?? false, holding: !!dock && !dock.held, scrubbing: dock?.held ?? false};
    if (next.dragging !== previous.dragging || next.holding !== previous.holding || next.scrubbing !== previous.scrubbing) {previous = next; ports.changed(next);}
  }
  function clearRailTimer() {if (railTimer !== null) ports.clock.clear(railTimer); railTimer = null;}
  function clearDockTimer() {if (dockTimer !== null) ports.clock.clear(dockTimer); dockTimer = null;}
  function endRail() {
    clearRailTimer(); const old = rail; rail = null;
    if (old?.held || old?.moved) railGuard = ports.clock.now() + 500;
    if (old) ports.release('rail', old.id); publish();
  }
  function endDock(suppress = false) {
    clearDockTimer(); const old = dock; dock = null;
    if (suppress) dockGuard = ports.clock.now() + 500;
    if (old) ports.release('dock', old.id, old.owner); publish();
  }
  function beginRail() {
    if (!rail || rail.held || !ports.visible('rail')) return;
    clearRailTimer(); rail.held = true; ports.capture('rail', rail.id); publish();
  }
  function candidate(id: string) {
    if (!dock || dock.choice === id) return;
    dock.choice = id;
    if (ports.selected() !== id) ports.select(id);
  }
  function beginDock() {
    if (!dock || dock.held || !ports.visible('dock', dock.owner)) return;
    clearDockTimer(); dock.held = true; ports.capture('dock', dock.id, dock.owner); publish(); candidate(dock.owner);
  }
  function scrub(x: number, y: number) {
    const bounds = ports.dockBounds();
    if (y < bounds.top - 64 || y > bounds.bottom + 64) return;
    const choices = ports.dockChoices();
    if (choices.length) candidate(choices.reduce((best, choice) => Math.abs(choice.center - x) < Math.abs(best.center - x) ? choice : best).id);
  }
  return {
    railDown(event: LibraryPointer) {
      if (event.pointerType !== 'mouse') {ports.cancelMotion(); endDock(); return;}
      if (!event.isPrimary || event.button !== 0 || modified(event)) return;
      endRail(); ports.cancelMotion(); endDock(); railGuard = 0;
      rail = {id: event.pointerId, startX: event.clientX, startY: event.clientY, left: ports.scrollLeft(), held: false, moved: false};
      railTimer = ports.clock.set(beginRail, 180);
    },
    dockDown(id: string, event: LibraryPointer) {
      if (!event.isPrimary || event.button !== 0 || modified(event)) return;
      endDock(); dockGuard = 0;
      dock = {id: event.pointerId, owner: id, x: event.clientX, y: event.clientY, touch: event.pointerType !== 'mouse', held: false, choice: null};
      publish(); dockTimer = ports.clock.set(beginDock, 350);
    },
    move(event: LibraryPointer): boolean {
      let prevent = false;
      if (rail?.id === event.pointerId) {
        if (!(event.buttons & 1)) endRail();
        else {
          const dx = Math.abs(event.clientX - rail.startX), dy = Math.abs(event.clientY - rail.startY);
          if (Math.max(dx, dy) > 4) rail.moved = true;
          if (dx > 4 && dx > dy) beginRail();
          if (rail.held) {ports.scrollTo(rail.left + rail.startX - event.clientX); prevent = true;}
        }
      }
      if (dock?.id === event.pointerId) {
        if (!dock.held) {
          const dx = Math.abs(event.clientX - dock.x), dy = Math.abs(event.clientY - dock.y);
          if (dx >= 8 && dx > dy * 1.25) beginDock();
          else if (dy > 24 && dy > dx) endDock(true);
        }
        if (dock?.held) {scrub(event.clientX, event.clientY); prevent = true;}
      }
      return prevent;
    },
    up(event: LibraryPointer) {
      if (rail?.id === event.pointerId) endRail();
      if (dock?.id !== event.pointerId) return;
      if (dock.held && dock.choice) scrub(event.clientX, event.clientY);
      const {held, choice, touch} = dock; endDock(held);
      if (held && choice) ports.select(choice, true, touch);
    },
    cancel(pointerId: number) {if (rail?.id === pointerId) endRail(); if (dock?.id === pointerId) endDock(true);},
    lostRail(pointerId: number) {if (rail?.id === pointerId) endRail();},
    lostDock(pointerId: number) {if (dock?.id === pointerId) endDock(true);},
    outsideDock() {endDock();},
    cancelDock() {endDock();},
    cardClick(id: string, event: Pick<LibraryPointer, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, firstClickOpens = false): 'native' | 'selected' | 'suppressed' | 'open' {
      if (modified(event)) return 'native';
      if (ports.clock.now() < railGuard) return 'suppressed';
      if (ports.selected() !== id && !firstClickOpens) {ports.select(id); return 'selected';}
      return 'open';
    },
    dockClick(id: string, touch = false) {
      if (ports.clock.now() < dockGuard) return;
      if (ports.selected() === id) {endDock(); ports.open(id, touch);}
      else ports.select(id);
    },
    suppressWheel(event: {ctrlKey: boolean; shiftKey: boolean; deltaX: number}) {return !event.ctrlKey && (event.deltaX !== 0 || event.shiftKey);},
    suspend(cancelMotion = true) {endDock(); endRail(); if (cancelMotion) ports.cancelMotion();},
    dispose() {endDock(); endRail(); ports.cancelMotion();},
  };
}

/** One interruptible scroll animation per shelf, sharing the live preference.
 * Native touch scrolling never competes with an old queued destination. */
export function createLibraryRailMotion(ports: {
  read(): number; write(left: number): void; maximum(): number; reduced(): boolean;
  now(): number; requestFrame(callback: (now: number) => void): number; cancelFrame(id: number): void;
}) {
  let frame: number | null = null, serial = 0;
  const clamp = (left: number) => Math.max(0, Math.min(ports.maximum(), left));
  function cancel() {serial++; if (frame !== null) ports.cancelFrame(frame); frame = null;}
  return {
    cancel,
    settle(left: number) {cancel(); ports.write(clamp(left));},
    move(left: number) {
      cancel(); const ticket = serial, target = clamp(left), start = ports.read(), distance = target - start;
      if (ports.reduced() || Math.abs(distance) < 1) {ports.write(target); return;}
      const began = ports.now(), duration = Math.min(560, 300 + Math.abs(distance) * .18);
      const tick = (now: number) => {
        if (ticket !== serial) return;
        const progress = ports.reduced() ? 1 : Math.max(0, Math.min(1, (now - began) / duration));
        ports.write(clamp(start + distance * (1 - Math.pow(1 - progress, 4))));
        if (progress < 1) frame = ports.requestFrame(tick); else frame = null;
      };
      frame = ports.requestFrame(tick);
    },
  };
}
