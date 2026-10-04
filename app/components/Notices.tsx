import {createContext, createElement, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ReactNode} from 'react';
import {useHref, useLocation} from 'react-router';
import {AnimatedDialog, AnimatedDialogClose} from './AnimatedDialog';
import {useLocale} from './LocaleProvider';
import {useDocumentRequestFetch} from './DocumentRequestProvider';
import {createPreparationDocumentOwner} from '../runtime/preparation-document-owner';
import {createNoticesService, type NoticesService, type NoticeStorage, type PackagedContent, type PackagedContentNode, parsePackagedContent} from '../services/notices.client';
import type {GameId} from '../../src/contracts/product-catalog.mts';
import type {UiMessageKey} from '../services/locale.client';
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
  if(params.has('mpRoom') || /\/room(?:\/|$)/.test(pathname) || /\/(?:lobby|lobby\.html)$/.test(pathname) || params.get('lobbyOptions')==='1')return 'none';
  return params.has('debug') || ['touch','touch-hud'].includes(params.get('preview') ?? '')?'site-only':'all';
}
/** One document owner; routed window changes never restart entry notices.
 * Fixed content paths remain the existing generated publication artifacts. */
export function NoticesProvider({children,automatic = true,baseUrl,storage}: {
  children:ReactNode;automatic?:boolean;baseUrl?:string;storage?:NoticeStorage|null;
}) {
  const fetchImpl = useDocumentRequestFetch();
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
        controller.hydrate();void controller.showEntry(mode.current);return controller;
      },
      onController:controller=>{setService(controller);if(controller)setError(null);},
      onError:reason=>setError(reason instanceof Error?reason.message:String(reason)),
    });
    retained.current=owner;owner.attach();
    return()=>{owner.detach();queueMicrotask(()=>{if(epoch.current===effect){owner.dispose();if(retained.current===owner)retained.current=null;}});};
  },[baseUrl,rootHref,storage]);
  return <Context.Provider value={service}>{children}{error && <p role="alert">{error}</p>}<Notices/></Context.Provider>;
}
const button='min-h-11 rounded-xl border border-line px-3 py-2 text-sm disabled:opacity-50';
export function FirstUseNoticeButton({className=button}:{className?:string}) {
  const {service,snapshot}=useNotices(),{t}=useLocale();
  return <button type="button" className={className} disabled={!service || snapshot?.contents['first-use'].status==='loading'} onClick={()=>void service?.showFirstUse()}>{t('firstUseNotice.title')}</button>;
}
export function MultiplayerGuideButton({className=button}:{className?:string}) {
  const {service,snapshot}=useNotices(),{t}=useLocale();
  return <button type="button" className={className} disabled={!service || snapshot?.contents.multiplayer.status==='loading'} onClick={()=>void service?.showMultiplayer()}>{t('multiplayerGuide.action')}</button>;
}
export function SiteNoticeToggle({className=button}:{className?:string}) {
  const {service,snapshot}=useNotices(),{t}=useLocale();
  return <button type="button" role="switch" aria-checked={snapshot?.site.enabled ?? true} className={className} disabled={!service}
    onClick={()=>service?.setSiteEnabled(!snapshot?.site.enabled)}>{t('notice.aria')}</button>;
}

function renderPackagedNodes(nodes:ReadonlyArray<PackagedContentNode>,prefix=''):ReactNode[] {
  return nodes.map((node,index)=>node.kind==='text'?node.text:createElement(node.tag,{key:`${prefix}${index}`,...node.attributes},
    ...renderPackagedNodes(node.children,`${prefix}${index}.`)));
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
    <AnimatedDialog open={snapshot.firstUseOpen} onOpenChange={open=>{if(!open)service.closeFirstUse();}} title={t('firstUseNotice.title')}>
      <PackagedContentView content={snapshot.contents['first-use']} baseUrl={snapshot.baseUrl}/>
      <AnimatedDialogClose className={`${button} mt-5`}>{t('action.close')}</AnimatedDialogClose>
    </AnimatedDialog>
    <AnimatedDialog open={snapshot.multiplayerOpen} onOpenChange={open=>{if(!open)service.closeMultiplayer();}} title={t('multiplayerGuide.title')}>
      <PackagedContentView content={snapshot.contents.multiplayer} baseUrl={snapshot.baseUrl}/>
      <AnimatedDialogClose className={`${button} mt-5`}>{t('action.close')}</AnimatedDialogClose>
    </AnimatedDialog>
    {snapshot.site.open && <aside aria-label={t('notice.aria')} aria-hidden={snapshot.site.scrollHidden || undefined} inert={snapshot.site.scrollHidden}
      className={`fixed inset-x-3 top-20 z-40 mx-auto max-w-2xl rounded-2xl border border-line bg-panel p-3 text-sm shadow-menu transition-[opacity,transform] motion-reduce:transition-none ${snapshot.site.scrollHidden?'-translate-y-4 pointer-events-none opacity-0':''}`}>
      <div className="space-y-2">{snapshot.site.lines.map((line,index)=><p key={index}>{line.map((segment,part)=>segment.type==='text'?segment.text:<a key={part} href={segment.resolvedHref}
        target={segment.external?'_blank':undefined} rel={segment.external?'noopener noreferrer':undefined} className="inline-flex items-center gap-1 text-accent">
        {segment.asset && <img alt="" className="inline size-4" src={new URL(segment.asset,snapshot.baseUrl).href}/>}<span>{segment.label}</span></a>)}</p>)}</div>
      <div className="mt-2 flex justify-end gap-2">{snapshot.site.canOptOut && <button type="button" className={button} onClick={()=>service.setSiteEnabled(false)}>{t('notice.dismissForever')}</button>}
        <button type="button" className={button} aria-label={t('notice.close')} onClick={()=>service.closeSite({dismiss:true})}>{t('action.close')}</button></div>
    </aside>}
  </>;
}

