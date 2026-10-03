import {DEFAULT_PRODUCT_ID} from '../../src/contracts/product-catalog.mts';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {createPreferenceStore,type PreferenceStore} from './preferences';
import {loadMidiSynth} from './midi.client';
import {createRoomService} from './room.client';
import {createPackageTaskService} from './package-tasks.client';
import type {createRuntimeService} from './runtime.client';
export interface BrowserServices {runtime:ReturnType<typeof createRuntimeService>; preferences:PreferenceStore; packageTasks:ReturnType<typeof createPackageTaskService>; rooms:ReturnType<typeof createRoomService>}
const Context=createContext<BrowserServices|null>(null);
export function BrowserServicesProvider({children}:{children:ReactNode}) {
  const [services,setServices]=useState<BrowserServices|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false; let owned:BrowserServices|null=null;
    void import('./runtime.client').then(({createRuntimeService})=>{
      if(cancelled)return;
      let storage:Storage|null=null;try {storage=localStorage;}catch{}
      const baseUrl=new URL('/',location.href).href;
      const preferences=createPreferenceStore(storage);
      const runtime=createRuntimeService({baseUrl,loadMidiSynth});
      const rooms=createRoomService({baseUrl,onLaunch:async handoff=>{
        const prefs=preferences.read(handoff.product);
        await runtime.launch({productId:handoff.product,language:prefs.language,music:prefs.musicPreference,options:prefs.options,configureOptions:handoff.options});
      },getMovement:()=>{
        const product=runtime.getSnapshot().productId??DEFAULT_PRODUCT_ID;const prefs=preferences.read(product);
        return{movementMode:prefs.options.touchMovementMode,touchEnabled:prefs.options.touchEnabled,mobileDevice:matchMedia('(pointer:coarse)').matches};
      }});
      owned={runtime,preferences,rooms,packageTasks:createPackageTaskService({baseUrl})};
      setServices(owned);
    }).catch(reason=>setError(reason instanceof Error?reason.message:String(reason)));
    return ()=>{cancelled=true; owned?.runtime.dispose(); owned?.packageTasks.dispose(); owned?.rooms.dispose();};
  },[]);
  useEffect(()=>{
    if(!services)return;
    const changed=()=>services.preferences.invalidate(); window.addEventListener('storage',changed);
    const unsubscribe=services.preferences.subscribe(()=>services.rooms.syncMovement());
    return ()=>{window.removeEventListener('storage',changed);unsubscribe();};
  },[services]);
  return <Context.Provider value={services}>{error?<p role="alert">启动失败：{error}</p>:children}</Context.Provider>;
}
export function useBrowserServices(){return useContext(Context);}
