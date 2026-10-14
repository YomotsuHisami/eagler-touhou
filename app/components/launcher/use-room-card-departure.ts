import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react';
import type {MultiplayerRoomService} from '../../services/multiplayer-room';
import {animateWorkspaceCard, workspaceCardSelector} from './workspace-motion';

/** Hold only the live room's presentation until its exit ends. Cleanup and
 * membership remain at the existing service, including launch/Runtime guards. */
export function useRoomCardDeparture(service: MultiplayerRoomService, lessMotion: boolean) {
  const state = useSyncExternalStore(service.subscribe,service.getSnapshot,service.getSnapshot);
  const active = useRef<{cancel():void;task:Promise<void>;committing:boolean} | null>(null);
  useEffect(() => () => {active.current?.cancel();active.current=null;}, []);
  useEffect(() => {if(active.current && !active.current.committing) {active.current.cancel();active.current=null;}}, [state.epoch]);
  return useCallback((action:() => void | Promise<void>): Promise<void> => {
    if(active.current) return active.current.task;
    const before = service.getSnapshot();
    const card = document.querySelector<HTMLElement>(workspaceCardSelector);
    if(!before.room || !card?.classList.contains('room-workspace')) return Promise.resolve(action());
    const motion = animateWorkspaceCard(card,'exit',true,lessMotion);
    let observer: MutationObserver | null=null, timer: ReturnType<typeof setTimeout> | null=null;
    const cancel = () => {observer?.disconnect();if(timer!==null)clearTimeout(timer);motion.cancel();if(active.current===entry)active.current=null;};
    const entry = {cancel,task:Promise.resolve(),committing:false}; active.current=entry;
    entry.task = motion.finished.then(async completed => {
      if(completed && service.getSnapshot().epoch===before.epoch && service.getSnapshot().room?.code===before.room?.code) {
        entry.committing=true;
        // Service retirement may precede the Router commit. Keep its old node
        // offscreen until it is actually replaced, matching the prototype ACK.
        observer=new MutationObserver(() => {if(!card.isConnected)cancel();});
        observer.observe(document.body,{childList:true,subtree:true});
        timer=setTimeout(cancel,1200);
        await action();
      }
    }).finally(() => {if(!entry.committing || !card.isConnected)cancel();});
    return entry.task;
  },[service,lessMotion]);
}
