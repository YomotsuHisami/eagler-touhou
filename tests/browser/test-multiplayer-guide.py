from __future__ import annotations

import json
import socket
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


PROJECT = Path(__file__).resolve().parents[2]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args) -> None:
        pass


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def main() -> int:
    # Keep this browser test focused on the guide. The full development server
    # needs private Runtime DATA inputs which are unrelated to this surface.
    subprocess.run(
        ["node", "scripts/build-launcher.mjs", "--force"],
        cwd=PROJECT,
        check=True,
        stdout=subprocess.DEVNULL,
    )

    port = free_port()
    handler = partial(QuietHandler, directory=str(PROJECT))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 430, "height": 820})
            page.goto(f"http://127.0.0.1:{port}/public/", wait_until="domcontentloaded")
            page.set_content(
                """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/public/styles.css">
</head>
<body>
  <dialog class="multiplayer-guide-dialog" id="mpGuideDialog" aria-labelledby="mpGuideTitle">
    <article class="multiplayer-guide-window">
      <header><h1 id="mpGuideTitle">联机玩法介绍</h1><button id="mpGuideClose">×</button></header>
      <div class="multiplayer-guide-content" id="mpGuideContent"></div>
    </article>
  </dialog>
</body>
</html>
""",
                wait_until="load",
            )
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.evaluate(
                """async () => {
                  const module = await import('/.cache/build/browser/assets/launcher/multiplayer-guide.mjs');
                  window.__mpGuide = module.createMultiplayerGuideController({ getGameId: () => 'th07' });
                  await window.__mpGuide.show();
                }"""
            )
            page.wait_for_selector("#mpGuideContent [data-mp-rule-guide]")

            # The content source owns game-rule wording. Prove the dialog keeps
            # every authored group visible instead of freezing older mechanics.
            authored_groups = page.evaluate("""async () => {
              const template = document.createElement('template');
              template.innerHTML = await (await fetch('/public/content/MULTIPLAYER.html')).text();
              const groups = {}; let current;
              for (const node of template.content.children) {
                if (node.tagName === 'H2') current = groups[node.textContent.trim()] = [];
                else if (current && node.textContent.trim() !== '本作特有规则')
                  current.push(node.textContent.replace(/\\s+/g, ' ').trim());
              }
              return groups;
            }""")

            def assert_group_visible(group, text):
                normalized = " ".join(text.split())
                for paragraph in authored_groups[group]:
                    assert paragraph in normalized, (group, paragraph)

            game_tabs = page.locator("#mpGuideContent .multiplayer-rule-game-tab")
            assert game_tabs.count() == 4
            assert [game_tabs.nth(i).get_attribute("data-game") for i in range(4)] == ["th06", "th07", "th08", "th10"]
            assert game_tabs.all_inner_texts() == ["红魔乡", "妖妖梦", "永夜抄", "风神录"]
            for i in range(4):
                box = game_tabs.nth(i).bounding_box()
                assert box and box["x"] >= 0 and box["x"] + box["width"] <= 430
            assert page.locator('#mpGuideContent .multiplayer-rule-game-tab[data-game="th07"]').get_attribute("aria-selected") == "true"

            th07_panel = page.locator('#mpGuideContent .multiplayer-rule-panel[data-game="th07"]')
            common = th07_panel.locator('details[data-scope="common"]')
            specific = th07_panel.locator('details[data-scope="specific"]')
            assert common.get_attribute("open") is None
            assert specific.get_attribute("open") is None
            assert common.locator("summary").inner_text().startswith("通用规则")
            assert specific.locator("summary").inner_text().startswith("本作特有规则")

            page.locator('button[data-game="th06"]').click()
            th06_specific = page.locator('.multiplayer-rule-panel[data-game="th06"] details[data-scope="specific"]')
            th06_specific.locator("summary").click()
            assert th06_specific.locator(".multiplayer-rule-disclosure-body").inner_text().strip() == "无"

            page.locator('button[data-game="th07"]').click()
            common.locator("summary").click()
            common_text = common.inner_text()
            assert_group_visible("通用规则", common_text)
            common.locator("summary").click()
            assert common.get_attribute("open") is None

            specific.locator("summary").click()
            assert th07_panel.is_visible()
            assert_group_visible("TH07 妖妖梦", th07_panel.inner_text())
            specific.locator("summary").click()
            assert specific.get_attribute("open") is None

            page.locator('#mpGuideContent .multiplayer-rule-game-tab[data-game="th10"]').click()
            th10_panel = page.locator('#mpGuideContent .multiplayer-rule-panel[data-game="th10"]')
            th10_specific = th10_panel.locator('details[data-scope="specific"]')
            th10_specific.locator("summary").click()
            th10_text = th10_panel.inner_text()
            assert th10_panel.is_visible()
            assert_group_visible("TH10 风神录", th10_text)
            assert page.locator("#mpGuideContent").evaluate("element => element.scrollTop") == 0
            page.locator('#mpGuideContent .multiplayer-rule-game-tab[data-game="th08"]').click()
            th08_panel = page.locator('#mpGuideContent .multiplayer-rule-panel[data-game="th08"]')
            th08_panel.locator('details[data-scope="specific"] summary').click()
            assert_group_visible("TH08 永夜抄", th08_panel.inner_text())

            assert page.locator("#mpGuideContent [onerror]").count() == 0
            assert page.locator("#mpGuideContent [style]").count() == 0
            assert page.locator("#mpGuideContent script").count() == 0
            backdrop = page.locator("#mpGuideDialog").evaluate(
                "element => ({ background: getComputedStyle(element, '::backdrop').backgroundColor, filter: getComputedStyle(element, '::backdrop').backdropFilter })"
            )
            assert backdrop["background"] in ("rgba(0, 0, 0, 0)", "transparent"), backdrop
            assert backdrop["filter"] in ("none", ""), backdrop
            assert not errors, errors
            print(json.dumps({"multiplayerGuide": "PASS", "gameTabs": 4, "viewport": [430, 820], "backdrop": backdrop}, ensure_ascii=False))
            browser.close()
        return 0
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
