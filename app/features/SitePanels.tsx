import {useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {useLocation,useNavigate} from 'react-router';
import {Dialog,Sheet} from '../ui';
import {useCloseIntent} from '../navigation/close-intent';
import {useUiText} from '../services/ui-preferences';
import {createFirstUseNoticeService} from '../services/first-use-notice';
import styles from './site-panels.module.css';

export type SitePanel = 'first-use'|'donation';
const panelKey='panel';
export function useSitePanels(){
 const location=useLocation(),navigate=useNavigate();
 const query=new URLSearchParams(location.search),value=query.get(panelKey);
 const panel:SitePanel|null=value==='first-use'||value==='donation'?value:null;
 query.delete(panelKey);
 const fallback=location.pathname+(query.size?`?${query}`:'')+location.hash;
 const close=useCloseIntent(fallback);
 function open(next:SitePanel){
  const search=new URLSearchParams(location.search);search.set(panelKey,next);
  void navigate({pathname:location.pathname,search:`?${search}`,hash:location.hash},{state:{from:location.pathname+location.search+location.hash},preventScrollReset:true});
 }
 return{panel,open,close};
}

export function SitePanels({panel,onClose,returnFocusRef,onDonationUnavailable,runtimeActive=false}:{runtimeActive?:boolean;onDonationUnavailable:()=>void;panel:SitePanel|null;onClose:()=>void;returnFocusRef:RefObject<HTMLElement|null>}){
 const location=useLocation(),navigate=useNavigate(),t=useUiText();
 const service=useMemo(()=>createFirstUseNoticeService(),[]);
 const current=useRef(location);current.current=location;
 const activeRuntime=useRef(runtimeActive);activeRuntime.current=runtimeActive;
 const[result,setResult]=useState<Awaited<ReturnType<typeof service.load>>|null>(null);
 useEffect(()=>{
  let active=true;const initial=current.current;
  // Onboarding is a boot-only effect, never a room/embedded session interrupt.
  const query=new URLSearchParams(initial.search);
  if(service.hasSeen()||query.has(panelKey)||!(/^\/$|^\/games\/[^/]+\/?$/).test(initial.pathname)||
    [...query.keys()].some(key=>/room|debug|touch|embed/i.test(key)))return;
  void service.load().then(value=>{
   if(!active||activeRuntime.current||value.kind!=='available'||current.current.key!==initial.key)return;
   const next=new URLSearchParams(initial.search);next.set(panelKey,'first-use');
   void navigate({pathname:initial.pathname,search:`?${next}`,hash:initial.hash},{replace:true,state:null,preventScrollReset:true});
  });
  return()=>{active=false;};
 },[service,navigate]);
 useEffect(()=>{
  if(panel!=='first-use')return;
  let active=true;setResult(null);
  void service.load().then(value=>{if(!active)return;setResult(value);if(value.kind==='available')service.markSeen();});
  return()=>{active=false;};
 },[panel,service]);
 return <>
  <Sheet placement="right" backdrop="transparent" open={panel==='first-use'} onOpenChange={open=>{if(!open)onClose();}} title={t('firstUseNotice.title')} returnFocusRef={returnFocusRef} className={styles.noticePanel}>
   <div className={styles.notice}>{!result?<p role="status">{t('firstUseNotice.loading')}</p>:result.kind==='available'?<div dangerouslySetInnerHTML={{__html:result.html}}/>:result.kind==='empty'?<p>{t('firstUseNotice.empty')}</p>:<p role="alert">{t('firstUseNotice.readFailed',{reason:result.error instanceof Error?result.error.message:String(result.error)})}</p>}</div>
  </Sheet>
  <Dialog open={panel==='donation'} onOpenChange={open=>{if(!open)onClose();}} title="捐赠以支持服务器运行" returnFocusRef={returnFocusRef} className={styles.donationPanel}>
   <div className={styles.donation}><p>使用微信扫码。</p><img src="/assets/donation.webp" alt="Tenko 的赞赏码" decoding="async" onError={onDonationUnavailable}/></div>
  </Dialog>
 </>;
}
