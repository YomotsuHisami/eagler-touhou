import {useEffect,useState,useSyncExternalStore} from 'react';
import {Link,useNavigate,useParams,useSearchParams} from 'react-router';
import {useBrowserServices} from '../services/browser-services';
import {DEFAULT_MULTIPLAYER_PRODUCT_ID,isMultiplayerProductId,multiplayerConfigForProduct,type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {GameSettings} from '../features/GameSettings';
import {Button,SettingsRow,SettingsGroup} from '../ui';
import styles from './library.module.css';
const emptySubscribe=()=>()=>{};
export default function Room(){
 const services=useBrowserServices(),navigate=useNavigate();const{roomId=''}=useParams();const[search]=useSearchParams();const[error,setError]=useState('');
 const product=search.get('product')??DEFAULT_MULTIPLAYER_PRODUCT_ID;
 const state=useSyncExternalStore(services?.rooms.subscribe??emptySubscribe,()=>services?.rooms.getSnapshot()??null,()=>null);
 useEffect(()=>{if(!services||!isMultiplayerProductId(product))return;const current=services.rooms.getSnapshot().room;if(current?.code===roomId&&current.product===product)return;void services.rooms.join(product,roomId);},[services,product,roomId]);
 if(!isMultiplayerProductId(product))throw new Response('Unknown multiplayer product',{status:404});const policy=multiplayerConfigForProduct(product)!;
 const room=state?.room?.code===roomId&&state.room.product===product?state.room:null;
 async function prepare(){if(!services||!room)return;const id=room.product,code=room.code,generation=room.generation;setError('');services.rooms.reportResources({status:'preparing',stage:'runtime',percent:null},id,code,generation);try{const prefs=services.preferences.read(id);await services.runtime.prepare({productId:id,language:prefs.language,music:prefs.musicPreference,options:prefs.options});services.rooms.reportResources({status:'ready',stage:'runtime',percent:100},id,code,generation);}catch(reason){services.rooms.reportResources({status:'failed',stage:'runtime',percent:null},id,code,generation);setError(reason instanceof Error?reason.message:String(reason));}}
 return <section><p className={styles.subtitle}>MULTIPLAYER ROOM</p><h1 className={styles.title}>房间 {roomId}</h1><p role="status">{room?.connection??'正在连接'}</p>
 <ul>{room?.seats.slice(0,room.playerCount).map((seat,index)=><li key={index}>P{index+1} · {seat?.name||'空位'} · {seat?.ready?'已准备':seat?.offline?'离线':'未准备'} {!seat&&<Button onClick={()=>services?.rooms.takeSeat(index)}>入座</Button>}{seat&&state?.permissions.canKick&&index>0&&<Button onClick={()=>{if(window.confirm(`将 ${seat.name||'该玩家'} 移出房间？`))services?.rooms.kick(seat.clientId);}}>移出</Button>}</li>)}</ul>
 <SettingsGroup title="房间设置"><SettingsRow label="机体" htmlFor="room-loadout"><select id="room-loadout" value={state?.preferredLoadout??0} onChange={e=>services?.rooms.setLoadout(Number(e.target.value))}>{policy.loadouts.map((loadout,index)=><option key={index} value={index}>{loadout.glyph} · {index+1}</option>)}</select></SettingsRow>
 <SettingsRow label="输入延迟" htmlFor="room-delay"><select id="room-delay" disabled={!state?.permissions.canSettings} value={state?.inputDelay??'auto'} onChange={e=>services?.rooms.setInputDelay(e.target.value==='auto'?'auto':Number(e.target.value))}><option value="auto">自动</option>{Array.from({length:9},(_,n)=><option key={n} value={n}>{n} 帧</option>)}</select></SettingsRow></SettingsGroup>
 <div className={styles.actions}><Button onClick={()=>void prepare()} disabled={!room}>检查游戏资源</Button><Button onClick={()=>services?.rooms.setReady(!(room?.localSeat!=null&&room.seats[room.localSeat]?.ready))} disabled={!state?.permissions.canReady}>准备 / 取消</Button><Button variant="primary" onClick={()=>services?.rooms.requestStart()} disabled={!state?.permissions.canStart}>开始游戏</Button><Button onClick={()=>services?.rooms.spectate()}>观战</Button><Button onClick={()=>{services?.rooms.leave();navigate('/lobby');}}>离开房间</Button></div>
 {error&&<p role="alert">{error}</p>}{state?.error&&<p role="alert">{state.error}</p>}
 <details><summary>个人设置</summary><GameSettings productId={product as MultiplayerProductId}/></details><Link to={`/games/${product}/resources`} state={{from:`/rooms/${roomId}?product=${product}`}}>管理资源</Link>
 </section>;
}
