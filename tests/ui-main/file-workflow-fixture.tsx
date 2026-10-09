/** Real App/Router/services, tiny synthetic Package and protocol peer only.
 * No retail DATA, native engine, live relay or real persistence acceptance. */
import {createRoot} from 'react-dom/client';
import {createBrowserRouter} from 'react-router';
import {RouterProvider} from 'react-router/dom';
import App from '../../app/root';
import Library from '../../app/routes/library';
import GameReplays from '../../app/routes/game-replays';
import GameSaves from '../../app/routes/game-saves';
import GameResources from '../../app/routes/game-resources';
import Game from '../../app/routes/game';
import {installPackageFromAcquisition} from '../../package/package-installer.mjs';
import {sha256Hex} from '../../src/launcher/sha256.mts';
import type {PackageDescriptor} from '../../src/contracts/package-read-models.mts';
import {FIRST_USE_NOTICE_SEEN_STORAGE_KEY} from '../../src/launcher/first-use-notice.mts';
import {SITE_NOTICE_STORAGE_KEY} from '../../src/launcher/site-notice.mts';
import {PRODUCT_GAMES} from '../../src/contracts/product-catalog.mts';
import {DEFAULT_GAME_OPTIONS, persistStoredGamePreferences} from '../../src/launcher/game-preferences.mts';
import {openPackageStore, readCurrentPackageGeneration, PACKAGE_OBJECTS} from '../../package/package-store.mjs';
localStorage.setItem(FIRST_USE_NOTICE_SEEN_STORAGE_KEY,'1');localStorage.setItem(SITE_NOTICE_STORAGE_KEY,'0');
persistStoredGamePreferences({storage:localStorage,preferenceId:'th06',language:'ja',preferences:{options:{...DEFAULT_GAME_OPTIONS,touchEnabled:new URLSearchParams(location.search).get('touch')==='1',
  touchMovementMode:new URLSearchParams(location.search).get('movement')==='unlimited'?'touch-unlimited':DEFAULT_GAME_OPTIONS.touchMovementMode},music:'none',musicPreference:'none',musicPreferenceExplicit:true}});

const bytes = Uint8Array.of(1,2,3), hash = await sha256Hex(bytes);
const payloads=[bytes,Uint8Array.of(4,5,6),Uint8Array.of(7,8,9)], hashes=await Promise.all(payloads.map(value=>sha256Hex(value)));
const dataTarget = PRODUCT_GAMES.th06.package.dataTarget;
const files = Object.fromEntries(['game-data','shared-msgothic','shared-unifont'].map((id,index) => [id, {
  revision: 'synthetic-file-1', source: [`games/th06${dataTarget}`,'shared/msgothic.ttc','shared/unifont.otf'][index],
  target: [dataTarget,'/msgothic.ttc','/unifont.otf'][index], bytes: bytes.length, sha256: hashes[index],
}]));
const descriptor: PackageDescriptor = {schema:'eagler-touhou/package/1',game:'th06',revision:'synthetic-file-1',files,
  runtimeRequirement:{protocol:'eagler-touhou/1',target:'th06',dataFile:'game-data',dataLayout:`sha256-${hash}`},
  base:{files:Object.keys(files)},components:{}};
await installPackageFromAcquisition({descriptor,source:'local',desiredFileIds:()=>Object.keys(files),acquire:async id=>payloads[Object.keys(files).indexOf(id)].slice().buffer});
const host = {schema:'eagler-touhou/host-manifest/1',protocol:'eagler-touhou/1',profile:'web-development',
  shared:{resourceMode:'hosted',testBuild:true,vanillaFont:'shared/msgothic.ttc',unicodeFont:'shared/unifont.otf',netplayRelay:'wss://synthetic.invalid/netplay'},
  games:{th06:{runtime:'__ui_tests__/th06.html',multiplayerRuntime:'__ui_tests__/th06.html',
    gameData:{path:dataTarget.slice(1),source:`games/th06${dataTarget}`,bytes:3,sha256:hash,version:`sha256-${hash}`,layout:`sha256-${hash}`},
    music:{midi:{files:[]}},features:{thprac:true,focusHitbox:true},languageOptions:[{id:'ja',pack:null}],languages:[]}}};
