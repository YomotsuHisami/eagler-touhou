"""Touch layout settings remain shared when the selected game changes."""
import json
import sys

from playwright.sync_api import sync_playwright


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8130/"
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        context.add_init_script(
            "localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1')"
        )
        page = context.new_page()
        page.emulate_media(reduced_motion="reduce")
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url, wait_until="load", timeout=30000)
        page.wait_for_function("window.__eaglerBoot?.done === true", timeout=30000)
        # The one-time first-use notice decision resolves asynchronously after
        # boot and may open between the first state check and the next click.
        page.wait_for_timeout(500)
        if page.locator("#firstUseNoticeDialog").get_attribute("open") is not None:
            page.locator("#firstUseNoticeCloseHint").click()
            page.wait_for_function("document.querySelector('#firstUseNoticeDialog')?.open === false")

        page.locator('.game[data-game="th06"]:not([data-product])').click()
        page.locator("#mobileOptionsToggle").click()
        page.wait_for_function("document.querySelector('#mobileOptions').classList.contains('open')")
        assert page.locator("#touchHelpOpen").get_attribute("aria-label") in ("打开帮助", "Open help")
        assert page.locator("#touchHelpOpen svg").count() == 1

        # Help content follows the enabled input mode, not UA/pointer heuristics.
        # This context has a desktop/fine pointer, so enabling Touch is the
        # regression case that previously kept showing keyboard/gamepad help.
        page.locator("#touchToggle").click()
        page.wait_for_function("document.querySelector('#decisionDialog')?.open === true")
        page.evaluate(
            "document.querySelector('.decision-window').requestSubmit(document.querySelector('#decisionConfirm'))"
        )
        page.wait_for_function("document.querySelector('#touchToggle').getAttribute('aria-checked') === 'true'")
        assert page.locator("#touchHelp").evaluate("el => el.classList.contains('touch-help-touch-input')")
        assert page.locator(".help-mobile-only").first.evaluate("el => getComputedStyle(el).display !== 'none'")
        assert page.locator(".help-desktop-only").first.evaluate("el => getComputedStyle(el).display === 'none'")
        page.locator("#touchToggle").click()
        assert not page.locator("#touchHelp").evaluate("el => el.classList.contains('touch-help-touch-input')")
        assert page.locator(".help-mobile-only").first.evaluate("el => getComputedStyle(el).display === 'none'")
        assert page.locator(".help-desktop-only").first.evaluate("el => getComputedStyle(el).display !== 'none'")

        page.evaluate("document.querySelector('#touchLayoutEdit').click()")
        page.wait_for_timeout(1500)
        assert page.locator("#touchLayoutEditor").evaluate("el => !el.hidden"), {
            "errors": errors,
            "status": page.locator("#status").text_content(),
        }
        # Keep the preview usable: compact by default and out of the way during drag.
        page.evaluate("async () => { if (document.fullscreenElement) await document.exitFullscreen(); }")
        for width, height in ((390, 844), (1280, 800)):
            page.set_viewport_size({"width": width, "height": height})
            panel = page.locator("#touchLayoutEditor").bounding_box()
            assert panel["width"] <= 290 and panel["height"] <= 470, panel
            assert page.locator("#touchLayoutSave").is_visible()
        page.locator("#touchLayoutCollapse").click()
        assert not page.locator("#touchWorkbenchBody").is_visible()
        page.locator("#touchLayoutCollapse").click()
        control = page.locator("#touchBomb").bounding_box()
        x, y = control["x"] + control["width"] / 2, control["y"] + control["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 20, y - 20, steps=3)
        assert page.locator("#player").evaluate("el => el.classList.contains('touch-layout-manipulating')")
        page.mouse.up()
        assert not page.locator("#player").evaluate("el => el.classList.contains('touch-layout-manipulating')")
        editor_url = page.url
        page.go_back(wait_until="commit")
        page.wait_for_timeout(100)
        if page.locator("#decisionDialog").evaluate("el => el.open"):
            page.evaluate(
                "document.querySelector('.decision-window').requestSubmit(document.querySelector('#decisionConfirm'))"
            )
        page.wait_for_selector("#touchLayoutEditor", state="hidden")
        assert page.url == editor_url, "system Back must close only the editor history entry"
        assert not page.locator("#player").evaluate("el => el.classList.contains('touch-layout-edit')")
        page.emulate_media(reduced_motion="no-preference")
        page.evaluate("document.querySelector('#touchLayoutEdit').click()")
        page.wait_for_function("document.querySelector('#player').getAnimations().some(a => a.playState === 'running')")
        assert page.locator("#touchLayoutEditor").evaluate("el => el.getAnimations().length === 0"), "enter the whole settings scene, not just the floating panel"
        page.wait_for_function("document.querySelector('#player').getAnimations().length === 0")
        assert page.locator("#player").evaluate("el => getComputedStyle(el).opacity === '1' && !el.classList.contains('touch-layout-preparing')")
        page.emulate_media(reduced_motion="reduce")
        page.wait_for_selector("#touchLayoutEditor:not([hidden])")
        assert page.locator("#touchRestart").evaluate(
            "el => el.hidden && getComputedStyle(el).display === 'none'"
        ), "disabled R must be actually hidden in the layout editor"

        assert page.locator("#touchLayoutSettingsPanel").is_visible()
        assert page.locator("#touchLayoutArrangement").is_visible()
        assert page.locator("#restartButtonToggle").evaluate(
            "r => !!(r.closest('.touch-layout-setting-row').compareDocumentPosition("
            "document.querySelector('#thpracTouchControlsToggle').closest('.touch-layout-setting-row')) "
            "& Node.DOCUMENT_POSITION_FOLLOWING)"
        )
        page.locator("#touchSensitivity").evaluate(
            "input => { input.value = '200'; input.dispatchEvent(new Event('input', {bubbles:true})); "
            "input.dispatchEvent(new Event('change', {bubbles:true})); }"
        )
        page.locator("#touchFocusMode").select_option("toggle-button", force=True)
        page.locator("#doubleTapBombToggle").click()
        page.locator("#restartButtonToggle").click()
        assert page.locator("#restartButtonToggle").get_attribute("aria-checked") == "true"
        restart_geometry = page.evaluate("""() => {
          const escapeRect = document.querySelector('#touchEscape').getBoundingClientRect();
          const restart = document.querySelector('#touchRestart');
          const restartRect = restart.getBoundingClientRect();
          return {
            hidden: restart.hidden,
            display: getComputedStyle(restart).display,
            escapeBottom: escapeRect.bottom,
            restartTop: restartRect.top,
            leftDelta: Math.abs(escapeRect.left - restartRect.left),
          };
        }""")
        assert restart_geometry["hidden"] is False, restart_geometry
        assert restart_geometry["display"] != "none", restart_geometry
        assert restart_geometry["restartTop"] >= restart_geometry["escapeBottom"], restart_geometry
        assert restart_geometry["leftDelta"] <= 1, restart_geometry
        page.locator("#restartButtonToggle").click()
        page.locator("#touchMovementMode").select_option("joystick-free", force=True)
        page.wait_for_function("document.querySelector('#decisionDialog')?.open === true")
        page.evaluate(
            "document.querySelector('.decision-window').requestSubmit(document.querySelector('#decisionConfirm'))"
        )
        page.wait_for_function("document.querySelector('#decisionDialog')?.open === false")

        page.locator("#touchLayoutExit").click()
        page.wait_for_timeout(100)
        if page.locator("#decisionDialog").evaluate("el => el.open"):
            page.evaluate(
                "document.querySelector('.decision-window').requestSubmit(document.querySelector('#decisionConfirm'))"
            )
        page.wait_for_selector("#touchLayoutEditor", state="hidden")
        page.locator("#libraryBack").click()
        page.locator('.game[data-game="th07"]:not([data-product])').click()
        if not page.locator("#mobileOptions").evaluate("el => el.classList.contains('open')"):
            page.locator("#mobileOptionsToggle").click()
        page.wait_for_function("document.querySelector('#mobileOptions').classList.contains('open')")
        page.evaluate("document.querySelector('#touchLayoutEdit').click()")
        page.wait_for_timeout(1500)
        assert page.locator("#touchLayoutEditor").evaluate("el => !el.hidden"), {
            "errors": errors,
            "status": page.locator("#status").text_content(),
        }

        shared = page.evaluate("""() => ({
          movement: document.querySelector('#touchMovementMode').value,
          sensitivity: document.querySelector('#touchSensitivity').value,
          focus: document.querySelector('#touchFocusMode').value,
          doubleTapBomb: document.querySelector('#doubleTapBombToggle').getAttribute('aria-checked'),
          restart: document.querySelector('#restartButtonToggle').getAttribute('aria-checked'),
          restartHidden: document.querySelector('#touchRestart').hidden,
          thpracButtons: document.querySelector('#thpracTouchControlsToggle').getAttribute('aria-checked'),
          stored: JSON.parse(localStorage.getItem('eagler-touhou-touch-options-v1')),
        })""")
        assert shared["movement"] == "joystick-free", shared
        assert shared["sensitivity"] == "200", shared
        assert shared["focus"] == "toggle-button", shared
        assert shared["doubleTapBomb"] == "true", shared
        assert shared["restart"] == "false", shared
        assert shared["restartHidden"] is True, shared
        assert shared["thpracButtons"] == "false", shared
        assert shared["stored"]["restartButtonEnabled"] is False, shared
        assert not errors, errors
        print(json.dumps({"browser": browser.version, "cross_game_touch_settings": "PASS", "restart_above_thprac": "PASS"}))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
