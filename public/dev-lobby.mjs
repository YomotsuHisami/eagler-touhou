// Layout source: https://touhou.vip/lobby.html (retrieved 2026-09-28).
// Local-only visual fixture for the live lobby design. No relay connection.
import { PRODUCT_GAMES } from './assets/contracts/product-catalog.mjs';
const $=id=>document.getElementById(id);
if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) throw Error('Local preview only');
const games=['th06','th07','th08','th09','th10'];
let localProfile={name:'',initial:'?',device:'未知'};
let selected=new URL(location.href).searchParams.get('game')||'th06',mode='create';
const rooms=games.map((game,i)=>({game,code:String(6100+i),capacity:i===2?3:2,players:i===3?2:1,difficulty:['Normal','Easy','Lunatic','Hard','Extra'][i],running:i===3}));
const notice=text=>{$('notice').hidden=false;$('notice').textContent=text;};
function render(){
 $('roomList').replaceChildren();
 const visible=rooms.filter(r=>!r.private&&(!selected||r.game===selected));
 for(const room of visible){
  const row=$('roomRowTemplate').content.firstElementChild.cloneNode(true),meta=PRODUCT_GAMES[room.game];
  const text=(selector,value)=>row.querySelector(selector).textContent=value;
  text('.lobby-room-code','#'+room.code);
  text('.lobby-difficulty',room.difficulty);text('.lobby-mobile-difficulty',room.difficulty);text('.lobby-occupancy',room.players+' / '+room.capacity);text('.lobby-player-count',room.players+' / '+room.capacity);
  const state=room.running?'running':room.players>=room.capacity?'full':'recruiting';
  const stateText={running:'游戏中',full:'已满员',recruiting:'招募中'}[state];
  const stateNode=row.querySelector('.lobby-room-state');stateNode.dataset.state=state;stateNode.textContent=stateText;
  for(let i=0;i<room.capacity;i++){const seat=document.createElement('span');seat.className='lobby-seat';seat.dataset.empty=String(i>=room.players);seat.dataset.ready=String(room.running);seat.textContent=i<room.players?String.fromCharCode(65+i):'';seat.title='P'+(i+1);row.querySelector('.lobby-seats').append(seat);}
  const join=row.querySelector('.lobby-join');join.disabled=state!=='recruiting';join.textContent=state==='recruiting'?'加入':stateText;
  join.addEventListener('click',()=>joinRoom(room));
  $('roomList').append(row);
 }
 $('roomList').setAttribute('aria-busy','false');$('listLoading').hidden=true;$('listHead').hidden=!visible.length;$('emptyState').hidden=!!visible.length;
 $('emptyTitle').textContent='暂无房间';$('emptyHint').textContent='可以创建一个本地示例房间。';$('roomCount').textContent=visible.length+' 个示例房间';
}
for(const game of ['',...games]){const button=document.createElement('button');button.type='button';button.className='lobby-filter';button.textContent=game?PRODUCT_GAMES[game].number:'全部';button.setAttribute('aria-pressed',String(!game));button.addEventListener('click',()=>{selected=game;for(const b of $('filters').children)b.setAttribute('aria-pressed',String(b===button));render();});$('filters').append(button);}
for(const game of games){const option=document.createElement('option');option.value=game;option.textContent=PRODUCT_GAMES[game].title;$('gameSelect').append(option);}
for(const n of [2,3])$('capacitySelect').add(new Option(n+' 人',n));
for(const difficulty of ['Easy','Normal','Hard','Lunatic','Extra'])$('difficultySelect').add(new Option(difficulty,difficulty));
$('difficultySelect').value='Normal';
function open(next){mode=next;$('dialogTitle').textContent=mode==='create'?'创建房间':'通过房间号加入';$('submitRoom').textContent=mode==='create'?'创建房间':'加入房间';$('gameSelect').closest('label').hidden=mode!=='create';$('gameSelect').disabled=mode!=='create';$('createFields').hidden=mode!=='create';$('policyFields').hidden=mode!=='create';$('codeField').hidden=mode==='create';$('roomCodeInput').required=mode!=='create';$('formError').hidden=true;$('formNote').textContent='本地调试操作，不会连接线上服务器。';$('gameSelect').value=selected||new URL(location.href).searchParams.get('game')||'th06';$('roomDialog').showModal();}
$('createButton').disabled=false;$('codeButton').disabled=false;
$('createButton').onclick=createRoom;$('codeButton').onclick=()=>open('join');$('closeDialog').onclick=()=>$('roomDialog').close();
$('roomForm').onsubmit=event=>{event.preventDefault();const game=$('gameSelect').value;if(mode==='create'){const code=String(6200+rooms.length);rooms.unshift({game,code,capacity:Number($('capacitySelect').value),players:1,difficulty:$('difficultySelect').value,running:false});selected=game;for(const b of $('filters').children)b.setAttribute('aria-pressed',String(b.textContent===PRODUCT_GAMES[game].number));notice('已创建示例房间 #'+code);}else{const room=rooms.find(r=>r.code===$('roomCodeInput').value.trim());if(!room||room.running||room.players>=room.capacity){$('formError').hidden=false;$('formError').textContent='未找到可加入的本地示例房间。';return;}joinRoom(room);} $('roomDialog').close();render();};
// Shared footer stays visible while the room list scrolls.
const footer=document.createElement('footer');footer.className='lobby-card-footer';
footer.append($('launcherLink'),document.querySelector('.lobby-actions'));document.querySelector('.lobby-main').append(footer);
$('codeButton').textContent='通过房间号加入';$('filters').hidden=true;
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==parent)return;
 if(event.data?.type==='local-room-show'){showRoomView(event.data.open,false);requestAnimationFrame(()=>parent.postMessage({type:'local-room-shown',open:event.data.open},location.origin));return;}
 if(event.data?.type==='local-room-focus'){if(roomViewOpen)focusChoice();else $('createButton').focus({preventScroll:true});return;}
 if(event.data?.type!=='local-lobby-view')return;
 document.body.classList.toggle('desktop-host',event.data.desktop===true);
 document.body.classList.toggle('portrait-host',event.data.portrait===true);
 const profile={name:typeof event.data.playerName==='string'?event.data.playerName:'',initial:typeof event.data.playerInitial==='string'?event.data.playerInitial:'?',device:['PC','手机'].includes(event.data.device)?event.data.device:'未知'};
 const profileChanged=JSON.stringify(profile)!==JSON.stringify(localProfile);localProfile=profile;
 if(profileChanged&&roomViewOpen)renderRoom();
 const game=event.data.game;
 if(games.includes(game)&&selected!==game){selected=game;$('roomDialog').close();$('notice').hidden=true;if(activeRoom&&roomViewOpen){resetChoice();scheduleRoomSync();focusChoice();}render();}
});
document.body.classList.toggle('desktop-host',matchMedia('(pointer:fine) and (orientation:landscape)').matches);
$('launcherLink').onclick=event=>{if(parent!==window){event.preventDefault();parent.postMessage({type:'local-lobby-back'},location.origin);}};
render();


