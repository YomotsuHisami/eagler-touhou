"""Current Framework UI with real relay membership, ownership and refresh.

Retired drawer/layout assertions are replaced by current accessible room panels.
This is a live-relay browser lane; synthetic component snapshots do not replace it.
"""
import argparse
import re
from playwright.sync_api import sync_playwright, expect
from support.current_ui import require_local_publication, suppress_notices, open_current, open_product, set_music
from support.current_room_ui import (room, room_code, open_lobby, create_room,
    room_panel, close_room_panel, wait_local_seat, prepare_room, ready_room)


def session(page, product):
    return page.evaluate("product => JSON.parse(sessionStorage.getItem(`eagler-touhou-${product}-room-v1`) || 'null')", product)


def leave_room(page):
    room(page).get_by_role('button', name='← Back to lobby', exact=True).click()
    expect(room(page)).to_have_count(0)
    assert 'mpRoom=' not in page.url
    expect(page.get_by_role('button', name='Enter room code', exact=True)).to_be_visible()


def stand_up(page):
    panel = room_panel(page, 'Personal settings / Loadout')
    panel.get_by_role('button', name='Leave player seat', exact=True).click()
    expect(panel.get_by_role('button', name='Leave player seat', exact=True)).to_be_disabled()
    close_room_panel(page, panel)
    expect(room(page).get_by_role('button', name='Ready', exact=True)).to_be_disabled()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='complete local publication with TH06/TH07 and configured relay')
    args = parser.parse_args()
    url = require_local_publication(args.url, games=('th06mp', 'th07mp'))
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        contexts = []
        try:
            def endpoint(width=1280, height=800):
                context = browser.new_context(viewport={'width': width, 'height': height}, service_workers='block')
                contexts.append(context); suppress_notices(context)
                page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
                return page
            page = endpoint()
            for product, title in [('th06mp', '東方紅魔郷'), ('th07mp', '東方妖々夢')]:
                open_product(page, url, product)
                expect(page.get_by_role('heading', name=title, exact=True)).to_be_visible()
                expect(page.get_by_role('form', name='Game settings', exact=True)).to_be_visible()
                expect(page.get_by_label('Share single-player settings', exact=True)).to_be_visible()
                for label in ('Resource manager', 'Replay', 'Save'):
                    expect(page.get_by_role('navigation', name='Game management', exact=True).get_by_role('link', name=label, exact=True)).to_be_visible()
                set_music(page, 'none')
            open_lobby(page, url, 'th06mp')
            code06 = create_room(page, 'th06mp')
            wait_local_seat(page, 0)
            assert session(page, 'th06mp')['room']['code'] == code06
            assert session(page, 'th07mp') is None
            panel = room_panel(page, 'Personal settings / Loadout')
            panel.get_by_role('button', name='Game / Touch settings', exact=True).click()
            expect(page.get_by_role('form', name='Game settings', exact=True)).to_be_visible()
            assert room_code(page) == code06
            page.keyboard.press('Escape')
            expect(page.get_by_role('dialog', name='Game / Touch settings', exact=True)).to_have_count(0)
            assert room_code(page) == code06
            panel = room_panel(page, 'Room / Difficulty settings')
            assert panel.get_by_label('Difficulty', exact=True).locator('option').count() == 5
            assert panel.get_by_label('Difficulty', exact=True).locator('option[value="5"]').count() == 0
            close_room_panel(page, panel)

            # Supported explicit create intent with identical digits proves the
            # namespace at the real relay, without old implicit join-as-create.
            other = endpoint(960, 720)
            open_current(other, url, 'play/th07mp', mpRoom=code06, room=code06,
                         fromLobby=1, lobbyAction='create', lobbyPlayers=2,
                         lobbyDifficulty=1, lobbyVisibility='private')
            assert room_code(other) == code06
            wait_local_seat(other, 0)
            wait_local_seat(page, 0)
            assert session(other, 'th07mp')['room']['code'] == code06
            assert session(other, 'th06mp') is None
            leave_room(other)
            leave_room(page)
            assert session(page, 'th06mp') is None

            open_lobby(page, url, 'th07mp')
            code = create_room(page, 'th07mp')
            assert 'mpRoom=' in page.url
            expect(page.locator('[data-library-stage]')).to_be_hidden()
            panel = room_panel(page, 'Personal settings / Loadout')
            panel.get_by_label('Loadout', exact=True).select_option('3')
            expect(panel.get_by_label('Loadout', exact=True)).to_have_value('3')
            close_room_panel(page, panel)
            expect(room(page).get_by_role('article').nth(0)).to_contain_text('Marisa B')
            prepare_room(page)
            stand_up(page)
            panel = room_panel(page, 'Room / Difficulty settings')
            expect(panel.get_by_label('Players', exact=True)).to_be_disabled()
            close_room_panel(page, panel)
            room(page).get_by_role('button', name='Join P2', exact=True).click()
            wait_local_seat(page, 1)
            ready_room(page)
            stand_up(page)
            room(page).get_by_role('button', name='Join P1', exact=True).click()
            wait_local_seat(page, 0)
            expect(room(page).get_by_role('button', name='Ready', exact=True)).to_be_enabled()
            ready_room(page)
            panel = room_panel(page, 'Room / Difficulty settings')
            panel.get_by_label('Players', exact=True).select_option('3')
            expect(panel.get_by_label('Players', exact=True)).to_have_value('3')
            panel.get_by_label('Difficulty', exact=True).select_option('5')
            expect(panel.get_by_label('Difficulty', exact=True)).to_have_value('5')
            close_room_panel(page, panel)
            expect(room(page).get_by_role('article')).to_have_count(3)
            expect(room(page).get_by_role('button', name='Ready', exact=True)).to_be_enabled()
            ready_room(page)
            page.reload(wait_until='load')
            assert room_code(page) == code
            wait_local_seat(page, 0)
            panel = room_panel(page, 'Room / Difficulty settings')
            expect(panel.get_by_label('Players', exact=True)).to_have_value('3')
            expect(panel.get_by_label('Difficulty', exact=True)).to_have_value('5')
            close_room_panel(page, panel)
            saved = session(page, 'th07mp')
            assert saved['seat'] == 0 and saved['room']['playerCount'] == 3 and saved['room']['difficulty'] == 5, saved
            leave_room(page)
            assert session(page, 'th07mp') is None
            # Return destination is now the real lobby. A new room adds a real
            # Router history entry; Back leaves and releases its membership.
            create_room(page, 'th07mp')
            page.go_back(wait_until='load')
            expect(room(page)).to_have_count(0)
            assert 'mpRoom=' not in page.url

            mobile = endpoint(390, 844)
            open_lobby(mobile, url, 'th07mp')
            mobile_code = create_room(mobile, 'th07mp')
            expect(room(mobile).get_by_role('article')).to_have_count(2)
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
            room(mobile).get_by_role('button', name=re.compile(rf'Room code\s*{mobile_code}\s*Copy')).click()
            expect(room(mobile).get_by_role('status').filter(has_text=re.compile('Room code copied|Could not copy automatically'))).to_be_visible()
            stand_up(mobile)
            expect(room(mobile).get_by_role('button', name='Start game', exact=True)).to_have_count(0)
            expect(room(mobile).get_by_role('button', name='Waiting for host', exact=True)).to_be_disabled()
            leave_room(mobile)
            open_product(mobile, url, 'th07mp')
            expect(mobile.get_by_label('Enable touch controls', exact=True)).to_be_visible()
            mobile.get_by_role('button', name='Edit button layout', exact=True).click()
            expect(mobile.get_by_role('dialog', name='Button layout', exact=True)).to_be_visible()
            assert not errors, errors
            print('TH07MP Framework live-relay UI: PASS namespaces=1 seats=1 owner=1 refresh=1 panels=1 mobile=1')
        finally:
            for context in contexts: context.close()
            browser.close()
    return 0


if __name__ == '__main__': raise SystemExit(main())
