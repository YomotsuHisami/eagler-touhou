import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createEdgeDrawerGesture} from '../../../src/launcher/edge-drawer-gesture.mts';
import {useLocale} from '../../i18n';
export interface RoomSettingsDrawerProps {
  roomOpen: boolean;
  open: boolean;
  onCloseRequest(): void;
  /** Retain settings while the fixed Player owns the editor foreground. */
  foregroundActive?: boolean;
  onClosingChange?(closing: boolean): void;
}
/** Main index716–719 and app2125–2207/6577–6593. Original regular drawer,
 * not an extra native dialog. OptionsPanel relocates its one header/fold here. */
export function RoomSettingsDrawer({roomOpen, open, foregroundActive = false, onCloseRequest, onClosingChange}: RoomSettingsDrawerProps) {
  const {t} = useLocale(), drawer = useRef<HTMLElement>(null), generation = useRef(0);
  const [presence, setPresence] = useState({hidden: true, closing: false});
  const suspendedFocus = useRef<HTMLElement | null>(null);
  const pendingReturnFocus = useRef(false);
  const latest = useRef({open, roomOpen, foregroundActive, onCloseRequest, onClosingChange}); latest.current = {open, roomOpen, foregroundActive, onCloseRequest, onClosingChange};
  useLayoutEffect(() => {
    const node = drawer.current, token = ++generation.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const returnFocus = node.contains(document.activeElement);
    const finish = () => {
      if (generation.current !== token) return;
      pendingReturnFocus.current = returnFocus && latest.current.roomOpen && !latest.current.foregroundActive;
      setPresence({hidden: true, closing: false});
    };
    if (roomOpen && open) {
      pendingReturnFocus.current = false;
      setPresence({hidden: false, closing: false});
      if (!foregroundActive) queueMicrotask(() => {if (generation.current === token && !latest.current.foregroundActive) node.querySelector<HTMLElement>('#libraryBack')?.focus({preventScroll: true});});
    } else if (node.hidden || !roomOpen || document.body.classList.contains('less-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {setPresence({hidden: false, closing: true}); timer = setTimeout(finish, 220);}
    return () => {generation.current++; if (timer !== null) clearTimeout(timer);};
  }, [roomOpen, open]);
  useLayoutEffect(() => {
    onClosingChange?.(presence.closing);
    if (presence.hidden && pendingReturnFocus.current) {
      pendingReturnFocus.current = false;
      // Main unhides the cue before restoring focus. The parent owns its
      // hidden prop, so wait for that closing=false commit to land first.
      const token = generation.current;
      queueMicrotask(() => {if (generation.current === token && latest.current.roomOpen && !latest.current.open && !latest.current.foregroundActive) document.getElementById('mpSettingsRoomDrawerToggle')?.focus({preventScroll: true});});
    }
  }, [presence, onClosingChange]);
  useLayoutEffect(() => {
    const node = drawer.current;
    if (!node) return;
    if (foregroundActive) {if (document.activeElement instanceof HTMLElement && node.contains(document.activeElement)) suspendedFocus.current = document.activeElement;}
    else if (open && suspendedFocus.current?.isConnected && node.contains(suspendedFocus.current)) {suspendedFocus.current.focus({preventScroll: true}); suspendedFocus.current = null;}
  }, [foregroundActive, open]);
  useEffect(() => {
    const node = drawer.current;
    if (!node) return;
    // The header and fold retain their OptionsPanel React ancestry when main's
    // same-node relocation moves them here. Native bubbling follows the actual
    // drawer and therefore preserves original Escape/Tab ownership.
    const keydown = (event: KeyboardEvent) => {
      if (!latest.current.open || latest.current.foregroundActive || event.defaultPrevented) return;
      if (event.key === 'Escape') {event.preventDefault(); latest.current.onCloseRequest();}
      if (event.key !== 'Tab') return;
      const controls = Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), summary, a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first && last) {event.preventDefault(); last.focus();} else if (!event.shiftKey && document.activeElement === last && first) {event.preventDefault(); first.focus();}
    };
    node.addEventListener('keydown', keydown);
    const gesture = createEdgeDrawerGesture({side: 'right', drawer: node,
      enabled: () => latest.current.open && !latest.current.foregroundActive,
      isOpen: () => latest.current.open, open: () => {}, close: () => latest.current.onCloseRequest()});
    return () => {node.removeEventListener('keydown', keydown); gesture.destroy();};
  }, []);
  return <><button className="settings-room-backdrop" id="mpSettingsRoomBackdrop" type="button" aria-label={t('settings.drawerClose')} hidden={!roomOpen || !open || foregroundActive} onClick={onCloseRequest}/>
    <aside ref={drawer} className={`mp-settings-room-drawer settings-ui${presence.closing ? ' closing' : ''}`} id="mpSettingsRoomDrawer" role="dialog" aria-modal="true" aria-label={t('settings.title')} hidden={presence.hidden || foregroundActive} inert={foregroundActive}><div className="mp-settings-room-content" id="mpSettingsRoomDrawerContent"/></aside>
  </>;
}
