"""Production shells + real BrowserPeerTransport; no remote input injection."""
import argparse,json,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:18380');p.add_argument('--game',choices=['th08','th10'],required=True)
p.add_argument('--players',type=int,choices=[2,3],default=2);p.add_argument('--mode',type=int,choices=[1,2],default=1)
p.add_argument('--route',choices=['rtc','relay'],default='rtc');p.add_argument('--delay',type=int);p.add_argument('--output',type=Path,required=True)
p.add_argument('--spectator',action='store_true');p.add_argument('--replay',action='store_true');p.add_argument('--input-lag-ms',type=int,default=0)
p.add_argument('--last-frame',type=int,default=179)
p.add_argument('--difficulty',type=int,default=1)
p.add_argument('--join-lag-ms',type=int,default=0)
a=p.parse_args();report={'passed':False,'game':a.game,'players':a.players,'difficulty':a.difficulty,'adonisMode':a.mode,'route':a.route,'manualDelay':a.delay,'inputLagMs':a.input_lag_ms,'joinLagMs':a.join_lag_ms,'errors':[],'checkpoints':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--enable-unsafe-swiftshader']);pages=[]
 try:
  room=a.game+'mp-adonis-'+uuid.uuid4().hex[:12]
  relay=a.url.replace('http://','ws://').replace(':18380',':18381')+'/?room='+room+'&run=1'
  for seat in range(a.players+int(a.spectator)):
   if seat==1 and a.join_lag_ms:
    pages[0].evaluate('()=>{const r=host.runtime();r.core.sdl_loop_start(r.app);r.core.sdl_loop_pause(0)}')
    pages[0].wait_for_timeout(a.join_lag_ms);pages[0].evaluate('host.stopLoop()')
   context=browser.new_context(service_workers='block')
   if a.route=='relay':context.add_init_script("Object.defineProperty(globalThis,'RTCPeerConnection',{value:undefined,configurable:true})")
   if a.input_lag_ms:
    assert a.route=='relay'
    context.add_init_script("const originalSend=WebSocket.prototype.send;WebSocket.prototype.send=function(data){if(typeof data==='string')return originalSend.call(this,data);const socket=this,payload=data.slice?.(0)||data;setTimeout(()=>{if(socket.readyState===WebSocket.OPEN)originalSend.call(socket,payload)},globalThis.auditGameplayLag??"+str(a.input_lag_ms)+")}")
   page=context.new_page();pages.append(page);page.on('pageerror',lambda e,seat=seat:report['errors'].append({'seat':seat,'error':str(e)}))
   page.goto(a.url+'/host/'+a.game);page.evaluate('host.open()');page.wait_for_function('host.ready()',timeout=120000)
   if a.spectator:
    lobby_id='audit_seat_'+str(seat)+'_'+uuid.uuid4().hex[:8]
    page.evaluate("""async o=>{const url=new URL(o.url);url.searchParams.delete('run');url.searchParams.set('lobby',o.id);
     const ws=window.auditLobby=new WebSocket(url);window.auditLobbyState=null;window.auditLobbyMessages=[];
     ws.onmessage=e=>{const m=JSON.parse(e.data);auditLobbyMessages.push(m);if(m.room)auditLobbyState=m.room};
     window.auditLobbyWait=async predicate=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw Error('Lobby wait timeout');await new Promise(r=>setTimeout(r,10))}};
     await auditLobbyWait(()=>auditLobbyState);ws.send(JSON.stringify(o.seat<o.count?{type:'take-seat',seat:o.seat,loadout:o.seat,ready:false}:{type:'spectate'}));
     await auditLobbyWait(()=>o.seat<o.count?auditLobbyState.seats[o.seat]?.clientId===o.id:auditLobbyState.spectators.some(s=>s.clientId===o.id));
     if(o.seat===0){ws.send(JSON.stringify({type:'settings',playerCount:o.count,difficulty:1}));await auditLobbyWait(()=>auditLobbyState.playerCount===o.count)};
     if(o.seat<o.count){ws.send(JSON.stringify({type:'set-ready',ready:true}));await auditLobbyWait(()=>auditLobbyState.seats[o.seat]?.ready)};
    }""",{'url':relay,'id':lobby_id,'seat':seat,'count':a.players})
    if seat==a.players:
     for player_page in pages[:a.players]:
      player_page.evaluate("async()=>{auditLobby.send(JSON.stringify({type:'set-ready',ready:true}));await auditLobbyWait(()=>auditLobbyState.seats.filter(Boolean).every(s=>s.ready))}" if player_page==pages[a.players-1] else "()=>auditLobby.send(JSON.stringify({type:'set-ready',ready:true}))")
     pages[0].evaluate("""async o=>{auditLobby.send(JSON.stringify({type:'start',adonisMode:o.mode,inputDelayAuto:o.delay===null,inputDelay:o.delay||0,predictionReserve:2,predictionLimit:8}));await auditLobbyWait(()=>auditLobbyMessages.some(m=>m.type==='start'))}""",{'mode':a.mode,'delay':a.delay})
   loadouts=([{'character':i,'shot':0} for i in range(a.players)] if a.game=='th08' else [{'character':0,'shot':0},{'character':1,'shot':1},{'character':0,'shot':2}][:a.players])
   options={'netplayMode':'lan','netplayUrl':relay,'netplayPlayer':seat if seat<a.players else 0,'netplayPlayerCount':a.players,'netplaySeed':1234,
    'netplayDifficulty':a.difficulty,'netplayLoadouts':loadouts,'netplayAdonisMode':a.mode,'netplayInputDelay':a.delay or 0,
    'netplayInputDelayAuto':a.delay is None,'netplayPredictionReserve':2,'netplayPredictionLimit':8,'netplaySpectatorCount':int(a.spectator),'netplaySpectator':seat==a.players}
   if seat==a.players:options['netplaySpectatorId']=lobby_id
   page.evaluate('o=>host.configure(o)',options)
  deadline=time.monotonic()+90;observed=[]
  while True:
   snapshots=[]
   for seat,page in enumerate(pages):
    s=page.evaluate('host.snapshot()');snapshots.append(s)
    assert not s['error'] and not s['events'],s
    if not s['ready']:
     if seat<a.players and s['calibration'][1]<5:assert s['last']==4294967295,('frame zero advanced before calibration',s)
     page.evaluate('host.tick(-1)') if 2<=s['calibration'][1]<5 else page.evaluate('host.tick(0)')
   observed.append([s['calibration'][1:4] for s in snapshots])
   if all(s['ready'] for s in snapshots[:a.players]):break
   assert time.monotonic()<deadline,('startup timeout',snapshots,report['errors'])
   pages[0].wait_for_timeout(5)
  report['startup']=snapshots;report['progress']=observed
  for s in snapshots[:a.players]:
   assert s['calibration'][1]==5 and s['calibration'][2]==129 and s['calibration'][3]>=96,s
   assert s['timing'] and s['timing']['route']==a.route,s
  choices=[s['calibration'][8:11] for s in snapshots[:a.players]];assert all(c==choices[0] for c in choices),choices
  if a.delay is not None:assert choices[0][0]==a.delay,choices
  if a.input_lag_ms and a.mode==2 and a.delay is None:assert choices[0][2]>0,choices
  for target in [f for f in [59,119,179] if f<=a.last_frame]:
   settled=False
   if a.input_lag_ms and a.mode==2:
    for page in pages:
     for frame in page.frames:frame.evaluate('lag=>{globalThis.auditGameplayLag=lag}',a.input_lag_ms*3)
   deadline=time.monotonic()+100
   while True:
    snapshots=[]
    for seat,page in enumerate(pages):
     s=page.evaluate('host.snapshot()')
     if seat<a.players:page.evaluate('([shoot,right])=>{host.key("KeyZ",shoot);host.key("ArrowRight",right)}',[s['next']>=20,(s['next']//25+seat)%2==0])
     snapshots.append(page.evaluate('n=>host.tick(n)',target))
    assert all(not s['error'] for s in snapshots),snapshots
    if a.input_lag_ms and a.mode==2 and not settled and any(s['next']>=target-24 for s in snapshots):
     for page in pages:
      for frame in page.frames:frame.evaluate('globalThis.auditGameplayLag=0')
     pages[0].wait_for_timeout(a.input_lag_ms*3+200);settled=True
    if a.mode==1:
     for s in snapshots:
      assert s['rollback']==0,s
      assert (not any(s['driver'][3:6]) and s['driver'][10]==0) if a.game=='th08' else s['net'][6]==0,s
      if a.game=='th10':assert not any(s['rollbackStorage'][1:]),('Disabled rollback allocated or performed work',s)
      else:assert s['driver'][16]==0,('Disabled rollback allocated journals',s)
    if all(s['last']==target for s in snapshots):break
    assert time.monotonic()<deadline,('gameplay timeout',target,snapshots,report['errors'])
    pages[0].wait_for_timeout(10)
   pages[0].wait_for_timeout(150)
   snapshots=[page.evaluate('host.snapshot()') for page in pages]
   if a.game=='th08' and a.difficulty==4:
    assert all(s['native'][6]==8 for s in snapshots),('Extra did not start its native stage',snapshots)
   hashes=[s['hash'] for s in snapshots]
   # TH10's composite excludes seat identity; TH08 exports named hashes.
   # Staggered real-rAF loading advances presentation/loading clocks differently.
   # The portable world categories are the established same-frame game oracle.
   comparison=hashes if a.game=='th08' else [s['portable'][2:10] for s in snapshots] if a.spectator or a.join_lag_ms else [h[1] for h in hashes]
   assert all(h==comparison[0] for h in comparison),('same-frame state mismatch',target,snapshots)
   report['checkpoints'].append({'frame':target,'snapshots':snapshots});print(a.game,a.players,a.mode,a.route,'confirmed',target,flush=True)
  for s in snapshots:
   if a.mode==2 and s in snapshots[:a.players]:
    assert (s['rollbackStorage'][9] if a.game=='th10' else s['driver'][16])==1,('Enabled rollback has no undo owner',s)
    if a.input_lag_ms:
     assert s['rollback']>0,('Delayed live input did not exercise correction',s)
   buttons=[s['native'][8+seat*12+(10 if a.game=='th08' else 11)] for seat in range(a.players)]
   assert all(b&1 for b in buttons),('Physical shoot input did not reach every player',buttons)
  if a.replay:
   assert a.last_frame==179
   # Let the complete rollback checkpoint retire before exporting irreversible
   # Replay outputs. Keep frame 179's corrected world as the playback oracle.
   deadline=time.monotonic()+60
   while True:
    tail=[page.evaluate('host.tick(191)') for page in pages]
    if all(s['last']==191 for s in tail):break
    assert time.monotonic()<deadline,('Replay commit tail stalled',tail)
    pages[0].wait_for_timeout(10)
   pages[0].wait_for_timeout(150)
   for page in pages:page.evaluate('host.tick(191)')
   archive=pages[0].evaluate('host.exportReplay()');report['replayBytes']=len(archive)
   a.output.with_suffix('.rpyx').write_bytes(bytes(archive))
   assert len(archive)>128
   context=browser.new_context(service_workers='block');playback=context.new_page();pages.append(playback)
   playback.goto(a.url+'/host/'+a.game);playback.evaluate('host.open()');playback.wait_for_function('host.ready()',timeout=120000)
   playback.evaluate('bytes=>host.prepareReplay(bytes)',archive)
   deadline=time.monotonic()+90
   while True:
    state=playback.evaluate('host.replayTick(179)')
    assert not state['error'],state
    if state['last']==179:break
    assert time.monotonic()<deadline,('Replay timeout',state)
    playback.wait_for_timeout(5)
   reference=snapshots[0]['hash'] if a.game=='th08' else snapshots[0]['portable'];actual=state['hash'] if a.game=='th08' else state['portable']
   # TH10 composite includes the read-only session/Replay owners. Compare its
   # canonical world categories (pilots, RNG, scripts, bullets, lifecycle).
   world=lambda h:h if a.game=='th08' else h[2:10]
   assert world(reference)==world(actual),('Replay world mismatch',reference,actual,state)
   report['replay']=state
  assert not report['errors'],report['errors'];report['passed']=True
 except Exception as e:
  report['failure']=str(e);report['last']=[page.evaluate('host.snapshot()') for page in pages];raise
 finally:
  a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