// Shot choices follow the original games' manuals; portraits retain their source credits.
const portraitCrops={yukari:'45 552 320 430',reimu:'350 538 345 445',alice:'710 552 270 435',marisa:'990 552 340 431',remilia:'75 1080 340 400',sakuya:'390 1020 285 455',youmu:'715 1000 235 485',yuyuko:'965 1020 280 460'};
const unit=(name,art,modes)=>({name,art,modes});
const loadouts={
 th06:[unit('博丽灵梦',['reimu'],['A · 灵符','B · 梦符']),unit('雾雨魔理沙',['marisa'],['A · 魔符','B · 恋符'])],
 th07:[unit('博丽灵梦',['reimu'],['A · 灵符','B · 梦符']),unit('雾雨魔理沙',['marisa'],['A · 魔符','B · 恋符']),unit('十六夜咲夜',['sakuya'],['A · 幻符','B · 时符'])],
 th08:[unit('结界组',['reimu','yukari'],['组合','博丽灵梦 · 单人','八云紫 · 单人']),unit('咏唱组',['marisa','alice'],['组合','雾雨魔理沙 · 单人','爱丽丝 · 单人']),unit('红魔组',['sakuya','remilia'],['组合','十六夜咲夜 · 单人','蕾米莉亚 · 单人']),unit('幽冥组',['youmu','yuyuko'],['组合','魂魄妖梦 · 单人','西行寺幽幽子 · 单人'])],
 th09:['博丽灵梦','雾雨魔理沙','十六夜咲夜','魂魄妖梦','铃仙','琪露诺','莉莉卡','梅露兰','露娜萨','米斯蒂娅','因幡帝','射命丸文','梅蒂欣','风见幽香','小野塚小町','四季映姬'].map((name,index)=>unit(name,['pofv'+index],['标准'])),
 th10:[unit('博丽灵梦',['reimu'],['A · 诱导装备','B · 前方集中装备','C · 封印装备']),unit('雾雨魔理沙',['marisa'],['A · 高威力装备','B · 贯通装备','C · 魔法使装备'])]
};
let directoryLocked=true;
function syncDirectoryLock(){parent.postMessage({type:'local-directory-lock',locked:roomViewOpen&&directoryLocked},location.origin);}
let choice={character:0,mode:0,stage:'character',ready:false},localSeat=0;
function resetChoice(){choice={character:0,mode:0,stage:'character',ready:false};}
function focusChoice(){document.querySelector('.preview-room-seat.is-local')?.focus({preventScroll:true});}
function moveChoice(delta){
 if(choice.ready)return;
 const units=loadouts[selected];
 if(choice.stage==='character'){choice.character=(choice.character+delta+units.length)%units.length;choice.mode=0;}
 else if(choice.stage==='mode'){const n=units[choice.character].modes.length;choice.mode=(choice.mode+delta+n)%n;}
 renderRoom();focusChoice();
}
function confirmChoice(){
 if(choice.stage==='character'&&loadouts[selected][choice.character].modes.length>1)choice.stage='mode';
 else choice.stage='done';
 renderRoom();if(choice.stage==='done')$('previewRoomReady').focus({preventScroll:true});else focusChoice();
}
function makePortrait(key){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),img=document.createElementNS(ns,'image');
 const pofv=key.startsWith('pofv');svg.setAttribute('viewBox',pofv?`257 ${20+Number(key.slice(4))*340} 256 320`:portraitCrops[key]);
 svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.setAttribute('aria-hidden','true');
 img.setAttribute('href',pofv?'assets/room-th09-portraits.png':'assets/score-character-sheet.png');img.setAttribute('width',pofv?'2314':'1668');img.setAttribute('height',pofv?'5477':'2312');
 const clip=document.createElementNS(ns,'clipPath'),rect=document.createElementNS(ns,'rect');const bounds=svg.getAttribute('viewBox').split(' ');clip.id='portrait-'+crypto.randomUUID();['x','y','width','height'].forEach((key,i)=>rect.setAttribute(key,bounds[i]));clip.append(rect);img.setAttribute('clip-path','url(#'+clip.id+')');svg.append(clip,img);return svg;
}
function joinRoom(room){
 if(room.running||room.players>=room.capacity)return;
 localSeat=room.players++;directoryLocked=true;activeRoom=room;selected=room.game;resetChoice();
 parent.postMessage({type:'local-lobby-joined',game:room.game},location.origin);
 $('roomDialog').close();render();requestRoomView(true);
}

