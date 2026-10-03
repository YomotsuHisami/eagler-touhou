import { parseSiteNoticeText } from './site-notice.mjs';
/** Inline site announcement, independent of selected game, saves and Runtime. */
export function createSiteInfo(root: HTMLElement) {
  const content = root.querySelector<HTMLElement>('#siteInfoContent')!;
  const status = root.querySelector<HTMLElement>('#siteInfoStatus')!;
  let loaded = false, request: AbortController | null = null;
  async function refresh() {
    request?.abort(); const controller = new AbortController(); request = controller;
    status.textContent = '正在读取网站公告…'; content.setAttribute('aria-busy','true');
    try {
      const response = await fetch('NOTICE.txt', {cache:'no-store', signal:controller.signal});
      if(!response.ok) throw Error(`公告读取失败（HTTP ${response.status}）`);
      const text = await response.text(); if(controller.signal.aborted)return;
      content.replaceChildren();
      for(const line of parseSiteNoticeText(text)) {
        const paragraph = document.createElement('p');
        for(const segment of line){
          if(segment.type==='text'){paragraph.append(document.createTextNode(segment.text));continue;}
          const link=document.createElement('a');link.textContent=segment.label;link.href=segment.resolvedHref;
          if(segment.external){link.target='_blank';link.rel='noopener noreferrer';}
          paragraph.append(link);
        }
        content.append(paragraph);
      }
      status.textContent = text.trim() ? '' : '暂无网站公告。'; loaded=true;
    }catch(error){if(!controller.signal.aborted)status.textContent=error instanceof Error?error.message:'公告暂时不可用，请点击刷新。';}
    finally{if(request===controller){content.setAttribute('aria-busy','false');request=null;}}
  }
  root.querySelector('#siteInfoRefresh')!.addEventListener('click',()=>void refresh());
  return { show(visible:boolean){root.hidden=!visible;if(visible&&!loaded&&!request)void refresh();}, refresh };
}
