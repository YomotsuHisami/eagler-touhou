"""Current cross-game touch settings and real editor interaction boundary.

Uses an assembled loopback publication, but starts no game/native Runtime.
Desktop input-mode help, shared settings, draft navigation and layout geometry
are browser assertions; model tests do not substitute for them.
"""
import argparse
import json
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import sync_playwright, expect
from support.current_ui import require_local_publication, suppress_notices, open_product, runtime_url


def editor(page):
    return page.locator('[role="dialog"].touch-editor')


def open_editor(page):
    page.get_by_role('button', name='Edit button layout', exact=True).click()
    expect(editor(page)).to_be_visible()
    expect(page.locator('[data-touch-editor-scene]')).to_have_attribute('data-touch-editor-ready', 'true')
    expect(editor(page).get_by_role('button', name='Save layout', exact=True)).to_be_enabled()
    return editor(page)


def close_editor(page, *, discard=False):
    editor(page).get_by_role('button', name='Exit', exact=True).click()
    decision = page.get_by_role('dialog', name='Save unfinished settings?', exact=True)
    if decision.is_visible():
        decision.get_by_role('button', name='Discard changes and continue' if discard else 'Save settings and continue', exact=True).click()
    expect(editor(page)).to_have_count(0)


def shared_settings(dialog):
    disclosure = dialog.locator('details').filter(has_text='Touch settings (autosaved)')
    if disclosure.get_attribute('open') is None:
        disclosure.locator('summary').click()
    return disclosure.get_by_role('group', name='Shared touch settings', exact=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', nargs='?', default='http://127.0.0.1:8130/')
    args = parser.parse_args()
    base = require_local_publication(args.url, games=('th06', 'th07'))
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={'width':1280,'height':800}, service_workers='block')
            suppress_notices(context)
            page = context.new_page(); errors = []
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.emulate_media(reduced_motion='reduce')
            open_product(page, base, 'th06')
            form = page.get_by_role('form',name='Game settings',exact=True)
            touch = form.get_by_label('Enable touch controls',exact=True)
            touch.set_checked(True)
            expect(touch).to_be_checked()
            # A desktop/fine-pointer device must follow the configured input
            # mode, not UA guesses. Contextual Help owns these explicit groups.
            page.get_by_role('link',name='Controls and help',exact=True).click()
            help_dialog = page.get_by_role('dialog',name='Controls and help',exact=True)
            expect(help_dialog.locator('[data-help-input="touch"]')).to_be_visible()
            expect(help_dialog.locator('[data-help-input="keyboard"]')).to_be_hidden()
            help_dialog.get_by_role('button',name='Close',exact=True).click()
            touch.set_checked(False)
            page.get_by_role('link',name='Controls and help',exact=True).click()
            expect(help_dialog.locator('[data-help-input="keyboard"]')).to_be_visible()
            expect(help_dialog.locator('[data-help-input="touch"]')).to_be_hidden()
            help_dialog.get_by_role('button',name='Close',exact=True).click()
            dialog = open_editor(page)
            workbench = page.locator('[data-touch-workbench]')
            for width,height in ((390,844),(1280,800)):
                page.set_viewport_size({'width':width,'height':height})
                bounds = workbench.bounding_box()
                assert bounds and bounds['width'] <= 290 and bounds['height'] <= 470, bounds
                expect(dialog.get_by_role('button',name='Save layout',exact=True)).to_be_visible()
            dialog.get_by_role('button',name='Collapse panel',exact=True).click()
            expect(dialog.get_by_label('Selected control',exact=True)).to_be_hidden()
            expect(workbench).to_have_attribute('data-collapsed','true')
            dialog.get_by_role('button',name='Expand panel',exact=True).click()
            expect(workbench).to_have_attribute('data-collapsed','false')
            expect(dialog.get_by_label('Selected control',exact=True)).to_be_visible()
            bomb = dialog.locator('.layout-placed.layout-bomb')
            before = bomb.bounding_box(); x,y = before['x']+before['width']/2,before['y']+before['height']/2
            page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+20,y-20,steps=3)
            expect(bomb).to_have_attribute('aria-pressed','true')
            expect(page.locator('[data-touch-editor-scene]')).to_have_attribute('data-touch-manipulating','true')
            page.mouse.up(); after=bomb.bounding_box()
            expect(page.locator('[data-touch-editor-scene]')).to_have_attribute('data-touch-manipulating','false')
            assert abs(after['x']-before['x'])+abs(after['y']-before['y']) >= 10, (before,after)
            assert runtime_url(page) == '', 'layout editing must not manufacture a native Runtime'
            editor_path = urlsplit(page.url).path
            page.go_back(wait_until='commit')
            decision=page.get_by_role('dialog',name='Save unfinished settings?',exact=True)
            expect(decision).to_be_visible()
            decision.get_by_role('button',name='Discard changes and continue',exact=True).click()
            expect(editor(page)).to_have_count(0)
            assert urlsplit(page.url).path == editor_path and 'touchLayout' not in parse_qs(urlsplit(page.url).query)
            # Main animates the complete editor scene; the workbench is not a
            # separately animated replacement for that full-screen transition.
            page.emulate_media(reduced_motion='no-preference')
            page.get_by_role('button',name='Edit button layout',exact=True).click()
            page.wait_for_function("document.querySelector('[data-touch-editor-scene]')?.getAnimations().some(a => a.playState === 'running')")
            assert not editor(page).locator('.layout-workbench').evaluate('e => e.getAnimations().length')
            page.wait_for_function("document.querySelector('[data-touch-editor-scene]')?.getAnimations().every(a => a.playState !== 'running')")
            assert editor(page).evaluate("e => getComputedStyle(e).opacity") == '1'
            page.emulate_media(reduced_motion='reduce')
            dialog=editor(page)
            expect(dialog.locator('.layout-placed.layout-restart')).to_have_count(0)
            settings=shared_settings(dialog)
            restart=settings.get_by_label('Show restart button',exact=True)
            practice=settings.get_by_label('Show thprac touch buttons',exact=True)
            assert restart.evaluate('(e, other) => !!(e.compareDocumentPosition(document.getElementById(other)) & Node.DOCUMENT_POSITION_FOLLOWING)',practice.get_attribute('id'))
            settings.get_by_role('button',name='200%',exact=True).click()
            settings.get_by_label('Focus method',exact=True).select_option('toggle-button')
            settings.get_by_label('Double-tap Bomb',exact=True).set_checked(True)
            restart.set_checked(True)
            escape=dialog.locator('.layout-placed.layout-escape').bounding_box()
            restart_rect=dialog.locator('.layout-placed.layout-restart').bounding_box()
            assert restart_rect and escape and restart_rect['y'] >= escape['y']+escape['height'] and abs(restart_rect['x']-escape['x']) <= 1, (escape,restart_rect)
            restart.set_checked(False)
            practice.set_checked(False)
            settings.get_by_label('Movement method',exact=True).select_option('joystick-free')
            expect(settings.get_by_text('Touch movement and the free-direction joystick use a new replay format incompatible with the original replay system.',exact=True)).to_be_visible()
            close_editor(page)
            page.get_by_role('button',name='Back to library',exact=True).click()
            open_product(page,base,'th07')
            dialog=open_editor(page); settings=shared_settings(dialog)
            expect(settings.get_by_label('Movement method',exact=True)).to_have_value('joystick-free')
            expect(settings.get_by_label('Focus method',exact=True)).to_have_value('toggle-button')
            expect(settings.get_by_label('Double-tap Bomb',exact=True)).to_be_checked()
            expect(settings.get_by_label('Show restart button',exact=True)).not_to_be_checked()
            expect(settings.get_by_label('Show thprac touch buttons',exact=True)).not_to_be_checked()
            expect(settings.get_by_role('button',name='200%',exact=True)).to_have_attribute('aria-pressed','true')
            expect(dialog.locator('.layout-placed.layout-restart')).to_have_count(0)
            stored=page.evaluate("JSON.parse(localStorage.getItem('eagler-touhou-touch-options-v1'))")
            assert stored['touchSensitivity']==200 and stored['touchFocusMode']=='toggle-button' and stored['doubleTapBombEnabled'] is True and stored['restartButtonEnabled'] is False,stored
            close_editor(page); assert not errors,errors
            print(json.dumps({'currentCrossGameTouchSettings':'PASS','nativeRuntime':False,'shared':stored}))
        finally:
            browser.close()


if __name__=='__main__':
    main()
