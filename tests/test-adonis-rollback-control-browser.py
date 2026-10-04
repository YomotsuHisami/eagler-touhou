"""Current React publication + local Relay room controls; no native gameplay claim.

Requires an explicitly assembled loopback publication. This lane exercises real
room membership and semantic controls but never prepares or starts a Runtime.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import socket
import subprocess
import time
import traceback
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import expect, sync_playwright

from support.current_ui import current_url, require_local_publication, runtime_frame, suppress_notices
from support.current_room_ui import close_room_panel, room, room_panel, wait_local_seat

ROOT = Path(__file__).resolve().parents[1]
NETWORK = 'Network diagnostics / Input timing'
ROLLBACK = 'Enable rollback (keep the manual input delay)'


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return int(sock.getsockname()[1])


def wait_relay(process, port: int, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Relay exited early: {process.returncode}')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.25):
                return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError('Local Relay did not start')


def stop(process) -> None:
    if process is None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def controls(dialog, *, chinese=False):
    return (dialog.get_by_role('combobox', name='输入延迟' if chinese else 'Input delay', exact=True),
            dialog.get_by_role('checkbox', name='启用回滚（手动输入延迟保持不变）' if chinese else ROLLBACK, exact=True))


def wait_connected(page, *, chinese=False):
    root = page.locator('section[aria-label="联机房间"]') if chinese else room(page)
    expect(root.get_by_role('status').filter(has_text=re.compile('^已连接$' if chinese else '^Connected$'))).to_be_visible(timeout=60000)
    return root


def main(default_game: str | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', nargs='?', help='Compatibility alias for --url')
    parser.add_argument('--url', dest='publication_url', help='Loopback URL of an assembled current React publication')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--game', choices=['th08', 'th09', 'th10'], required=default_game is None, default=default_game)
    args = parser.parse_args()
    if args.url and args.publication_url and args.url != args.publication_url:
        parser.error('Specify the publication URL only once')
    base = args.publication_url or args.url
    if not base:
        parser.error('An explicit assembled publication --url is required; development metadata is not supported')
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'passed': False, 'scope': __doc__, 'game': args.game, 'errors': [], 'layouts': [],
              'contract': 'Host-only checkbox and input-delay controls in the current network dialog'}
    relay = None
    try:
        publication = require_local_publication(base, [args.game + 'mp'])
        base = publication['base']
        manifest = publication['host']
        port = free_port()
        with (args.output / 'relay.log').open('w', encoding='utf-8') as log:
            relay = subprocess.Popen(['node', 'server/netplay-relay.mjs'], cwd=ROOT,
                env={**os.environ, 'EAGLER_NETPLAY_RELAY_HOST': '127.0.0.1',
                     'EAGLER_NETPLAY_RELAY_PORT': str(port), 'EAGLER_NETPLAY_STUN_URLS': ''},
                stdout=log, stderr=subprocess.STDOUT)
            try:
                wait_relay(relay, port)
                # Only the transport endpoint is overridden. Host/package/Runtime
                # metadata remains the actual assembled publication's contract.
                manifest['shared']['netplayRelay'] = f'ws://127.0.0.1:{port}/'
                with sync_playwright() as pw:
                    browser = pw.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader', '--disable-features=LocalNetworkAccessChecks'])
                    try:
                        def context(viewport=None):
                            result = browser.new_context(service_workers='block', viewport=viewport or {'width': 1280, 'height': 850})
                            suppress_notices(result)
                            result.route(urljoin(base, 'host-manifest.json') + '*', lambda route: route.fulfill(status=200,
                                content_type='application/json', body=json.dumps(manifest)))
                            return result

                        host_context = context()
                        page = host_context.new_page()
                        page.on('pageerror', lambda error: report['errors'].append({'role': 'host', 'message': str(error)}))
                        code = str(secrets.randbelow(9000) + 1000)
                        create_url = lambda value: current_url(base, f'play/{args.game}mp', mpRoom=value,
                            fromLobby=1, lobbyAction='create', lobbyPlayers=2, lobbyDifficulty=1)
                        page.goto(create_url(code), wait_until='load')
                        wait_connected(page)
                        wait_local_seat(page, 0)
                        dialog = room_panel(page, NETWORK)
                        delay, toggle = controls(dialog)
                        expect(toggle).to_be_enabled()
                        expect(toggle).not_to_be_checked()
                        expect(delay).to_have_value('auto')
                        expect(delay.locator('option[value="auto"]')).to_have_text('Measured by Runtime at launch')
                        chosen_delay = '9' if args.game == 'th09' else '8'
                        delay.select_option(chosen_delay)
                        toggle.check()
                        expect(toggle).to_be_checked()
                        expect(delay).to_have_value(chosen_delay)
                        toggle.focus()
                        page.keyboard.press('Space')
                        expect(toggle).not_to_be_checked()
                        expect(delay).to_have_value(chosen_delay)  # Rollback never rewrites D.
                        close_room_panel(page, dialog)
                        # Reopening uses current values, not a reset view-local draft.
                        dialog = room_panel(page, NETWORK)
                        delay, toggle = controls(dialog)
                        expect(delay).to_have_value(chosen_delay)
                        expect(toggle).not_to_be_checked()
                        close_room_panel(page, dialog)

                        guest_context = context()
                        guest = guest_context.new_page()
                        guest.on('pageerror', lambda error: report['errors'].append({'role': 'guest', 'message': str(error)}))
                        guest.goto(current_url(base, f'play/{args.game}mp', mpRoom=code, fromLobby=1, lobbyAction='join'), wait_until='load')
                        wait_connected(guest)
                        wait_local_seat(guest, 1)
                        guest_dialog = room_panel(guest, NETWORK)
                        guest_delay, guest_toggle = controls(guest_dialog)
                        # React exposes read-only controls, unlike the retired hidden
                        # switch. The real fieldset must deny both guest mutations.
                        expect(guest_delay).to_be_visible()
                        expect(guest_delay).to_be_disabled()
                        expect(guest_toggle).to_be_visible()
                        expect(guest_toggle).to_be_disabled()
                        expect(runtime_frame(guest)).not_to_have_attribute('src', re.compile('.+'))
                        guest_context.close()

                        for width, height in ((1280, 850), (960, 720), (390, 844), (320, 740)):
                            page.set_viewport_size({'width': width, 'height': height})
                            dialog = room_panel(page, NETWORK)
                            delay, toggle = controls(dialog)
                            delay.select_option('auto')
                            # A native checkbox's associated label is its clickable
                            # target; assert the real 44px target, not the tiny glyph.
                            label = toggle.locator('xpath=..')
                            label.scroll_into_view_if_needed()
                            geometry = label.evaluate("""label => {
                              const rect = element => {const r = element.getBoundingClientRect();
                                return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
                              return {label:rect(label),control:rect(label.querySelector('input')),
                                viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth};
                            }""")
                            report['layouts'].append(geometry)
                            assert geometry['label']['height'] >= 44, geometry
                            assert geometry['label']['x'] >= 0 and geometry['label']['right'] <= width + 1, geometry
                            assert geometry['scrollWidth'] <= width + 1, geometry
                            label.screenshot(path=str(args.output / f'controls-{width}.png'))
                            delay.scroll_into_view_if_needed()
                            bounds = delay.bounding_box()
                            assert bounds and bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width + 1, bounds
                            delay.locator('xpath=..').screenshot(path=str(args.output / f'input-delay-{width}.png'))
                            close_room_panel(page, dialog)
                        room(page).screenshot(path=str(args.output / 'room-mobile-en.png'))

                        # Explicit locale routes are public navigation. A reload must
                        # reconnect the actual room; no hidden select is force-clicked.
                        page.goto(current_url(base, f'play/{args.game}mp', mpRoom=code, uiLocale='zh-CN'), wait_until='load')
                        chinese_room = wait_connected(page, chinese=True)
                        chinese_room.get_by_role('button', name='网络检测 / 输入时序', exact=True).click()
                        chinese_dialog = page.get_by_role('dialog', name='网络检测 / 输入时序', exact=True)
                        chinese_delay, chinese_toggle = controls(chinese_dialog, chinese=True)
                        expect(chinese_toggle).to_be_enabled()
                        expect(chinese_delay.locator('option[value="auto"]')).to_have_text('开局由 Runtime 实测决定')
                        chinese_dialog.screenshot(path=str(args.output / 'network-320-zh.png'))
                        chinese_dialog.get_by_role('button', name='关闭', exact=True).click()
                        expect(chinese_dialog).to_be_hidden()
                        page.goto(current_url(base, f'play/{args.game}mp', mpRoom=code), wait_until='load')
                        wait_connected(page)
                        wait_local_seat(page, 0)
                        page.set_viewport_size({'width': 1280, 'height': 850})
                        room(page).screenshot(path=str(args.output / 'room-desktop.png'))
                        dialog = room_panel(page, NETWORK)
                        delay, toggle = controls(dialog)
                        delay.select_option(chosen_delay)
                        toggle.check()
                        expect(toggle).to_be_checked()
                        close_room_panel(page, dialog)
                        room(page).get_by_role('button', name='← Back to lobby', exact=True).click()
                        page.wait_for_url(lambda url: urlsplit(url).path.rstrip('/').endswith('/lobby'))
                        fresh_code = str(secrets.randbelow(9000) + 1000)
                        while fresh_code == code:
                            fresh_code = str(secrets.randbelow(9000) + 1000)
                        page.goto(create_url(fresh_code), wait_until='load')
                        wait_connected(page)
                        wait_local_seat(page, 0)
                        dialog = room_panel(page, NETWORK)
                        delay, toggle = controls(dialog)
                        expect(toggle).to_be_enabled()
                        expect(toggle).not_to_be_checked()  # New rooms reset rollback.
                        expect(delay).to_have_value('auto')
                        expect(runtime_frame(page)).not_to_have_attribute('src', re.compile('.+'))
                        assert not report['errors'], report['errors']
                        report['passed'] = True
                    finally:
                        browser.close()
            finally:
                stop(relay)
                relay = None
    except BaseException as error:
        report['error'] = repr(error)
        report['traceback'] = traceback.format_exc()
        raise
    finally:
        stop(relay)
        (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(args.game, 'React rollback checkbox, keyboard, fixed D, guest restriction and responsive placement: PASS')


if __name__ == '__main__':
    main()
