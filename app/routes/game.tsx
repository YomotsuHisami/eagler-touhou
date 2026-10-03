import {Link,useOutlet,useLocation,useParams} from 'react-router';
import {useState,useSyncExternalStore} from 'react';
import {PRODUCT_GAMES,gameIdForProduct,isProductId,isMultiplayerProductId,multiplayerProductIdForGame,productEnabledForBuild} from '../../src/contracts/product-catalog.mts';
import {useBrowserServices} from '../services/browser-services';
import {ScoreOverview} from '../features/ScoreOverview';
import {GameSettings} from '../features/GameSettings';
import {Button,Dialog} from '../ui';
import {useCloseIntent} from '../navigation/close-intent';
import styles from './library.module.css';
import gameStyles from './game.module.css';
const emptySubscribe=()=>()=>{};
export default function Game(){
 const {productId=''}=useParams();const location=useLocation();const outlet=useOutlet();const closePanel=useCloseIntent(`/games/${productId}`, { dismissNestedOnEscape: true });const services=useBrowserServices();const [error,setError]=useState('');
 const snapshot=useSyncExternalStore(services?.runtime.subscribe??emptySubscribe,()=>services?.runtime.getSnapshot()??null,()=>null);
 if(!isProductId(productId))throw new Response('Unknown product',{status:404});
 if(!productEnabledForBuild(productId,snapshot?.metadata.hostManifest?.shared.testBuild===true)){if(!snapshot?.metadata.hostManifest&&!snapshot?.metadata.errors.length)return <p role="status">正在核对作品发布范围…</p>;throw new Response('Product not available in this build',{status:404});}
 const gameId=gameIdForProduct(productId),game=PRODUCT_GAMES[gameId],mp=multiplayerProductIdForGame(gameId);
 async function launch(){if(!services||!isProductId(productId))return;setError('');try{const prefs=services.preferences.read(productId);await services.runtime.launch({productId,language:prefs.language,music:prefs.musicPreference,options:prefs.options});}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}
 return <section className={gameStyles.panel} aria-label={game.title}>
  <h1 className={styles.visuallyHidden}>{game.title}</h1>
  <div className={gameStyles.toolbar}><Link to="replays" state={{from:location.pathname}}>存档 / 录像</Link><span className={styles.visuallyHidden}>{isMultiplayerProductId(productId)?'MULTIPLAYER':'SINGLEPLAYER'}</span></div>
  <ScoreOverview productId={productId}/>
  <details className={gameStyles.settings} data-testid="game-settings-disclosure"><summary>游戏设置</summary><GameSettings productId={productId}/></details>
  <div className={gameStyles.launch}>{isMultiplayerProductId(productId)?<Button asChild variant="primary"><Link to={`/lobby?product=${productId}`}>联机大厅</Link></Button>:<Button variant="primary" disabled={!services||['preparing','loading','configuring','launching','saving'].includes(snapshot?.phase??'')} onClick={()=>void launch()}>开始游戏</Button>}
   {mp&&!isMultiplayerProductId(productId)&&<Button asChild variant="danger"><Link to={`/lobby?product=${mp}`}>多人游戏</Link></Button>}
   <Button asChild><Link to="resources" state={{from:location.pathname}}>资源管理</Link></Button></div>
  <div className={gameStyles.help}><Link to="help" state={{from:location.pathname}}>操作帮助</Link><Link to={`/games/${isMultiplayerProductId(productId)?gameId:mp||gameId}`} replace>{isMultiplayerProductId(productId)?'单机':'联机设置'}</Link></div>
  {snapshot?.progress&&<p role="status">{snapshot.progress.label||snapshot.progress.mode} · {snapshot.progress.loaded}/{snapshot.progress.total}</p>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  <Dialog open={outlet!==null} onOpenChange={open=>{if(!open)void closePanel();}} title={location.pathname.endsWith('/resources')?'资源管理':location.pathname.endsWith('/replays')?'存档 / 录像':'操作帮助'}>{outlet}</Dialog>
 </section>;
}
