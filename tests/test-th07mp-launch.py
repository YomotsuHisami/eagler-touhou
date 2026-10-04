"""Real TH07 WASM/RTC gate against a complete local Framework publication.

No synthetic Runtime or resource readiness is accepted. Pass an assembled site
URL (including its mount path), optionally importing real Package ZIP bytes.
"""
import argparse
import os
import time

from playwright.sync_api import sync_playwright
from support.current_ui import (suppress_notices, require_local_publication,
    open_product, runtime_frame, set_music, import_package)
from support.current_room_ui import (open_lobby, create_room, join_room,
    prepare_room, ready_room, start_room, wait_occupied, wait_runtime,
    diagnostics_report, launch_state)


def open_mp(page, url, package_zip=None):
    if package_zip:
        import_package(page, url, "th07mp", package_zip)
        assert page.locator('[data-runtime-host]').get_attribute('aria-hidden') == 'true', \
            "importing resources must not auto-launch normal TH07"
    open_product(page, url, "th07mp")
    set_music(page, "none")
    open_lobby(page, url, "th07mp")


def netplay_frame(page):
    for frame in page.frames:
        try:
            value = frame.evaluate("() => globalThis.__eaglerNetplayLanActive === true ? (globalThis.__eaglerNetplayLanFrame ?? -1) : -1")
        except Exception:
            continue
        if isinstance(value, (int, float)) and value >= 0:
            return int(value)
    return -1


def netplay_transport(page):
    for frame in page.frames:
        try:
            active = frame.evaluate("() => globalThis.__eaglerNetplayLanActive === true")
            mode = frame.evaluate("() => globalThis.__eaglerNetplayTransport ?? null")
        except Exception:
            continue
        if active and isinstance(mode, str):
            return mode
    return None


def netplay_path(page):
    for frame in page.frames:
        try:
            active = frame.evaluate("() => globalThis.__eaglerNetplayLanActive === true")
            path = frame.evaluate("() => globalThis.__eaglerNetplayPath ?? null")
        except Exception:
            continue
        if active and isinstance(path, str):
            return path
    return None


def netplay_time_sync(page):
    for frame in page.frames:
        try:
            state = frame.evaluate("""() => ({
              lead: Number.isFinite(Number(globalThis.__eaglerNetplayLanFrameAdvantage))
                ? Number(globalThis.__eaglerNetplayLanFrameAdvantage) : null,
              peers: Array.isArray(globalThis.__eaglerNetplayLanPeerAdvantages)
                ? globalThis.__eaglerNetplayLanPeerAdvantages.filter(Number.isFinite) : []
            })""")
        except Exception:
            continue
        if (isinstance(state, dict) and isinstance(state.get("lead"), (int, float))
                and state.get("peers")):
            return state
    return None



def wait_netplay_progress(pages, target=120, timeout=90):
    deadline = time.monotonic() + timeout
    last = [-1 for _ in pages]
    while time.monotonic() < deadline:
        last = [netplay_frame(page) for page in pages]
        if all(value >= target for value in last):
            return last
        time.sleep(.25)
    raise AssertionError(f"TH07MP frames did not reach {target}: {last}; "
                         f"diagnostics={[launch_state(page) for page in pages]}")


