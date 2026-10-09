import {useEffect,useRef,useState} from 'react';
import {useRuntimeService,useRuntimeSnapshot} from './RuntimeHost';
import {useLocale} from '../components/LocaleProvider';
import {readMultiplayerConnection} from '../services/multiplayer-gameplay-path.client';
import {describeNetplayConnection,type NetplayConnectionView,type NetplayConnectionPeerState} from '../../src/launcher/runtime-diagnostics-model.mts';
export function useMultiplayerConnection() {
  const service=useRuntimeService(),runtime=useRuntimeSnapshot(),{locale}=useLocale();
  const identity=useRef<{epoch:number|null;peer:NetplayConnectionPeerState}|null>(null),connectedOnce=useRef(false);
  const [state,setState]=useState<{view:NetplayConnectionView;healthy:boolean;spectator:boolean}|null>(null);
  useEffect(()=>{
    if(!service||!runtime?.launched){identity.current=null;connectedOnce.current=false;setState(null);return;}
    const sample=()=>{
      const native=readMultiplayerConnection(service);
      if(!native){setState(null);return;}
      if(identity.current?.epoch!==native.epoch||identity.current.peer!==native.peerState){identity.current={epoch:native.epoch,peer:native.peerState};connectedOnce.current=false;}
      const view=describeNetplayConnection({...native,english:locale==='en',connectedOnce:connectedOnce.current,webSocketOpenState:1});connectedOnce.current=view.connectedOnce;
      const next={view,healthy:!native.failed&&!native.spectator&&!native.peerState.disconnected&&!native.peerState.isRecovering?.(),spectator:native.spectator};
      setState(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    };
    sample();const timer=window.setInterval(sample,250);return()=>window.clearInterval(timer);
  },[service,runtime?.epoch,runtime?.launched,locale]);
  return state;
}
