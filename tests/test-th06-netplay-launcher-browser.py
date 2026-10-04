"""Native TH06 relay/hash gate on a complete local Framework publication."""
from __future__ import annotations
import argparse
import os
import socket
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current_ui import suppress_notices, require_local_publication, open_product, set_music, runtime_url
from support.current_room_ui import (open_lobby, create_room, join_room, prepare_room,
    ready_room, start_room, wait_occupied, wait_runtime)
PROJECT = Path(__file__).resolve().parents[1]
RELAY_SCRIPT = PROJECT / 'server' / 'netplay-relay.mjs'


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_relay(process: subprocess.Popen[str], timeout: float = 10.0) -> None:
    assert process.stdout is not None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = process.stdout.readline()
        if line:
            print(f"RELAY {line.rstrip()}")
            if "LAN relay listening" in line:
                return
        elif process.poll() is not None:
            raise RuntimeError(f"relay exited early: {process.returncode}")
        else:
            time.sleep(0.05)
    raise RuntimeError("relay did not start")


def snapshot(page, target_frame: int) -> dict:
    value = page.evaluate(
        """target => {
          const frame = document.querySelector('[data-runtime-host] iframe');
          const runtime = frame?.contentWindow;
          const hash = runtime?.__eaglerNetplayLanHashes?.[String(target)] || '';
          return {
            active: runtime?.__eaglerNetplayLanActive === true,
            frame: Number(runtime?.__eaglerNetplayLanFrame || 0),
            confirmed: Number(runtime?.__eaglerNetplayLanConfirmed ?? -1),
            transport: String(runtime?.__eaglerNetplayTransport || ''),
            failed: runtime?.__eaglerNetplayFailed === true,
            error: String(runtime?.__eaglerNetplayError || ''),
            build: String(runtime?.__eaglerNetplayRuntimeBuild || ''),
            mode: String(runtime?.Module?.eaglerOptions?.netplayMode || ''),
            player: Number(runtime?.Module?.eaglerOptions?.netplayPlayer ?? -1),
            players: Number(runtime?.Module?.eaglerOptions?.netplayPlayerCount ?? -1),
            difficulty: Number(runtime?.Module?.eaglerOptions?.netplayDifficulty ?? -1),
            hash: String(hash),
          };
        }""",
        target_frame,
    )
    value['frameSrc'] = runtime_url(page)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.environ.get('EAGLER_NATIVE_SITE_URL'),
                        help='local assembled publication URL, or EAGLER_NATIVE_SITE_URL')
    args = parser.parse_args()
    if not args.url: parser.error('--url or EAGLER_NATIVE_SITE_URL is required; raw development Runtime discovery is unsupported')
    relay_port = free_port()
    relay_url = f'ws://127.0.0.1:{relay_port}/'
    url = require_local_publication(args.url, games=('th06mp',), relay_override=relay_url)
    env = os.environ.copy()
    env.update({'TH07_RELAY_HOST': '127.0.0.1', 'TH07_RELAY_PORT': str(relay_port),
        'TH07_RTC_TIMEOUT_MS': '1000', 'TH07_STUN_URLS': '',
        'TH07_RELAY_DELAY_MS': '25', 'TH07_RELAY_JITTER_MS': '5'})
    relay = subprocess.Popen(['node', str(RELAY_SCRIPT)], cwd=PROJECT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    browsers = []
    try:
        wait_relay(relay)
        with sync_playwright() as pw:
            pages, failures = [], ['', '']
            for index in range(2):
                browser = pw.chromium.launch(headless=True, args=['--autoplay-policy=no-user-gesture-required',
                    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'])
                browsers.append(browser)
                context = browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
                suppress_notices(context)
                def manifest_route(route):
                    response = route.fetch()
                    assert response.ok, 'assembled Host manifest unavailable'
                    manifest = response.json(); manifest['shared']['netplayRelay'] = relay_url
                    route.fulfill(response=response, json=manifest)
                context.route('**/host-manifest.json*', manifest_route)
                # Use the production native WS fallback, never a synthetic peer.
                context.add_init_script('delete globalThis.RTCPeerConnection')
                page = context.new_page(); pages.append(page)
                page.on('pageerror', lambda error, i=index: failures.__setitem__(i, f'pageerror: {error}'))
                open_product(page, url, 'th06mp'); set_music(page, 'none'); open_lobby(page, url, 'th06mp')
            p1, p2 = pages
            code = create_room(p1, 'th06mp')
            join_room(p2, 'th06mp', code, seat=1)
            for page in pages:
                wait_occupied(page, 2); prepare_room(page); ready_room(page)
            start_room(p1)
            for page in pages: wait_runtime(page)
            target_frame, deadline, values = 300, time.time() + 90, None
            while time.time() < deadline:
                values = [snapshot(page, target_frame) for page in pages]
                if any(failures) or any(value['failed'] for value in values): break
                if all(value['active'] and value['frame'] >= target_frame and
                       value['confirmed'] >= target_frame - 1 and value['hash'] for value in values): break
                time.sleep(.1)
            values = values or [snapshot(page, target_frame) for page in pages]
            assert not any(failures), failures
            assert not any(value['failed'] for value in values), values
            assert all(value['active'] and value['frame'] >= target_frame and
                       value['confirmed'] >= target_frame - 1 and value['hash'] for value in values), values
            assert len({value['hash'] for value in values}) == 1, values
            for index, value in enumerate(values):
                assert '/runtime/th06/multiplayer/' in value['frameSrc'] and '/th06.html' in value['frameSrc'], value
                assert value['mode'] == 'lan' and value['player'] == index and value['players'] == 2, value
                assert 0 <= value['difficulty'] <= 4, value
                assert value['transport'] == 'relay', value
                assert value['build'].startswith('th06mp-'), value
            print(f"TH06 Framework native relay: PASS room={code} frame={target_frame} "
                  f"hash={values[0]['hash']} frames={[value['frame'] for value in values]}")
    finally:
        for browser in browsers: browser.close()
        relay.terminate()
        try: relay.wait(timeout=5)
        except subprocess.TimeoutExpired: relay.kill(); relay.wait(timeout=5)


if __name__ == '__main__': main()
