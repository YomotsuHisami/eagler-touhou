import {useEffect,useState,useSyncExternalStore} from 'react';
import {gameIdForProduct,PRODUCT_GAMES,scoreStorageFileForGame,type ProductId} from '../../src/contracts/product-catalog.mts';
import {defaultCharacterArt,characterArtForName} from '../../src/contracts/character-art.mts';
import {parseScoreDat,type ScoreReport} from '../../src/launcher/score-dat.mts';
import {readRuntimeSavedScore} from '../services/runtime-save-storage';
import {useBrowserServices} from '../services/browser-services';
import styles from './score.module.css';
const emptySubscribe=()=>()=>{};
export function ScoreOverview({productId}:{productId:ProductId}){
 const services=useBrowserServices();const snapshot=useSyncExternalStore(services?.runtime.subscribe??emptySubscribe,()=>services?.runtime.getSnapshot()??null,()=>null);
 const preferences=useSyncExternalStore(services?.preferences.subscribe??emptySubscribe,()=>services?.preferences.read(productId)??null,()=>null);
 const[report,setReport]=useState<ScoreReport|null>(null),[error,setError]=useState(''),[character,setCharacter]=useState('');
 const game=gameIdForProduct(productId),storage=PRODUCT_GAMES[game].storage;
 const language=snapshot?.productId===productId?snapshot.language:preferences?.language??'ja';
 useEffect(()=>{let current=true;setReport(null);setError('');setCharacter('');
  const file=scoreStorageFileForGame(game,language);
  void readRuntimeSavedScore(storage.saveRoot,file).then(bytes=>{if(!current||!bytes)return;try{setReport(parseScoreDat(game,bytes));}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}).catch(reason=>{if(current)setError(String(reason));});
  return()=>{current=false;};
 },[game,language,snapshot?.phase==='exited',snapshot?.phase==='idle',storage.saveRoot,storage.scoreFile]);
 const portraits=character?characterArtForName(character):defaultCharacterArt(game);
 return <section className={styles.overview} aria-label="游玩统计">
  <div className={styles.portraits} aria-hidden="true">{portraits.map(id=><img key={id} src={`/assets/dairi/${id}.png`} alt="" decoding="async" title="DAIRI / はるか" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>)}</div>
  <div className={styles.summary}><span>HIGHSCORE</span><strong>{report?.highest?.toLocaleString()??'—'}</strong><small>{report?`${report.rankingCount} 条排行记录 · ${report.spells} 张符卡`:'尚无可读取的游玩记录'}</small></div>
  {error&&<p role="status">{error}</p>}
  {report&&<details className={styles.details}><summary>查看存档统计</summary>{report.sections.map(section=><section key={section.title}><h3>{section.title}</h3>{section.note&&<p>{section.note}</p>}<div className={styles.table}><table><thead><tr>{section.columns.map((column,i)=><th key={i}>{column}</th>)}</tr></thead><tbody>{section.rows.map((row,i)=><tr key={i} onPointerEnter={()=>setCharacter(String(row[0]??''))}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></section>)}</details>}
 </section>;
}
