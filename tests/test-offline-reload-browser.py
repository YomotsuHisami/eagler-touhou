"""Real current-publication prepare online, then first gameplay launch offline."""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parent/'support'))
from current_ui import (require_local_publication,suppress_notices,open_product,set_music,
                        prepare_game,launch_game,exit_game,runtime_url,RuntimeEvents,wait_ready)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url',help='Explicit loopback assembled current publication')
    parser.add_argument('game',choices=['th06','th07'])
    args=parser.parse_args(); base=require_local_publication(args.url,[args.game])
    with sync_playwright() as playwright:
        with playwright.chromium.launch(headless=True) as browser:
            context=browser.new_context();suppress_notices(context)
            page=context.new_page();events=RuntimeEvents(page,args.game)
            open_product(page,base,args.game)
            page.evaluate('() => navigator.serviceWorker.ready')
            page.reload(wait_until='load');wait_ready(page)
            set_music(page,'none')
            # Current preparation installs Package and freezes/caches the Runtime
            # without sending launch, so first gameplay still happens offline.
            prepare_game(page,args.game)
            assert not any(event['event']=='first-frame' for event in events.events), events.events
            online=page.evaluate("""async game => {
              const frame=document.querySelector('[data-runtime-host] iframe');
              const runtime=new URL(frame.contentWindow.location.href);
              if(runtime.origin!==location.origin)throw Error('Runtime document is not same-origin');
              runtime.search='';
              const cachedRuntime=!!(await caches.match(runtime.href));
              const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('eagler-touhou-package-store-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
              try {const installation=await new Promise((resolve,reject)=>{const r=db.transaction('installations','readonly').objectStore('installations').get(game);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return {cachedRuntime,currentGeneration:installation?.currentGeneration,runtime:runtime.href};} finally {db.close();}
            }""",args.game)
            assert online['cachedRuntime'] and online['currentGeneration'], online
            exit_game(page);context.set_offline(True)
            page.reload(wait_until='load');wait_ready(page);events.clear()
            set_music(page,'none');launch_game(page,args.game);events.wait()
            frame=runtime_url(page)
            assert not frame.startswith('blob:') and 'managedData=1' in frame,frame
            assert parse_qs(urlsplit(frame).query).get('gameGeneration') == [online['currentGeneration']], frame
            assert not page.evaluate('navigator.onLine')
            print(json.dumps({'pass':True,'game':args.game,'generation':online['currentGeneration'],'runtime':frame,'offline':True}))
    return 0
if __name__=='__main__':raise SystemExit(main())
