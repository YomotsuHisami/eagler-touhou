"""TEST-ONLY TH20 native adapter import gate, not public Launcher support.

TH20 remains hidden even in testBuild. Requires an explicit local assembled
publication, separate native fixture, real Package ZIP and exact Runtime hash.
The imported large DATA and OGG are exercised by the current real RuntimeService;
only native WebAssembly presentation counters establish a successful run.
See tests/native-th20/README.md. Never auto-starts a development server.
"""
from __future__ import annotations

import time
from playwright.sync_api import sync_playwright
from support.th20_native import (arguments, inputs, inspect, observe_failures, open_native,
                                  wait_presented, close_native, FRAME_TARGET)


def main():
    args = arguments(__doc__)
    verified = inputs(args)
    started = time.monotonic()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
            page = context.new_page()
            errors, data_requests = observe_failures(page)
            result = open_native(page, verified, music='ogg')
            # This unique lane must still cover the >127 MiB Chromium IDB value
            # boundary, rather than silently accepting a tiny fixture Package.
            assert result['imported']['dataBytes'] > 127 * 1024 * 1024, result['imported']
            assert len(result['imported']['oggIds']) >= 2, result['imported']
            native = wait_presented(page, verified)
            assert inspect(page)['context']['options']['oggDecodeMode'] == 'stream'
            assert not data_requests, f'Managed DATA must come only from the imported generation: {data_requests}'
            assert not page.evaluate('window.__nativeTestIdbErrors'), page.evaluate('window.__nativeTestIdbErrors')
            close_native(page)
            assert not errors, errors
            print(f"TH20 TEST-ONLY native adapter import: PASS package={args.package_zip.name} "
                  f"music=imported-ogg runtime={args.runtime_generation} presented={native['presented']}>={FRAME_TARGET} "
                  f"scene={native['scene']} elapsed={time.monotonic() - started:.0f}s; public product support remains hidden")
        finally:
            browser.close()


if __name__ == '__main__':
    main()
