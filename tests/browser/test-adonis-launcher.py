"""Actual Launcher, production MP packages, real Relay and resident retail DATA."""
import argparse,json,hashlib,time,uuid,traceback,re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:18382/')
p.add_argument('--game',choices=['th08','th10'],required=True);p.add_argument('--output',type=Path,required=True)
p.add_argument('--package-dir',type=Path)
a=p.parse_args();root=Path(__file__).resolve().parents[2];workspace=root.parents[2]
topics=workspace/'worktrees/adonis';package=a.package_dir.resolve() if a.package_dir else topics/a.game/'build-eagler-multiplayer'
data_path=workspace/('th08-eagler/artifacts/presentation-lab/input/th08.dat' if a.game=='th08' else 'games/web-content/th10/th10.data')
data=data_path.read_bytes();font=(workspace/'games/th06/msgothic.ttc').read_bytes()
report={'passed':False,'game':a.game,'scope':__doc__,'errors':[],'console':[],'httpFailures':[]}
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--enable-unsafe-swiftshader','--disable-features=LocalNetworkAccessChecks']);pages=[]
 try:
  seed_context=browser.new_context(service_workers='block');response=seed_context.request.get(a.url+'host-manifest.json')
  manifest=response.json();seed_context.close();manifest['shared']['netplayRelay']='ws://127.0.0.1:18381/'
  external=manifest.get('shared',{}).get('resourceMode')=='external'
  if not external:
   manifest['shared']['vanillaFont']='shared/msgothic.ttc';manifest['shared']['unicodeFont']='shared/unifont.otf'
  game=manifest['games'][a.game];manifest['games']={a.game:game}
  if not game.get('multiplayerRuntime'):game['multiplayerRuntime']=f'runtime/{a.game}/multiplayer/{a.game}.html?hosted=1'
  game['gameData'].update(bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),version='sha256-'+hashlib.sha256(data).hexdigest())
  if not external:game['gameData']['source']=f'test-data/{a.game}'
  # Exercise the current hosted installer rather than its missing-catalog fallback.
  descriptor=json.loads((workspace/f'dist/main-th09mp-launcher-20261003/site/{a.game}.package.json').read_text())
  descriptor['files']={k:descriptor['files'][k] for k in ('game-data','shared-msgothic')}
  descriptor['files']['game-data'].update(source=f'test-data/{a.game}',bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
  descriptor['base']['files']=['game-data','shared-msgothic'];descriptor['components']={}
  catalog={'schema':'eagler-touhou/release-catalog/1','games':{a.game:{'revision':descriptor['revision'],'descriptor':a.game+'.package.json'}}}
  room=str(1000+int(uuid.uuid4().hex[:6],16)%9000)
  for seat in range(3):
   context=browser.new_context(service_workers='block',viewport={'width':1280,'height':900})
   context.route('**/host-manifest.json*',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps(manifest)))
   context.route('**/release-catalog.json*',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps(catalog)))
   context.route('**/'+a.game+'.package.json*',lambda r:r.fulfill(status=200,content_type='application/json',body=json.dumps(descriptor)))
   context.route('**/test-data/'+a.game,lambda r:r.fulfill(status=200,body=data))
   context.route('**/shared/msgothic.ttc*',lambda r:r.fulfill(status=200,body=font))
   def runtime_resource(route):
    relative=urlparse(route.request.url).path.split('/multiplayer/',1)[1]
    relative=re.sub(r'^[a-f0-9]{64}/','',relative)
    file=(package/relative).resolve();assert file.is_relative_to(package.resolve()),file
    mime='application/wasm' if file.suffix=='.wasm' else 'text/javascript' if file.suffix in ('.mjs','.js') else 'text/html' if file.suffix=='.html' else 'application/json' if file.suffix=='.json' else 'application/octet-stream'
    route.fulfill(status=200,content_type=mime,body=file.read_bytes())
   context.route('**/runtime/'+a.game+'/multiplayer/**',runtime_resource)
   context.add_init_script("window.calibrationEvents=[];window.runtimeEvents=[];window.connectionViews=[];addEventListener('message',e=>{if(e.data?.netplayTiming)calibrationEvents.push(e.data.netplayTiming);if(e.data?.event)runtimeEvents.push(e.data)});setInterval(()=>{const w=document.querySelector('#netplayConnectionWindow');if(w?.dataset.calibration==='ready')connectionViews.push(w.innerText)},200)")
   page=context.new_page();pages.append(page);page.on('pageerror',lambda e,seat=seat:report['errors'].append({'seat':seat,'message':str(e)}))
   page.on('console',lambda m,seat=seat:report['console'].append({'seat':seat,'type':m.type,'message':m.text}) if m.type in ('error','warning') else None)
   page.on('response',lambda r,seat=seat:report['httpFailures'].append({'seat':seat,'status':r.status,'url':r.url}) if r.status>=400 else None)
   action='create' if seat==0 else 'join';from_lobby=1 if seat<2 else 0
   page.goto(a.url+f'?game={a.game}mp&mpRoom={room}&fromLobby={from_lobby}&lobbyAction={action}&lobbyPlayers=2&lobbyDifficulty=1')
   page.wait_for_function('window.__eaglerBoot?.done === true',timeout=60000)
   notice=page.locator('#firstUseNoticeDialog')
   if notice.count() and notice.evaluate('d=>d.open'):page.locator('#firstUseNoticeClose').click()
   page.wait_for_selector('#mpRoomView:not([hidden])',timeout=15000)
   if seat==2:
    page.locator('#mpSpectatorToggle').click()
    page.locator('#mpSpectatorJoin').click()
    page.locator('#mpRoomPanelClose').click()
   # Use the published room music control through the real select.
   select=page.locator('#mpMusicSelect')
   if select.count():select.select_option('none',force=True)
   if seat<2:page.wait_for_function("i=>document.querySelector('[data-mp-seat=\"'+i+'\"]')?.classList.contains('occupied')",arg=seat,timeout=20000)
  host,guest,viewer=pages
  report['room']=room
  assert host.locator('#mpRollbackToggle').get_attribute('aria-checked')=='false'
  for page in [host,guest]:page.locator('#mpReady').click()
  host.wait_for_function("!document.querySelector('#mpStartGame').disabled",timeout=20000);host.locator('#mpStartGame').click()
  deadline=time.monotonic()+120;screenshot=False
  while time.monotonic()<deadline:
   for page in pages:
    decision=page.locator('#decisionDialog[open]:not(.closing)')
    if decision.count():
     keep=decision.locator('#decisionCancel')
     keep.click() if '当前版本' in keep.inner_text() else decision.locator('#decisionConfirm').click()
   if not screenshot and host.locator('#netplayConnectionWindow').get_attribute('data-calibration')=='ready':
    host.locator('#netplayConnectionWindow').screenshot(path=str(a.output.with_suffix('.png')));screenshot=True
   if all(page.evaluate("connectionViews.length>0") for page in [host,guest]):break
   host.wait_for_timeout(100)
  report['connection']=[page.evaluate("connectionViews.at(-1)") for page in [host,guest]]
  assert all(report['connection']),('Missing measured connection UI',report['connection'])
  for text in report['connection']:assert '测定延迟' in text and '最大延迟' in text and '输入延迟' in text,text
  for page in pages:
   page.wait_for_function("g=>{const r=document.querySelector('#gameFrame')?.contentWindow['__'+g+'Runtime'];if(!r?.app)return false;const c=r.core,s=new Uint32Array(c.memory.buffer,c.multiplayer_netplay_status(r.app),g==='th08'?15:11);return s[g==='th08'?4:3]!==4294967295&&s[g==='th08'?4:3]>=119}",arg=a.game,timeout=60000)
  report['timing']=[page.evaluate("calibrationEvents.filter(e=>e.phase==='ready').at(-1)") for page in [host,guest]]
  report['native']=[page.evaluate("g=>{const r=document.querySelector('#gameFrame').contentWindow['__'+g+'Runtime'],c=r.core;return Array.from(new Uint32Array(c.memory.buffer,c.multiplayer_netplay_status(r.app),g==='th08'?15:11))}",a.game) for page in pages]
  assert all(t and t['adonisMode']==1 and t['inputDelay']>=1 for t in report['timing']),report['timing']
  assert not report['errors'],report['errors'];report['passed']=True
 except Exception as e:
  report['failure']=str(e);report['traceback']=traceback.format_exc()
  for seat,page in enumerate(pages):
   report.setdefault('pages',[]).append({'seat':seat,'body':page.locator('body').inner_text()[-8000:],'runtime':page.evaluate("g=>{const f=document.querySelector('#gameFrame'),r=f?.contentWindow['__'+g+'Runtime'];return {url:f?.src,app:r?.app,status:r?.status?.(),events:calibrationEvents.slice(-4),runtimeEvents:runtimeEvents.slice(-12)}}",a.game)})
   page.screenshot(path=str(a.output.with_name(a.output.stem+f'-failure-{seat}.png')))
  raise
 finally:
  a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
print(a.game,'Launcher connection, two players and live spectator: PASS')
