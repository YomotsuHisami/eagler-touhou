import {useEffect,useState,useSyncExternalStore} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router';
import {useBrowserServices} from '../services/browser-services';
import {DEFAULT_MULTIPLAYER_PRODUCT_ID,PRODUCT_GAMES,gameIdForProduct,isMultiplayerProductId,multiplayerConfigForProduct,type MultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {Button,SettingsRow,SettingsGroup} from '../ui';
import styles from './library.module.css';
const emptySubscribe=()=>()=>{};
export default function Lobby(){
 const services=useBrowserServices(),navigate=useNavigate();const[search]=useSearchParams();const[product,setProduct]=useState<MultiplayerProductId>(isMultiplayerProductId(search.get('product')??'')?search.get('product') as MultiplayerProductId:DEFAULT_MULTIPLAYER_PRODUCT_ID);
 const[count,setCount]=useState<2|3>(2),[difficulty,setDifficulty]=useState(1),[code,setCode]=useState(''),[name,setName]=useState('');
 const state=useSyncExternalStore(services?.rooms.subscribe??emptySubscribe,()=>services?.rooms.getSnapshot()??null,()=>null);
 useEffect(()=>{if(services)void services.rooms.boot();},[services]);
 const policy=multiplayerConfigForProduct(product)!;
 useEffect(()=>{setCount(policy.playerCounts[0]);setDifficulty(1);},[product]);
 async function enter(create:boolean){if(!services)return;const okay=create?await services.rooms.create({product,playerCount:count,difficulty,visibility:'public',disableCheatMovement:true}):await services.rooms.join(product,code);const room=services.rooms.getSnapshot().room;if(okay&&room)navigate(`/rooms/${room.code}?product=${room.product}`,{state:{from:'/lobby'}});}
 return <section className={styles.page}><p className={styles.subtitle}>MULTIPLAYER</p><h1 className={styles.title}>联机大厅</h1><p role="status">{state?.connection==='live'?`${state.total} 个房间`:state?.connection??'正在连接'}</p>
 <SettingsGroup title="进入房间">
 {!state?.displayNameLocked&&<SettingsRow label="昵称" htmlFor="display-name"><input id="display-name" value={name} onChange={e=>setName(e.target.value)} maxLength={24}/><Button onClick={()=>services?.rooms.setDisplayName(name)}>确定</Button></SettingsRow>}
 <SettingsRow label="作品" htmlFor="lobby-product"><select id="lobby-product" value={product} onChange={e=>setProduct(e.target.value as MultiplayerProductId)}>{(state?.products??[product]).map(id=><option key={id} value={id}>{PRODUCT_GAMES[gameIdForProduct(id)].title}</option>)}</select></SettingsRow>
 <SettingsRow label="人数" htmlFor="player-count"><select id="player-count" value={count} onChange={e=>setCount(Number(e.target.value) as 2|3)}>{policy.playerCounts.map(n=><option key={n}>{n}</option>)}</select></SettingsRow>
 <SettingsRow label="难度" htmlFor="difficulty"><select id="difficulty" value={difficulty} onChange={e=>setDifficulty(Number(e.target.value))}>{policy.difficulties.map((title,index)=><option key={index} value={index}>{title}</option>)}</select></SettingsRow>
 <div className={styles.actions}><Button variant="primary" disabled={!services||state?.connection!=='live'} onClick={()=>void enter(true)}>创建房间</Button><input aria-label="房间号" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" maxLength={8}/><Button disabled={!services||!code} onClick={()=>void enter(false)}>加入房间</Button></div>
 </SettingsGroup>
 <div className={styles.actions}><Button onClick={()=>services?.rooms.refresh()}>刷新房间</Button><Link to={`/games/${product}`}>个人设置</Link></div>
 <ul>{state?.rooms.map(room=><li key={`${room.product}:${room.code}`}><Link to={`/rooms/${room.code}?product=${room.product}`} state={{from:'/lobby'}}>{PRODUCT_GAMES[gameIdForProduct(room.product)].title} · {room.code} · {room.players}/{room.capacity} · {room.phase==='playing'?'游戏中':'准备中'}</Link></li>)}</ul>
 {state?.error&&<p role="alert">{state.error}</p>}
 </section>;
}
