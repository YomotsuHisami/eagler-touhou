import {useEffect,useState,useSyncExternalStore} from 'react';
import {gameIdForProduct,PRODUCT_GAMES,scoreStorageFileForGame,type ProductId} from '../../src/contracts/product-catalog.mts';
import {parseScoreDat,type ScoreReport} from '../../src/launcher/score-dat.mts';
import {favoriteLoadout,orderedScoreSections} from '../../src/launcher/score-panel.mts';
import {activeScoreSave} from '../../src/launcher/score-saves.mts';
import {readRuntimeSavedScore} from '../services/runtime-save-storage';
import {useBrowserServices} from '../services/browser-services';
import styles from './score.module.css';
const emptySubscribe=()=>()=>{};
export function ScoreOverview({productId}:{productId:ProductId}){
 const services=useBrowserServices();const snapshot=useSyncExternalStore(services?.runtime.subscribe??emptySubscribe,()=>services?.runtime.getSnapshot()??null,()=>null);
 const preferences=useSyncExternalStore(services?.preferences.subscribe??emptySubscribe,()=>services?.preferences.read(productId)??null,()=>null);
 const scoreRevision=useSyncExternalStore(services?.scoreSlots.subscribe??emptySubscribe,()=>services?.scoreSlots.revision(productId)??0,()=>0);
 const[report,setReport]=useState<ScoreReport|null>(null),[error,setError]=useState('');
 const game=gameIdForProduct(productId),storage=PRODUCT_GAMES[game].storage;
 const language=snapshot?.productId===productId?snapshot.language:preferences?.language??'ja';
 useEffect(()=>{let current=true;setReport(null);setError('');
  const file=scoreStorageFileForGame(game,language);
  void activeScoreSave(productId).then(async active=>active?.state.pending?active.save.bytes:await readRuntimeSavedScore(storage.saveRoot,file)).then(bytes=>{if(!current||!bytes)return;try{setReport(parseScoreDat(game,bytes));}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}).catch(reason=>{if(current)setError(String(reason));});
  return()=>{current=false;};
 },[scoreRevision,game,productId,language,snapshot?.phase==='exited',snapshot?.phase==='idle',storage.saveRoot,storage.scoreFile]);
 const favorite=report?favoriteLoadout(report):null;
 return <section className={styles.overview} aria-label="游玩统计">
  {!!favorite?.portraits.length&&<div className={styles.portraits} aria-hidden="true">{favorite.portraits.map(id=><img key={id} src={`/assets/dairi/${id}.png`} alt="" title="DAIRI / はるか" decoding="async" onError={event=>{event.currentTarget.style.visibility='hidden';}}/>)}</div>}
  {!report&&!error&&<div className={styles.empty}><p>游戏保存后，成绩与进度将在这里显示</p></div>}
  {error&&<p role="status">{error}</p>}
  {report&&<><div className={styles.metrics}><div><span>最高分</span><strong>{report.highest?.toLocaleString()??'暂无记录'}</strong></div><div><span>排行槽位</span><strong>{report.rankingCount}</strong></div><div><span>最常用机体</span><strong>{favorite?`${favorite.name} · ${favorite.count.toLocaleString()} 次`:'暂无次数记录'}</strong></div></div>{report.notes.map((note,index)=><p key={index}>{note}</p>)}{orderedScoreSections(report).map(section=><details className={styles.details} key={section.title}><summary>{section.title} · {section.rows.length}</summary>{section.note&&<p>{section.note}</p>}<div className={styles.table} tabIndex={0} role="region" aria-label={section.title}><table><thead><tr>{section.columns.map((column,i)=><th key={i} scope="col">{column}</th>)}</tr></thead><tbody>{section.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{typeof cell==='number'?cell.toLocaleString():cell}</td>)}</tr>)}</tbody></table></div></details>)}</>}
 </section>;
}
