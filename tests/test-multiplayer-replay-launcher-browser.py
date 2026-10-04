"""Synthetic protocol integration for the real Framework Replay workflow.

Uses a sealed synthetic Runtime/Package publication. No native game or Replay
playback acceptance is claimed; exact prepare/start/configure intent is checked.
"""
from playwright.sync_api import sync_playwright, expect
from support.current_ui import suppress_notices, open_product, management_tab, set_music, runtime_frame, runtime_url
from support.current_room_ui import protocol_publication, wait_runtime

GAMES = ('th06', 'th07', 'th08', 'th09', 'th10')


def main():
    with protocol_publication(GAMES, with_relay=False) as (base, _):
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                for game in GAMES:
                    context = browser.new_context(viewport={'width':960, 'height':720}, service_workers='block')
                    try:
                        suppress_notices(context)
                        page, errors = context.new_page(), []
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        open_product(page, base, game + 'mp'); set_music(page, 'none')
                        management_tab(page, 'replays')
                        viewer = page.get_by_role('region', name='Multiplayer Replay viewer', exact=True)
                        viewer.get_by_role('button', name='Prepare Replay viewer', exact=True).click(timeout=60000)
                        prepared = page.get_by_role('complementary', name='Multiplayer Replay viewer', exact=True)
                        expect(prepared).to_be_visible(timeout=60000)
                        frame = runtime_frame(page)
                        assert not frame.evaluate("frame => frame.contentWindow.__eaglerTestMessages.some(m => m.command === 'launch')"), 'Preparation must not launch'
                        prepared.get_by_role('button', name='Open Replay viewer', exact=True).click()
                        wait_runtime(page)
                        page.wait_for_function("document.querySelector('[data-runtime-host] iframe')?.contentWindow?.__eaglerTestMessages?.some(m => m.command === 'launch')")
                        source = runtime_url(page)
                        configure = frame.evaluate("frame => frame.contentWindow.__eaglerTestMessages.find(m => m.command === 'configure')")
                        assert f'/runtime/{game}/multiplayer/' in source and 'runtimeVariant=multiplayer' in source, source
                        assert configure['options']['replayViewer'] is True, configure
                        assert not any(key.startswith('netplay') for key in configure['options']), configure
                        assert not errors, errors
                    finally: context.close()
            finally: browser.close()
    print('Multiplayer Replay Framework protocol integration: PASS (synthetic, no native playback claim)')
    return 0


if __name__ == '__main__': raise SystemExit(main())
