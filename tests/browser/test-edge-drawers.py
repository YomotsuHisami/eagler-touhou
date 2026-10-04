"""Current sealed UI edge gestures; synthetic content/probe, not phone/game proof.

Run `npm run build:ui` first. Every request is isolated by FrameworkArtifact.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "tests" / "support"))
from ui_framework_browser import FrameworkArtifact


def swipe(page, start: tuple[int, int], end: tuple[int, int]) -> None:
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=8)
    page.mouse.up()


def main() -> int:
    artifact = FrameworkArtifact()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 430, "height": 820})
        artifact.install(context)
        artifact.install_probe(context, available=True)
        context.add_init_script("""localStorage.setItem('eagler-touhou-first-use-notice-seen-v1','1');
          localStorage.setItem('eagler-touhou-site-notice-enabled-v1','1');""")
        page = context.new_page()
        page.route("**/NOTICE.txt", lambda route: route.fulfill(status=200, content_type="text/plain", body="Source-owned notice fixture"))
        # Explicit headings fixture preserves h2 styling coverage; real prose now uses h3.
        page.route("**/content/FIRST_USE_NOTICE.html", lambda route: route.fulfill(status=200, content_type="text/html", body='<div class="first-use-notice-list"><section class="first-use-notice-item"><h2>Synthetic primary heading</h2><h3>Synthetic secondary heading</h3><p>Source-owned UI content</p></section></div>'))
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(artifact.base_url, wait_until="load")
        site = page.locator("[data-site-notice]")
        expect(site).to_be_visible()
        site.get_by_role("button", name="关闭公告", exact=True).click()
        expect(site).to_have_count(0)
        notice = page.get_by_role("dialog", name="首次使用须知", exact=True)
        captures = os.environ.get("EAGLER_EDGE_DRAWER_ARTIFACT_DIR")
        if captures:
            Path(captures).mkdir(parents=True, exist_ok=True)
        for attempt in range(2):
            swipe(page, (428, 320), (348, 321))
            expect(notice).to_be_visible()
            expect(notice).to_have_attribute("data-dialog-layout", "notice-right")
            expect(page).to_have_url(artifact.base_url)
            expect(notice).to_have_css("opacity", "1")
            box = notice.bounding_box()
            assert box and abs(box["x"] + box["width"] - 430) < 2, box
            backdrop = page.locator("[data-dialog-overlay]").last.evaluate("element=>getComputedStyle(element).backgroundColor")
            assert backdrop in ("rgba(0, 0, 0, 0)", "transparent"), backdrop
            heading = notice.locator(".notice-right-content h2").first.evaluate("element=>({size:parseFloat(getComputedStyle(element).fontSize),weight:parseInt(getComputedStyle(element).fontWeight,10)})")
            assert heading["size"] >= 21 and heading["weight"] >= 700, heading
            if captures:
                page.screenshot(path=str(Path(captures) / "first-use-notice-right.png"), full_page=True)
            if attempt == 0:
                notice.get_by_role("button", name="关闭首次使用须知", exact=True).click()
            else:
                swipe(page, (90, 320), (170, 321))
            expect(notice).to_have_count(0)
            expect(page.locator('[data-dialog-layout="notice-right"]')).to_have_count(0)
        swipe(page, (2, 600), (82, 601))
        expect(site).to_be_visible()
        expect(site).to_have_css("opacity", "1")
        site_box = site.bounding_box()
        assert site_box and abs(site_box["x"]) < 2, site_box
        if captures:
            page.screenshot(path=str(Path(captures) / "notice-left.png"), full_page=True)
        y = int(site_box["y"] + 30)
        x = int(site_box["x"] + site_box["width"] - 12)
        swipe(page, (x, y), (x - 80, y + 1))
        expect(site).to_have_count(0)
        assert not errors, errors
        print(json.dumps({"pass": True, "synthetic": True, "viewport": [430, 820],
          "firstUseNotice": {"side": "right", "box": box, "backdrop": backdrop, "heading": heading},
          "notice": {"side": "left", "box": site_box},
          "gestures": ["right-edge-reveal", "hint-close", "right-retract", "left-edge-reveal", "left-retract"],
          "nativeGameOrPhoneAcceptance": False}, ensure_ascii=False))
        browser.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
