"""Real relay late-spectator admission through current Framework controls.

The sealed Runtime is a synthetic protocol peer. This checks browser integration,
identity and exact server options, not native spectator frame convergence.
"""
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect
from support.current_ui import suppress_notices, open_product, set_music, runtime_frame, runtime_visible
from support.current_room_ui import (protocol_publication, open_lobby, join_room, room,
    room_panel, close_room_panel, wait_runtime)

LOBBY_RECORDING_INIT = r"""(() => {
  const NativeWebSocket = globalThis.WebSocket;
  globalThis.__eaglerTestLobbyMessages = [];
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(...args) {super(...args); this.addEventListener('message', event => {
      try {const m = JSON.parse(String(event.data)); if (m?.type) globalThis.__eaglerTestLobbyMessages.push(m);} catch {}
    });}
  };
})();"""


def main():
    with protocol_publication(('th07',)) as (base, relay):
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            setup_context = browser.new_context()
            context = browser.new_context(viewport={'width':960,'height':720}, service_workers='block')
            try:
                setup = setup_context.new_page()
                setup.evaluate("""async relay => {
                  const connect = (id, intent) => new Promise((resolve, reject) => {
                    const socket = new WebSocket(`${relay}?room=th07mp-4321&lobby=${id}&intent=${intent}&players=2&difficulty=1&visibility=private`);
                    const client = {socket, messages: []};
                    socket.addEventListener('message', event => {try {client.messages.push(JSON.parse(String(event.data)));} catch {}});
                    socket.addEventListener('open', () => resolve(client), {once:true});
                    socket.addEventListener('error', () => reject(Error('Synthetic setup client failed to reach real relay')), {once:true});
                  });
                  const owner = await connect('owner_client_0001', 'create');
                  const player = await connect('player_client_0002', 'join');
                  globalThis.__spectatorSetup = {owner, player};
                }""", relay)
                setup.wait_for_function("__spectatorSetup.owner.messages.some(m => m.type === 'state') && __spectatorSetup.player.messages.some(m => m.type === 'state')")
                for key, seat, name in [('owner',0,'Owner'), ('player',1,'Player')]:
                    setup.evaluate("""({key,seat,name}) => __spectatorSetup[key].socket.send(JSON.stringify({type:'take-seat',seat,loadout:seat,name}))""", {'key':key,'seat':seat,'name':name})
                    setup.wait_for_function("""seat => __spectatorSetup.owner.messages.some(m => m.type === 'state' && m.room?.seats?.[seat])""", arg=seat)
                setup.evaluate("""() => {for (const client of Object.values(__spectatorSetup)) client.socket.send(JSON.stringify({type:'set-ready',ready:true}));}""")
                setup.wait_for_function("__spectatorSetup.owner.messages.some(m => m.type === 'state' && m.room?.seats?.[0]?.ready && m.room?.seats?.[1]?.ready)")

                suppress_notices(context); context.add_init_script(LOBBY_RECORDING_INIT)
                page, errors = context.new_page(), []
                page.on('pageerror', lambda error: errors.append(str(error)))
                open_product(page, base, 'th07mp'); set_music(page, 'none'); open_lobby(page, base, 'th07mp')
                assert not page.get_by_role('alert').filter(has_text='not configured').count()
                join_room(page, 'th07mp', '4321')
                expect(room(page).get_by_role('article').nth(0)).to_contain_text('Owner')
                expect(room(page).get_by_role('article').nth(1)).to_contain_text('Player')
                expect(room(page).get_by_role('button', name='Ready', exact=True)).to_be_disabled()
                expect(room(page).get_by_role('button', name='Join as spectator', exact=True)).to_be_enabled()
                panel = room_panel(page, 'Personal settings / Loadout')
                panel.get_by_label('Multiplayer nickname (permanent once saved)', exact=True).fill('Watcher')
                panel.get_by_role('button', name='Save nickname', exact=True).click()
                expect(panel.get_by_label('Multiplayer nickname (permanent once saved)', exact=True)).to_be_disabled()
                close_room_panel(page, panel)
                panel = room_panel(page, 'Spectators (0)')
                expect(panel).to_contain_text('No spectators')
                close_room_panel(page, panel)
                setup.evaluate("__spectatorSetup.owner.socket.send(JSON.stringify({type:'start'}))")
                setup.wait_for_function("__spectatorSetup.owner.messages.some(m => m.type === 'start' && m.serial === 1)")
                page.wait_for_function("__eaglerTestLobbyMessages.some(m => m.type === 'start' && m.serial === 1)")
                assert not runtime_visible(page), 'Unseated non-spectator must not launch on room start'
                room(page).get_by_role('button', name='Join as spectator', exact=True).click()
                page.wait_for_function("__eaglerTestLobbyMessages.some(m => m.type === 'spectator-start' && m.serial === 1)")
                wait_runtime(page)
                page.wait_for_function("document.querySelector('[data-runtime-host] iframe')?.contentWindow?.__eaglerTestMessages?.some(m => m.command === 'launch')")
                configure = runtime_frame(page).evaluate("frame => frame.contentWindow.__eaglerTestMessages.find(m => m.command === 'configure')")
                options = configure['options']; spectator_id = options['netplaySpectatorId']
                assert options['netplaySpectator'] is True and options['netplaySpectatorCount'] >= 1, options
                assert options['netplayPlayerCount'] == 2 and isinstance(spectator_id,str) and len(spectator_id) >= 8, options
                query = parse_qs(urlparse(options['netplayUrl']).query)
                assert query.get('room') == ['th07mp-4321'] and query.get('run') == ['1'], query
                assert query.get('spectator') == [spectator_id] and 'player' not in query, query
                identity = page.evaluate("""id => __eaglerTestLobbyMessages.flatMap(m => m.room?.spectators || []).find(s => s.clientId === id)""", spectator_id)
                assert identity and identity['name'] == 'Watcher', identity
                assert not errors, errors
            finally:
                context.close(); setup_context.close(); browser.close()
    print('Framework spectator protocol integration: PASS real-relay=1 explicit-late-admission=1 name=1 (synthetic Runtime)')
    return 0


if __name__ == '__main__': raise SystemExit(main())
