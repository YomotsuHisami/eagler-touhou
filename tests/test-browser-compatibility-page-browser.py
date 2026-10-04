"""Exercise the sealed Framework's early ES5 gate and standalone public guide.

Build first with npm run build:ui. EAGLER_UI_BUILD_DIRECTORY can select a sealed
nested-mount build. All requests are intercepted; no local server or deployment
is used. Synthetic UA/GPU cases do not establish actual browser/GPU support.
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent / "support"))
from ui_framework_browser import FrameworkArtifact, suppress_automatic_notices


def check(browser, artifact, label, user_agent, available, expected_reasons, *, platform="desktop", huawei=False):
    context = browser.new_context(user_agent=user_agent, service_workers="block", reduced_motion="reduce")
    try:
        artifact.install(context)
        artifact.install_probe(context, available=available, guide=True)
        suppress_automatic_notices(context)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(artifact.base_url, wait_until="domcontentloaded")
        if expected_reasons:
            page.wait_for_url("**/compatibility.html?*")
            assert urlsplit(page.url).path == artifact.mount_path + "compatibility.html", (label, page.url)
            query = parse_qs(urlsplit(page.url).query)
            assert query["reasons"][0].split(",") == expected_reasons, (label, query)
            assert query["platform"] == [platform], (label, query)
            assert query.get("huawei") == (["1"] if huawei else None), (label, query)
            failures = page.locator("#result").inner_text()
            rows = page.locator("#checks li").all_inner_texts()
            assert len(rows) == 4, (label, rows)
            for reason, name in [("chrome", "Chromium"), ("webgl2", "WebGL 2.0"),
                                 ("windows", "Windows"), ("ie", "IE")]:
                if reason in expected_reasons:
                    assert name + "：未通过" in " ".join(rows), (label, rows)
                    assert name in failures, (label, failures)
            if "Windows NT" in user_agent and "windows" not in expected_reasons:
                assert "Windows：通过" in " ".join(rows), (label, rows)
            assert page.locator("#computer").count() == 1
            assert page.locator("#phone").count() == 1
            assert page.locator("#graphics").count() == 1
            assert page.locator(".nav a").count() == 0
            assert page.locator("#recheck").inner_text() == "重新检测兼容性"
            assert page.locator("button#try-anyway").inner_text() == "我不管兼容性！我得亲自试试能不能玩！"
            order = page.locator(".section").evaluate_all("els => els.map(el => el.id)")
            assert order == ["computer", "graphics", "phone"], (label, order)
            assert page.locator(".columns").count() == 3
            assert page.locator('script[src], script[type="module"], link[rel="stylesheet"]').count() == 0
            page.set_viewport_size({"width": 390, "height": 844})
            assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), label
        else:
            assert urlsplit(page.url).path == artifact.mount_path, (label, page.url)
            # A rendered React library proves the real Framework boot completed.
            expect(page.get_by_role("heading", name="单机", exact=True)).to_be_visible()
            expect(page.locator("html")).to_have_attribute("lang", "zh-CN")
            assert page.evaluate("window.__reactRouterContext.isSpaMode") is True
            assert page.evaluate("window.__reactRouterContext.basename") == artifact.mount_path
            assert page.locator("#browser-compatibility-gate").get_attribute("data-compatibility-url") == artifact.mount_path + "compatibility.html"
        assert page.evaluate("window.__frameworkProbeFixture") == {
            "calls": 1, "releases": 1 if available else 0, "restored": True,
        }, label
        assert not errors, (label, errors)
        print("PASS", label, "[synthetic UA/WebGL2; sealed Framework mount", artifact.mount_path + "]")
    finally:
        context.close()


def direct_guide(browser, artifact, user_agent, available, expected):
    context = browser.new_context(user_agent=user_agent, service_workers="block")
    try:
        artifact.install(context)
        artifact.install_probe(context, available=available, guide=True)
        page = context.new_page()
        page.goto(artifact.base_url + "compatibility.html")
        assert page.locator("#checks li").count() == 4
        assert expected in page.locator("#result").inner_text()
        assert page.locator("#phone h3").first.inner_text() == "华为"
        assert page.locator("#checks .fail").count() == (0 if available else 1)
        assert page.locator("#checks .pass").count() == (4 if available else 3)
        assert page.locator("#checks .pass").first.evaluate("el => getComputedStyle(el).color") == "rgb(24, 122, 37)"
        if not available:
            assert page.locator("#checks .fail").first.evaluate("el => getComputedStyle(el).color") == "rgb(176, 0, 32)"
        with page.expect_navigation(wait_until="domcontentloaded"):
            page.locator("#recheck").click()
        assert page.locator("#checks li").count() == 4
        assert expected in page.locator("#result").inner_text()
        assert page.evaluate("window.__frameworkProbeFixture.restored") is True
        print("PASS direct guide and recheck", expected)
    finally:
        context.close()


def explicit_retry(browser, artifact, user_agent):
    context = browser.new_context(user_agent=user_agent, service_workers="block")
    try:
        artifact.install(context)
        artifact.install_probe(context, available=False, guide=True)
        suppress_automatic_notices(context)
        page = context.new_page()
        page.goto(artifact.base_url)
        page.wait_for_url("**/compatibility.html?*")
        with page.expect_navigation(wait_until="domcontentloaded"):
            page.locator("#try-anyway").click()
        assert page.url == artifact.base_url + "?compat=continue", page.url
        expect(page.get_by_role("heading", name="单机", exact=True)).to_be_visible()
        assert page.evaluate("window.__frameworkProbeFixture") == {"calls": 0, "releases": 0, "restored": True}
        # The button grants a single explicit document retry, not stored consent.
        page.goto(artifact.base_url)
        page.wait_for_url("**/compatibility.html?*")
        assert parse_qs(urlsplit(page.url).query)["reasons"] == ["webgl2"]
        print("PASS explicit mount-preserving retry does not persist a bypass")
    finally:
        context.close()


def win7(major):
    return (f"Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 "
            f"Chrome/{major}.0.0.0 Safari/537.36")


def main() -> int:
    artifact = FrameworkArtifact()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            check(browser, artifact, "Win7 + Chromium 126 + WebGL2", win7(126), True, [])
            check(browser, artifact, "Win7 + Chromium 132 + missing WebGL2", win7(132), False, ["webgl2"])
            check(browser, artifact, "Win7 + Chromium 125", win7(125), True, ["windows", "chrome"])
            check(browser, artifact, "IE11", "Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko", True, ["ie"])
            check(browser, artifact, "Huawei + Chromium 125", "Mozilla/5.0 (Linux; Android 11; HUAWEI XYZ) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36", True, ["chrome"], platform="mobile", huawei=True)
            direct_guide(browser, artifact, win7(126), True, "未发现失败项目")
            direct_guide(browser, artifact, win7(126), False, "WebGL 2.0")
            explicit_retry(browser, artifact, win7(132))
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
