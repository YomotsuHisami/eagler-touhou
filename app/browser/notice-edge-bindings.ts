import {createEdgeDrawerGesture} from '../../src/launcher/edge-drawer-gesture.mts';
import type {NoticesService} from '../services/notices.client';

export function bindNoticeEdgeGestures(service:Pick<NoticesService,'getSnapshot'|'showFirstUse'|'closeFirstUse'|'loadSite'|'closeSite'>,
  {documentObj=globalThis.document,windowObj=globalThis.window}:{documentObj?:Document;windowObj?:Window}={}) {
  const available=()=>!documentObj.querySelector('[data-runtime-host][aria-hidden="false"]');
  const drawer=(selector:string)=>({contains:(target:Node|null)=>!!target && !!documentObj.querySelector(selector)?.contains(target)});
  const common={documentObj,windowObj};
  const firstUse=createEdgeDrawerGesture({...common,side:'right',drawer:drawer('[data-dialog-layout="notice-right"]'),
    enabled:available,isOpen:()=>service.getSnapshot().firstUseOpen,
    open:()=>available()?service.showFirstUse():undefined,close:()=>service.closeFirstUse()});
  const site=createEdgeDrawerGesture({...common,side:'left',drawer:drawer('[data-site-notice]'),
    enabled:()=>available() && service.getSnapshot().site.enabled,isOpen:()=>service.getSnapshot().site.open,
    open:()=>available()?service.loadSite():undefined,close:()=>service.closeSite()});
  return ()=>{firstUse.destroy();site.destroy();};
}
