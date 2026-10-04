"""Real TH09 WASM/relay/frame/title/touch/spectator acceptance.

Requires --url (or EAGLER_NATIVE_SITE_URL) pointing at a complete local
Framework publication with immutable Runtime Manifest and verified packages.
--package-zip imports genuine game resources through the current React review.
No native Runtime, relay, touch, hash or frame assertion is simulated.
"""
from __future__ import annotations
import argparse
import os
import socket
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright
from support.current_ui import (require_local_publication, suppress_notices,
    open_product, set_music, import_package, prepare_game, start_prepared)
from support.current_room_ui import (open_lobby, create_room, join_room, room,
    room_code, prepare_room, ready_room, start_room, wait_occupied, wait_runtime, launch_state)
PROJECT = Path(__file__).resolve().parents[1]
FRAME_TARGET = 120


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0)); return int(sock.getsockname()[1])


def wait_relay(process, port):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None: raise RuntimeError(f'Relay exited: {process.returncode}')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.25): return
        except OSError: time.sleep(.05)
    raise RuntimeError('Relay did not start')


def netplay_state(page) -> dict | None:
    for frame in page.frames:
        try:
            state = frame.evaluate("""() => {
              const core = globalThis.__th09Runtime?.core;
              const options = core?.eaglerOptions || globalThis.Module?.eaglerOptions || null;
              return {
                active: globalThis.__eaglerNetplayLanActive === true,
                frame: Number(globalThis.__eaglerNetplayLanFrame ?? -1),
                error: String(document.querySelector('#error')?.textContent || ''),
                mode: options?.netplayMode ?? null,
                player: Number(options?.netplayPlayer ?? -1),
                url: String(options?.netplayUrl || ''),
              };
            }""")
        except Exception:
            continue
        if isinstance(state, dict) and (state.get("mode") == "lan" or state.get("active")):
            return state
    return None


def runtime_hash_capture(page, start: bool) -> dict | bool:
    for frame in page.frames:
        try:
            value = frame.evaluate("""start => {
              const runtime = globalThis.__th09Runtime;
              if (!runtime?.core?._th09_network_hash) return null;
              if (start) {
                const hashes = globalThis.__th09SpectatorTestHashes = {};
                setInterval(() => {
                  const frame = Number(globalThis.__eaglerNetplayLanFrame ?? -1);
                  if (frame > 0 && hashes[frame] === undefined)
                    hashes[frame] = runtime.core._th09_network_hash() >>> 0;
                }, 4);
                return true;
              }
              return globalThis.__th09SpectatorTestHashes || {};
            }""", start)
            if value is not None:
                return value
        except Exception:
            continue
    raise RuntimeError("TH09 Runtime frame not found for state hash capture")


def title_status(page) -> list | None:
    """Read TH09's title state: [frames, in_title, screen, state, selection, ...]."""
    for frame in page.frames:
        try:
            values = frame.evaluate("""() => {
              const core = globalThis.__th09Runtime?.core;
              if (!core) return null;
              const at = core._th09_title_status() / 4;
              return Array.from(core.HEAP32.subarray(at, at + 8));
            }""")
        except Exception:
            continue
        if isinstance(values, list) and len(values) == 8:
            return values
    return None


def wait_title(page, predicate, timeout: float, what: str) -> list:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = title_status(page)
        if last and predicate(last):
            return last
        page.wait_for_timeout(200)
    raise RuntimeError(f"TH09 title never reached {what}: last={last}")


def tap_key(page, key: str, hold_ms: int = 50) -> None:
    """Press a game key long enough for the Runtime's frame-sampled input.

    The Launcher forwards keydown/keyup to the Runtime; TH09 samples held keys
    once per frame, so an instantaneous synthetic press would be missed. The
    Runtime document owns focus while a game runs, so the press is handled there.
    """
    page.keyboard.down(key)
    page.wait_for_timeout(hold_ms)
    page.keyboard.up(key)
    page.wait_for_timeout(140)


def move_selection_to(page, target: int, timeout: float = 20.0) -> list:
    """Walk a title menu to `target`, correcting for held-key auto-repeat."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = title_status(page)
        if last[4] == target:
            return last
        tap_key(page, "ArrowUp" if last[4] > target else "ArrowDown")
    raise RuntimeError(f"TH09 title menu never reached selection {target}: {last}")


def select_room_music(page, requested=None):
    select = page.get_by_label('Background music', exact=True)
    select.wait_for(state='visible')
    values = select.evaluate('element => [...element.options].map(option => option.value)')
    mode = requested or ('ogg-stream' if 'ogg-stream' in values else 'none')
    assert mode in values, (mode, values)
    set_music(page, mode)
    return mode


def title_network_entry(page, url, music_modes, requested_music=None):
    """Require TH09's real title/versus native request before React room entry."""
    open_product(page, url, 'th09')
    music_modes.append(select_room_music(page, requested_music))
    prepare_game(page, 'th09'); start_prepared(page, 'th09'); wait_runtime(page)
    deadline = time.time() + 120
    while time.time() < deadline:
        state = title_status(page)
        if state and state[1] == 1 and state[2] == 1 and state[3] == 1: break
        tap_key(page, 'KeyZ')
    else: raise RuntimeError(f'TH09 title never reached main menu: {title_status(page)}')
    move_selection_to(page, 2); tap_key(page, 'KeyZ')
    wait_title(page, lambda state: state[2] == 6, 30, 'versus-type screen')
    move_selection_to(page, 4); tap_key(page, 'KeyZ')
    dialog = page.get_by_role('dialog', name='Phantasmagoria of Flower View · Versus', exact=True)
    dialog.wait_for(state='visible', timeout=30000)
    dialog.get_by_role('button', name='Create room', exact=True).click()
    return room_code(page)


