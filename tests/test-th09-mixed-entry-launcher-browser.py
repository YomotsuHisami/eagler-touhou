"""Current React mixed TH09 title/launcher room entry, real relay, synthetic Runtime.

The sealed protocol fixture is not native TH09 execution, DATA, saves, timing,
WebRTC or gameplay acceptance. Both entry directions retain configured seat,
player-count, relay room and shared-loadout assertions.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0,str(Path(__file__).resolve().parent))
from support.current_ui import (suppress_notices,open_product,set_music,launch_game,runtime_frame,RuntimeEvents,diagnostics)
from support.current_room_ui import (protocol_publication,open_lobby,create_room,join_room,room,room_code,
    wait_local_seat,wait_occupied,room_panel,close_room_panel,prepare_room,ready_room,start_room,wait_runtime)


def open_page(browser):
    context=browser.new_context(viewport={'width':1280,'height':900})
    suppress_notices(context)
    page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    return page,errors


def title_entry(page,base,code=None):
    events=RuntimeEvents(page,'th09')
    open_product(page,base,'th09');set_music(page,'none');launch_game(page,'th09');events.wait()
    # Only the explicitly synthetic fixture supplies this title receipt. The
    # current root owner authenticates and handles its ordinary network event.
    runtime_frame(page).evaluate('frame=>frame.contentWindow.__eaglerTestRequestTitleRoom()')
    dialog=page.get_by_role('dialog',name='Phantasmagoria of Flower View · Versus',exact=True)
    expect(dialog).to_be_visible()
    if code is None:dialog.get_by_role('button',name='Create room',exact=True).click()
    else:
        dialog.get_by_role('textbox',name='Room code',exact=True).fill(code)
        dialog.get_by_role('button',name='Join room',exact=True).click()
    return room_code(page)


def launcher_entry(page,base,code=None):
    open_product(page,base,'th09mp');set_music(page,'none')
    open_lobby(page,base,'th09mp')
    if code is None:return create_room(page,'th09mp')
    join_room(page,'th09mp',code,seat=1);return room_code(page)


def run_scenario(browser,base,label,host_entry,joiner_entry):
    host,host_errors=open_page(browser);joiner,joiner_errors=open_page(browser)
    try:
        code=host_entry(host,base)
        assert len(code)==4 and code.isdigit(),code
        assert joiner_entry(joiner,base,code)==code
        wait_local_seat(host,0);wait_local_seat(joiner,1)
        for page in [host,joiner]:
            wait_occupied(page,2)
            panel=room_panel(page,'Personal settings / Loadout')
            loadout=panel.get_by_label('Loadout',exact=True)
            current=int(loadout.input_value())
            options=loadout.locator('option').count()
            loadout.select_option(str((current+1)%options))
            close_room_panel(page,panel)
            prepare_room(page);ready_room(page)
        start_room(host)
        configured=[]
        for page in [host,joiner]:
            wait_runtime(page)
            page.wait_for_function("""() => {
              const messages=document.querySelector('[data-runtime-host] iframe')?.contentWindow?.__eaglerTestMessages;
              return messages?.some(m=>m.command==='launch') && messages.some(m=>m.command==='configure'&&m.options?.netplayMode==='lan');
            }""",timeout=30000)
            configured.append(runtime_frame(page).evaluate("frame=>frame.contentWindow.__eaglerTestMessages.find(m=>m.command==='configure'&&m.options?.netplayMode==='lan').options"))
        assert [value['netplayPlayer'] for value in configured]==[0,1],configured
        assert all(value['netplayPlayerCount']==2 for value in configured),configured
        assert all(f'room=th09mp-{code}' in value['netplayUrl'] for value in configured),configured
        assert configured[0]['netplayLoadouts']==configured[1]['netplayLoadouts'],configured
        assert not host_errors+joiner_errors,host_errors+joiner_errors
        print('TH09 current React mixed-entry synthetic protocol: PASS '+json.dumps({'scenario':label,'room':code,'nativeRuntime':False}))
    except Exception:
        print(json.dumps({'scenario':label,'host':diagnostics(host),'joiner':diagnostics(joiner),'errors':host_errors+joiner_errors},ensure_ascii=False))
        raise
    finally:host.context.close();joiner.context.close()


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    with protocol_publication(['th09']) as (base,_):
        with sync_playwright() as playwright:
            with playwright.chromium.launch(headless=True) as browser:
                run_scenario(browser,base,'title-host/launcher-join',title_entry,launcher_entry)
                run_scenario(browser,base,'launcher-host/title-join',launcher_entry,title_entry)
if __name__=='__main__':main()
