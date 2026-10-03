import {useEffect,useState} from 'react';
import {Link,useNavigate,useLocation} from 'react-router';
import {isProductId,isMultiplayerProductId} from '../../src/contracts/product-catalog.mts';
import {useUiPreferences} from '../services/ui-preferences';
import {parseSiteNoticeText} from '../../src/launcher/site-notice.mts';
import styles from './library.module.css';
export default function Home(){
 const navigate=useNavigate();const location=useLocation();const ui=useUiPreferences();
 useEffect(()=>{const query=new URLSearchParams(location.search);const game=query.get('game');const room=query.get('mpRoom');if(!game||!isProductId(game)||query.get('view')==='site')return;query.delete('game');query.delete('mpRoom');const target=room&&isMultiplayerProductId(game)&&/^[A-Za-z0-9_-]{1,24}$/.test(room)?`/rooms/${room}?product=${game}`:`/games/${game}${query.size?'?'+query.toString():''}`;void navigate(target,{replace:true});},[location.search,navigate]);
 const [notice,setNotice]=useState('');const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 useEffect(()=>{if(!ui.siteNotices){setNotice('');return;}const controller=new AbortController();void fetch('/NOTICE.txt',{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw Error(`HTTP ${response.status}`);return response.text();}).then(setNotice).catch(reason=>{if(!controller.signal.aborted)setError(String(reason));});return()=>controller.abort();},[revision,ui.siteNotices]);
 return <section className={styles.page}><p className={styles.subtitle}>EAGLER TOUHOU</p><h1 className={styles.title}>网站公告</h1><div className={styles.section}>{parseSiteNoticeText(notice).map((line,index)=><p key={index}>{line.map((part,i)=>part.type==='text'?part.text:<a key={i} href={part.resolvedHref} target={part.external?'_blank':undefined} rel={part.external?'noreferrer':undefined}>{part.label}</a>)}</p>)}{error&&<p role="status">公告暂不可用：{error}</p>}</div><div className={styles.actions}><button onClick={()=>{setError('');setRevision(value=>value+1);}}>刷新公告</button><Link to="/lobby">多人游戏 →</Link></div></section>;
}
