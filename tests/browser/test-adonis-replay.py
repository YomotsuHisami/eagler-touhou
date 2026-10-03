"""Replay a retained native archive against its corrected live-world oracle."""
import argparse,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('--reference',type=Path,required=True)
p.add_argument('--output',type=Path,required=True);p.add_argument('--url',default='http://127.0.0.1:18380')
p.add_argument('--timeout',type=int,default=90)
a=p.parse_args();reference=json.loads(a.reference.read_text(encoding='utf-8'));game=reference['game']
report={'passed':False,'game':game,'reference':str(a.reference)}
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,args=['--enable-unsafe-swiftshader']);context=browser.new_context(service_workers='block');page=context.new_page()
 try:
  page.goto(a.url+'/host/'+game);page.evaluate('host.open()');page.wait_for_function('host.ready()',timeout=120000)
  page.evaluate('bytes=>host.prepareReplay(bytes)',list(a.reference.with_suffix('.rpyx').read_bytes()))
  deadline=time.monotonic()+a.timeout;notice=time.monotonic()+10
  while True:
   state=page.evaluate('host.replayTick(179)');report['state']=state
   assert not state['error'] and not state['events'],state
   if state['last']==179:break
   if time.monotonic()>notice:print(game,'Replay',state['last'],'title',state['title'],'previews',state['titlePreview'],flush=True);notice=time.monotonic()+10
   assert time.monotonic()<deadline,('Replay timeout',state)
   page.wait_for_timeout(10)
  expected=reference['checkpoints'][-1]['snapshots'][0]
  actual=state['hash'] if game=='th08' else state['portable'][2:10]
  oracle=expected['hash'] if game=='th08' else expected['portable'][2:10]
  assert actual==oracle,('Playback world mismatch',oracle,actual)
  report['passed']=True
 except Exception as e:
  report['failure']=str(e);report['state']=page.evaluate('host.snapshot()');raise
 finally:
  a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
print(game,'native Replay at frame 179: PASS')
