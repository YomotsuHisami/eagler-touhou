import {AnimatePresence, motion, useIsPresent} from 'motion/react';
import {useMotionPreference} from './MotionPreferenceProvider';
import {NoticeEdgeGestures} from './NoticeEdgeGestures';
import {createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode} from 'react';
import {useHref, useLocation} from 'react-router';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';
import {useLocale} from './LocaleProvider';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {createNoticesService, type NoticesService, type NoticeStorage, type PackagedContent, parsePackagedContent} from '../services/notices.client';
import type {GameId} from '../../src/contracts/product-catalog.mts';
import {renderPackagedNodes} from './PackagedContentNodes';
import {MultiplayerGuideContent} from './MultiplayerGuideContent';
import {discouragedBrowserId} from '../../src/launcher/browser-support.mts';
const Context = createContext<NoticesService | null>(null);
const subscribeNone = () => () => {};
const empty = () => null;
export function useNotices() {
  const service = useContext(Context);
  const snapshot = useSyncExternalStore(service?.subscribe ?? subscribeNone,service?.getSnapshot ?? empty,empty);
  return {service,snapshot};
}
export function entryNoticeMode(pathname: string,search: string): 'all' | 'site-only' | 'none' {
  const params=new URLSearchParams(search);
  if(params.has('mpRoom') || params.has('j') || /\/room(?:\/|$)/.test(pathname) || /\/(?:lobby|lobby\.html)$/.test(pathname) || params.get('lobbyOptions')==='1')return 'none';
  return params.has('debug') || ['touch','touch-hud'].includes(params.get('preview') ?? '')?'site-only':'all';
}
/** One document owner; routed window changes never restart entry notices.
 * Fixed content paths remain the existing generated publication artifacts. */
