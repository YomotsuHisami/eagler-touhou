import {useEffect,useState} from 'react';
import {appliedAppShellUpdateAt,formatRelativeUpdateAge,nextRelativeUpdateRefresh} from '../../src/launcher/relative-update-time.mts';
import {useUiText} from '../services/ui-preferences';
/** Read-only display. It never installs a worker or applies an update. */
export function UpdateAge(){
 const t=useUiText();const [at,setAt]=useState<number|null>(null);const[now,setNow]=useState(0);
 useEffect(()=>{let active=true;const abort=new AbortController();
  void fetch('/__app-shell-update-status__',{cache:'no-store',signal:abort.signal}).then(response=>response.ok?response.json():null).then(value=>{if(active)setAt(appliedAppShellUpdateAt(value));}).catch(()=>{});
  return()=>{active=false;abort.abort();};
 },[]);
 useEffect(()=>{if(at===null)return;let timer:ReturnType<typeof setTimeout>;const tick=()=>{const now=Date.now();setNow(now);timer=setTimeout(tick,nextRelativeUpdateRefresh(now-at));};tick();return()=>clearTimeout(timer);},[at]);
 return <time dateTime={at===null?undefined:new Date(at).toISOString()}>{at===null?t('brand.neverUpdated'):t('brand.updatedAgo',{age:formatRelativeUpdateAge(now-at)})}</time>;
}
