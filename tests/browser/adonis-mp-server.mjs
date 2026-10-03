import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {spawn} from 'node:child_process';
const workspace=resolve(process.env.EAGLER_WORKSPACE||'D:/workspace/eagler');
const topics=resolve(workspace,'worktrees/adonis'),port=Number(process.env.PORT||18380),relayPort=port+1;
const host=`<!doctype html><meta charset="utf-8"><div id="player"></div><script>
const game=location.pathname.split('/').pop(),protocol='eagler-touhou/1',events=[],pending=new Map();let iframe,serial=0,replayApp=0,replayCallbacks=0,replayLoop=false;
window.__eaglerPrepareManagedRuntimeDataV1=async()=>({buffer:await(await fetch('/data/'+game)).arrayBuffer()});
window.addEventListener('message',e=>{const m=e.data;if(e.origin!==location.origin||e.source!==iframe?.contentWindow||m?.protocol!==protocol)return;
 if(m.event)events.push(m);if(m.request&&pending.has(m.request)){const p=pending.get(m.request);pending.delete(m.request);clearTimeout(p.timer);m.ok?p.resolve(m):p.reject(Error(m.error));}});
window.host={events,open(){iframe=document.createElement('iframe');iframe.style='width:640px;height:480px;border:0';
 iframe.src='/runtime/'+game+'/'+(game==='th08'?'th08.html':'th10.html')+'?hosted=1&managedData=1&gameGeneration=adonis-local&runtimeEpoch=1&runtimeVariant=multiplayer&manual=1';document.querySelector('#player').append(iframe);},
 ready(){return events.some(e=>e.event==='ready');},
 request(command,fields={}){return new Promise((resolve,reject)=>{const request='t'+(++serial),timer=setTimeout(()=>reject(Error('Host request timeout '+command)),120000);pending.set(request,{resolve,reject,timer});iframe.contentWindow.postMessage({protocol,game,epoch:1,request,command,...fields},location.origin);});},
 runtime(){return iframe.contentWindow['__'+game+'Runtime'];},
 snapshot(){const r=this.runtime();if(!r?.app)return {app:0};const {core}=r,app=replayApp||r.app;
  const words=(name,n)=>{const pointer=core[name](app);return Array.from(new Uint32Array(core.memory.buffer,pointer,n));};
  const net=words('multiplayer_netplay_status',game==='th08'?15:11),calibration=words('multiplayer_calibration_status',32);
  return {net,calibration,ready:net[game==='th08'?2:1],next:net[game==='th08'?3:2],last:net[game==='th08'?4:3],
   replay:words('multiplayer_replay_status',game==='th08'?12:13),
   driver:game==='th08'?words('multiplayer_driver_status',17):words('multiplayer_lifecycle_status',12),
   native:words('multiplayer_status',44),
   rollback:game==='th08'?words('multiplayer_driver_status',16)[3]:words('multiplayer_lifecycle_status',12)[8],
   rollbackStorage:game==='th10'?(()=>{const p=core.multiplayer_rollback_storage(app);return Array.from(new Float64Array(core.memory.buffer,p,10));})():null,
   hash:words(game==='th08'?'multiplayer_canonical_state':'multiplayer_canonical_hashes',game==='th08'?13:44),
   portable:game==='th10'?words('multiplayer_portable_hashes',12):null,
   title:game==='th10'&&core.application_title(app)?Array.from(new Int32Array(core.memory.buffer,core.application_title(app),12)):null,
   titlePreview:game==='th10'&&core.application_title(app)?Array.from(new Uint32Array(core.memory.buffer,core.application_title(app)+0x59e4,3)):null,
   replayCallbacks,
   error:game==='th08'?core.status(app,2):r.status()[2],shellError:iframe.contentWindow.__eaglerNetplayError||'',events:events.filter(e=>e.event==='error'),detail:(()=>{const p=core[game==='th08'?'multiplayer_network_error':'multiplayer_error_detail'](app),b=new Uint8Array(core.memory.buffer);let end=p;while(b[end])++end;return new TextDecoder().decode(b.subarray(p,end));})(),timing:iframe.contentWindow.__eaglerNetplayTiming||null};},
 tick(target){const r=this.runtime(),s=this.snapshot();if(s.next<=target){const code=r.core.sdl_loop_tick(r.app,1/60,16);if(code)throw Error('Native stopped-loop tick '+code);}
  else if(game==='th08'&&s.ready&&!r.core.multiplayer_reconcile(r.app))throw Error('Native reconcile failed');return this.snapshot();},
 stopLoop(){this.runtime().core.sdl_loop_stop();},
 async configure(options,replayBytes){const resources=await(await(await fetch('/runtime/'+game+'/resources.json')).json());
  const runtimeResources=resources.resources.map(r=>({...r,url:new URL(r.url,location.origin+'/runtime/'+game+'/').href}));
  await this.request('configure',{language:'lang_ja',music:'none',options,runtimeResources,sharedResources:[{path:'/msgothic.ttc',url:'/shared/msgothic.ttc'}]});
  if(replayBytes)await this.request('write',{path:'replay/th10_01.rpyx',bytes:replayBytes});
  await this.request('launch');this.stopLoop();},
 exportReplay(){const r=this.runtime(),c=r.core;if(game==='th08'){const p=c.multiplayer_replay_export(r.app),n=c.multiplayer_replay_export_size();if(!p||!n)throw Error('Replay export failed');return Array.from(new Uint8Array(c.memory.buffer,p,n));}
  const file='th10_01.rpy',name='Adonis',encode=s=>{const b=new TextEncoder().encode(s),p=c.files_allocate(b.length+1);new Uint8Array(c.memory.buffer,p,b.length+1).set(b);return p;},f=encode(file),n=encode(name);
  try{if(!c.world_save_replay(c.application_world(r.app),f,n))throw Error('Replay save failed');}finally{c.files_free(f);c.files_free(n);}
  return Array.from(r.Module.FS.readFile('/savesth10-multiplayer/jp/replay/'+file));
 },
 async prepareReplay(bytes){await this.configure({replayViewer:true,netplayMode:'offline',thpracEnabled:false},game==='th10'?bytes:null);const r=this.runtime(),c=r.core;
  if(game==='th08'){const p=c.allocate(bytes.length);try{new Uint8Array(c.memory.buffer,p,bytes.length).set(bytes);const seed=c.multiplayer_replay_seed(p,bytes.length);replayApp=c.multiplayer_replay_reopen(seed);if(!replayApp||!c.multiplayer_replay_load(replayApp,p,bytes.length,0))throw Error('Replay native bootstrap failed');}finally{c.deallocate(p);}
   for(let n=c.sdl_prepare_total(),i=0;i<n;++i)if(c.sdl_prepare_next()<0)throw Error('Replay prepare failed');if(!c.sdl_game_initialize())throw Error('Replay initialize failed');
  }
 },
 replayTick(target){const r=this.runtime(),c=r.core,app=replayApp||r.app,s=this.snapshot();if(s.last!==4294967295&&s.last>=target)return s;
  if(game==='th10'){if(!s.replay[2]&&s.title){const screen=s.title[7],phase=s.title[8];this.key('KeyZ',(phase===2&&[1,2,12].includes(screen)||screen===12&&phase===4)&&Math.floor(performance.now()/180)%2===0);}
   if(!replayLoop){replayLoop=true;const prior=r.Module.runtimeFinish;r.Module.runtimeFinish=(...args)=>{++replayCallbacks;prior(...args);const state=this.snapshot();if(state.last!==4294967295&&state.last>=target)c.sdl_loop_stop();};c.sdl_loop_start(app);c.sdl_loop_pause(0);}return s;}
  const result=c.sdl_loop_tick(app,1/60,16);if(result)throw Error('Replay tick failed '+result);return this.snapshot();},
 key(code,down){const r=this.runtime(),core=r.core,b=new TextEncoder().encode(code),alloc=core.allocate||core.files_allocate,free=core.deallocate||core.files_free,p=alloc(b.length+1);
  try{const out=new Uint8Array(core.memory.buffer,p,b.length+1);out.set(b);out[b.length]=0;core.sdl_key(p,+down);}finally{free(p);}},
};
</script>`;
const relay=spawn(process.execPath,[resolve(topics,'eagler-touhou/server/netplay-relay.mjs')],{env:{...process.env,EAGLER_NETPLAY_RELAY_HOST:'127.0.0.1',EAGLER_NETPLAY_RELAY_PORT:String(relayPort),EAGLER_NETPLAY_STUN_URLS:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
relay.stdout.on('data',b=>process.stdout.write(b));relay.stderr.on('data',b=>process.stderr.write(b));
const mime={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(/^\/host\/th(?:08|10)$/.test(path)){res.setHeader('Content-Type','text/html');res.end(host);return;}
 let file;
 const match=path.match(/^\/runtime\/(th08|th10)\/(.+)$/);
 if(match&&!match[2].split('/').some(p=>p==='..'))file=resolve(topics,match[1],'build-eagler-multiplayer',match[2]);
 if(path==='/data/th08')file=resolve(workspace,'th08-eagler/artifacts/presentation-lab/input/th08.dat');
 if(path==='/data/th10')file=resolve(workspace,'games/web-content/th10/th10.data');
 if(path==='/shared/msgothic.ttc')file=resolve(workspace,'games/th06/msgothic.ttc');
 if(!file||!existsSync(file)){res.statusCode=404;res.end('Missing test resource');return;}
 res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(readFileSync(file));
});
server.listen(port,'127.0.0.1',()=>console.log('Adonis MP browser host http://127.0.0.1:'+port+'; relay '+relayPort));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{relay.kill();server.close(()=>process.exit(0));});
