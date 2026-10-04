"""L4 browser capability checks against current Launcher and Runtime builds.

Preconditions: current source served at --url with hosted DATA available.
Mutations: isolated browser contexts; navigator.getGamepads is unavailable.
Invariant: optional browser APIs do not prevent Runtime first-frame.
Proves: named browser/game launch lifecycle. Does NOT prove device input or gameplay.
"""

import argparse
import os
import sys
import json
import subprocess
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "support"))
from current_ui import require_local_publication, suppress_notices, open_product, set_music, launch_game, RuntimeEvents


def products():
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import {PRODUCT_GAMES} from './product-catalog.mjs'; console.log(JSON.stringify(PRODUCT_GAMES))"],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


def run_case(page, url, game):
    events = RuntimeEvents(page, game)
    page.context.add_init_script("Object.defineProperty(navigator, 'getGamepads', {configurable:true,value:undefined});")
    open_product(page, url, game)
    set_music(page, 'none')
    launch_game(page, game)
    events.wait()
    assert page.evaluate("typeof navigator.getGamepads === 'undefined'")
    return events.events


def main():
    catalog = products()
    default_games = [game for game, product in catalog.items() if product["dataProvider"] == "emscripten-preload"]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("EAGLER_NATIVE_SITE_URL"), help="Explicit loopback assembled current publication")
    parser.add_argument("--games", nargs="+", choices=catalog, default=default_games)
    parser.add_argument("--browsers", nargs="+", choices=["chromium", "webkit"], default=["chromium", "webkit"])
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "validation" / "browser-capabilities" / time.strftime("%Y%m%d-%H%M%S"))
    args = parser.parse_args()
    if not args.url: parser.error("--url or EAGLER_NATIVE_SITE_URL is required")
    args.url = require_local_publication(args.url, args.games)
    args.output.mkdir(parents=True, exist_ok=False)
    records = []
    with sync_playwright() as playwright:
        for engine in args.browsers:
            with getattr(playwright, engine).launch(headless=True) as browser:
                for game in args.games:
                    record = {"browser": engine, "browserVersion": browser.version, "game": game,
                              "capability": "gamepad-absent", "level": "L4"}
                    with browser.new_context(locale="zh-CN") as context:
                        suppress_notices(context)
                        page = context.new_page()
                        try:
                            record["events"] = run_case(page, args.url, game)
                            record["status"] = "PASS"
                        except Exception:
                            record.update(status="FAIL", error=traceback.format_exc())
                            page.screenshot(path=str(args.output / f"{engine}-{game}.png"))
                    records.append(record)
                    (args.output / "report.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(f"{engine}/{game}/gamepad-absent: {record['status']}", flush=True)
    raise SystemExit(1 if any(record["status"] != "PASS" for record in records) else 0)


if __name__ == "__main__":
    main()
