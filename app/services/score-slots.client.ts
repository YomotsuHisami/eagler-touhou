import {listScoreSaves,activeScoreSave,addScoreSave,chooseScoreSave} from '../../src/launcher/score-saves.mts';
/** Notifications only; the existing score-slot IndexedDB module remains the writer. */
const defaults={list:listScoreSaves,active:activeScoreSave,add:addScoreSave,select:chooseScoreSave};
export function createScoreSlotService(dependencies:typeof defaults=defaults){
 const versions=new Map<string,number>();const listeners=new Set<()=>void>();
 const changed=(product:string)=>{versions.set(product,(versions.get(product)??0)+1);listeners.forEach(listener=>listener());};
 return{
  revision:(product:string)=>versions.get(product)??0,
  subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
  list:dependencies.list,active:dependencies.active,
  async add(product:string,game:string,name:string,bytes:Uint8Array){const result=await dependencies.add(product,game,name,bytes);changed(product);return result;},
  async select(product:string,id:string|null){await dependencies.select(product,id);changed(product);},
 };
}
