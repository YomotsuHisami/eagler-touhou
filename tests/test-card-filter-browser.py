"""Current library rail/minimap pointer, keyboard and retained-sheet contract.

Use an assembled loopback publication with TH06/07/08/10 and multiplayer cards.
This UI-only lane starts no native Runtime. Old filter preferences stay inert.
"""
import argparse
import json
from playwright.sync_api import sync_playwright, expect
from support.current_ui import require_local_publication, suppress_notices, open_current


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', nargs='?', default='http://127.0.0.1:8130/')
    args = parser.parse_args()
    base = require_local_publication(args.url, games=('th06', 'th07', 'th08', 'th10'))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            context = browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
            suppress_notices(context)
            context.add_init_script("localStorage.setItem('eagler-touhou-card-filter-v1','multiplayer')")
            page = context.new_page(); errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            open_current(page, base)
            shelves = page.locator('[data-library-shelf]')
            expect(shelves).to_have_count(2)
            shelf = page.locator('[data-library-shelf="singleplayer"]')
            rail = shelf.locator('#singleplayer-rail')
            dock = shelf.locator('[data-library-minimap]')
            buttons = dock.locator('[data-library-preview]')
            toggle = buttons.first
            panel = page.locator('[data-dialog-layout="library-panel"]')
            cards = shelf.locator('[data-library-product]')
            selected = shelf.locator('[data-library-product][data-library-selected="true"]')
            toggle.hover(); expect(dock.locator('[aria-current="true"]')).to_have_count(1)
            assert rail.evaluate('e => e.scrollLeft') == 0
            assert toggle.inner_text().strip() == '06'
            toggle.click(); expect(panel).to_be_visible()
            panel.get_by_role('button', name='Back to library', exact=True).click(); expect(panel).to_have_count(0)
            # Wheel events do not pan covers; intentional native pointer drags do.
            box = rail.bounding_box(); x, y = box['x'] + min(400, box['width'] - 10), box['y'] + 100
            page.mouse.move(x, y); page.mouse.wheel(180, 0); page.wait_for_timeout(120)
            assert rail.evaluate('e => e.scrollLeft') == 0
            page.mouse.down(); page.wait_for_timeout(360)
            expect(rail).to_have_attribute('data-library-dragging', 'true')
            page.mouse.move(x - 180, y, steps=6); page.mouse.up()
            assert rail.evaluate('e => e.scrollLeft') > 0
            assert page.evaluate('window.getSelection().toString()') == ''
            assert not rail.locator('a,img').evaluate_all('nodes => nodes.some(e => e.draggable)')
            expect(panel).to_have_count(0)
            page.mouse.move(x - 180, y); page.mouse.down(); page.wait_for_timeout(360)
            page.mouse.move(x + 100, y, steps=6); page.mouse.up()
            assert rail.evaluate('e => e.scrollLeft') == 0
            # Held and immediate dock scrubbing retain capture across gaps and
            # below button hit boxes, including reverse travel.
            first, last = buttons.first.bounding_box(), buttons.last.bounding_box()
            first_x, last_x = first['x'] + first['width']/2, last['x'] + last['width']/2
            y = first['y'] + first['height']/2
            last_id = buttons.last.get_attribute('data-library-preview')
            for hold in (460, 0):
                page.mouse.move(first_x, y); page.mouse.down()
                if hold: page.wait_for_timeout(hold)
                page.mouse.move(last_x, y, steps=4)
                expect(selected).to_have_attribute('data-library-product', last_id)
                assert buttons.first.evaluate('e => getComputedStyle(e).backgroundColor') != buttons.last.evaluate('e => getComputedStyle(e).backgroundColor')
                page.mouse.move(first_x, y + 36, steps=4)
                expect(selected).to_have_attribute('data-library-product', 'th06')
                page.mouse.move(last_x, y + 36, steps=4); page.mouse.up()
                expect(selected).to_have_attribute('data-library-product', last_id)
                expect(dock.locator('[aria-current="true"]')).to_have_count(1); expect(panel).to_have_count(0)
            # A new short press resets the old drag click guard: select, then open.
            toggle.click(); expect(panel).to_have_count(0); expect(toggle).to_have_attribute('aria-current', 'true')
            toggle.click(); expect(panel).to_be_visible()
            for target in (panel, page.locator('[data-library-stage]')):
                assert target.evaluate('e => getComputedStyle(e).backdropFilter') == 'none'
                assert target.evaluate('e => getComputedStyle(e).filter') == 'none'
            panel.get_by_role('button', name='Back to library', exact=True).click(); expect(panel).to_have_count(0)
            box = toggle.bounding_box(); page.mouse.move(box['x'] + box['width']/2, box['y'] + box['height']/2)
            page.mouse.down(); page.wait_for_timeout(460); page.mouse.up()
            expect(toggle).to_have_attribute('aria-current', 'true'); expect(panel).to_have_count(0)
            page.set_viewport_size({'width': 390, 'height': 844}); toggle.focus(); toggle.press('End')
            page.wait_for_function("document.querySelector('#singleplayer-rail').scrollLeft > 0")
            expect(selected).to_have_attribute('data-library-product', last_id); expect(panel).to_have_count(0)
            cards.first.click(); expect(panel).to_have_count(0); expect(toggle).to_have_attribute('aria-current', 'true')
            for _ in range(2):
                before = rail.bounding_box()
                cards.first.click(); expect(panel).to_be_visible()
                assert rail.bounding_box()['width'] == before['width']
                assert panel.evaluate('e => getComputedStyle(e).position') == 'fixed'
                panel.get_by_role('link', name='Resource manager', exact=True).click()
                expect(panel.locator('input[type=file]')).to_be_visible()
                panel.get_by_role('button', name='Back to settings', exact=True).click()
                panel.get_by_role('button', name='Back to library', exact=True).click(); expect(panel).to_have_count(0)
            expect(shelves).to_have_count(2)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.emulate_media(reduced_motion='reduce'); toggle.focus(); toggle.press('Home')
            assert toggle.evaluate("e => getComputedStyle(e).transitionDuration") == '0s'
            toggle.press('Escape'); expect(dock.locator('[aria-current="true"]')).to_have_count(1)
            assert not errors, errors
            print(json.dumps({'currentLibraryPointerKeyboardSheet': 'PASS', 'nativeRuntime': False}))
        finally:
            browser.close()


if __name__ == '__main__':
    main()
