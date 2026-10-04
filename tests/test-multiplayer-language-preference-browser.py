"""A direct TH06 multiplayer settings entry restores language after Host metadata arrives."""

import argparse
import json
from support.current_ui import require_local_publication, suppress_notices, open_product

from playwright.sync_api import sync_playwright, expect


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="loopback assembled Framework publication URL")
    args = parser.parse_args()
    base = require_local_publication(args.url, games=("th06mp",))

    pack = {
        "url": "games/th06/language/lang_zh-hans.zip",
        "bytes": 1,
        "sha256": "0" * 64,
        "runtimeVersion": "test",
        "files": 1,
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        cases = (
            ("lang_zh-hans", None, True, "lang_zh-hans"),
            ("ja", "lang_zh-hans", False, "lang_zh-hans"),
            ("unsupported", None, True, "ja"),
        )
        for single_language, multiplayer_language, share_settings, expected in cases:
            context = browser.new_context(service_workers="block")
            suppress_notices(context)
            context.add_init_script(
                "localStorage.setItem('eagler-touhou-language-v1-th06', "
                f"{json.dumps(single_language)});"
                + (
                    "" if share_settings else
                    "localStorage.setItem('eagler-touhou-th06mp-share-singleplayer-settings-v1', '0');"
                    "localStorage.setItem('eagler-touhou-language-v1-th06mp', "
                    f"{json.dumps(multiplayer_language)});"
                )
            )

            def publish_language(route):
                manifest = route.fetch().json()
                manifest["games"]["th06"]["languages"] = [
                    {"id": "lang_zh-hans", "title": "中文（简体）", "pack": pack}
                ]
                manifest["games"]["th06"]["languageOptions"] = [
                    {"id": "ja", "title": "日本語(原版)", "pack": None},
                    {"id": "lang_zh-hans", "title": "中文（简体）", "pack": pack},
                ]
                route.fulfill(status=200, content_type="application/json", body=json.dumps(manifest))

            context.route("**/host-manifest.json", publish_language)
            page = context.new_page()
            # Direct multiplayer settings is the current entry; no room is
            # created just to observe local preference/Host-catalog hydration.
            open_product(page, base, "th06mp")
            selector = page.get_by_role("form", name="Game settings", exact=True).get_by_label("Game language", exact=True)
            expect(selector).to_have_value(expected)
            actual = selector.input_value()
            page.reload(wait_until="load")
            expect(selector).to_have_value(expected)
            assert actual == expected, {
                "single": single_language,
                "multiplayer": multiplayer_language,
                "share": share_settings,
                "expected": expected,
                "actual": actual,
            }
            context.close()
        browser.close()
    print(json.dumps({"th06mpDirectSettingsLanguagePreference": "PASS"}))


if __name__ == "__main__":
    main()
