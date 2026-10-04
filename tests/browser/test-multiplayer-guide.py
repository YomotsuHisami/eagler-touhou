"""Browser contract for the actual Framework React multiplayer guide.

Run after npm run build:ui (or select a sealed EAGLER_UI_BUILD_DIRECTORY).
Request interception isolates this UI-only lane from Host/runtime/network inputs.
No retired controller, replacement DOM, or legacy launcher CSS is loaded.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "support"))
from ui_framework_browser import FrameworkArtifact, suppress_automatic_notices


def assert_geometry(page, dialog, tabs, width: int, height: int) -> None:
    page.set_viewport_size({"width": width, "height": height})
    dialog.evaluate("element => element.scrollTo({top: 0, behavior: 'instant'})")
    box = dialog.bounding_box()
    assert box and box["x"] >= 0 and box["y"] >= -1, box
    assert box["x"] + box["width"] <= width + 1, box
    assert box["y"] + box["height"] <= height + 1, box
    assert dialog.evaluate("element => element.scrollWidth <= element.clientWidth + 1")
    for tab in tabs.all():
        bounds = tab.bounding_box()
        assert bounds and bounds["x"] >= box["x"], bounds
        assert bounds["x"] + bounds["width"] <= box["x"] + box["width"] + 1, bounds
        assert bounds["height"] >= 44, bounds
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")


def main() -> int:
    artifact = FrameworkArtifact()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={"width": 430, "height": 820},
                                          service_workers="block", reduced_motion="reduce")
            artifact.install(context)
            artifact.install_probe(context, available=True)
            suppress_automatic_notices(context)
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(artifact.base_url, wait_until="domcontentloaded")
            expect(page.get_by_role("heading", name="单机", exact=True)).to_be_visible()
            page.get_by_label("更多站点信息").click()
            trigger = page.get_by_role("button", name="联机玩法介绍", exact=True)
            trigger.click()
            dialog = page.get_by_role("dialog", name="联机玩法介绍", exact=True)
            expect(dialog).to_be_visible()
            tabs = dialog.get_by_role("tab")
            expect(tabs).to_have_count(4)
            expect(tabs).to_have_text(["红魔乡", "妖妖梦", "永夜抄", "风神录"])
            page.evaluate("document.fonts.ready")
            expect(tabs.nth(1)).to_have_attribute("aria-selected", "true")
            for index, game in enumerate(["th06", "th07", "th08", "th10"]):
                assert tabs.nth(index).get_attribute("aria-controls").endswith("-panel-" + game)
            expect(dialog.locator("details[open]")).to_have_count(0)

            for size in [(430, 820), (320, 640), (1280, 800)]:
                assert_geometry(page, dialog, tabs, *size)
            page.set_viewport_size({"width": 430, "height": 820})

            th07 = dialog.get_by_role("tabpanel", name="妖妖梦", exact=True)
            common, specific = th07.locator("details").all()
            expect(common.locator("summary")).to_have_text("通用规则")
            expect(specific.locator("summary")).to_have_text("本作特有规则")
            common.locator("summary").click()
            # Current authored rules, rather than stale old-controller copy.
            for text in ["Boss 耐久与玩家人数", "伤害系数 0.75", "伤害系数 2/3",
                         "不会直接改写 Boss 血量", "团队团灭后保留 180 个正常游戏逻辑帧",
                         "赠送Power者快速点按射击键 5 次", "统一跟随房主 / P1 的选择",
                         "所有玩家共享符卡收取或收取失败的状态"]:
                expect(common).to_contain_text(text)
            common.locator("summary").click()
            expect(common).not_to_have_attribute("open", "")
            specific.locator("summary").click()
            expect(specific).to_contain_text("樱点+（Cherry+）调整")
            expect(specific).to_contain_text("在妖妖梦中，Power机制经过微调")
            specific.locator("summary").click()

            tabs.nth(0).click()
            expect(th07).to_have_count(0)  # Hidden panels are absent from the accessibility tree.
            th06 = dialog.get_by_role("tabpanel", name="红魔乡", exact=True)
            th06.locator("details").nth(1).locator("summary").click()
            expect(th06.locator("details").nth(1).locator("div")).to_have_text("无")
            tabs.nth(3).click()
            th10 = dialog.get_by_role("tabpanel", name="风神录", exact=True)
            th10.locator("details").nth(1).locator("summary").click()
            expect(th10).to_contain_text("场上仍可操作的玩家全部达到满 Power 后")
            expect(th10).not_to_contain_text("Power 低于 1.00 时视为“无 Bomb”")
            tabs.nth(2).click()
            th08 = dialog.get_by_role("tabpanel", name="永夜抄", exact=True)
            th08.locator("details").nth(1).locator("summary").click()
            expect(th08).to_contain_text("每位玩家拥有独立的人妖率")
            expect(th08).to_contain_text("刻符池、夜晚时间与关卡推进为全队共享")

            # The React tablist owns keyboard selection and roving tab stops.
            tabs.nth(2).focus()
            for key, index in [("ArrowRight", 3), ("ArrowRight", 0), ("End", 3),
                               ("Home", 0), ("ArrowLeft", 3)]:
                page.keyboard.press(key)
                expect(tabs.nth(index)).to_be_focused()
                expect(tabs.nth(index)).to_have_attribute("aria-selected", "true")
                expect(tabs.nth(index)).to_have_attribute("tabindex", "0")
                expect(dialog.locator('[role="tab"][tabindex="0"]')).to_have_count(1)

            # Motion styles belong to the real modal; only authored guide nodes
            # must be free of active markup and inline styles.
            prose = dialog.locator('[lang="zh-CN"]')
            expect(prose.locator("[onerror], [onclick], [style], script, iframe")).to_have_count(0)
            expect(page.locator("[data-dialog-overlay]")).to_be_visible()
            page.keyboard.press("Escape")
            expect(dialog).to_have_count(0)
            # Return to the opener if its menu remains visible, otherwise to
            # the real modal's main-landmark fallback. Reopen through the UI.
            if trigger.is_visible():
                expect(trigger).to_be_focused()
            else:
                expect(page.locator("#main-content")).to_be_focused()
                page.get_by_label("更多站点信息").click()
            trigger.click()
            expect(dialog).to_be_visible()
            expect(tabs.nth(1)).to_have_attribute("aria-selected", "true")
            expect(dialog.locator("details[open]")).to_have_count(0)
            dialog.get_by_role("button", name="关闭", exact=True).click()
            expect(dialog).to_have_count(0)
            assert artifact.requests.count("content/MULTIPLAYER.html") == 1, artifact.requests
            assert page.evaluate("window.__frameworkProbeFixture") == {
                "calls": 1, "releases": 1, "restored": True,
            }
            assert not errors, errors
            print(json.dumps({"multiplayerGuide": "PASS", "surface": "sealed Framework React UI",
                              "gameTabs": 4, "viewports": [[430, 820], [320, 640], [1280, 800]],
                              "mount": artifact.mount_path, "syntheticEarlyWebGL2Probe": True}, ensure_ascii=False))
            context.close()
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