def touch_probe(page) -> list | None:
    """Local side touch diagnostics: position, velocity and applied motion sample."""
    for frame in page.frames:
        try:
            values = frame.evaluate("""() => {
              const core = globalThis.__th09Runtime?.core;
              if (!core || typeof core._th09_touch_probe !== 'function') return null;
              const at = core._th09_touch_probe() / 4;
              const words = core.HEAPU32.subarray(at, at + 8);
              const buffer = new ArrayBuffer(4), view = new DataView(buffer);
              return Array.from(words, word => { view.setUint32(0, word, true); return view.getFloat32(0, true); });
            }""")
        except Exception:
            continue
        if isinstance(values, list) and len(values) == 8:
            return values
    return None


def point_touch(page, touch_type: int, x: float, y: float) -> None:
    """Deliver one pointer sample to the Runtime's own touch surface."""
    for frame in page.frames:
        try:
            handled = frame.evaluate("""(args) => {
              const core = globalThis.__th09Runtime?.core;
              if (!core) return false;
              core._th09_touch(args.type, 1, args.x, args.y);
              return true;
            }""", {"type": touch_type, "x": x, "y": y})
        except Exception:
            continue
        if handled:
            return
    raise RuntimeError(f"TH09 Runtime is not running; launcher state: {launch_state(page)}")


