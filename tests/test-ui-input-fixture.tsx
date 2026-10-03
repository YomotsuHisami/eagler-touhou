// Protocol fixture for the real React RuntimeHost browser lane. No game data.
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Routes, Route, useNavigate, useLocation} from 'react-router';
import {RuntimeHost} from '../app/runtime/runtime-host';
import {Dialog} from '../app/ui/Dialog';
import {DEFAULT_GAME_OPTIONS} from '../src/launcher/game-preferences.mts';
const fixture = window as any;
fixture.messages=[]; fixture.bindCount=0; fixture.closeCalls=[];
let snapshot:any={phase:'running',intent:'launch',productId:'th09',game:'th09',epoch:1,ready:true,launched:true,firstFrame:true,
inputOptions:{...DEFAULT_GAME_OPTIONS,touchEnabled:true},spectator:false,error:null,saveError:null};
const listeners=new Set<()=>void>(); fixture.fixtureSnapshot=()=>snapshot;
fixture.changeSession=(patch:any)=>{snapshot={...snapshot,...patch};listeners.forEach(fn=>fn());};
const target={postMessage:(message:any)=>fixture.messages.push(message)};
fixture.fixtureServices={runtime:{getSnapshot:()=>snapshot,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},
getInputContext:()=>({target,targetOrigin:location.origin,protocol:'eagler-touhou/1',game:snapshot.game,epoch:snapshot.epoch,ready:snapshot.ready,launched:snapshot.launched,spectator:snapshot.spectator}),
bindFrame:(frame:HTMLIFrameElement)=>{fixture.bindCount++;fixture.gameFrame=frame;},
close:async(options:any)=>{fixture.closeCalls.push(options);if(!options?.discardUnsaved)throw Error('Fixture save failed');fixture.changeSession({phase:'idle',launched:false,ready:false,epoch:null});}
}};
function Help(){const navigate=useNavigate();return <Dialog open title="操作帮助" onOpenChange={open=>{if(!open)void navigate(-1);}}><p>运行中的帮助</p><button onClick={()=>void navigate(-1)}>返回游戏</button></Dialog>;}
function Location(){const value=useLocation();return <output id="route">{value.pathname}</output>;}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/games/th09']}><Location/><Routes><Route path="/games/:productId" element={<main>游戏设置</main>}/><Route path="/games/:productId/help" element={<Help/>}/></Routes><RuntimeHost/></MemoryRouter>);
