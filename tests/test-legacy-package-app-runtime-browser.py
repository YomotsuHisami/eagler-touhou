"""Real legacy-package input, current React import, and native first-frame gate."""
import argparse
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent / 'support'))
from current_ui import (require_local_publication, suppress_notices, open_product,
                        import_package, set_music, launch_game, runtime_url, RuntimeEvents)

PACKAGE_SNAPSHOT = """async game => {
  const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('eagler-touhou-package-store-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try {
    const installation=await new Promise((resolve,reject)=>{const r=db.transaction('installations','readonly').objectStore('installations').get(game);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const generation=await new Promise((resolve,reject)=>{const r=db.transaction('generations','readonly').objectStore('generations').get([game,installation.currentGeneration]);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return {installation,generation};
  } finally {db.close();}
}"""

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='Explicit loopback assembled current publication')
    parser.add_argument('game', choices=['th06','th07'])
    parser.add_argument('package_zip')
    args=parser.parse_args()
    package=Path(args.package_zip).resolve()
    if not package.is_file(): raise FileNotFoundError(package)
    base=require_local_publication(args.url, [args.game])
    with sync_playwright() as playwright:
        with playwright.chromium.launch(headless=True) as browser:
            context=browser.new_context(); suppress_notices(context)
            page=context.new_page(); events=RuntimeEvents(page,args.game)
            open_product(page,base,args.game)
            import_package(page,base,args.game,package)
            set_music(page,'none'); launch_game(page,args.game,timeout=240000)
            events.wait(timeout=240000)
            state=page.evaluate(PACKAGE_SNAPSHOT,args.game)
            descriptor=state['generation']['descriptor']
            carries_runtime='runtime' in descriptor or 'runtimes' in descriptor
            assert carries_runtime, 'fixture is not a legacy Package carrying executable Runtime files'
            frame=runtime_url(page)
            assert not frame.startswith('blob:') and 'managedData=1' in frame, frame
            print(json.dumps({'pass':True,'game':args.game,'legacyRevision':descriptor['revision'],
                'legacyCarriesRuntime':carries_runtime,'runtime':frame,'source':state['installation']['source']},ensure_ascii=False))
    return 0
if __name__=='__main__': raise SystemExit(main())