export function NoticesProvider({children,automatic = true,baseUrl,storage}: {
  children:ReactNode;automatic?:boolean;baseUrl?:string;storage?:NoticeStorage|null;
}) {
  const fetchImpl = useDocumentRequestFetch();
  const {t} = useLocale();
  const [browserWarning, setBrowserWarning] = useState(false);
  const continueEntry = useRef<((faq: boolean) => void) | null>(null);
  const location=useLocation(),rootHref=useHref('/');
  const [service,setService]=useState<NoticesService|null>(null),[error,setError]=useState<string|null>(null);
  const mode=useRef(automatic?entryNoticeMode(location.pathname,location.search):'none');
  const currentMode=useRef(mode.current);
  useEffect(()=>{currentMode.current=automatic?entryNoticeMode(location.pathname,location.search):'none';},[automatic,location.pathname,location.search]);
  const retained=useRef<ReturnType<typeof createPreparationDocumentOwner<NoticesService>>|null>(null),epoch=useRef(0);
  useEffect(()=>{
    const effect=++epoch.current;
    const owner=retained.current ?? createPreparationDocumentOwner<NoticesService>({
      target:window,
      load:async()=>()=>{
        const root=new URL(rootHref,window.location.origin);
        let selectedStorage=storage;
        if(selectedStorage===undefined){try{selectedStorage=window.localStorage;}catch{selectedStorage=null;}}
        const controller=createNoticesService({baseUrl:baseUrl ?? new URL(root.pathname.endsWith('/')?root.pathname:`${root.pathname}/`,root.origin).href,
          fetchImpl,storage:selectedStorage});
        controller.hydrate();
        const query = new URLSearchParams(location.search);
        let dismissed = false;try {dismissed = selectedStorage?.getItem('browser-warning-dismissed') === '1';} catch {}
        if (automatic && !query.has('debug') && !['touch','touch-hud'].includes(query.get('preview') ?? '') &&
            query.get('lobbyOptions') !== '1' && !/\/(?:lobby|lobby\.html)$/.test(location.pathname) &&
            !dismissed && discouragedBrowserId(navigator.userAgent)) {
          continueEntry.current = faq => {
            continueEntry.current = null;
            try {selectedStorage?.setItem('browser-warning-dismissed', '1');} catch {}
            setBrowserWarning(false);
            if (faq) window.location.href = new URL('faq.html', root).href;
            else void controller.showEntry(mode.current);
          };
          setBrowserWarning(true);
        } else void controller.showEntry(mode.current);
        return controller;
      },
      onController:controller=>{setService(controller);if(controller)setError(null);},
      onError:reason=>setError(reason instanceof Error?reason.message:String(reason)),
    });
    retained.current=owner;owner.attach();
    return()=>{owner.detach();queueMicrotask(()=>{if(epoch.current===effect){owner.dispose();if(retained.current===owner)retained.current=null;}});};
  },[baseUrl,rootHref,storage]);
  return <Context.Provider value={service}>{children}{error && <p role="alert">{error}</p>}<Notices/>
    <AnimatedDialog open={browserWarning} onOpenChange={() => {}} title={t('browserWarning.title')} description={t('browserWarning.message')}
      layer={100} onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
      <div className="flex justify-end gap-3">
        <button type="button" className={button} onClick={() => continueEntry.current?.(true)}>{t('action.viewFaq')}</button>
        <button type="button" className={button} onClick={() => continueEntry.current?.(false)}>{t('action.continueVisit')}</button>
      </div>
    </AnimatedDialog>
  </Context.Provider>;
}
const button='min-h-11 rounded-xl border border-line px-3 py-2 text-sm disabled:opacity-50';
export function FirstUseNoticeButton({className=button, children}:{className?:string;children?:ReactNode}) {
  const {service,snapshot}=useNotices(),{t}=useLocale();
  return <button type="button" className={className} disabled={!service || snapshot?.contents['first-use'].status==='loading'} onClick={()=>void service?.showFirstUse()}>{children ?? t('firstUseNotice.title')}</button>;
}
export function MultiplayerGuideButton({className=button,gameId}:{className?:string;gameId?:GameId}) {
  const {service,snapshot}=useNotices(),{t}=useLocale();
  return <button type="button" className={className} disabled={!service || snapshot?.contents.multiplayer.status==='loading'} onClick={()=>void service?.showMultiplayer(gameId)}>{t('multiplayerGuide.action')}</button>;
}
export function SiteNoticeToggle({className=button, children}:{className?:string;children?:ReactNode}) {
  const {service,snapshot}=useNotices(),{t}=useLocale();
  return <button type="button" role="switch" aria-checked={snapshot?.site.enabled ?? true} className={className} disabled={!service}
    onClick={()=>service?.setSiteEnabled(!snapshot?.site.enabled)}>{children ?? t('notice.aria')}</button>;
}