def assert_touch_converges(page, frames: int = 120) -> dict:
    """Drag the Runtime's own touch surface and require it to reach the finger.

    A networked gesture travels with the lockstep input delay. When it is shipped
    as a velocity sampled from the sender's position, the player aims from a
    position `lead` frames in the future and orbits the finger forever; the
    shipped absolute target must settle exactly on it instead.
    """
    for frame in page.frames:
        try:
            frame.evaluate("() => globalThis.__th09Runtime?.core?._th09_touch_options(1, 0, 1, 0, 0)")
        except Exception:
            continue
    start = touch_probe(page)
    assert start, f"touch probe never reported a position; launcher state: {launch_state(page)}"
    start_x, start_y = start[0], start[1]
    # Touch coordinates are normalised over the Runtime canvas; the shared touch
    # controller maps a normalised delta to 640x480 field units.
    drag_x, drag_y = 0.2, 0.1
    point_touch(page, 0, 0.5, 0.5)
    page.wait_for_timeout(120)
    point_touch(page, 1, 0.5 + drag_x, 0.5 + drag_y)
    trail = []
    for _ in range(frames):
        page.wait_for_timeout(16)
        state = touch_probe(page)
        if state:
            trail.append((state[0], state[1]))
    settled = touch_probe(page)
    point_touch(page, 2, 0.5 + drag_x, 0.5 + drag_y)
    assert trail, "touch probe never reported a position while dragging"
    moved = ((trail[-1][0] - start_x) ** 2 + (trail[-1][1] - start_y) ** 2) ** 0.5
    # A converged gesture stops moving; an orbiting one keeps drawing a circle.
    tail = trail[len(trail) * 2 // 3:]
    path = sum(((tail[i + 1][0] - tail[i][0]) ** 2 + (tail[i + 1][1] - tail[i][1]) ** 2) ** 0.5
               for i in range(len(tail) - 1))
    assert moved > 60, (f"touch drag barely moved the player: moved={moved:.1f} "
                        f"start=({start_x:.1f},{start_y:.1f}) first={trail[:3]}")
    assert settled and settled[5] == 1, f"networked touch must ship an absolute target, got {settled}"
    distance = ((trail[-1][0] - settled[6]) ** 2 + (trail[-1][1] - settled[7]) ** 2) ** 0.5
    assert distance < 10, (
        f"touch drag did not reach the finger: start=({start_x:.1f},{start_y:.1f}) "
        f"target=({settled[6]:.1f},{settled[7]:.1f}) end=({trail[-1][0]:.1f},{trail[-1][1]:.1f}) "
        f"distance={distance:.1f} tail_path={path:.1f} samples={len(trail)}")
    assert path < 12, f"touch drag kept circling after reaching the finger: tail_path={path:.1f} tail={tail}"
    return {"start": (round(start_x, 1), round(start_y, 1)),
            "target": (round(settled[6], 1), round(settled[7], 1)),
            "end": (round(trail[-1][0], 1), round(trail[-1][1], 1)),
            "distance": round(distance, 2), "tail_path": round(path, 2)}


def wait_netplay(pages, target=FRAME_TARGET, timeout=180):
    deadline, last = time.time() + timeout, []
    while time.time() < deadline:
        last = [netplay_state(page) for page in pages]
        if all(state and state['active'] and state['frame'] >= target for state in last): return last
        time.sleep(.25)
    raise RuntimeError(f'TH09 netplay did not reach {target}: {last}; {[launch_state(page) for page in pages]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.environ.get('EAGLER_NATIVE_SITE_URL'))
    parser.add_argument('--package-zip')
    parser.add_argument('--music', choices=('ogg-stream', 'none'))
    parser.add_argument('--host-entry', choices=('card', 'title'), default='card')
    parser.add_argument('--touch-check', action='store_true')
    parser.add_argument('--spectator-check', action='store_true')
    args = parser.parse_args()
    if not args.url: parser.error('--url or EAGLER_NATIVE_SITE_URL is required')
    if args.package_zip and not Path(args.package_zip).is_file(): parser.error('Package ZIP does not exist')
    port = free_port(); relay_url = f'ws://127.0.0.1:{port}/'
    url = require_local_publication(args.url, games=('th09', 'th09mp'), relay_override=relay_url)
    env = dict(os.environ, TH07_RELAY_HOST='127.0.0.1', TH07_RELAY_PORT=str(port),
               TH07_STUN_URLS='', TH07_RTC_TIMEOUT_MS='1000')
    relay = subprocess.Popen(['node', 'server/netplay-relay.mjs'], cwd=PROJECT,
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_relay(relay, port)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            contexts, pages, errors, music_modes = [], [], [], []
            try:
                for index in range(3 if args.spectator_check else 2):
                    context = browser.new_context(viewport={'width':1280,'height':900}, service_workers='block')
                    contexts.append(context); suppress_notices(context)
                    def manifest_route(route):
                        response = route.fetch(); assert response.ok
                        manifest = response.json(); manifest['shared']['netplayRelay'] = relay_url
                        route.fulfill(response=response, json=manifest)
                    context.route('**/host-manifest.json*', manifest_route)
                    page = context.new_page(); pages.append(page)
                    page.on('pageerror', lambda error, i=index: errors.append(f'P{i}: {error}'))
                    if args.package_zip: import_package(page, url, 'th09mp', args.package_zip)
                    open_product(page, url, 'th09mp')
                    music_modes.append(select_room_music(page, args.music))
                    open_lobby(page, url, 'th09mp')
                host, guest = pages[:2]; viewer = pages[2] if args.spectator_check else None
                code = (title_network_entry(host, url, music_modes, args.music) if args.host_entry == 'title'
                        else create_room(host, 'th09mp'))
                assert len(code) == 4 and code.isdigit(), code
                join_room(guest, 'th09mp', code, seat=1)
                if viewer:
                    join_room(viewer, 'th09mp', code)
                    room(viewer).get_by_role('button', name='Join as spectator', exact=True).click()
                    room(viewer).get_by_role('button', name='Stop spectating', exact=True).wait_for(state='visible')
                for page in pages[:2]:
                    wait_occupied(page, 2); prepare_room(page); ready_room(page)
                start_room(host)
                for page in pages: wait_runtime(page)
                states = wait_netplay(pages)
                assert sorted(state['player'] for state in states[:2]) == [0,1], states
                if viewer:
                    assert states[2]['frame'] >= FRAME_TARGET and 'spectator=' in states[2]['url'], states
                    for page in pages: runtime_hash_capture(page, True)
                    time.sleep(3)
                    hashes = [runtime_hash_capture(page, False) for page in pages]
                    common = set(hashes[0]).intersection(hashes[1], hashes[2])
                    assert len(common) >= 15, [len(item) for item in hashes]
                    mismatched = [frame for frame in common if len({item[frame] for item in hashes}) != 1]
                    assert not mismatched, {frame:[item[frame] for item in hashes] for frame in mismatched[:5]}
                assert all(f'room=th09mp-{code}' in state['url'] for state in states), states
                touch = assert_touch_converges(host) if args.touch_check else None
                assert not errors, errors
                print(f'TH09MP native launch: PASS room={code} host-entry={args.host_entry} '
                      f'music={sorted(set(music_modes))} frames={[s["frame"] for s in states]} '
                      f'spectator={bool(viewer)} touch={touch}')
            finally:
                for context in contexts: context.close()
                browser.close()
    finally:
        relay.terminate()
        try: relay.wait(timeout=5)
        except subprocess.TimeoutExpired: relay.kill(); relay.wait(timeout=5)


if __name__ == '__main__': main()