// Local room authoring surface. Mutations stay in this preview's room list.
let activeRoom=null,roomViewOpen=false,syncTimer=0;
const roomCard=document.createElement('section');roomCard.className='preview-room-card';roomCard.hidden=true;
roomCard.innerHTML=`<header class="preview-room-header"><div class="preview-room-heading"><h1>联机房间</h1><label class="room-difficulty"><span>难度</span><select id="previewRoomDifficulty"><option>Easy</option><option selected>Normal</option><option>Hard</option><option>Lunatic</option><option>Extra</option></select></label><button type="button" class="lobby-button room-cheat" id="previewRoomCheat" aria-pressed="true" title="是否允许触摸（作弊，不限速）移动">允许作弊移动</button><button type="button" class="lobby-button room-directory-lock" id="previewDirectoryLock" aria-pressed="true">锁定游戏目录</button></div><div class="preview-room-connection"><span class="connection-status">Room connected</span><button type="button" class="lobby-button room-privacy" id="previewRoomPrivacy" aria-label="Public：切换为 Private" aria-pressed="false"></button><button type="button" class="lobby-button room-code" id="previewRoomCopy" aria-label="复制房间号"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8V3h13v13h-5M3 8h13v13H3Z"/></svg><span id="previewRoomCode"></span></button></div></header>
<div class="preview-room-content"><div class="preview-room-seats" id="previewRoomSeats"></div><button type="button" class="room-add-player" id="previewRoomAdd" aria-label="增加第三个玩家席位">＋</button></div>
<footer class="lobby-card-footer"><button type="button" class="lobby-button" id="previewRoomBack">返回大厅</button><div class="lobby-actions"><button type="button" class="lobby-button" id="previewRoomReady">准备</button><button type="button" class="lobby-button lobby-primary" disabled>开始游戏</button></div></footer>`;
document.body.append(roomCard);
function renderRoom(){
 if(!activeRoom)return;
 $('previewRoomCode').textContent=activeRoom.code;
 $('previewDirectoryLock').setAttribute('aria-pressed',String(directoryLocked));$('previewDirectoryLock').textContent=directoryLocked?'锁定游戏目录':'解锁游戏目录';
 const privacy=$('previewRoomPrivacy');privacy.setAttribute('aria-pressed',String(!!activeRoom.private));privacy.setAttribute('aria-label',activeRoom.private?'Private：切换为 Public':'Public：切换为 Private');privacy.title=activeRoom.private?'Private':'Public';
 privacy.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="'+(activeRoom.private?'M8 10V6a4 4 0 0 1 8 0v4':'M8 10V6a4 4 0 0 1 8 0')+'"/><path d="M12 14v3"/></svg>';
 $('previewRoomDifficulty').value=activeRoom.difficulty;
 $('previewRoomCheat').setAttribute('aria-pressed',String(!activeRoom.disableCheatMovement));$('previewRoomCheat').textContent=activeRoom.disableCheatMovement?'禁止作弊移动':'允许作弊移动';
 $('previewRoomSeats').replaceChildren();

 const current=loadouts[selected][choice.character];
 for(let i=0;i<activeRoom.capacity;i++){
  const mine=i===localSeat,occupied=i<activeRoom.players,seat=document.createElement('article');seat.className='preview-room-seat'+(mine?' is-local':'');
  const title=document.createElement('h3'),name=document.createElement('p');title.textContent='P'+(i+1);name.textContent=mine?(i===0?'你 · 房主':'你'):occupied?'示例玩家 · 未选择机体':'等待玩家加入';seat.append(title,name);
  if(occupied){
   const avatar=document.createElement('span');avatar.className='room-player-avatar';avatar.textContent=mine?localProfile.initial:'?';avatar.setAttribute('role','img');avatar.setAttribute('aria-label',mine?(localProfile.name||'玩家')+'的头像':'玩家头像未知');avatar.title=mine?(localProfile.name||'未设置昵称'):'未知玩家';seat.append(avatar);
   const device=document.createElement('span');device.className='room-player-device';device.textContent=mine?localProfile.device:'未知';device.setAttribute('aria-label','设备：'+device.textContent);seat.append(device);
  }
  if(mine){
   seat.tabIndex=0;seat.setAttribute('aria-label','选择机体');
   const reselect=document.createElement('button');reselect.type='button';reselect.className='room-touch-reselect';reselect.textContent='重选';reselect.setAttribute('aria-label','重新选择机体');reselect.onclick=()=>{resetChoice();renderRoom();focusChoice();};seat.append(reselect);
   const art=document.createElement('div');art.className='room-character-art';
   const keys=selected==='th08'&&choice.mode>0?[current.art[choice.mode-1]]:current.art;
   keys.forEach(key=>art.append(makePortrait(key)));seat.append(art);
   const details=document.createElement('div');details.className='room-character-details';
   const phase=document.createElement('p');phase.className='room-select-phase';
   const selectingCharacter=choice.stage==='character';
   phase.textContent=choice.stage==='done'?'':selectingCharacter?'选择主人公':selected==='th08'?'选择出击模式':'选择武器';
   const english=document.createElement('span');english.textContent=selectingCharacter?'Choose Girl.':selected==='th08'?'Choose Player.':selected==='th10'?'Choose Weapon.':'Choose Spell Card.';
   if(choice.stage!=='done')phase.append(english);
   const heading=document.createElement('h4');heading.textContent=current.name;
   details.append(phase,heading);
   if(!selectingCharacter){
    const options=document.createElement('div');options.className='room-shot-options';options.setAttribute('role','list');
    current.modes.forEach((text,index)=>{if(choice.stage==='done'&&index!==choice.mode)return;const line=document.createElement('p');line.textContent=text;line.className=index===choice.mode?'selected':'';line.setAttribute('role','listitem');if(index===choice.mode)line.setAttribute('aria-current','true');options.append(line);});details.append(options);
   }
   const hint=document.createElement('p');hint.className='room-choice-hint';hint.textContent=choice.stage==='done'?(choice.ready?'':'Esc 返回选择'):'Enter 决定 · Esc 返回';details.append(hint);seat.append(details);
   // Touch uses the card itself, keeping the original-style selection free of arrow buttons.
   let touchStart=null;
   seat.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&event.isPrimary&&!event.target.closest('button')){touchStart={x:event.clientX,y:event.clientY};seat.setPointerCapture(event.pointerId);}});
   seat.addEventListener('pointerup',event=>{if(!touchStart||event.pointerType!=='touch')return;const dx=event.clientX-touchStart.x,dy=event.clientY-touchStart.y;touchStart=null;if(choice.stage==='done'||choice.ready)return;const delta=Math.abs(dx)>=Math.abs(dy)?dx:dy;if(Math.abs(delta)>35)moveChoice(delta<0?1:-1);else if(Math.abs(dx)<12&&Math.abs(dy)<12)confirmChoice();});
   seat.addEventListener('pointercancel',()=>{touchStart=null;});

  }
  if(occupied){const badge=document.createElement('span');const ready=mine&&choice.ready;badge.className='room-ready-badge'+(ready?' ready':'');badge.textContent=ready?'✓':'×';badge.setAttribute('role','img');badge.setAttribute('aria-label',ready?'已准备':'未准备');seat.append(badge);}
  $('previewRoomSeats').append(seat);
 }
 $('previewRoomSeats').dataset.capacity=String(activeRoom.capacity);
 $('previewRoomAdd').hidden=activeRoom.capacity>=3||localSeat!==0;
 $('previewRoomReady').disabled=choice.stage!=='done';$('previewRoomReady').textContent=choice.ready?'取消准备':'准备';

}
function scheduleRoomSync(){
 clearTimeout(syncTimer);const room=activeRoom,game=selected;
 renderRoom();
 syncTimer=setTimeout(()=>{room.game=game;render();},1200);
}
function showRoomView(open,focus=true){roomViewOpen=open;syncDirectoryLock();document.querySelector('.lobby-main').hidden=open;roomCard.hidden=!open;if(open){renderRoom();if(focus)focusChoice();}else if(focus){$('createButton').focus({preventScroll:true});}}
function requestRoomView(open){if(parent===window)showRoomView(open);else parent.postMessage({type:'local-room-transition',open},location.origin);}
function createRoom(){
 if(roomViewOpen)return;
 localSeat=0;directoryLocked=true;resetChoice();
 activeRoom={game:selected,code:String(6200+rooms.length),capacity:2,players:1,difficulty:'Normal',disableCheatMovement:false,running:false};rooms.unshift(activeRoom);render();
 $('previewRoomReady').textContent='准备';requestRoomView(true);
}
$('previewRoomBack').onclick=()=>requestRoomView(false);
$('previewRoomPrivacy').onclick=()=>{activeRoom.private=!activeRoom.private;renderRoom();render();};
$('previewRoomCopy').onclick=async()=>{try{await navigator.clipboard.writeText(activeRoom.code);$('previewRoomCopy').setAttribute('aria-label','已复制房间号');}catch{$('previewRoomCopy').setAttribute('aria-label','房间号 '+activeRoom.code);}};
$('previewDirectoryLock').onclick=()=>{directoryLocked=!directoryLocked;renderRoom();syncDirectoryLock();};
$('previewRoomCheat').onclick=()=>{activeRoom.disableCheatMovement=!activeRoom.disableCheatMovement;renderRoom();scheduleRoomSync();};
$('previewRoomDifficulty').onchange=()=>{activeRoom.difficulty=$('previewRoomDifficulty').value;scheduleRoomSync();};
$('previewRoomReady').onclick=()=>{if(choice.stage!=='done')return;choice.ready=!choice.ready;renderRoom();$('previewRoomReady').focus({preventScroll:true});};
$('previewRoomAdd').onclick=()=>{if(localSeat!==0||activeRoom.capacity>=3)return;activeRoom.capacity=3;scheduleRoomSync();};

