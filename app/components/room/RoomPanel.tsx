import {useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject} from 'react';
import {useLocale} from '../../i18n';
import type {RoomPanelKind} from './types';
/** Main app6728–6772. Router owns the entry; this native owner only animates
 * committed closure and restores the exact opening control. */
export function RoomPanel({open, kind, peerId, onCloseRequest, onClosed, trigger, children}: {
  open: boolean; kind: RoomPanelKind; peerId?: string; onCloseRequest(): void; onClosed(): void;
  trigger: RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const {t} = useLocale(), ref = useRef<HTMLDialogElement>(null), generation = useRef(0), motion = useRef<Animation | null>(null);
  const completed = useRef(true), mounted = useRef(true);
  const latest = useRef({open, onCloseRequest, onClosed, trigger}); latest.current = {open, onCloseRequest, onClosed, trigger};
  const didClose = () => {
    if (!mounted.current || completed.current || ref.current?.open) return;
    completed.current = true;
    latest.current.onClosed();
    // A direct native close must settle the existing Router layer too. A
    // Router-committed close already has open=false and never repeats it.
    if (latest.current.open) latest.current.onCloseRequest();
    if (latest.current.trigger.current?.isConnected) latest.current.trigger.current.focus();
  };
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const token = ++generation.current;
    motion.current?.cancel(); motion.current = null;
    if (open) {completed.current = false; if (!node.open) node.showModal(); return;}
    if (!node.open) return;
    const finish = () => {
      if (generation.current !== token) return;
      motion.current = null;
      if (node.open) node.close();
      didClose();
    };
    if (document.body.classList.contains('less-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else {const animation = node.animate([{opacity: 1, transform: 'translateY(0) scale(1)'}, {opacity: 0, transform: 'translateY(14px) scale(.985)'}], {duration: 160, easing: 'cubic-bezier(.4,0,1,1)'}); motion.current = animation; void animation.finished.catch(() => {}).then(finish);}
  }, [open]);
  useEffect(() => {
    const node = ref.current; mounted.current = true;
    return () => {mounted.current = false; generation.current++; motion.current?.cancel(); motion.current = null; if (node?.open) node.close();};
  }, []);
  return <dialog ref={ref} id="mpRoomPanel" className="mp-room-panel" aria-labelledby="mpRoomPanelTitle" data-panel={kind} data-network-peer={peerId}
    onClose={didClose}
    onCancel={event => {event.preventDefault(); onCloseRequest();}} onClick={event => {if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCloseRequest();}}>
    <header className="mp-panel-head"><h3 id="mpRoomPanelTitle">{t(kind === 'personal' ? 'room.playerOptions' : kind === 'network' ? 'room.network' : kind === 'game' ? 'multiplayer.gameSettings' : 'room.spectatorLounge')}</h3><button type="button" id="mpRoomPanelClose" onClick={onCloseRequest}>{t('room.done')}</button></header>{children}
  </dialog>;
}
