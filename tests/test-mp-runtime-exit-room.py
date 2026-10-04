"""Current Check game preflight, room retention and Runtime exit boundaries.

Default: sealed synthetic protocol plus real loopback relay. The check waits for
an explicit fixture first-frame and covers stale/current exit and cancellation;
a separate two-player launch covers launched Runtime loss/room retention.
--url: explicit assembled native publication; the successful check must observe
real WASM memory and an authenticated first-frame before automatic safe cleanup.
No browser/native result is claimed by syntax or source/VM checks.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from support.current_ui import suppress_notices, open_product, set_music, runtime_frame, runtime_visible, runtime_url, require_local_publication
from support.current_room_ui import (protocol_publication, open_lobby, create_room, join_room,
    prepare_room, ready_room, start_room, wait_runtime, wait_local_seat, room, room_code)


# Read-only event observation. It never changes a command, native memory,
# readiness flag or Runtime ownership, and accepts only the current document.
PREFLIGHT_AUDIT = r"""game => {
  const record = value => globalThis.__recordPreflight(value).catch(() => {});
  if (window === window.top) {
    addEventListener('message', event => {
      const frame = document.querySelector('[data-runtime-host] iframe'), message = event.data || {};
      if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin ||
          message.protocol !== 'eagler-touhou/1' || message.game !== game || typeof message.event !== 'string') return;
      let url; try {url = new URL(frame.contentWindow.location.href);} catch {return;}
      const epoch = Number(url.searchParams.get('runtimeEpoch'));
      if (url.origin !== location.origin || !Number.isSafeInteger(epoch) || epoch <= 0 || message.epoch !== epoch) return;
      let nativeWasm = false;
      if (message.event === 'first-frame') {
        const native = frame.contentWindow['__' + game + 'Runtime'];
        nativeWasm = !!native?.app && native?.core?.memory instanceof frame.contentWindow.WebAssembly.Memory;
      }
      record({kind:'event',game,epoch,event:message.event,nativeWasm,url:url.href});
    });
  } else {
    addEventListener('message', event => {
      const message = event.data || {}, url = new URL(location.href), epoch = Number(url.searchParams.get('runtimeEpoch'));
      if (event.source !== parent || event.origin !== location.origin || message.protocol !== 'eagler-touhou/1' ||
          message.game !== game || !Number.isSafeInteger(epoch) || epoch <= 0 || message.epoch !== epoch || typeof message.command !== 'string') return;
      record({kind:'command',game,epoch,command:message.command,options:message.options || {},url:url.href});
    });
  }
}"""


def assert_retained_room(page, product, code):
    assert room_code(page) == code
    wait_local_seat(page, 0)
    assert f'/play/{product}' in page.url and f'mpRoom={code}' in page.url
    assert page.evaluate("""({product, code}) => {
      const saved = JSON.parse(sessionStorage.getItem(`eagler-touhou-${product}-room-v1`) || 'null');
      return saved?.room?.code === code && saved.seat === 0;
    }""", {'product':product, 'code':code})


def run_preflight(browser, base, game, *, native=False):
    product = game + 'mp'
    context = browser.new_context(viewport={'width':960,'height':720}, service_workers='block')
    observed, errors = [], []
    context.expose_binding('__recordPreflight', lambda _source, value: observed.append(value))
    context.add_init_script('(' + PREFLIGHT_AUDIT + ')(' + json.dumps(game) + ')')
    suppress_notices(context)
    page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        open_product(page, base, product); set_music(page, 'none'); open_lobby(page, base, product)
        code = create_room(page, product)
        # Check game owns its exact local acquisition; explicit Prepare does not
        # replace its first-frame requirement or join gameplay transport.
        prepare_room(page)
        for outcome in (('passed',) if native else ('failed','cancelled','passed')):
            start = len(observed)
            check = room(page).locator('[data-multiplayer-check-game]')
            expect(check).to_be_enabled(timeout=30000); check.click()
            if not native:
                page.wait_for_function("document.querySelector('[data-runtime-host] iframe')?.contentWindow?.__eaglerTestMessages?.some(m => m.command === 'launch')", timeout=60000)
                frame = runtime_frame(page)
                before = runtime_url(page)
                expect(room(page).locator('[data-multiplayer-check-status]')).to_have_attribute('data-multiplayer-check-status','checking')
                if outcome == 'failed':
                    frame.evaluate('frame => frame.contentWindow.__eaglerSendStaleExit()')
                    page.wait_for_timeout(100)
                    assert runtime_url(page) == before, 'stale preflight exit must not retire its current epoch'
                    expect(room(page).locator('[data-multiplayer-check-status]')).to_have_attribute('data-multiplayer-check-status','checking')
                    frame.evaluate('frame => frame.contentWindow.__eaglerSendCurrentExit()')
                elif outcome == 'cancelled':
                    room(page).locator('[data-multiplayer-cancel-check]').click()
                else:
                    frame.evaluate('frame => frame.contentWindow.__eaglerSendFirstFrame()')
            expect(room(page).locator('[data-multiplayer-check-status]')).to_have_attribute('data-multiplayer-check-status',outcome, timeout=180000)
            page.wait_for_function("document.querySelector('[data-runtime-host] iframe')?.contentWindow?.location.href === 'about:blank'", timeout=30000)
            assert not runtime_visible(page) and not runtime_url(page)
            assert_retained_room(page, product, code)
            expect(room(page).get_by_role('button',name='Ready',exact=True)).to_be_enabled()
            assert not page.get_by_role('dialog',name='Game ended before saving completed',exact=True).is_visible(), 'private check cleanup must not manufacture save/loss debt'
            # Browser bindings preserve observations even after the actual old
            # document is retired, rather than reading an empty iframe src.
            records = observed[start:]
            commands = [item for item in records if item['kind']=='command']
            config = next(item for item in commands if item['command']=='configure')
            assert bool(config['options'].get('multiplayerPreflight')) == (game=='th08'), config
            assert not any(key.startswith('netplay') and value is not None for key,value in config['options'].items()), config
            assert '/multiplayer/' in config['url'], config
            assert any(item['command']=='launch' for item in commands), commands
            assert not any(item['command']=='sync' for item in commands), 'preflight must not synchronize gameplay save data'
            frames = [item for item in records if item.get('event')=='first-frame' and item['epoch']==config['epoch']]
            assert bool(frames) == (outcome=='passed'), records
            if native:
                assert frames[-1]['nativeWasm'], 'native preflight requires actual game WebAssembly.Memory, not a synthetic first-frame peer'
        room(page).get_by_role('button',name='← Back to lobby',exact=True).click()
        expect(room(page)).to_have_count(0)
        assert 'mpRoom=' not in page.url and not errors, errors
    finally:
        context.close()


def run_case(browser, base, game):
    product = game + 'mp'
    contexts, pages, errors = [], [], []
    try:
        for index in range(2):
            context = browser.new_context(viewport={'width':960,'height':720}, service_workers='block')
            contexts.append(context); suppress_notices(context)
            page = context.new_page(); pages.append(page)
            page.on('pageerror', lambda error, i=index: errors.append(f'P{i}: {error}'))
            open_product(page, base, product); set_music(page, 'none'); open_lobby(page, base, product)
        host, guest = pages
        code = create_room(host, product)
        join_room(guest, product, code, seat=1)
        for page in pages:
            prepare_room(page); ready_room(page)
        start_room(host)
        for page in pages:
            wait_runtime(page)
            page.wait_for_function("document.querySelector('[data-runtime-host] iframe')?.contentWindow?.__eaglerTestMessages?.some(m => m.command === 'launch')")
        frame = runtime_frame(host)
        configure = frame.evaluate('frame => frame.contentWindow.__eaglerConfigureOptions')
        assert configure['netplayMode'] == 'lan' and configure['netplayPlayer'] == 0, configure
        assert not configure.get('multiplayerPreflight'), 'Current React room start is an authoritative multiplayer launch'
        before = runtime_url(host)
        assert before and 'runtimeEpoch=' in before, 'A launched Runtime must have an authenticated current document URL'
        frame.evaluate('frame => frame.contentWindow.__eaglerSendStaleExit()')
        host.wait_for_timeout(100)
        assert runtime_visible(host) and runtime_url(host) == before, 'Stale epoch must not close the current Runtime'
        frame.evaluate('frame => frame.contentWindow.__eaglerSendCurrentExit()')
        expect(host.locator('[data-runtime-host]')).to_have_attribute('aria-hidden', 'true', timeout=10000)
        assert room_code(host) == code
        wait_local_seat(host, 0)
        assert f'/play/{product}' in host.url and f'mpRoom={code}' in host.url
        assert host.evaluate("""({product, code}) => {
          const saved = JSON.parse(sessionStorage.getItem(`eagler-touhou-${product}-room-v1`) || 'null');
          return saved?.room?.code === code && saved.seat === 0;
        }""", {'product':product, 'code':code})
        # Unexpected native termination retains a real unsaved-progress warning.
        # Acknowledge the synthetic loss explicitly before leaving the room.
        room(host).get_by_role('button', name='← Back to lobby', exact=True).click()
        dialog = host.get_by_role('dialog', name='Game ended before saving completed', exact=True)
        expect(dialog).to_be_visible()
        assert f'mpRoom={code}' in host.url, 'Blocked leave must retain the room until loss acknowledgment'
        dialog.get_by_role('button', name='Acknowledge loss risk and leave', exact=True).click()
        expect(dialog).to_be_hidden()
        expect(room(host)).to_have_count(0)
        assert 'mpRoom=' not in host.url
        assert not errors, errors
    finally:
        for context in contexts: context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', choices=('th06','th07','th08'))
    parser.add_argument('--url', default=os.environ.get('EAGLER_NATIVE_SITE_URL'), help='Explicit assembled loopback native publication; omit only for the sealed synthetic lane')
    parser.add_argument('--th08-data', type=Path, default=Path(os.environ['TH08_MP_DATA']) if os.environ.get('TH08_MP_DATA') else None,
                        help='Optional retail th08.dat pin; requires --game th08 and --url, exact Host byte/hash match')
    args = parser.parse_args()
    games = (args.game,) if args.game else ('th06','th07')
    if args.th08_data and (args.game != 'th08' or not args.url):
        parser.error('--th08-data requires --game th08 and an explicit assembled --url; no source server or forged Runtime metadata is substituted')
    if args.url:
        publication = require_local_publication(args.url, games=tuple(game+'mp' for game in games), metadata=True)
        if any(game+'mp' not in publication['publication'].get('products',[]) for game in games):
            parser.error('The selected multiplayer products are not exposed by this publication; preserve its catalog/testBuild policy')
        if args.th08_data:
            data = args.th08_data.read_bytes(); identity = publication['host']['games']['th08']['gameData']
            if len(data) != identity['bytes'] or hashlib.sha256(data).hexdigest() != identity['sha256']:
                parser.error('--th08-data bytes/hash differ from the assembled Host identity')
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                for game in games: run_preflight(browser, publication['base'], game, native=True)
            finally: browser.close()
        print('Native Check game: PASS authenticated first-frame + native WASM + no transport + safe retained room')
    else:
        with protocol_publication(games, manual_preflight_frame=True) as (base, _):
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                try:
                    for game in games:
                        run_preflight(browser, base, game)
                        run_case(browser, base, game)
                finally: browser.close()
        print('Synthetic Check game and Runtime exit -> room: PASS early/stale exit + cancel + explicit first-frame + two-endpoint room (no native acceptance)')
    return 0


if __name__ == '__main__': raise SystemExit(main())