const originalFetch = window.fetch.bind(window);
let holdMetadata=false;const heldMetadata:Array<()=>void>=[];
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
  if (url.pathname.endsWith('/host-manifest.json')) {if(holdMetadata)await new Promise<void>(resolve=>heldMetadata.push(resolve));return new Response(JSON.stringify(host),{headers:{'content-type':'application/json'}});}
  if (url.pathname.endsWith('/release-catalog.json')) return new Response(JSON.stringify({schema:'eagler-touhou/release-catalog/1',games:{th06:{revision:descriptor.revision,descriptor:'th06.package.json'}}}),{headers:{'content-type':'application/json'}});
  if (url.pathname.endsWith('/th06.package.json')) return new Response(JSON.stringify(descriptor),{headers:{'content-type':'application/json'}});
  if (url.pathname.endsWith('/ui-publication.json')) return new Response(null,{status:404});
  return originalFetch(input,init);
}) as typeof fetch;
const sockets: Array<{url:string;closed:boolean}> = [];
const lobbyPeers:SyntheticSocket[]=[];
class SyntheticSocket extends EventTarget {
  static OPEN=1;static CONNECTING=0;static CLOSING=2;static CLOSED=3;readyState=0;
  readonly url:string;private row:{url:string;closed:boolean};private room:Record<string,unknown> | null=null;
  constructor(value:string | URL) {
    super();this.url=String(value);this.row={url:this.url,closed:false};sockets.push(this.row);
    const parsed=new URL(this.url),client=parsed.searchParams.get('lobby');
    if(client) {lobbyPeers.push(this);this.room={playerCount:2,difficulty:1,visibility:'public',phase:'lobby',startSerial:0,inputDelay:0,settingsVersion:1,
      disableCheatMovement:false,challengeMode:false,seats:[{clientId:client,name:'Host',loadout:0,ready:false},{clientId:'synthetic_guest_123',name:'Guest',loadout:1,ready:false}],spectators:[]};
    }
    queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));if(this.room)this.emitState();});
  }
  private emitState() {this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'state',room:this.room,roomDirectory:{version:1,controlModes:true}})}));}
  send(value:string) {if(this.readyState!==1)throw Error('Synthetic socket closed');const message=JSON.parse(value);
    if(message.type==='set-ready'&&this.room){const seats=this.room.seats as Array<Record<string,unknown>>;seats[0].ready=message.ready;this.emitState();}}
  close(code=1000,reason='') {this.readyState=3;this.row.closed=true;this.dispatchEvent(new CloseEvent('close',{code,reason}));}
  startForTest(restricted=false) {if(!this.room)return;this.room.disableCheatMovement=restricted;this.room.phase='starting';this.room.startSerial=1;for(const seat of this.room.seats as Array<Record<string,unknown>>)seat.ready=true;
    this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'start',serial:1,room:this.room})}));}
  returnForTest() {if(!this.room)return;this.room.phase='lobby';for(const seat of this.room.seats as Array<Record<string,unknown>>)seat.ready=false;this.emitState();}
}
Object.defineProperty(window,'WebSocket',{configurable:true,value:SyntheticSocket});
const persisted = new Map<string, Map<string,number[]>>();
const events:string[]=[];
let rejectSync=false;
let holdConfigure=false;const heldConfigure:Array<()=>void>=[];
function nativeFiles(variant:string) {let stored=persisted.get(variant);if(!stored){stored=new Map([['score.dat',[4,5]],['replay/th6_01.rpy',[7,8]]]);persisted.set(variant,stored);}return stored;}
const initial=new URLSearchParams(location.search).get('initial') ?? '/play/th06?uiLocale=en&extra=a%2Bb#kept';
const router=createBrowserRouter([{element:<App/>,children:[{element:<Library/>,children:[{path:'/',element:null},
  {path:'/play/:productId',element:<Game/>,children:[{index:true,element:null},{path:'replays',element:<GameReplays/>},{path:'saves',element:<GameSaves/>},{path:'resources',element:<GameResources/>}]}]},
  {path:'/lobby',element:<p>Synthetic lobby destination</p>}]}]);
const fixture={nativeFiles,events,
  holdConfigure(){holdConfigure=true;},
  waitConfigure(){return holdConfigure?new Promise<void>(resolve=>heldConfigure.push(resolve)):Promise.resolve();},
  releaseConfigure(){holdConfigure=false;for(const release of heldConfigure.splice(0))release();},
  failNextSync(){rejectSync=true;},consumeSyncFailure(){const failed=rejectSync;rejectSync=false;return failed;},
  startRoom(restricted=false){for(const peer of lobbyPeers)if(peer.readyState===1)peer.startForTest(restricted);},
  nativeExited(){for(const peer of lobbyPeers)if(peer.readyState===1)peer.returnForTest();},
  exitGame(){document.querySelector('iframe')?.contentWindow?.postMessage({syntheticAction:'exit'},location.origin);},
  connection(mode:'connected'|'recovering'|'ended'){const target=document.querySelector('iframe')?.contentWindow as unknown as Record<string,unknown>;const peer=target?.__th06PeerTransport as {disconnected:boolean;recovering:boolean}|undefined;if(!peer)throw Error('Expected synthetic gameplay peer');peer.recovering=mode==='recovering';peer.disconnected=mode==='ended';},
  holdMetadata(){holdMetadata=true;},releaseMetadata(){holdMetadata=false;for(const release of heldMetadata.splice(0))release();},
  packageFile:()=>({descriptor,entries:Object.fromEntries(Object.entries(files).map(([,file],index)=>[file.source,[...payloads[index]]]))}),
  async evictData() {const current=await readCurrentPackageGeneration('th06'),id=current.generation?.files['game-data']?.objectId;if(!id)throw Error('Expected synthetic DATA object');const db=await openPackageStore();
    try {await new Promise<void>((resolve,reject)=>{const transaction=db.transaction(PACKAGE_OBJECTS,'readwrite');transaction.objectStore(PACKAGE_OBJECTS).delete(id);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);});}finally{db.close();}},
  missingSave(variant='normal'){nativeFiles(variant).delete('score.dat');},
  missingReplay(variant='normal'){const stored=nativeFiles(variant);for(const key of stored.keys())if(key.startsWith('replay/'))stored.delete(key);},
  navigate:(to:string)=>router.navigate(to),
  inspect:()=>({events:[...events],sockets:sockets.filter(row=>new URL(row.url).searchParams.has('lobby')).map(row=>({...row})),
    files:Object.fromEntries([...persisted].map(([variant,stored])=>[variant,Object.fromEntries(stored)])),iframes:document.querySelectorAll('iframe').length,heldMetadata:heldMetadata.length,heldConfigure:heldConfigure.length})};
declare global {interface Window {__fileWorkflow:typeof fixture}}
window.__fileWorkflow=fixture;
await router.navigate(initial,{replace:true});createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>);
