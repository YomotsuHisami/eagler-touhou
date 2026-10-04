"""Desktop Playwright WebKit: real Runtime/DATA and current React controls.

Mobile emulation and synthetic simultaneous TouchEvents are not physical iOS
acceptance. Native first-frame/DATA checks are kept separate from input delivery.
An explicitly assembled local publication and optional legal ZIP are required.
"""
import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'support'))
from current_ui import (require_local_publication,suppress_notices,open_product,set_music,set_touch,
                        import_package,launch_game,exit_game,runtime_frame,runtime_url,RuntimeEvents,diagnostics)


def is_runtime_frame(src,game):
    return re.search(r'/runtime/'+re.escape(game)+r'/(?:[a-f0-9]{64}/)?'+re.escape(game)+r'\.html$',urlparse(src).path) is not None


def runtime_generation(src,game):
    return parse_qs(urlparse(src).query).get('gameGeneration',[''])[0] if is_runtime_frame(src,game) else ''


def touch_ownership(page,runtime):
    """Synthetic native TouchEvents through the real current iOS input owner."""
    surface=page.locator('.touch-runtime > .pointer-events-auto[aria-hidden="true"]')
    focus=page.get_by_role('button',name='Focus',exact=True)
    expect(surface).to_be_visible();expect(focus).to_be_visible()
    runtime.evaluate("""() => {
      window.__currentUiTouchMessages=[];
      addEventListener('message',event=>{const m=event.data||{},epoch=Number(new URLSearchParams(location.search).get('runtimeEpoch'));
        if(event.source===parent && event.origin===location.origin && m.protocol==='eagler-touhou/1' && m.epoch===epoch && m.command==='direct-touch')
          window.__currentUiTouchMessages.push({type:m.type,id:m.id,x:m.x,y:m.y});});
    }""")
    bounds=runtime_frame(page).bounding_box();button=focus.bounding_box()
    assert bounds and button
    x,y=bounds['x']+bounds['width']*.60,bounds['y']+bounds['height']*.60
    fx,fy=button['x']+button['width']/2,button['y']+button['height']/2
    runtime_frame(page).evaluate("frame=>{window.__currentUiFocusCalls=0;Object.defineProperty(frame,'focus',{configurable:true,value:()=>window.__currentUiFocusCalls++});}")
    def dispatch(target,kind,identifier,cx,cy):
        prevented=target.evaluate("""(target,{kind,id,x,y})=>{
          const event=new Event(kind,{bubbles:true,cancelable:true});
          Object.defineProperty(event,'changedTouches',{value:[{target,identifier:id,clientX:x,clientY:y}]});
          target.dispatchEvent(event);return event.defaultPrevented;
        }""",{'kind':kind,'id':identifier,'x':cx,'y':cy})
        page.wait_for_timeout(25)
        return prevented
    prevented=[]
    try:
        prevented.append(dispatch(surface,'touchstart',101,x,y))
        prevented.append(dispatch(surface,'touchmove',101,x+24,y-12))
        prevented.append(dispatch(focus,'touchstart',102,fx,fy));expect(focus).to_have_attribute('aria-pressed','true')
        prevented.append(dispatch(surface,'touchmove',101,x+48,y-18));expect(focus).to_have_attribute('aria-pressed','true')
        prevented.append(dispatch(focus,'touchend',102,fx,fy));expect(focus).to_have_attribute('aria-pressed','false')
        prevented.append(dispatch(surface,'touchmove',101,x+72,y-24))
        prevented.append(dispatch(surface,'touchend',101,x+72,y-24))
        focus_calls=page.evaluate('window.__currentUiFocusCalls')
        messages=runtime.evaluate('window.__currentUiTouchMessages')
        assert all(prevented) and focus_calls==0,{'prevented':prevented,'frameFocusCalls':focus_calls}
        assert [message['type'] for message in messages]==['down','move','move','move','up'],messages
    finally:
        runtime_frame(page).evaluate('frame=>{delete frame.focus;}')
    runtime.evaluate('window.__currentUiTouchMessages=[]')
    page.touchscreen.tap(bounds['x']+bounds['width']*.62,bounds['y']+bounds['height']*.58)
    page.wait_for_timeout(120)
    page.touchscreen.tap(bounds['x']+bounds['width']*.62,bounds['y']+bounds['height']*.58)
    page.wait_for_timeout(120)
    taps=runtime.evaluate('window.__currentUiTouchMessages')
    assert [message['type'] for message in taps][-4:]==['down','up','down','up'],taps
    return {'simultaneousMoveFocus':{'messages':messages,'prevented':prevented,'frameFocusCalls':focus_calls},'directTouchTaps':taps}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url',nargs='?',default=os.environ.get('EAGLER_NATIVE_SITE_URL'))
    parser.add_argument('game',nargs='?',default='th07',choices=['th06','th07','th08'])
    parser.add_argument('music',nargs='?',default='none',choices=['midi','ogg-stream','ogg-full','none'])
    parser.add_argument('--package-zip');parser.add_argument('--block-game-data',action='store_true');parser.add_argument('--artifact-dir')
    args=parser.parse_args()
    if not args.url:parser.error('Explicit assembled publication URL or EAGLER_NATIVE_SITE_URL required')
    base=require_local_publication(args.url,[args.game])
    if args.package_zip and not Path(args.package_zip).is_file():raise FileNotFoundError(args.package_zip)
    errors=[];requests=[];responses=[];blocked=[]
    with sync_playwright() as p:
        with p.webkit.launch(headless=True) as browser:
            context=browser.new_context(viewport={'width':844,'height':390},has_touch=True,is_mobile=True,device_scale_factor=3,
                user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
            suppress_notices(context);page=context.new_page();events=RuntimeEvents(page,args.game)
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('requestfailed',lambda request:requests.append({'url':request.url,'failure':request.failure}))
            page.on('response',lambda response:responses.append({'url':response.url,'status':response.status}) if response.status>=400 else None)
            if args.block_game_data:
                context.route('**/*.data*',lambda route:route.abort() if '/games/' in route.request.url.lower() else route.continue_())
            try:
                open_product(page,base,args.game)
                capabilities=page.evaluate("""() => ({audioContext:typeof AudioContext,webkitAudioContext:typeof webkitAudioContext,
                  offlineAudioContext:typeof OfflineAudioContext,indexedDB:typeof indexedDB,blob:typeof Blob,
                  urlCreateObjectURL:typeof URL.createObjectURL,webAssembly:typeof WebAssembly,ua:navigator.userAgent})""")
                audio_available=capabilities['audioContext']=='function' or capabilities['webkitAudioContext']=='function'
                effective_music=args.music if audio_available else 'none'
                if args.package_zip:import_package(page,base,args.game,args.package_zip)
                set_music(page,effective_music);launch_game(page,args.game);events.wait()
                first=runtime_generation(runtime_url(page),args.game)
                assert first and 'managedData=1' in runtime_url(page),diagnostics(page)
                exit_game(page)
                def block_remote_package(route):
                    lower=route.request.url.lower().split('?',1)[0]
                    if lower.endswith('.package.json') or lower.endswith(f'/{args.game}.data') or f'/games/{args.game}/music/' in lower:
                        blocked.append(route.request.url);route.abort()
                    else:route.continue_()
                context.route('**/*',block_remote_package)
                open_product(page,base,args.game);events.clear()
                set_music(page,effective_music);set_touch(page,True,'touch','hold-button')
                launch_game(page,args.game);events.wait()
                local=runtime_generation(runtime_url(page),args.game)
                assert local==first,{'first':first,'local':local}
                runtime=runtime_frame(page).element_handle().content_frame()
                assert runtime is not None
                managed=runtime.evaluate("""game=>({
                  provider:game==='th08'?typeof parent.__eaglerPrepareManagedRuntimeDataV1:typeof Module?.getPreloadedPackage,
                  preload:game==='th08'?null:Module?.preloadResults?.[`${game}.data`]||null,
                  dataPresent:game==='th08'?Array.isArray(Module?.th08RetailFiles)&&Module.th08RetailFiles.length===2&&typeof Module._th08_web_allocate_game_data==='function'&&typeof Module._th08_web_set_retail_file_sizes==='function':
                    game==='th07'?!!FS.analyzePath('/th07.dat').exists:['/紅魔郷CM.DAT','/紅魔郷ED.DAT','/紅魔郷IN.DAT','/紅魔郷MD.DAT','/紅魔郷ST.DAT','/紅魔郷TL.DAT'].every(path=>!!FS.analyzePath(path).exists)
                })""",args.game)
                assert managed['provider']=='function' and managed['dataPresent'],managed
                touches=touch_ownership(page,runtime)
                post_release=None
                if args.game=='th08':
                    counter="() => ({frames:Module._th08_web_get_presentation_frame_count?.()??-1,callbacks:Module._th08_web_get_callback_count?.()??-1,documentFocus:document.hasFocus(),activeTag:document.activeElement?.tagName||''})"
                    before=runtime.evaluate(counter)
                    runtime.evaluate('() => {Module.canvas?.focus?.({preventScroll:true});Module.canvas?.blur?.();}')
                    page.wait_for_timeout(900);after=runtime.evaluate(counter)
                    post_release={'before':before,'after':after,'frameDelta':after['frames']-before['frames'],'callbackDelta':after['callbacks']-before['callbacks']}
                    assert post_release['frameDelta']>0 and post_release['callbackDelta']>0,post_release
                assert not errors,errors
                print('Playwright WebKit current Launcher: PASS '+json.dumps({'execution':'desktop-playwright-webkit-mobile-emulation',
                    'physicalDevice':False,'game':args.game,'requestedMusic':args.music,'effectiveMusic':effective_music,
                    'audioAvailable':audio_available,'audioCoverage':'tested' if audio_available else 'unavailable-in-playwright-webkit',
                    'firstGeneration':first,'localGeneration':local,'blockedRemotePackageRequests':len(blocked),
                    'managedData':managed,**touches,'postReleaseFrames':post_release,'capabilities':capabilities},ensure_ascii=False))
            except Exception:
                output=Path(args.artifact_dir or tempfile.mkdtemp(prefix='current-webkit-'));output.mkdir(parents=True,exist_ok=True)
                (output/f'{args.game}-failure.json').write_text(json.dumps({'ui':diagnostics(page),'events':events.events,'pageErrors':errors,'requests':requests[-30:],'responses':responses[-30:]},ensure_ascii=False,indent=2))
                try:page.screenshot(path=str(output/f'{args.game}-failure.png'),full_page=True)
                except Exception:pass
                raise
    return 0
if __name__=='__main__':raise SystemExit(main())