/** Canonical help copy from main's message catalog, not the obsolete TH06 sample
 * restriction. Host-attested optional thprac help is enabled explicitly. */
export function CanonicalHelpContent({gameId,thpracAvailable=false}:{gameId?:GameId;thpracAvailable?:boolean}) {
  const {t}=useLocale(),{snapshot}=useNotices();
  const orientationImage=snapshot?new URL('assets/touch-rotate-landscape.webp',snapshot.baseUrl).href:'/assets/touch-rotate-landscape.webp';
  const practiceKeys:ReadonlyArray<readonly [string,UiMessageKey]>=[['Backspace','touch.cheatMenu'],['Tab','help.tracker'],['F12','touch.advancedMenu'],['F1','touch.invincible'],['F2','touch.infiniteLives'],['F3','touch.infiniteBombs'],['F4','touch.infinitePower'],['F5','touch.timeLock'],['F6','touch.autoBomb'],['F7','touch.enemyBgm']];
  const keys=useMemo<ReadonlyArray<readonly [string,UiMessageKey]>>(()=>[
    [t('help.arrowKeys'),'help.moveSelect'],['Z','help.fireConfirm'],['X','help.bombCancel'],['Shift','help.focusMove'],['Esc','help.pauseBack'],['Ctrl','help.skipDialogue'],['R','touch.restartHint'],
    ...(gameId==='th11'?[['C','touch.functionKeyHint'] as const]:[]),
  ],[t,gameId]);
  return <div className="space-y-5 text-sm leading-relaxed">
    <section><h2 className="font-bold">{t('help.gameControls')}</h2><p>{t('help.gameControlsIntro')}</p>
      <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">{keys.map(([key,label])=><div key={key} className="contents"><dt><kbd>{key}</kbd></dt><dd>{t(label)}</dd></div>)}</dl><p>{t('help.gameControlsNote')}</p></section>
    <details><summary className="min-h-11 cursor-pointer font-bold">{t('help.inGame')}</summary><ul className="list-disc space-y-2 pl-5"><li>{t('help.focusHoldSummary')}</li><li>{t('help.focusToggleSummary')}</li><li>{t('help.focusTwoFingerSummary')}</li><li>{t('help.menuSummary')}</li><li>{t('help.dialogueSummary')}</li></ul></details>
    <details><summary className="min-h-11 cursor-pointer font-bold">{t('help.manualLandscape')}</summary><ol className="list-decimal pl-5"><li>{t('help.turnPhone')}</li><li>{t('help.systemRotate')}</li></ol><img src={orientationImage} width={1550} height={1121} loading="lazy" decoding="async" alt={t('help.rotateImageAlt')} className="mt-3 h-auto max-w-full rounded-xl"/></details>
    <details><summary className="min-h-11 cursor-pointer font-bold">{t('help.iphoneFullscreen')}</summary><ol className="list-decimal space-y-2 pl-5"><li>{t('help.iosSafariShare')}<p>{t('help.iosSafariShareStep')}</p></li><li>{t('help.iosAddHome')}<p>{t('help.iosAddHomeStep')}</p></li><li>{t('help.iosWebApp')}<p>{t('help.iosWebAppStep')}</p></li></ol></details>
    {thpracAvailable && <details><summary className="min-h-11 cursor-pointer font-bold">thprac</summary><p>{t('help.thpracIntro')}</p><dl className="my-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">{practiceKeys.map(([key,label])=><div key={key} className="contents"><dt><kbd>{key}</kbd></dt><dd>{t(label)}</dd></div>)}</dl><p>{t('help.thpracReplayDesktop')}</p><p>{t('help.thpracReplayMobile')}</p></details>}
    <div className="flex flex-wrap gap-2"><FirstUseNoticeButton/><MultiplayerGuideButton/></div>
  </div>;
}
