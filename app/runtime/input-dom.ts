import type { RuntimeInput } from './input-controller';
import {directTouchPoint, type InputRect} from './input-geometry';

export function usesNativeTouch(navigator: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>) {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}
export function bindRuntimeKeyboard(input: RuntimeInput, host: Window = window) {
  const doc = host.document;
  const forward = (event: KeyboardEvent) => {
    const launcherOwnsFocus = event.target instanceof Element && !!event.target.closest('input, select, textarea, button, a, dialog, [role="dialog"], [contenteditable="true"]');
    if (input.forwardKeyboard(event, launcherOwnsFocus || !!doc.querySelector('[data-ui-dialog-live]'))) event.preventDefault();
  };
  const blur = () => {input.clearKeyboard(); queueMicrotask(() => {if (!doc.hasFocus()) input.cancelTransient();});};
  const leave = () => {input.clearKeyboard(); input.cancelTransient();};
  const visibility = () => {if (doc.hidden) leave();};
  host.addEventListener('keydown', forward, true); host.addEventListener('keyup', forward, true);
  host.addEventListener('blur', blur); host.addEventListener('pagehide', leave);
  doc.addEventListener('visibilitychange', visibility);
  return () => {
    host.removeEventListener('keydown', forward, true); host.removeEventListener('keyup', forward, true);
    host.removeEventListener('blur', blur); host.removeEventListener('pagehide', leave);
    doc.removeEventListener('visibilitychange', visibility); leave();
  };
}
interface Contact {id: number; clientX: number; clientY: number}
interface ContactHandlers {
  down(contact: Contact): boolean | void;
  move?(contact: Contact): void;
  up(contact: Contact): void;
  accessible?: boolean;
}
/** Own a single native event family. iOS keeps every simultaneous HUD/movement
 * contact in the parent document, avoiding cross-frame pointer cancellation. */
export function bindInputContact(element: HTMLElement, handlers: ContactHandlers, nativeTouch = usesNativeTouch(navigator), ignoreMouse = false) {
  const contacts = new Map<number, Contact>();
  const removers: (() => void)[] = [];
  let accessibilityTimer: ReturnType<typeof setTimeout> | null = null;
  function listen(type: string, listener: EventListener) {
    element.addEventListener(type, listener, {passive: false});
    removers.push(() => element.removeEventListener(type, listener));
  }
  function down(contact: Contact, event: Event) {
    if (contacts.has(contact.id)) return;
    if (handlers.down(contact) === false) return;
    event.preventDefault(); contacts.set(contact.id, contact);
  }
  function move(contact: Contact, event: Event) {
    if (!contacts.has(contact.id)) return;
    event.preventDefault(); contacts.set(contact.id, contact); handlers.move?.(contact);
  }
  function up(contact: Contact, event: Event) {
    if (!contacts.has(contact.id)) return;
    event.preventDefault(); contacts.delete(contact.id); handlers.up(contact);
  }
  if (nativeTouch) {
    for (const [type, handler] of [['touchstart', down], ['touchmove', move], ['touchend', up], ['touchcancel', up]] as const) {
      listen(type, event => {
        for (const touch of Array.from((event as TouchEvent).changedTouches)) {
          handler({id: touch.identifier, clientX: touch.clientX, clientY: touch.clientY}, event);
        }
      });
    }
  } else {
    listen('pointerdown', event => {
      const pointer = event as PointerEvent;
      if (ignoreMouse && pointer.pointerType === 'mouse') return;
      down({id: pointer.pointerId, clientX: pointer.clientX, clientY: pointer.clientY}, event);
      if (contacts.has(pointer.pointerId)) try {element.setPointerCapture(pointer.pointerId);} catch { /* Synthetic or retired pointer. */ }
    });
    listen('pointermove', event => {const pointer = event as PointerEvent; move({id: pointer.pointerId, clientX: pointer.clientX, clientY: pointer.clientY}, event);});
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(type, event => {
      const pointer = event as PointerEvent;
      const last = contacts.get(pointer.pointerId);
      up({id: pointer.pointerId, clientX: type === 'lostpointercapture' ? last?.clientX ?? 0 : pointer.clientX,
        clientY: type === 'lostpointercapture' ? last?.clientY ?? 0 : pointer.clientY}, event);
    });
  }
  if (handlers.accessible) {
    const accessibilityContact = {id: -1, clientX: 0, clientY: 0};
    listen('keydown', event => {
      const key = event as KeyboardEvent;
      if (key.key !== ' ' && key.key !== 'Enter') return;
      event.preventDefault(); if (!key.repeat) down(accessibilityContact, event);
    });
    listen('keyup', event => {
      if (![' ', 'Enter'].includes((event as KeyboardEvent).key)) return;
      event.preventDefault(); up(accessibilityContact, event);
    });
    listen('click', event => {
      if ((event as MouseEvent).detail !== 0 || contacts.has(-1)) return;
      down(accessibilityContact, event);
      accessibilityTimer = setTimeout(() => {accessibilityTimer = null; up(accessibilityContact, event);}, 70);
    });
    listen('blur', event => up(accessibilityContact, event));
  }
  listen('contextmenu', event => event.preventDefault());
  const cancel = () => {contacts.forEach(contact => handlers.up(contact)); contacts.clear();};
  const blur = () => {queueMicrotask(() => {if (!document.hasFocus()) cancel();});};
  const visibility = () => {if (document.hidden) cancel();};
  window.addEventListener('blur', blur); window.addEventListener('pagehide', cancel);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('blur', blur); window.removeEventListener('pagehide', cancel);
    document.removeEventListener('visibilitychange', visibility);
    removers.forEach(remove => remove());
    if (accessibilityTimer) clearTimeout(accessibilityTimer);
    cancel();
  };
}

export function bindDirectTouch(element: HTMLElement, frame: HTMLIFrameElement, input: RuntimeInput) {
  let rect: InputRect | null = null;
  const point = (contact: Contact) => {
    rect ??= frame.getBoundingClientRect();
    return directTouchPoint(rect, contact);
  };
  const invalidate = () => {rect = null;};
  const cleanup = bindInputContact(element, {
    down(contact) {
      if (!input.hasDirectTouches()) invalidate();
      const normalized = point(contact);
      return !!normalized && input.directDown(contact.id, normalized);
    },
    move(contact) {const normalized = point(contact); if (normalized) input.directMove(contact.id, normalized);},
    up(contact) {input.directUp(contact.id, point(contact) ?? undefined); if (!input.hasDirectTouches()) invalidate();},
  }, usesNativeTouch(navigator), true);
  window.addEventListener('resize', invalidate, {passive: true});
  window.visualViewport?.addEventListener('resize', invalidate, {passive: true});
  document.addEventListener('fullscreenchange', invalidate);
  return () => {
    cleanup(); window.removeEventListener('resize', invalidate);
    window.visualViewport?.removeEventListener('resize', invalidate);
    document.removeEventListener('fullscreenchange', invalidate);
  };
}
