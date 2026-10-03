"""Exercise the generated first-page compatibility gate in an actual browser.

The test uses isolated request interception, not a running development server,
so an unrelated localhost site or language preference cannot affect results.
"""
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / ".cache/build/optimized/index.html").read_bytes()
GUIDE = (ROOT / "public/compatibility.html").read_bytes()
ORIGIN = "http://compatibility.test/"


def serve(route):
    path = urlsplit(route.request.url).path
    if path in ("/", "/index.html"):
        route.fulfill(status=200, body=INDEX, content_type="text/html; charset=utf-8")
    elif path == "/compatibility.html":
        route.fulfill(status=200, body=GUIDE, content_type="text/html; charset=utf-8")
    else:
        route.fulfill(status=404)


def check(browser, label, user_agent, available, expected_reasons):
    context = browser.new_context(user_agent=user_agent, service_workers="block")
    page = context.new_page()
    # Intercept only the ephemeral probe; no driver or graphics hardware is
    # inferred from these controlled browser tests.
    page.add_init_script("window.__compatMockWebGL2 = " + ("true" if available else "false") + ";" + """(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
            if (kind === 'webgl2') return window.__compatMockWebGL2
                ? { isContextLost: () => false, getExtension: () => null } : null;
            return original.call(this, kind, ...args);
        };
    })();""")
    page.route(ORIGIN + "**", serve)
    page.goto(ORIGIN, wait_until="domcontentloaded")
    if expected_reasons:
        page.wait_for_url("**/compatibility.html?*")
        query = parse_qs(urlsplit(page.url).query)
        assert query["reasons"][0].split(",") == expected_reasons, (label, query)
        failures = page.locator("#result").inner_text()
        rows = page.locator("#checks li").all_inner_texts()
        assert len(rows) == 4, (label, rows)
        if "chrome" in expected_reasons:
            assert "Chromium：未通过" in " ".join(rows), (label, rows)
        if "webgl2" in expected_reasons:
            assert "WebGL 2.0：未通过" in " ".join(rows), (label, rows)
            assert "WebGL 2.0" in failures, (label, failures)
        if "windows" in expected_reasons:
            assert "Windows：未通过" in " ".join(rows), (label, rows)
        if "windows" not in expected_reasons and "chrome" not in expected_reasons:
            assert "Windows：通过" in " ".join(rows), (label, rows)
        assert page.locator("#computer").count() == 1
        assert page.locator("#phone").count() == 1
        assert page.locator("#graphics").count() == 1
        assert page.locator(".nav a").count() == 0
        assert page.locator("#recheck").inner_text() == "重新检测兼容性"
        assert page.locator('button#try-anyway').inner_text() == "我不管兼容性！我得亲自试试能不能玩！"
        order = page.locator(".section").evaluate_all("els => els.map(el => el.id)")
        assert order == ["computer", "graphics", "phone"], (label, order)
        assert page.locator(".columns").count() == 3
        page.set_viewport_size({"width": 390, "height": 844})
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), label
    else:
        assert urlsplit(page.url).path == "/", (label, page.url)
        assert page.locator("html").get_attribute("lang") == "zh-CN"
        assert page.evaluate("typeof window.__eaglerBoot") == "object"
    print("PASS", label)
    context.close()


def direct_guide(browser, user_agent, available, expect):
    context = browser.new_context(user_agent=user_agent, service_workers="block")
    page = context.new_page()
    page.add_init_script("window.__mockGL = " + ("true" if available else "false") + ";" + """(() => {
        HTMLCanvasElement.prototype.getContext = function (kind) {
            return kind === 'webgl2' && window.__mockGL
                ? { isContextLost: () => false, getExtension: () => null } : null;
        };
    })();""")
    page.route(ORIGIN + "**", serve)
    page.goto(ORIGIN + "compatibility.html")
    assert page.locator("#checks li").count() == 4
    assert expect in page.locator("#result").inner_text()
    assert page.locator("#phone h3").first.inner_text() == "华为"
    assert page.locator("#checks .fail").count() == (0 if available else 1)
    assert page.locator("#checks .pass").count() == (4 if available else 3)
    assert page.locator("#checks .pass").first.evaluate("el => getComputedStyle(el).color") == "rgb(24, 122, 37)"
    if not available:
        assert page.locator("#checks .fail").first.evaluate("el => getComputedStyle(el).color") == "rgb(176, 0, 32)"
    page.locator("#recheck").click()
    page.wait_for_load_state("domcontentloaded")
    assert page.locator("#checks li").count() == 4
    assert expect in page.locator("#result").inner_text()
    print("PASS direct guide", expect)
    context.close()


win7 = lambda major: (
    f"Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 "
    f"Chrome/{major}.0.0.0 Safari/537.36"
)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        check(browser, "Win7 + Chromium 126 + WebGL2", win7(126), True, [])
        check(browser, "Win7 + Chromium 132 + missing WebGL2", win7(132), False, ["webgl2"])
        check(browser, "Win7 + Chromium 125", win7(125), True, ["windows", "chrome"])
        direct_guide(browser, win7(126), True, "未发现失败项目")
        direct_guide(browser, win7(126), False, "WebGL 2.0")
    finally:
        browser.close()
