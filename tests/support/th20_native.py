"""Explicit hidden-adapter fixture driver, never a public TH20 product driver.

Only a supplied loopback assembled publication and exact local Package/Runtime
inputs are accepted. No development server, default proprietary path or fake
native peer. The fixture owns the current real RuntimeService and components.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, build_opener

from playwright.sync_api import expect
from support.current_ui import _NoRedirect, require_local_publication, runtime_frame

FRAME_TARGET = 120


def arguments(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--url', required=True, help='Explicit loopback assembled publication root')
    parser.add_argument('--fixture-url', required=True, help='Same-origin separate __th20_native__/index.html fixture')
    parser.add_argument('--package-zip', required=True, type=Path, help='Explicit real local TH20 Package containing DATA, fonts and OGG')
    parser.add_argument('--runtime-generation', required=True, help='Exact 64-digit SHA-256 native Runtime generation')
    args = parser.parse_args()
    if not args.package_zip.is_file():
        parser.error(f'TH20 Package does not exist: {args.package_zip}')
    if not re.fullmatch('[a-f0-9]{64}', args.runtime_generation):
        parser.error('--runtime-generation must be an exact lowercase SHA-256 identity')
    return args


def inputs(args):
    root = require_local_publication(args.url, ['th20'])
    fixture = urlsplit(args.fixture_url)
    publication = urlsplit(root)
    if ((fixture.scheme, fixture.netloc) != (publication.scheme, publication.netloc) or
            fixture.path != publication.path + '__th20_native__/index.html' or fixture.query or fixture.fragment):
        raise ValueError('--fixture-url must name the separate __th20_native__/index.html test mount on the same loopback origin')
    opener = build_opener(_NoRedirect)

    def read(url):
        with opener.open(Request(url, headers={'Accept': 'application/json'}), timeout=30) as response:
            if 'application/json' not in response.headers.get('Content-Type', ''):
                raise ValueError(f'Expected explicit JSON, not a route fallback: {url}')
            payload = response.read()
        return json.loads(payload), payload

    marker, _ = read(urljoin(args.fixture_url, 'fixture-manifest.json'))
    if (marker.get('schema') != 'eagler-touhou/th20-native-fixture/1' or marker.get('testOnly') is not True or
            marker.get('scope') != 'test-only-native-adapter' or marker.get('productionProductSupport') is not False):
        raise ValueError('Build/mount the independent native fixture; production UI is not a TH20 entry')
    host, host_bytes = read(urljoin(root, 'host-manifest.json'))
    runtime, _ = read(urljoin(root, 'runtime-manifest.json'))
    expected = f'runtime/th20/{args.runtime_generation}/th20.html'
    if host['games']['th20']['runtime'].removeprefix('./') != expected:
        raise ValueError('Host TH20 entry does not match --runtime-generation')
    group = next((group for group in runtime['groups'] if group['root'] == 'runtime/th20/'), None)
    if not group or group['current']['generation'] != args.runtime_generation:
        raise ValueError('The exact native Runtime must be current in the supplied publication')
    digest = hashlib.sha256()
    with args.package_zip.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    pins = {'publication': root, 'hostSha256': hashlib.sha256(host_bytes).hexdigest(),
            'runtimeGeneration': args.runtime_generation, 'packageSha256': digest.hexdigest(), 'uiLocale': 'en'}
    return {'url': args.fixture_url + '?' + urlencode(pins), 'root': root, 'package': args.package_zip,
            'runtimeGeneration': args.runtime_generation, 'pins': pins}


def inspect(page):
    return page.evaluate('() => window.__th20NativeFixture?.inspect() ?? null')


def observe_failures(page):
    errors, data_requests = [], []
    benign = re.compile(r'^(?:Failed to load resource|th20 wasm build|sdl_game_open|tick \d+ scene \d+|worker\[)')
    page.on('pageerror', lambda error: errors.append(f'pageerror:{error}'))
    page.on('console', lambda message: errors.append(f'{message.type}:{message.text}')
            if message.type == 'error' and not benign.search(message.text) else None)
    page.on('response', lambda response: errors.append(f'http{response.status}:{response.url}') if response.status >= 400 else None)
    page.on('request', lambda request: data_requests.append(request.url) if urlsplit(request.url).path.endswith('/th20.data') else None)
    page.add_init_script("""(() => {
      window.__nativeTestIdbErrors = [];
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = original.apply(this, args);
        tx.addEventListener('error', () => window.__nativeTestIdbErrors.push(tx.error ? `${tx.error.name}: ${tx.error.message}` : 'transaction failed'));
        return tx;
      };
    })();""")
    return errors, data_requests


def open_native(page, verified, music='none', movement=None):
    page.goto(verified['url'], wait_until='load', timeout=60000)
    expect(page.get_by_role('heading', name='Test-only TH20 native adapter fixture', exact=True)).to_be_visible()
    expect(page.get_by_text('Verified publication; choose the explicit Package', exact=True)).to_be_visible(timeout=90000)
    page.get_by_label('Explicit TH20 Package ZIP', exact=True).set_input_files(str(verified['package']))
    expect(page.get_by_text('Verified local Package imported', exact=True)).to_be_visible(timeout=900000)
    imported = inspect(page)
    assert imported['imported']['oggIds'], imported
    assert not page.evaluate('window.__nativeTestIdbErrors'), page.evaluate('window.__nativeTestIdbErrors')
    page.get_by_label('Native test music', exact=True).select_option(music)
    if movement is not None:
        page.get_by_label('Enable native test touch', exact=True).check()
        page.get_by_label('Native movement method', exact=True).select_option(movement)
    page.get_by_role('button', name='Prepare exact native adapter', exact=True).click()
    expect(page.get_by_role('button', name='Start native TH20', exact=True)).to_be_visible(timeout=300000)
    prepared = inspect(page)
    assert prepared['snapshot']['codeGeneration'] == verified['runtimeGeneration'], prepared
    assert prepared['snapshot']['generationId'] == imported['imported']['id'], prepared
    assert prepared['snapshot']['ready'] and not prepared['snapshot']['firstFrame'], prepared
    page.get_by_role('button', name='Start native TH20', exact=True).click()
    page.wait_for_function("() => window.__th20NativeFixture?.inspect().snapshot?.phase === 'running'", timeout=300000)
    expect(page.locator('[data-runtime-host]')).to_have_attribute('aria-hidden', 'false')
    result = inspect(page)
    snapshot = result['snapshot']
    assert snapshot['ready'] and snapshot['launched'] and snapshot['firstFrame'], result
    assert all(any(event['event'] == name and event['game'] == 'th20' and event['epoch'] == snapshot['epoch']
                   for event in result['events']) for name in ['ready', 'first-frame']), result
    return result


def runtime_eval(page, expression):
    """Only read the exact native frame owned by the real current service epoch."""
    owner = inspect(page)
    if not owner or not owner['snapshot'] or not owner['snapshot']['source']:
        return None
    for frame in page.frames:
        if frame.url != owner['snapshot']['source']:
            continue
        return frame.evaluate(expression)
    return None


def presented_state(page):
    return runtime_eval(page, """() => {
      const core = globalThis.__th20Runtime?.core;
      if (!core || !(core.memory instanceof WebAssembly.Memory)) return null;
      return {src: location.href, nativeMemory: true,
        presented: new Uint32Array(core.memory.buffer, core.sdl_stats(), 6)[5],
        scene: new Int32Array(core.memory.buffer, core.sdl_game_status(), 1)[0]};
    }""")


def wait_presented(page, verified, timeout=180):
    deadline = time.monotonic() + timeout
    state = None
    while time.monotonic() < deadline:
        state = presented_state(page)
        if state and state.get('presented', 0) >= FRAME_TARGET:
            break
        page.wait_for_timeout(250)
    assert state and state['nativeMemory'] and isinstance(state['presented'], int) and state['presented'] >= FRAME_TARGET, state
    snapshot = inspect(page)['snapshot']
    from urllib.parse import parse_qs
    source = urlsplit(state['src'])
    query = parse_qs(source.query)
    assert source.path.endswith(f"/runtime/th20/{verified['runtimeGeneration']}/th20.html"), state
    assert query.get('managedData') == ['1'] and query.get('gameGeneration') == [snapshot['generationId']], state
    assert query.get('runtimeEpoch') == [str(snapshot['epoch'])], state
    return state


def close_native(page):
    page.get_by_role('toolbar', name='Game session controls', exact=True).get_by_role('button', name='Exit game', exact=True).click()
    page.get_by_role('dialog', name='End the current game?', exact=True).get_by_role('button', name='Save and exit', exact=True).click()
    page.wait_for_function("() => window.__th20NativeFixture?.inspect().snapshot?.phase === 'idle'", timeout=60000)
    expect(page.locator('[data-runtime-host]')).to_have_attribute('aria-hidden', 'true')
    assert inspect(page)['snapshot']['source'] is None
