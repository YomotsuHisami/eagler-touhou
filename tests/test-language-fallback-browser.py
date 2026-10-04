"""Native local-Package launch survives a missing optional remote translation.

Pass a complete loopback Framework publication publishing TH06 + lang_en and a
real TH06 Package ZIP. Only the optional remote translation request is failed;
Runtime/data/first-frame readiness are never replaced with synthetic evidence.
"""
import argparse
import json
import os
import re
from playwright.sync_api import sync_playwright, expect
from support.current_ui import (require_local_publication, suppress_notices, open_product,
    import_package, set_music, prepare_game, start_prepared, RuntimeEvents, runtime_frame, diagnostics)

CONFIGURE_OBSERVER = """(() => {
  if (window === window.top) return;
  addEventListener('message', event => {
    const message = event.data || {};
    const epoch = Number(new URL(location.href).searchParams.get('runtimeEpoch'));
    if (event.source !== parent || event.origin !== location.origin ||
        message.protocol !== 'eagler-touhou/1' || message.game !== 'th06' ||
        !Number.isSafeInteger(epoch) || epoch <= 0 || message.epoch !== epoch ||
        message.command !== 'configure') return;
    // Observe the genuine configure message; never answer it or generate ready.
    window.__languageFallbackConfigure = {language:message.language,
      hasRuntimePack:!!message.runtimePack, epoch};
  });
})();"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('package_zip')
    args = parser.parse_args()
    package_zip = os.path.abspath(args.package_zip)
    if not os.path.isfile(package_zip): parser.error(f'Package ZIP not found: {package_zip}')
    base = require_local_publication(args.url, games=('th06',))
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(service_workers='block')
        try:
            suppress_notices(context); context.add_init_script(CONFIGURE_OBSERVER)
            language_requests, console_messages, errors = [], [], []
            def fail_language(route, request):
                language_requests.append(request.url)
                route.fulfill(status=404, content_type='text/plain', body='intentional optional language fixture 404')
            context.route('**/games/th06/language/*.zip*', fail_language)
            page = context.new_page()
            events = RuntimeEvents(page, game='th06')
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: console_messages.append(f'{message.type}: {message.text}'))
            open_product(page, base, 'th06')
            language = page.get_by_label('Game language', exact=True)
            expect(language.locator('option[value="lang_en"]')).to_have_count(1)
            language.select_option('lang_en'); set_music(page, 'none')
            assert language.input_value() == 'lang_en'
            import_package(page, base, 'th06', package_zip)
            assert language.input_value() == 'lang_en', 'Import must preserve the selected translation'
            assert not any(event['event'] == 'first-frame' for event in events.events), 'Resource import must not auto-launch'
            try:
                prepare_game(page, 'th06', timeout=180000)
                warning = page.get_by_role('region', name='TH06 game launch', exact=True).get_by_text(
                    re.compile(r'lang_en translation is unavailable; using the built-in Japanese language for this launch'))
                expect(warning).to_be_visible()
                assert language_requests, 'The configured remote language ZIP was not exercised; use a Package without a bundled lang_en pack'
                configured = runtime_frame(page).evaluate('frame => frame.contentWindow.__languageFallbackConfigure')
                assert configured and configured['language'] == 'ja' and not configured['hasRuntimePack'], configured
                start_prepared(page, 'th06', timeout=180000)
                first_frame = events.wait('first-frame', timeout=90000)
                assert first_frame['epoch'] == configured['epoch'], (first_frame, configured)
            except Exception as error:
                raise AssertionError({'ui':diagnostics(page), 'nativeEvents':events.events,
                    'languageRequests':language_requests, 'console':console_messages[-20:]}) from error
            persisted = page.evaluate("localStorage.getItem('eagler-touhou-language-v1-th06')")
            assert persisted == 'lang_en', persisted
            assert not errors, errors
            print(json.dumps({'languageFallback':'PASS', 'remoteStatus':404,
                'authenticatedFirstFrame':first_frame, 'preferencePreserved':persisted,
                'configuredLanguage':configured['language'], 'requests':language_requests}, ensure_ascii=False))
        finally:
            context.close(); browser.close()
    return 0


if __name__ == '__main__': raise SystemExit(main())