/** Canonical generated markup becomes allowlisted React nodes, never innerHTML. */
export async function packagedContentNodes(html:string,baseUrl:string):Promise<ReactNode[]> {
  return renderPackagedNodes(await parsePackagedContent(html,baseUrl));
}
function PackagedContentView({content}:{content:PackagedContent;baseUrl:string}) {
  const {t}=useLocale();
  const rendered=useMemo(()=>renderPackagedNodes(content.nodes),[content.nodes]);
  const first=content.kind==='first-use';
  if(content.status==='error')return <p role="alert">{t(first?'firstUseNotice.readFailed':'multiplayerGuide.readFailed',{reason:content.error ?? ''})}</p>;
  if(content.status==='empty')return <p>{t('firstUseNotice.empty')}</p>;
  if(content.status!=='available')return <p role="status">{t(first?'firstUseNotice.loading':'multiplayerGuide.loading')}</p>;
  // Current packaged prose is Chinese, even when surrounding controls are English.
  return <div lang="zh-CN" className="space-y-3 text-sm leading-relaxed [&_h2]:mt-5 [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent">{rendered}</div>;
}
export function Notices() {
  const {service,snapshot}=useNotices(),{t}=useLocale();
  useEffect(()=>{
    if(!service || !snapshot?.site.open)return;
    const root=document.scrollingElement ?? document.documentElement;
    service.observeScroll(root,window.scrollY || root.scrollTop);
    const scroll=(event:Event)=>{
      const target=event.target instanceof Element?event.target:root;
      service.observeScroll(target,target===root?window.scrollY || root.scrollTop:target.scrollTop);
    };
    document.addEventListener('scroll',scroll,{capture:true,passive:true});
    return()=>document.removeEventListener('scroll',scroll,{capture:true});
  },[service,snapshot?.site.open]);
  if(!service || !snapshot)return null;
  return <>
    <NoticeEdgeGestures service={service}/>
    <AnimatedDialog layout="notice-right" open={snapshot.firstUseOpen} onOpenChange={open=>{if(!open)service.closeFirstUse();}} title={t('firstUseNotice.title')}>
      <div className="notice-right-content"><PackagedContentView content={snapshot.contents['first-use']} baseUrl={snapshot.baseUrl}/></div>
      <AnimatedDialogClose aria-label={t('firstUseNotice.close')} className="notice-swipe-close"><span>{t('firstUseNotice.swipeToClose')}</span><span aria-hidden="true">⟶</span></AnimatedDialogClose>
    </AnimatedDialog>
    <AnimatedDialog open={snapshot.multiplayerOpen} onOpenChange={open=>{if(!open)service.closeMultiplayer();}} title={t('multiplayerGuide.title')}>
      <MultiplayerGuideContent content={snapshot.contents.multiplayer} gameId={snapshot.multiplayerGameId} request={snapshot.multiplayerRequest}/>
      {snapshot.contents.multiplayer.status==='error' && <button type="button" className={button} onClick={()=>void service.loadContent('multiplayer')}>{t('lobby.retry')}</button>}
      <AnimatedDialogClose className={`${button} mt-5`}>{t('action.close')}</AnimatedDialogClose>
    </AnimatedDialog>
    <AnimatePresence>{snapshot.site.open && <SiteNoticeFrame scrollHidden={snapshot.site.scrollHidden} label={t('notice.aria')}>
      <div className="space-y-2">{snapshot.site.lines.map((line,index)=><p key={index}>{line.map((segment,part)=>segment.type==='text'?segment.text:<a key={part} href={segment.resolvedHref}
        target={segment.external?'_blank':undefined} rel={segment.external?'noopener noreferrer':undefined} className="inline-flex items-center gap-1 text-accent">
        {segment.asset && <img alt="" className="inline size-4" src={new URL(segment.asset,snapshot.baseUrl).href}/>}<span>{segment.label}</span></a>)}</p>)}</div>
      <div className="mt-2 flex justify-end gap-2">{snapshot.site.canOptOut && <button type="button" className={button} onClick={()=>service.setSiteEnabled(false)}>{t('notice.dismissForever')}</button>}
        <button type="button" className={button} aria-label={t('notice.close')} onClick={()=>service.closeSite({dismiss:true})}>{t('action.close')}</button></div>
    </SiteNoticeFrame>}</AnimatePresence>
  </>;
}

function SiteNoticeFrame({scrollHidden,label,children}:{scrollHidden:boolean;label:string;children:ReactNode}) {
  const present=useIsPresent(), {reducedMotion}=useMotionPreference();
  return <motion.aside data-site-notice role="region" aria-label={label} aria-hidden={!present || scrollHidden || undefined} inert={!present || scrollHidden}
    initial={{x:reducedMotion?0:'-110%',opacity:reducedMotion?1:.7}}
    animate={{x:scrollHidden?'-110%':0,opacity:scrollHidden?0:1}}
    exit={{x:reducedMotion?0:'-110%',opacity:0}}
    transition={{duration:reducedMotion?0:.25,ease:[.22,.8,.24,1]}}
    className="notice-left-panel">{children}</motion.aside>;
}

export {CanonicalHelpContent} from './MainHelpContent';
