"""Shared vertical directory and persistent launcher interaction regression."""
import argparse
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url', nargs='?', default='http://127.0.0.1:8130/')
    parser.add_argument('--test-build', action='store_true')
    args = parser.parse_args()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1280, 'height': 900}, service_workers='block')
        context.add_init_script("localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');localStorage.setItem('eagler-touhou-site-notice-enabled-v1','0')")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.wait_for_function('window.__eaglerBoot?.done === true')
        cards = page.locator('.game[data-game]:not([hidden])')
        ids = cards.evaluate_all('nodes => nodes.map(e => e.dataset.game)')
        assert len(ids) >= 2 and len(ids) == len(set(ids))
        assert page.locator('.game-shelf:not([hidden])').count() == 1
        assert page.locator('.tools').get_attribute('aria-hidden') == 'false'
        assert not page.locator('.game-library').evaluate('e => e.inert')
        second = cards.nth(1)
        second.click()
        selected_game = second.get_attribute('data-game')
        assert f'game={selected_game}' in page.url
        assert second.get_attribute('aria-current') == 'page'
        assert page.locator('#gameId').get_attribute('data-game') == selected_game
        assert page.locator('.tools').get_attribute('aria-modal') != 'true'
        mp = page.locator('[data-launch-mode=multiplayer]')
        if mp.is_visible():
            mp.click()
            assert f'game={selected_game}mp' in page.url
            assert mp.get_attribute('aria-pressed') == 'true'
            assert second.get_attribute('aria-current') == 'page'
            solo = page.locator('[data-launch-mode=singleplayer]')
            assert solo.is_visible()
            solo.click()
            assert solo.get_attribute('aria-pressed') == 'true'
            page.go_back()
            assert mp.get_attribute('aria-pressed') == 'true'
            solo.click()
        # Keyboard movement changes focus without opening a modal or trapping Tab.
        cards.first.focus()
        page.keyboard.press('ArrowDown')
        assert second.evaluate('e => document.activeElement === e')
        page.keyboard.press('Enter')
        assert second.get_attribute('aria-current') == 'page'
        # Selected covers stay larger; pointer magnification smoothly affects neighbors.
        page.mouse.move(1000, 100)
        page.wait_for_function("getComputedStyle(document.querySelector('.game.selected')).scale === '1.16'")
        first_box, selected_box = cards.first.bounding_box(), second.bounding_box()
        assert abs(first_box['width'] - first_box['height']) < 1
        assert selected_box['width'] > first_box['width'] * 1.1
        assert cards.first.locator('img').evaluate("e => getComputedStyle(e).objectFit") == 'cover'
        cards.nth(2).hover()
        page.wait_for_function("parseFloat(document.querySelectorAll('.game[data-game]')[2].style.getPropertyValue('--dock-wave')) > .1")
        waves = cards.evaluate_all("nodes => nodes.map(e => parseFloat(e.style.getPropertyValue('--dock-wave')) || 0)")
        assert waves[2] > waves[1] > waves[0]
        assert waves[2] > waves[3] > waves[4]
        page.mouse.move(1000, 100)
        page.wait_for_function("[...document.querySelectorAll('.game[data-game]')].every(e => !e.style.getPropertyValue('--dock-wave'))")
        for width in [1280, 768, 390, 320]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.wait_for_function("getComputedStyle(document.querySelector('.game.selected')).scale === (innerWidth <= 780 ? '1.12' : '1.16')")
            first_box, next_box = cards.first.bounding_box(), second.bounding_box()
            tools_box = page.locator('.tools').bounding_box()
            if width <= 780:
                assert next_box['x'] >= first_box['x'] + first_box['width']
                assert abs(next_box['y'] + next_box['height']/2 - first_box['y'] - first_box['height']/2) < 2
                assert tools_box['y'] >= first_box['y'] + first_box['height']
                assert tools_box['width'] > width - 50
                second.hover()
                assert cards.evaluate_all("nodes => nodes.every(e => !e.style.getPropertyValue('--dock-wave'))")
                cards.first.focus()
                page.keyboard.press('ArrowRight')
                assert second.evaluate('e => document.activeElement === e')
            else:
                assert next_box['y'] >= first_box['y'] + first_box['height']
                assert abs(next_box['x'] + next_box['width']/2 - first_box['x'] - first_box['width']/2) < 2
                assert tools_box['x'] >= first_box['x'] + first_box['width']
            assert page.locator('#launch').is_visible()
        assert not errors, errors
        browser.close()
    print('Persistent game directory: PASS')


if __name__ == '__main__':
    main()
