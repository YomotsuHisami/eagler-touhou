import {useLayoutEffect, useRef, useSyncExternalStore} from 'react';
import {isMultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {RoomView} from '../components/room';
import type {BrowserSession} from './browser-session';
import {useSurfaceNavigation} from '../navigation/surface-navigation';

/** Same room section is reparented at the two original fullscreen/launch seams.
 * Its React lifetime, native panel, controls and the Runtime iframe never reset. */
export function RoomComposition({session, settingsClosing}: {session: BrowserSession; settingsClosing: boolean}) {
  const navigation = useSurfaceNavigation();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const room = useSyncExternalStore(session.room.service.subscribe, session.room.service.getSnapshot, session.room.service.getSnapshot);
  const settings = useSyncExternalStore(session.settings.subscribe, session.settings.getSnapshot, session.settings.getSnapshot);
  const home = useRef<{parent: Node; next: Node | null} | null>(null);
  useLayoutEffect(() => {
    const element = document.getElementById('mpRoomView'), player = document.getElementById('player');
    if (!element || !player) return;
    home.current ??= {parent: element.parentNode!, next: element.nextSibling};
    const target = state.th09NetworkOverlayOpen ? document.getElementById('th09NetworkRoom') : state.roomLaunchStage ? player : null;
    const restore = () => {const original = home.current; if (!original) return; if (original.next?.parentNode === original.parent) original.parent.insertBefore(element, original.next); else original.parent.appendChild(element); player.classList.remove('mp-room-launch-cover');};
    if (target) {target.append(element); player.classList.toggle('mp-room-launch-cover', !!state.roomLaunchStage);} else restore();
    return () => {
      // RoomView may already have removed its section when membership ends.
      // Moving that detached node back would resurrect an orphan room after
      // the real service/socket and Router had successfully completed Leave.
      if (element.isConnected) restore();
      else player.classList.remove('mp-room-launch-cover');
    };
  }, [state.th09NetworkOverlayOpen, state.roomLaunchStage, !!room.room]);
  return <RoomView visible={!!navigation.productId && isMultiplayerProductId(navigation.productId)} service={session.room.service} network={session.room.network}
    context={{launched: state.runtime?.launched === true, th09NetworkOverlayOpen: state.th09NetworkOverlayOpen,
      launchStage: state.roomLaunchStage === 'runtime' ? 'preparing' : state.roomLaunchStage,
      touchEnabled: settings?.options.touchEnabled === true, touchMovementMode: settings?.options.touchMovementMode ?? 'touch'}}
    assetUrl={path => new URL(path, session.baseUrl).href} onLeave={session.leaveRoom} onCopyRoomCode={session.copyRoomCode}
    onGuide={() => navigation.openInfoDialog('mpGuideDialog')} onOpenSettings={navigation.openRoomSettings}
    settingsOpen={navigation.roomSettingsOpen} settingsClosing={settingsClosing}
    panel={navigation.roomPanel ? {kind: navigation.roomPanel, peerId: navigation.roomNetworkPeer} : null}
    onOpenPanel={navigation.openRoomPanel} onClosePanel={navigation.closeRoomPanel}/>;
}