// Keyboard events do not bubble across the iframe boundary.
document.addEventListener('keydown',event=>{
 if(event.key==='Enter'&&event.target.closest('button,a'))return;
 if(roomViewOpen&&event.key==='Escape'&&choice.stage==='done'&&!choice.ready&&event.target.closest('.preview-room-seat,#previewRoomReady')){event.preventDefault();choice.stage=loadouts[selected][choice.character].modes.length>1?'mode':'character';renderRoom();focusChoice();return;}
 if(roomViewOpen&&choice.stage!=='done'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,textarea,select,[contenteditable="true"]')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape'].includes(event.key)){
  event.preventDefault();event.stopPropagation();if(event.repeat)return;
  if(event.key==='Enter')confirmChoice();else if(event.key==='Escape'){choice.stage='character';renderRoom();focusChoice();}else moveChoice(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1);return;
 }
 if(!document.body.classList.contains('desktop-host')||!['ArrowUp','ArrowDown'].includes(event.key)||event.ctrlKey||event.metaKey||event.altKey||document.querySelector('dialog[open]')||event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
 event.preventDefault();if(event.repeat||(roomViewOpen&&directoryLocked))return;
 parent.postMessage({type:'local-lobby-step',direction:event.key==='ArrowDown'?1:-1},location.origin);
});
