import {createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useLocation} from 'react-router';
import {useRuntimeService, useRuntimeSnapshot} from '../runtime/RuntimeHost';
import {useResourceManager, useResourceImport} from './ResourceManagerProvider';
import {useGameLaunchJob} from './GameLaunchProvider';
import {useMultiplayerRoom, useMultiplayerLaunch} from './MultiplayerRoomProvider';
import {useMultiplayerReplay} from './MultiplayerReplayProvider';
import {useNavigationDraftRegistry} from './NavigationDrafts';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {useLocale} from './LocaleProvider';
import {createUiAppShell, uiShellActivityBlocks, type UiAppShell} from '../services/app-shell.client';
const Context=createContext<UiAppShell | null>(null),none=()=>()=>{},empty=()=>null;
// main's settings/room/notice surfaces are not native decision dialogs.
// Their accessible Radix role must not turn an idle page into perpetual work.
const updateDecisionSelector='[role="dialog"]:not([data-dialog-layout="library-panel"]):not([data-dialog-layout="fullscreen"]):not([data-dialog-layout="notice-right"]),dialog[open]';
export function useAppShell(){const controller=useContext(Context);return {controller,snapshot:useSyncExternalStore(controller?.subscribe ?? none,controller?.getSnapshot ?? empty,empty)};}
/** One document adapter inside all activity providers. Refs read live service
 * snapshots at activation and scheduled reload boundaries, never stale renders. */
export function AppShellProvider({children}:{children:ReactNode}){
  const runtime=useRuntimeService(),resources=useResourceManager(),imports=useResourceImport(),launch=useGameLaunchJob(),room=useMultiplayerRoom(),multiplayer=useMultiplayerLaunch();
  const runtimeSnapshot=useRuntimeSnapshot();
  const replay=useMultiplayerReplay();
  const drafts=useNavigationDraftRegistry(),location=useLocation(),fetchImpl=useDocumentRequestFetch();
  const ports=useRef({runtime,resources:resources.controller,imports:imports.controller,launch:launch.controller,room:room.controller,multiplayer:multiplayer.controller,replay:replay.controller,drafts,location});
  ports.current={runtime,resources:resources.controller,imports:imports.controller,launch:launch.controller,room:room.controller,multiplayer:multiplayer.controller,replay:replay.controller,drafts,location};
  const picker=useRef(false),retained=useRef<UiAppShell | null>(null),epoch=useRef(0);
  const [controller,setController]=useState<UiAppShell | null>(null);
  useLayoutEffect(()=>{
    const effect=++epoch.current;
    const owner=retained.current ?? createUiAppShell({baseUrl:new URL(import.meta.env.BASE_URL,window.location.origin).href,documentUrl:window.location.href,fetchImpl,
      shouldDefer(){const p=ports.current,resource=p.resources?.getSnapshot(),imported=p.imports?.getSnapshot(),job=p.launch?.getSnapshot(),group=p.room?.getSnapshot();
        return !p.runtime || uiShellActivityBlocks({runtime:p.runtime.getSnapshot(),operation:resource?.operation?.kind==='inspect'?null:resource?.operation,
          importOperation:imported?.operation,importReview:imported?.review,preparing:job?.preparing || group?.preparation?.status==='preparing' || group?.preparation?.status==='importing' || p.multiplayer?.getSnapshot().startup != null || p.replay?.getSnapshot().preparing,
          downloading:job?.ogg?.phase==='installing',
          dirtyDrafts:p.drafts?.blocking(p.location,{pathname:'',search:'',hash:''}).length,
          decisionOpen:!!document.querySelector(updateDecisionSelector),filePickerOpen:picker.current});},
    });
    retained.current=owner;setController(owner);owner.resume();void owner.start();
    const hide=()=>owner.suspend(),show=()=>owner.resume(),online=()=>{owner.resume();void owner.checkForUpdate();};
    const changed=()=>queueMicrotask(()=>owner.activityChanged());
    let dialogOpen=!!document.querySelector(updateDecisionSelector);
    const dialogs=new MutationObserver(()=>{const open=!!document.querySelector(updateDecisionSelector);if(open!==dialogOpen){dialogOpen=open;changed();}});
    dialogs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['role','open']});
    const pickerDone=(event:Event)=>{if(event.target instanceof HTMLInputElement && event.target.type==='file')picker.current=false;changed();};
    const click=(event:Event)=>{if(event.target instanceof HTMLInputElement && event.target.type==='file')picker.current=true;changed();};
    // The existing client announces activation before skipWaiting. Prevent a
    // new trusted user operation during that short handoff, including portals.
    const fence=(event:Event)=>{if(owner.getSnapshot().client?.activationPending){event.preventDefault();event.stopImmediatePropagation();}};
    window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('online',online);
    document.addEventListener('click',click,true);document.addEventListener('change',pickerDone,true);document.addEventListener('cancel',pickerDone,true);
    for(const kind of ['pointerdown','keydown','click','submit'])window.addEventListener(kind,fence,true);
    for(const kind of ['input','change','keyup','pointerup','visibilitychange'])document.addEventListener(kind,changed);
    return()=>{
      dialogs.disconnect();
      owner.suspend();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('online',online);
      document.removeEventListener('click',click,true);document.removeEventListener('change',pickerDone,true);document.removeEventListener('cancel',pickerDone,true);
      for(const kind of ['pointerdown','keydown','click','submit'])window.removeEventListener(kind,fence,true);
      for(const kind of ['input','change','keyup','pointerup','visibilitychange'])document.removeEventListener(kind,changed);
      queueMicrotask(()=>{if(epoch.current===effect){owner.dispose();if(retained.current===owner)retained.current=null;}});
    };
  },[fetchImpl]);
  useLayoutEffect(()=>{controller?.activityChanged();},[controller,runtime,runtimeSnapshot,resources.snapshot,imports.snapshot,launch.snapshot,room.snapshot,multiplayer.snapshot,replay.snapshot,location]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function AppShellStatus(){
  const {controller,snapshot}=useAppShell(),{t}=useLocale();
  if(!snapshot || snapshot.phase==='disabled' || snapshot.phase==='checking')return null;
  const pending=!!snapshot.client?.activationPending,waiting=!!snapshot.client?.updateWaiting || !!snapshot.client?.updateReady;
  if(!pending && !waiting && !snapshot.error && snapshot.phase!=='unsupported')return <span hidden data-ui-app-shell data-shell-phase={snapshot.phase} data-offline-ready={snapshot.offlineReady} data-update-waiting="false"/>;
  const label=pending?'ui.shell.applying':waiting && snapshot.deferred?'ui.shell.deferred':waiting?'ui.shell.waiting':snapshot.offlineReady?'ui.shell.ready':snapshot.phase==='unsupported'?'ui.shell.unsupported':'ui.shell.installing';
  return <aside aria-label={t('ui.shell.title')} data-ui-app-shell data-shell-phase={snapshot.phase} data-offline-ready={snapshot.offlineReady} data-update-waiting={waiting} className="mx-auto max-w-5xl px-4 py-2 text-xs text-muted">
    <p role="status">{t(label)}</p>
    {snapshot.error && <p role="alert">{t('ui.shell.error',{reason:snapshot.error})}</p>}
    {!pending && <button type="button" onClick={()=>void controller?.checkForUpdate()} className="mt-1 min-h-11 rounded-lg border border-line px-3">{t(snapshot.phase==='error'?'ui.shell.retry':'ui.shell.check')}</button>}
  </aside>;
}
