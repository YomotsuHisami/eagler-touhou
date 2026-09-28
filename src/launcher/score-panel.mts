import { listScoreSaves, activeScoreSave, addScoreSave, updateActiveScoreSave } from './score-saves.mjs';
import type { ScoreSave } from './score-saves.mjs';
import { parseScoreDat } from './score-dat.mjs';
import type { ScoreReport, ScoreCell } from './score-dat.mjs';
export interface ScoreSelection { game: string; product: string; root: string; file: string; storageFile?: string }
// Read only the existing Emscripten save file. Never create or mutate a save DB.
export async function readPersistedScore(root: string, file: string, factory: IDBFactory = indexedDB): Promise<Uint8Array | null> {
  return new Promise((resolve,reject)=>{
    const request=factory.open(root); let absent=false;
    request.onupgradeneeded=()=>{absent=true;request.transaction?.abort();};
    request.onerror=()=>absent?resolve(null):reject(request.error);
    request.onblocked=()=>reject(Error('存档正在被其他页面使用，请稍后刷新'));
    request.onsuccess=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('FILE_DATA')){db.close();resolve(null);return;}
      const tx=db.transaction('FILE_DATA','readonly'),read=tx.objectStore('FILE_DATA').get(`${root}/${file}`);
      tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error);};
      read.onerror=()=>reject(read.error);
      read.onsuccess=async()=>{try{const data=read.result?.contents;
        resolve(data==null?null:data instanceof Blob?new Uint8Array(await data.arrayBuffer()):new Uint8Array(data));
      }catch(error){reject(error);}};
    };
  });
}
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
const fmt=(v:ScoreCell)=>typeof v==='number'?v.toLocaleString():v;
export function favoriteLoadout(report: ScoreReport): { name:string; count:number; portraits:string[] } | null {
  const rows=report.sections.find(s=>s.title==='各机体开局次数')?.rows.filter(r=>r[1]==='合计')
    ?? report.sections.find(s=>s.title==='各机体游玩统计')?.rows.filter(r=>r[0]!=='合计').map(r=>[r[0],'合计',r[1]]) ?? [];
  const best=rows.filter(r=>Number(r[2])>0).sort((a,b)=>Number(b[2])-Number(a[2]))[0];
  if(!best)return null;
  const name=String(best[0]);
  const teams:Record<string,string[]>={'结界组':['reimu','yukari'],'咏唱组':['marisa','alice'],'红魔组':['sakuya','remilia'],'幽冥组':['youmu','yuyuko']};
  const names:Record<string,string>={'灵梦':'reimu','魔理沙':'marisa','咲夜':'sakuya','妖梦':'youmu','紫':'yukari','爱丽丝':'alice','蕾米莉亚':'remilia','幽幽子':'yuyuko'};
  return {name,count:Number(best[2]),portraits:teams[name]??[names[name.split(' ')[0]]].filter(Boolean)};
}
const crops:Record<string,string>={yukari:'45 552 320 430',reimu:'350 538 345 445',alice:'710 552 270 435',marisa:'990 538 340 445',remilia:'75 1080 340 400',sakuya:'390 1020 285 455',youmu:'715 1000 235 485',yuyuko:'965 1020 280 460'};
export function createScorePanel(host: HTMLElement, artwork: HTMLElement, read: (selection:ScoreSelection)=>Promise<Uint8Array|null>, libraryHost?: HTMLElement,
  choose?: (selection:ScoreSelection,save:ScoreSave|null)=>Promise<void>) {
  let selected:ScoreSelection|null=null,epoch=0;
  const input=make('input');input.type='file';input.accept='.dat';input.multiple=true;input.hidden=true;
  const status=make('p',undefined,'score-source visually-hidden');status.setAttribute('role','status');
  const content=make('div',undefined,'score-content');host.append(status,content);
  const library=make('section',undefined,'score-save-library'),libraryHeader=make('div',undefined,'score-save-library-header');
  const add=make('button','添加存档');add.type='button';libraryHeader.append(make('h3','选择存档'),add);
  const list=make('div',undefined,'score-save-list'),message=make('p',undefined,'score-save-message');message.setAttribute('role','status');
  library.append(libraryHeader,list,message,input);libraryHost?.prepend(library);
  let chosenId:string|null=null,libraryEpoch=0;
  function clearArt(){artwork.replaceChildren();artwork.hidden=true;}
  function display(report:ScoreReport,source:string) {
    content.replaceChildren();clearArt();status.textContent=source;
    const favorite=favoriteLoadout(report);
    if(favorite?.portraits.length){
      artwork.hidden=false;
      for(const name of favorite.portraits){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),image=document.createElementNS(ns,'image');
        svg.setAttribute('viewBox',crops[name]);svg.setAttribute('preserveAspectRatio','xMidYMid meet');
        const [, , w, h] = crops[name].split(' ');svg.setAttribute('width',w);svg.setAttribute('height',h);
        const ratio=Number(w)/Number(h);svg.style.setProperty('--portrait-ratio',String(ratio));svg.style.setProperty('--portrait-inset',ratio>=.7?'8%':'4%');
        image.setAttribute('href','assets/score-character-sheet.png');image.setAttribute('width','1668');image.setAttribute('height','2312');svg.append(image);artwork.append(svg);
      }
    }
    const metrics=make('div',undefined,'score-metrics');
    for(const [label,value] of [['最高分',report.highest==null?'暂无记录':report.highest.toLocaleString()],['排行槽位',String(report.rankingCount)],['最常用机体',favorite?`${favorite.name} · ${favorite.count.toLocaleString()} 次`:'暂无次数记录']]){
      const box=make('div');box.append(make('span',label),make('strong',value));metrics.append(box);
    }content.append(metrics);
    for(const note of report.notes)content.append(make('p',note,'score-note'));
    const order=['排行榜','各机体游玩统计','游玩次数','各机体开局次数','通关次数','通关与关卡进度','单关练习','时间与存档','音乐解锁','符卡汇总','单局详细统计'];
    for(const section of [...report.sections].sort((a,b)=>order.indexOf(a.title)-order.indexOf(b.title))){
      const details=make('details',undefined,'score-section'),summary=make('summary',`${section.title} · ${section.rows.length}`);details.append(summary);
      if(section.note)details.append(make('p',section.note,'score-note'));
      const wrap=make('div',undefined,'score-table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',section.title);
      const table=make('table'),head=make('thead'),hr=make('tr');for(const col of section.columns){const th=make('th',col);th.scope='col';hr.append(th);}head.append(hr);table.append(head);
      const body=make('tbody');
      for(const row of section.rows){const tr=make('tr');for(const val of row)tr.append(make('td',fmt(val)));body.append(tr);}
      table.append(body);wrap.append(table);details.append(wrap);content.append(details);
    }
  }
  async function refreshData(){
    if(!selected)return;const selection={...selected},ticket=++epoch;clearArt();content.replaceChildren();status.textContent='正在读取本机存档…';
    try{
      const active=libraryHost?await activeScoreSave(selection.product):null;
      const bytes=active?.state.pending?active.save.bytes:await read(selection);if(ticket!==epoch)return;
      chosenId=active?.save.id??null;
      if(!bytes?.length){status.textContent='';const empty=make('div',undefined,'score-empty');empty.append(make('p','游戏保存后，成绩与进度将在这里显示'));content.append(empty);return;}
      if(active&&!active.state.pending)await updateActiveScoreSave(selection.product,bytes);
      if(ticket!==epoch)return;
      display(parseScoreDat(selection.game,bytes),active?.state.pending?`已选择 ${active.save.name}，下次启动使用`:'本机游戏存档');
    }catch(error){if(ticket!==epoch)return;status.textContent='暂时无法读取统计';content.append(make('p',error instanceof Error?error.message:'读取失败，请重试','score-note'));}
  }
  function downloadSave(name:string,bytes:Uint8Array){const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'})),link=make('a');link.href=url;link.download=name.endsWith('.dat')?name:name+'.dat';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function openSaves(){
    if(!selected||!libraryHost)return;const selection={...selected},ticket=++libraryEpoch;list.replaceChildren();message.textContent='正在读取存档…';
    try{
      const [saves,active,bytes]=await Promise.all([listScoreSaves(selection.product),activeScoreSave(selection.product),read(selection)]);
      if(ticket!==libraryEpoch||selected?.product!==selection.product)return;chosenId=active?.save.id??null;message.textContent='';
      const row=(name:string,detail:string,save:ScoreSave|null,data:Uint8Array)=>{
        const item=make('div',undefined,'score-save-row'),select=make('button',undefined,'score-save-select'),download=make('button','下载存档','score-save-download');select.type=download.type='button';
        const isSelected=save?save.id===chosenId:chosenId===null;
        select.setAttribute('aria-pressed',String(isSelected));select.append(make('strong',name),make('small',detail+(isSelected?' · '+(active?.state.pending?'已选择，下次启动使用':'使用中'):'')));
        download.setAttribute('aria-label','下载存档 '+name);
        select.addEventListener('click',async()=>{if(!choose)return;select.disabled=true;message.textContent='正在切换存档…';try{await choose(selection,save);if(selected?.product!==selection.product)return;await refreshData();await openSaves();}catch(error){message.textContent=error instanceof Error?error.message:'切换失败';}finally{select.disabled=false;}});
        download.addEventListener('click',()=>downloadSave(save?.name??selection.file,data));item.append(select,download);list.append(item);
      };
      if(bytes?.length&&(!active||active.state.pending))row('当前游戏存档',selection.file,null,bytes);
      for(const save of saves)row(save.name,new Date(save.updated).toLocaleString(),save,save.bytes);
      if(!saves.length&&!bytes?.length)list.append(make('p','尚无存档，可添加已有 DAT 文件。','score-note'));
    }catch(error){if(ticket!==libraryEpoch)return;message.textContent=error instanceof Error?error.message:'存档列表读取失败';}
  }
  add.addEventListener('click',()=>input.click());
  input.addEventListener('change',async()=>{const files=[...(input.files??[])];input.value='';if(!files.length||!selected)return;const selection={...selected};add.disabled=true;
    try{for(const file of files){if(file.size>2_000_000)throw Error('DAT 文件过大');await addScoreSave(selection.product,selection.game,file.name,new Uint8Array(await file.arrayBuffer()));}if(selected?.product===selection.product)await openSaves();}
    catch(error){message.textContent=error instanceof Error?error.message:'存档添加失败';}finally{add.disabled=false;}
  });
  return {select(selection:ScoreSelection){if(selected?.product===selection.product && selected?.storageFile===selection.storageFile)return;selected=selection;void refreshData();},refresh:refreshData,openSaves};
}