def native_peer_stats(page, player_count, local):
    """Preserve real per-peer RTC/latency evidence removed from the old HUD."""
    frame = runtime_frame(page)
    deadline = time.monotonic() + 20
    values = []
    while time.monotonic() < deadline:
        values = frame.evaluate("""async frame => {
          const runtime = frame.contentWindow, state = runtime?.__th07PeerTransport;
          if (!state?.peers) return [];
          const result = [];
          for (const [player, peer] of state.peers) {
            if (!peer.pc) continue;
            const stats = await peer.pc.getStats(); let pair = null;
            for (const item of stats.values()) {
              if (item.type === 'transport' && item.selectedCandidatePairId)
                pair = stats.get(item.selectedCandidatePairId);
            }
            if (!pair) for (const item of stats.values()) {
              if (item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) {pair = item; break;}
            }
            const candidate = pair && stats.get(pair.localCandidateId);
            result.push({player: Number(player), connected: peer.pc.connectionState === 'connected',
              inputOpen: peer.inputDc?.readyState === 'open', controlOpen: peer.controlDc?.readyState === 'open',
              rtt: pair?.currentRoundTripTime ?? null, candidate: candidate?.candidateType,
              protocol: candidate?.protocol});
          }
          return result;
        }""")
        if len(values) == player_count - 1 and all(row['connected'] and row['inputOpen'] and row['controlOpen']
                and isinstance(row['rtt'], (int, float)) and row['rtt'] >= 0 for row in values):
            break
        page.wait_for_timeout(200)
    assert sorted(row['player'] for row in values) == [i for i in range(player_count) if i != local], values
    for row in values:
        assert row['connected'] and row['inputOpen'] and row['controlOpen'], row
        assert isinstance(row['rtt'], (int, float)) and row['rtt'] >= 0, row
        assert row['candidate'] != 'relay' and row['protocol'].lower() == 'udp', row
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='complete local assembled publication URL')
    parser.add_argument('players', nargs='?', type=int, choices=(2, 3), default=2)
    parser.add_argument('--package-zip')
    parser.add_argument('--difficulty', type=int, choices=range(6), default=1)
    parser.add_argument('--mobile-seat', type=int)
    parser.add_argument('--browser-channel')
    parser.add_argument('--all-mobile', action='store_true')
    args = parser.parse_args()
    url = require_local_publication(args.url, games=('th07mp',))
    if args.mobile_seat is not None and not 0 <= args.mobile_seat < args.players:
        parser.error('--mobile-seat must identify an active player')
    if args.package_zip and not os.path.isfile(args.package_zip):
        parser.error(f'package zip not found: {args.package_zip}')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=args.browser_channel)
        contexts, pages, errors, consoles = [], [], [], []
        try:
            for index in range(args.players):
                options = {'viewport': {'width': 1280, 'height': 800}, 'service_workers': 'block'}
                if index == args.mobile_seat or args.all_mobile:
                    options.update({'is_mobile': True, 'has_touch': True,
                        'user_agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36'})
                context = browser.new_context(**options); contexts.append(context); suppress_notices(context)
                page = context.new_page(); pages.append(page); errors.append([]); consoles.append([])
                page.on('pageerror', lambda error, i=index: errors[i].append(str(error)))
                page.on('console', lambda message, i=index: consoles[i].append(f'{message.type}: {message.text}'))
                open_mp(page, url, args.package_zip)
            host = pages[0]
            code = create_room(host, 'th07mp', players=args.players, difficulty=args.difficulty)
            for index, page in enumerate(pages[1:], 1):
                join_room(page, 'th07mp', code, seat=index)
            for page in pages:
                wait_occupied(page, args.players)
                prepare_room(page)
                ready_room(page)
            start_room(host)
            for page in pages: wait_runtime(page)
            try: frames = wait_netplay_progress(pages)
            except Exception as error: raise AssertionError(f'{error}; consoles={consoles}') from error
            difficulty_state = [runtime_frame(page).evaluate("""frame => ({
              option: Number(frame.contentWindow?.Module?.eaglerOptions?.netplayDifficulty),
              requested: Number(frame.contentWindow?.__eaglerNetplayRequestedDifficulty),
              gameplay: Number(frame.contentWindow?.__eaglerNetplayGameplayDifficulty),
              stage: Number(frame.contentWindow?.__eaglerNetplayGameplayStage),
            })""") for page in pages]
            expected_stage = 7 if args.difficulty == 4 else 8 if args.difficulty == 5 else 1
            for state in difficulty_state:
                assert state == {'option': args.difficulty, 'requested': args.difficulty,
                                 'gameplay': args.difficulty, 'stage': expected_stage}, state
            transports = [netplay_transport(page) for page in pages]
            paths = [netplay_path(page) for page in pages]
            time_sync = [netplay_time_sync(page) for page in pages]
            assert transports == ['rtc'] * args.players, transports
            assert paths == ['direct'] * args.players, paths
            peers = [native_peer_stats(page, args.players, index) for index, page in enumerate(pages)]
            diagnostics = [diagnostics_report(page) for page in pages]
            for report in diagnostics:
                assert report['session']['runtimeVariant'] == 'multiplayer' and report['session']['firstFrame'], report
                net = report['network']['native']
                assert net['mode'] == 'lan' and net['active'] and net['transport'] == 'rtc' and net['path'] == 'direct', net
                assert net['frame'] >= 120 and len(net['peers']) == args.players - 1, net
                assert len(net['rtcPaths']) == args.players - 1, net
                assert all(row['path'] == 'direct' and row['protocol'].lower() == 'udp' for row in net['rtcPaths']), net
                assert all(isinstance(net[key], (int, float)) for key in ('rollback', 'resimulated', 'advantage', 'pacing')), net
            for state in time_sync:
                assert state and state['peers'], state
                assert abs(state['lead'] - max(state['peers'])) < .1, state
            assert not any(errors), errors
            print(f'TH07MP native launch: PASS room={code} difficulty={args.difficulty} '
                  f'frames={frames} peers={peers} time_sync={time_sync}')
        finally:
            for context in contexts: context.close()
            browser.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
