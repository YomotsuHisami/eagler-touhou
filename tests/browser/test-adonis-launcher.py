"""Workspace-dependent React publication + real Relay, production MP and retail DATA.

The explicit fixture files must match the assembled publication's identities.
No synthetic Runtime, calibration, publication metadata or acceptance claim.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import sys
import time
import traceback
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from support.current_ui import current_url, require_local_publication, set_music, suppress_notices
from support.current_room_ui import (
    close_room_panel, prepare_room, ready_room, room, room_panel, start_room, wait_local_seat, wait_runtime,
)

TIMING_FIELDS = ('phase', 'automatic', 'adonisMode', 'inputDelay', 'fullDelay',
                 'predictionReserve', 'rttP95Us', 'samples', 'lost', 'route')


def checked_bytes(path: Path, identity: dict, label: str) -> bytes:
    body = path.read_bytes()
    assert len(body) == identity['bytes'], f'{label}: byte count differs from publication'
    assert hashlib.sha256(body).hexdigest() == identity['sha256'].lower(), f'{label}: SHA-256 differs from publication'
    return body


def publication_fixtures(request, base: str, publication: dict, args) -> tuple[dict, dict[str, bytes]]:
    """Validate explicit real inputs without rewriting any published identity."""
    manifest = publication['host']
    assert manifest['games'][args.game].get('multiplayerRuntime'), 'Publication must include multiplayer Runtime'
    response = request.get(urljoin(base, 'release-catalog.json'), max_redirects=0)
    assert response.ok, ('Missing release catalog', response.status)
    catalog = response.json()
    entry = catalog['games'][args.game]
    descriptor_url = urljoin(base, entry['descriptor'])
    target, root = urlsplit(descriptor_url), urlsplit(base)
    assert (target.scheme, target.netloc) == (root.scheme, root.netloc) and target.path.startswith(root.path), 'Descriptor must stay in local publication'
    response = request.get(descriptor_url, max_redirects=0)
    assert response.ok, ('Missing published descriptor', response.status)
    descriptor = json.loads(args.descriptor.read_text(encoding='utf-8'))
    assert descriptor == response.json(), 'Explicit descriptor must match the assembled publication'
    assert entry['revision'] == descriptor['revision']
    assert descriptor['game'] == args.game
    files = descriptor['files']
    assert {'game-data', 'shared-msgothic', 'shared-unifont'} <= set(descriptor['base']['files']), 'Canonical DATA and both shared fonts are required'
    assert files['game-data']['source'] == f'games/{args.game}/{args.game}.data'
    assert files['shared-msgothic']['source'] == 'shared/msgothic.ttc'
    assert files['shared-unifont']['source'] == 'shared/unifont.otf'
    data = checked_bytes(args.data, files['game-data'], 'Retail DATA')
    assert len(data) == manifest['games'][args.game]['gameData']['bytes']
    assert hashlib.sha256(data).hexdigest() == manifest['games'][args.game]['gameData']['sha256'].lower()
    font = checked_bytes(args.font, files['shared-msgothic'], 'Original font')
    runtime_root = f'runtime/{args.game}/multiplayer/'
    group = next(group for group in publication['runtimes']['groups'] if group['root'] == runtime_root)
    current = group['current']
    resources = {urlsplit(urljoin(base, files['game-data']['source'])).path: data,
                 urlsplit(urljoin(base, files['shared-msgothic']['source'])).path: font}
    package = args.package_dir.resolve()
    for file in current['files']:
        path = (package / file['path']).resolve()
        assert path.is_relative_to(package), file['path']
        body = checked_bytes(path, file, f'Multiplayer Runtime {file["path"]}')
        resources[urlsplit(urljoin(base, runtime_root + current['generation'] + '/' + file['path'])).path] = body
    # Keep publication metadata and all optional resources intact. In particular,
    # Unicode font bytes are acquired from the actual site and verified by Package.
    return manifest, resources


AUDIT = r"""(() => {
  if (window !== window.top) return;
  const audit = window.__adonisAudit = {timing: [], events: [], connectionViews: []};
  addEventListener('message', event => {
    const frame = document.querySelector('[data-runtime-host] iframe'), message = event.data;
    if (!frame?.contentWindow || event.source !== frame.contentWindow ||
        event.origin !== location.origin || message?.protocol !== 'eagler-touhou/1') return;
    let url;try {url = new URL(frame.contentWindow.location.href);} catch {return;}
    const game = url.pathname.match(/\/runtime\/(th\d+)\//)?.[1];
    const epoch = Number(url.searchParams.get('runtimeEpoch'));
    if (url.origin !== location.origin || !game || message.game !== game ||
        !Number.isSafeInteger(epoch) || epoch <= 0 || message.epoch !== epoch) return;
    if (message.netplayTiming) audit.timing.push(message.netplayTiming);
    if (message.event) audit.events.push(message);
  });
  setInterval(() => {
    const view = document.querySelector('aside[aria-label="Multiplayer start measurement"]');
    if (view?.querySelector('[role="status"]')?.textContent === 'Multiplayer measurement complete') {
      audit.connectionViews.push(view.innerText);
    }
  }, 100);
})();"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Loopback URL of an assembled current React publication')
    parser.add_argument('--game', choices=['th08', 'th10'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--package-dir', type=Path, required=True)
    parser.add_argument('--descriptor', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--font', type=Path, required=True)
    parser.add_argument('--relay-url', default='ws://127.0.0.1:18381/')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    report = {'passed': False, 'game': args.game, 'scope': __doc__, 'errors': [], 'console': [], 'httpFailures': []}
    pages = []
    try:
        publication = require_local_publication(args.url, [args.game, args.game + 'mp'])
        base = publication['base']
        with sync_playwright() as pw:
            request = pw.request.new_context()
            try:
                manifest, resources = publication_fixtures(request, base, publication, args)
            finally:
                request.dispose()
            manifest['shared']['netplayRelay'] = args.relay_url
            with pw.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader', '--disable-features=LocalNetworkAccessChecks']) as browser:
                code = str(1000 + int(uuid.uuid4().hex[:6], 16) % 9000)
                report['room'] = code
                try:
                    for seat in range(3):
                        context = browser.new_context(service_workers='block', viewport={'width': 1280, 'height': 900})
                        suppress_notices(context)
                        context.add_init_script(AUDIT)
                        context.route(urljoin(base, 'host-manifest.json') + '*', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps(manifest)))

                        def fixture_resource(route):
                            target, origin = urlsplit(route.request.url), urlsplit(base)
                            if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
                                route.fallback()
                                return
                            path = target.path
                            body = resources.get(path)
                            if body is None:
                                route.fallback()
                                return
                            content_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
                            if path.endswith(('.mjs', '.js')):
                                content_type = 'text/javascript'
                            route.fulfill(status=200, content_type=content_type, body=body)

                        context.route('**/*', fixture_resource)
                        page = context.new_page()
                        pages.append(page)
                        page.on('pageerror', lambda error, seat=seat: report['errors'].append({'seat': seat, 'message': str(error)}))
                        page.on('console', lambda message, seat=seat: report['console'].append({'seat': seat, 'type': message.type, 'message': message.text}) if message.type in ('error', 'warning') else None)
                        page.on('response', lambda response, seat=seat: report['httpFailures'].append({'seat': seat, 'status': response.status, 'url': response.url}) if response.status >= 400 else None)
                        page.goto(current_url(base, f'play/{args.game}mp', mpRoom=code,
                                              fromLobby=1 if seat < 2 else 0, lobbyAction='create' if seat == 0 else 'join',
                                              lobbyPlayers=2, lobbyDifficulty=1), wait_until='load')
                        expect(room(page).get_by_role('status').filter(has_text=re.compile('^Connected$'))).to_be_visible(timeout=60000)
                        if seat < 2:
                            wait_local_seat(page, seat)
                        else:
                            room(page).get_by_role('button', name='Join as spectator', exact=True).click()
                            expect(room(page).get_by_role('button', name='Stop spectating', exact=True)).to_be_visible(timeout=30000)
                        dialog = room_panel(page, 'Personal settings / Loadout')
                        dialog.get_by_role('button', name='Game / Touch settings', exact=True).click()
                        settings = page.get_by_role('dialog', name='Game / Touch settings', exact=True)
                        set_music(page, 'none')
                        close_room_panel(page, settings)
                        prepare_room(page)
                    host, guest, viewer = pages
                    dialog = room_panel(host, 'Network diagnostics / Input timing')
                    expect(dialog.get_by_role('checkbox', name='Enable rollback (keep the manual input delay)', exact=True)).not_to_be_checked()
                    close_room_panel(host, dialog)
                    ready_room(host)
                    ready_room(guest)
                    start_room(host)
                    for page in pages:
                        wait_runtime(page)
                    deadline = time.monotonic() + 120
                    screenshot = False
                    while time.monotonic() < deadline:
                        connection = host.get_by_role('complementary', name='Multiplayer start measurement', exact=True)
                        if not screenshot and connection.count() and connection.get_by_role('status').inner_text() == 'Multiplayer measurement complete':
                            connection.screenshot(path=str(args.output.with_suffix('.png')))
                            screenshot = True
                        if all(page.evaluate('window.__adonisAudit.connectionViews.length > 0') for page in (host, guest)):
                            break
                        host.wait_for_timeout(100)
                    report['connection'] = [page.evaluate('window.__adonisAudit.connectionViews.at(-1)') for page in (host, guest)]
                    assert all(report['connection']), ('Missing actual completed measurement UI', report['connection'])
                    for text in report['connection']:
                        assert 'Multiplayer measurement complete' in text and 'Input delay:' in text and 'Rollback: Off' in text, text
                    for page in pages:
                        page.wait_for_function("""game => {
                          const runtime = document.querySelector('[data-runtime-host] iframe')?.contentWindow['__' + game + 'Runtime'];
                          if (!runtime?.app) return false;
                          const core = runtime.core, words = new Uint32Array(core.memory.buffer, core.multiplayer_netplay_status(runtime.app), game === 'th08' ? 15 : 11);
                          const last = words[game === 'th08' ? 4 : 3];
                          return last !== 4294967295 && last >= 119;
                        }""", arg=args.game, timeout=60000)
                    report['timing'] = [page.evaluate("window.__adonisAudit.timing.filter(value => value.phase === 'ready').at(-1)") for page in (host, guest)]
                    report['native'] = [page.evaluate("""game => {
                      const runtime = document.querySelector('[data-runtime-host] iframe').contentWindow['__' + game + 'Runtime'];
                      return Array.from(new Uint32Array(runtime.core.memory.buffer, runtime.core.multiplayer_netplay_status(runtime.app), game === 'th08' ? 15 : 11));
                    }""", args.game) for page in pages]
                    assert all(timing and timing['adonisMode'] == 1 and timing['inputDelay'] >= 1 for timing in report['timing']), report['timing']
                    report['calibrationReports'] = []
                    for page, timing in zip((host, guest), report['timing']):
                        page.get_by_role('button', name='Calibration report', exact=True).click()
                        dialog = page.get_by_role('dialog', name='Start-of-game latency calibration report', exact=True)
                        measured = json.loads(dialog.get_by_role('textbox', name='Calibration report JSON', exact=True).input_value())
                        assert measured['game'] == args.game + 'mp'
                        assert {key: measured[key] for key in TIMING_FIELDS} == {key: timing[key] for key in TIMING_FIELDS}
                        native_players = timing['calibration']['players']
                        assert len(measured['players']) == len(native_players) == 2
                        for actual, native in zip(measured['players'], native_players):
                            for key in ('player', 'p95Us', 'samples', 'lost', 'minUs', 'maxUs', 'meanUs'):
                                assert actual[key] == native[key], (key, actual, native)
                            assert 96 <= actual['samples'] <= 120 and actual['lost'] == 120 - actual['samples']
                        report['calibrationReports'].append(measured)
                        close_room_panel(page, dialog)
                    assert not report['errors'], report['errors']
                    report['passed'] = True
                except BaseException:
                    for seat, page in enumerate(pages):
                        report.setdefault('pages', []).append({'seat': seat, 'body': page.locator('body').inner_text()[-8000:],
                            'runtime': page.evaluate("""game => {
                              const frame = document.querySelector('[data-runtime-host] iframe'), runtime = frame?.contentWindow['__' + game + 'Runtime'];
                              return {url: frame?.contentWindow?.location.href, app: runtime?.app, status: runtime?.status?.(), audit: window.__adonisAudit};
                            }""", args.game)})
                        page.screenshot(path=str(args.output.with_name(args.output.stem + f'-failure-{seat}.png')))
                    raise
    except BaseException as error:
        report['failure'] = str(error)
        report['traceback'] = traceback.format_exc()
        raise
    finally:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(args.game, 'React Launcher measurement, two players and live spectator: PASS')


if __name__ == '__main__':
    main()
