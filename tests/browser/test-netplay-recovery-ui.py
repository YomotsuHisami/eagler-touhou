"""Hermetic browser checks for recovery copy, room return, focus and narrow layout."""
import argparse, json, threading, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
project=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(project/'tests'))
from support.original_component_fixture import original_component_fixture
fixture=original_component_fixture(project,'netplay-recovery')
panel_selector=fixture['panelSelector'] if fixture else '#connection'
html='''<!doctype html><html data-ui-locale="zh"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<aside id="connection" class="netplay-connection-window"><header><strong id="netplayConnectionTitle"></strong></header><div id="netplayConnectionSummary"></div><div id="netplayConnectionPeers"></div><p id="netplayConnectionNote" hidden></p></aside>
<script type="module">
import {recordCalibrationProgress,renderCalibrationConnection} from '/assets/launcher/netplay-calibration-connection.mjs';
window.returns=0;window.show=phase=>{recordCalibrationProgress({phase,attempt:2,maxAttempts:4,reason:1,probes:10,replies:1});renderCalibrationConnection(document.querySelector('#connection'),()=>++returns)};
window.show('retrying');window.ready=true;
</script></html>'''
if fixture:html=fixture['html']
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  path=self.path.split('?')[0]
  if path=='/':data=html.encode();mime='text/html'
  elif fixture and path=='/__original-component-fixture.mjs':data=fixture['module'].encode();mime='text/javascript'
  else:
   root=project/'.cache/build/browser' if path.startswith('/assets/launcher/') or path.startswith('/assets/contracts/') else project/'public'
   file=(root/path.lstrip('/')).resolve()
   if not file.is_relative_to(root.resolve()) or not file.is_file():self.send_error(404);return
   data=file.read_bytes();mime='text/javascript' if file.suffix=='.mjs' else 'text/css' if file.suffix=='.css' else 'application/octet-stream'
  self.send_response(200);self.send_header('Content-Type',mime);self.end_headers();self.wfile.write(data)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
report={'passed':False,'states':[]}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True)
  try:
   for width in [360,1280]:
    page=browser.new_page(viewport={'width':width,'height':720});page.goto('http://127.0.0.1:'+str(server.server_port));page.wait_for_function('window.ready')
    for locale in ['zh','en']:
     page.evaluate('locale=>document.documentElement.dataset.uiLocale=locale',locale)
     for phase in ['retrying','suspended','unavailable']:
      page.evaluate('show',phase);button=page.locator('#netplayConnectionReturn');button.focus()
      page.evaluate('show',phase);assert button.evaluate('(b)=>document.activeElement===b'),'Progress update moved keyboard focus'
      box=button.bounding_box();panel=page.locator(panel_selector).bounding_box()
      assert box and panel and box['height']>=44 and box['x']>=0 and box['x']+box['width']<=width
      assert panel['x']>=0 and panel['x']+panel['width']<=width
      assert page.locator('#netplayConnectionTitle').get_attribute('aria-live')=='polite'
      text=button.text_content();assert text==('Return to room' if locale=='en' else '返回房间')
      before=page.evaluate('returns');page.keyboard.press('Enter');assert page.evaluate('returns')==before+1
      report['states'].append({'width':width,'locale':locale,'phase':phase,'title':page.locator('#netplayConnectionTitle').text_content(),'returnButton':text})
    args.output.parent.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(args.output.with_name('recovery-'+str(width)+'.png')));page.close()
   report['passed']=True
  finally:browser.close()
finally:
 server.shutdown();args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('Recovery UI: Chinese/English, narrow/desktop, keyboard return and stable focus PASS')
