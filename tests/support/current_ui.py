"""Semantic drivers for the current React publication, never the retired DOM.

Native lanes require an explicitly supplied loopback assembled publication. Test
observers authenticate native messages; no production debug globals are added.
These helpers do not establish game, browser or physical-device acceptance.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

def expect(*args, **kwargs):
    # Publication/relay preflight and its HTTP-free unit tests use stdlib only.
    from playwright.sync_api import expect as playwright_expect
    return playwright_expect(*args, **kwargs)


FRAME_SELECTOR = '[data-runtime-host] iframe'

# RuntimeService deliberately uses child location.replace so it does not create
# joint browser-history entries. The iframe's src attribute is never its owner.
RUNTIME_FRAME_URL_JS = """frame => {
  if (!frame?.contentWindow) throw new Error('Runtime browsing context is unavailable');
  const current = new URL(frame.contentWindow.location.href);
  if (current.protocol === 'about:' && current.pathname === 'blank') return '';
  if (!['http:', 'https:'].includes(current.protocol) || current.origin !== location.origin)
    throw new Error('Runtime document is not same-origin');
  return current.href;
}"""
RUNTIME_FRAME_CLOSED_JS = """frame => {
  try {return (""" + RUNTIME_FRAME_URL_JS + """)(frame) === '';}
  catch {return false;}
}"""
RUNTIME_EVENT_OBSERVER_JS = """({callback, game}) => {
  if (window !== window.top) return;
  const readRuntimeUrl = (""" + RUNTIME_FRAME_URL_JS + """);
  addEventListener('message', event => {
    const frame = document.querySelector('[data-runtime-host] iframe'), message = event.data || {};
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin ||
        message.protocol !== 'eagler-touhou/1' || typeof message.event !== 'string' || !message.event) return;
    let source;
    try {source = readRuntimeUrl(frame);} catch {return;}
    if (!source) return;
    const current = new URL(source), epoch = Number(current.searchParams.get('runtimeEpoch'));
    const expectedGame = game || current.pathname.match(/[/]runtime[/](th[0-9]+)[/]/)?.[1];
    if (!expectedGame || message.game !== expectedGame || !Number.isSafeInteger(epoch) || epoch <= 0 || message.epoch !== epoch) return;
    window[callback]({game: message.game, epoch, event: message.event, error: message.error, src: source}).catch(() => {});
  });
}"""


def current_url(base, path='', **query):
    parts = urlsplit(base)
    root = parts.path
    if root.endswith(('index.html', 'en.html', 'lobby.html')):
        root = root.rsplit('/', 1)[0] + '/'
    if not root.endswith('/'):
        root += '/'
    values = dict(parse_qsl(parts.query))
    values.pop('game', None)
    values['uiLocale'] = 'en'
    values.update({key: str(value) for key, value in query.items() if value is not None})
    return urlunsplit((parts.scheme, parts.netloc, root + path.lstrip('/'), urlencode(values), ''))


def suppress_notices(context):
    context.add_init_script("""(() => { try {
      localStorage.setItem('eagler-touhou-first-use-notice-seen-v1', '1');
      localStorage.setItem('eagler-touhou-site-notice-enabled-v1', '0');
      localStorage.setItem('eagler-touch-help-seen-v8', '1');
    } catch {} })();""")


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Publication checks do not follow redirects')


def require_local_relay(url):
    parsed = urlsplit(url)
    try:
        local = parsed.hostname == 'localhost' or ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        local = False
    if parsed.scheme not in ('ws', 'wss') or not local or parsed.username or parsed.password:
        raise ValueError('Browser test relay must be an explicit loopback WebSocket URL')
    return url


def require_local_publication(base, games=None, *, metadata=False, relay_override=None):
    """Reject dev metadata/remote targets; native execution still needs its lane.

    This verifies publication identities, not that payloads are genuine games.
    Synthetic callers must label their fixture evidence explicitly.
    """
    parsed = urlsplit(base)
    try:
        local = parsed.hostname == 'localhost' or ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        local = False
    if parsed.scheme not in ('http', 'https') or not local or parsed.username or parsed.password:
        raise ValueError('Supply --url for an explicitly assembled publication on localhost/loopback')
    root = current_url(base).split('?', 1)[0]
    opener = build_opener(_NoRedirect)

    def read(path):
        url = urljoin(root, path)
        target = urlsplit(url)
        if (target.scheme, target.netloc) != (parsed.scheme, parsed.netloc) or not target.path.startswith(urlsplit(root).path):
            raise ValueError(f'Publication input escapes its local mount: {path}')
        with opener.open(Request(url, headers={'Accept': 'application/json'}), timeout=30) as response:
            if 'application/json' not in response.headers.get('Content-Type', ''):
                raise ValueError(f'Publication metadata is not JSON: {url}')
            return json.load(response)

    marker = read('ui-publication.json')
    if (marker.get('schema') != 'eagler-touhou/ui-publication/1' or
            marker.get('status') not in ('react-main', 'experimental-opt-in') or
            marker.get('mountPath') != urlsplit(root).path or
            not re.fullmatch('[a-f0-9]{64}', marker.get('uiBuild', {}).get('sha256', ''))):
        raise ValueError('Current assembled React publication marker is required')
    host = read('host-manifest.json')
    if (host.get('schema') != 'eagler-touhou/host-manifest/1' or
            host.get('protocol') != 'eagler-touhou/1' or
            host.get('shared', {}).get('runtimeManifest') != 'runtime-manifest.json'):
        raise ValueError('Assembled Host metadata with immutable Runtime Manifest is required; source dev metadata is unsupported')
    relay = relay_override if relay_override is not None else host['shared'].get('netplayRelay')
    if relay:
        require_local_relay(relay)
    if any(game.endswith('mp') for game in games or []) and not relay:
        raise ValueError('Multiplayer acceptance requires an explicitly configured loopback relay')
    runtimes = read(host['shared']['runtimeManifest'])
    if runtimes.get('schema') != 'eagler-touhou/runtime-manifest/1' or runtimes.get('protocol') != 'eagler-touhou/1':
        raise ValueError('Invalid immutable Runtime Manifest')
    entries = set()
    for group in runtimes.get('groups', []):
        for generation in [group['current'], *group.get('previous', [])]:
            files = sorted(generation['files'], key=lambda item: item['path'])
            payload = ['eagler-touhou/runtime-generation/1', generation['entry'],
                       [[item['path'], item['bytes'], item['sha256']] for item in files]]
            actual = hashlib.sha256(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
            if actual != generation['generation']:
                raise ValueError('Runtime Manifest generation identity mismatch')
            entries.add(group['root'] + generation['generation'] + '/' + generation['entry'])
    for product in games or []:
        game = product[:-2] if product.endswith('mp') else product
        entry = host.get('games', {}).get(game)
        if not entry:
            raise ValueError(f'Publication does not supply {game}')
        key = 'multiplayerRuntime' if product.endswith('mp') else 'runtime'
        path = entry.get(key, '').removeprefix('./')
        if path not in entries:
            raise ValueError(f'{product} does not reference a sealed immutable Runtime generation')
    if metadata:
        return {'base': root, 'publication': marker, 'host': host, 'runtimes': runtimes}
    return root


def wait_ready(page, timeout=60000):
    expect(page.locator('main')).to_have_count(1, timeout=timeout)
    expect(runtime_frame(page)).to_have_count(1, timeout=timeout)
    # This control appears only after the current locale owner has hydrated.
    expect(page.locator('html')).to_have_attribute('data-ui-locale', 'en', timeout=timeout)


def open_current(page, base, path='', timeout=60000, **query):
    page.goto(current_url(base, path, **query), wait_until='load', timeout=timeout)
    wait_ready(page, timeout)


def open_product(page, base, product, timeout=60000):
    open_current(page, base, f'play/{product}', timeout=timeout)
    expect(page.get_by_role('form', name='Game settings', exact=True)).to_be_visible(timeout=timeout)


def runtime_frame(page):
    return page.locator(FRAME_SELECTOR)


def runtime_visible(page):
    return page.locator('[data-runtime-host]').get_attribute('aria-hidden') == 'false'


def runtime_url(page):
    return runtime_frame(page).evaluate(RUNTIME_FRAME_URL_JS)


def diagnostics(page):
    return {'url': page.url, 'runtime': runtime_url(page), 'visible': runtime_visible(page),
            'alerts': page.get_by_role('alert').all_text_contents(),
            'status': page.get_by_role('status').all_text_contents()}


def management_tab(page, name):
    labels = {'resources': 'Resource manager', 'saves': 'Save', 'settings': 'Settings', 'replays': 'Replay'}
    label = labels.get(name.lower(), name)
    page.get_by_role('navigation', name='Game management', exact=True).get_by_role('link', name=label, exact=True).click()
    expect(page.locator('[data-library-panel-body]')).to_have_attribute('aria-busy', 'false')


def set_music(page, mode):
    control = page.get_by_role('form', name='Game settings', exact=True).get_by_label('Background music', exact=True)
    expect(control).to_be_visible(timeout=60000)
    if control.input_value() != mode:
        control.select_option(mode, timeout=60000)
    expect(control).to_have_value(mode)


def set_touch(page, enabled=True, movement='touch', focus='hold-button'):
    form = page.get_by_role('form', name='Game settings', exact=True)
    form.get_by_label('Enable touch controls', exact=True).set_checked(enabled)
    form.get_by_label('Movement method', exact=True).select_option(movement)
    form.get_by_label('Focus method', exact=True).select_option(focus)


def import_package(page, base, product, path, timeout=900000):
    if not page.locator(f'[data-product-management="{product}"]').count():
        open_product(page, base, product)
    management_tab(page, 'resources')
    region = page.get_by_role('region', name='Import and remove resources', exact=True)
    region.get_by_label('Choose a resource file (up to 256 MiB)', exact=True).set_input_files(str(path), timeout=timeout)
    review = region.get_by_role('group', name='Confirm resource import', exact=True)
    expect(review).to_be_visible(timeout=timeout)
    review.get_by_role('button', name=re.compile(r'^Confirm import(?: and replacement)?$')).click()
    expect(region.get_by_text('Resources imported locally.', exact=True)).to_be_visible(timeout=timeout)
    expect(review).to_have_count(0, timeout=timeout)
    management_tab(page, 'settings')


def prepare_game(page, product=None, update_choice='keep-current', timeout=180000):
    product = product or page.locator('[data-product-management]').get_attribute('data-product-management')
    region = page.get_by_role('region', name=f'{product.upper()} game launch', exact=True)
    labels = {'keep-current': 'Keep current version', 'update-now': 'Update now', 'background': 'Download in background'}
    # Resource inspection is asynchronous; wait for its actual choice set.
    expect(region.get_by_role('button', name=re.compile(r'^(Prepare game resources|Prepare / repair game resources|Keep current version)$')).first).to_be_visible(timeout=timeout)
    choice = region.get_by_role('button', name=labels[update_choice], exact=True)
    if choice.count():
        choice.click(timeout=timeout)
    else:
        region.get_by_role('button', name=re.compile(r'^(Prepare game resources|Prepare / repair game resources)$')).click(timeout=timeout)
    expect(page.get_by_role('complementary', name='Prepared game', exact=True)).to_be_visible(timeout=timeout)
    return runtime_url(page)


LAUNCH_WARNINGS = frozenset(('touch.disabledInputWarning', 'music.noneLaunchWarning', 'music.midiLaunchWarning'))


def wait_for_launch_action(page, ready, timeout=180000):
    """Accept only the current launch's three documented input/music warnings.

    This runs after an explicit launch gesture; it neither changes preferences
    nor accepts unrelated save/loss/import dialogs. The caller still observes
    its real completion boundary, not the acknowledgment itself.
    """
    deadline = time.monotonic() + timeout / 1000
    accepted = set()
    while time.monotonic() < deadline:
        if ready():
            return tuple(accepted)
        warning = page.locator('[data-launch-warning]:visible')
        if warning.count():
            kind = warning.get_attribute('data-launch-warning')
            if kind not in LAUNCH_WARNINGS:
                raise AssertionError(f'Unexpected launch warning: {kind}')
            if kind not in accepted:
                warning.get_by_role('button', name='Start anyway', exact=True).click()
                accepted.add(kind)
        page.wait_for_timeout(50)
    raise TimeoutError({'launchWarnings': sorted(accepted), 'ui': diagnostics(page)})


def start_prepared(page, game, timeout=180000):
    prepared = page.get_by_role('complementary', name='Prepared game', exact=True)
    audio = prepared.get_by_role('button', name='Prepare MIDI audio', exact=True)
    start = prepared.get_by_role('button', name=f'Start {game.upper()}', exact=True)
    if audio.count():
        audio.click(timeout=timeout)
        wait_for_launch_action(page, lambda: start.is_visible() and start.is_enabled(), timeout=timeout)
    start.click(timeout=timeout)
    running = page.get_by_role('toolbar', name='Game session controls', exact=True).get_by_role('status').filter(has_text=re.compile(r'^Game running$'))
    wait_for_launch_action(page, running.is_visible, timeout=timeout)
    expect(running).to_have_text('Game running', timeout=timeout)
    expect(page.locator('[data-runtime-host]')).to_have_attribute('aria-hidden', 'false', timeout=timeout)
    return runtime_url(page)


def launch_game(page, game, update_choice='keep-current', timeout=180000):
    prepare_game(page, game, update_choice=update_choice, timeout=timeout)
    return start_prepared(page, game, timeout=timeout)


def exit_game(page, timeout=60000):
    page.get_by_role('toolbar', name='Game session controls', exact=True).get_by_role('button', name='Exit game', exact=True).click()
    page.get_by_role('dialog', name='End the current game?', exact=True).get_by_role('button', name='Save and exit', exact=True).click()
    page.wait_for_function('() => (' + RUNTIME_FRAME_CLOSED_JS + ')(document.querySelector(' + json.dumps(FRAME_SELECTOR) + '))', timeout=timeout)
    expect(page.locator('[data-runtime-host]')).to_have_attribute('aria-hidden', 'true', timeout=timeout)


def import_save(page, path, timeout=180000):
    management_tab(page, 'saves')
    page.get_by_label('Choose a save file to import', exact=True).set_input_files(str(path))
    page.get_by_role('dialog', name="Import and overwrite this game's save?", exact=True).get_by_role('button', name='Confirm overwrite and import', exact=True).click()
    expect(page.get_by_role('region', name='Local save manager', exact=True).get_by_text('存档已导入，并已重新载入 Runtime 核对全部字节。下次启动将使用此存档。', exact=True)).to_be_visible(timeout=timeout)


def export_save(page, path, timeout=60000):
    management_tab(page, 'saves')
    with page.expect_download(timeout=timeout) as download:
        page.get_by_role('button', name='Export save', exact=True).click(timeout=timeout)
    download.value.save_as(str(path))
    return Path(path).read_bytes()


class RuntimeEvents:
    def __init__(self, page, game=None):
        self.page, self.game, self.events, self.history = page, game, [], []
        callback = '__currentUiTestEvent_' + uuid.uuid4().hex
        def record(value):
            self.events.append(value)
            self.history.append(value)
        page.expose_function(callback, record)
        script = RUNTIME_EVENT_OBSERVER_JS
        page.add_init_script('(' + script + ')(' + json.dumps({'callback': callback, 'game': game}) + ');')
        # Support installing an observer on an already hydrated document too.
        page.evaluate(script, {'callback': callback, 'game': game})

    def clear(self):
        self.events.clear()

    def wait(self, event='first-frame', timeout=180000):
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            failure = next((item for item in self.events if item['event'] in ('error', 'fatal')), None)
            if failure:
                raise AssertionError(failure)
            found = next((item for item in reversed(self.events) if item['event'] == event), None)
            if found:
                return found
            self.page.wait_for_timeout(100)
        raise TimeoutError({'events': self.events, 'ui': diagnostics(self.page)})

# Explicit alias shared by native lane consumers.
start_game = start_prepared
