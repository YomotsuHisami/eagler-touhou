import argparse
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "support"))
from current_ui import (require_local_publication, suppress_notices, open_product, import_package, set_music, launch_game, runtime_url, RuntimeEvents)

from playwright.sync_api import sync_playwright, expect


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("game", choices=["th06", "th07"])
    parser.add_argument("package_zip")
    parser.add_argument("--engine", choices=["chromium", "firefox"], default="chromium")
    args = parser.parse_args()
    package_zip = os.path.abspath(args.package_zip)
    if not os.path.isfile(package_zip):
        raise FileNotFoundError(package_zip)

    base = require_local_publication(args.url, [args.game])
    with sync_playwright() as playwright:
        browser_type = getattr(playwright, args.engine)
        browser = browser_type.launch(headless=True)
        context = browser.new_context()
        suppress_notices(context)
        page = context.new_page()
        events = RuntimeEvents(page, args.game)
        open_product(page, base, args.game)
        import_package(page, base, args.game, package_zip)

        snapshot_js = """
          async game => {
            const db = await new Promise((resolve, reject) => {
              const request = indexedDB.open('eagler-touhou-package-store-v1');
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              const installation = await new Promise((resolve, reject) => {
                const request = db.transaction(['installations'], 'readonly').objectStore('installations').get(game);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              const generation = await new Promise((resolve, reject) => {
                const request = db.transaction(['generations'], 'readonly').objectStore('generations').get([game, installation.currentGeneration]);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              return { installation, generation };
            } finally { db.close(); }
          }
        """
        imported = page.evaluate(snapshot_js, args.game)
        descriptor = imported["generation"]["descriptor"]
        if imported["installation"]["source"] != "local" or not descriptor["revision"].endswith("-no-ogg"):
            raise AssertionError(f"content-only import identity was not preserved: {imported}")
        if "runtime" in descriptor or "runtimes" in descriptor or descriptor.get("runtimeRequirement", {}).get("dataFile") != "game-data":
            raise AssertionError("content-only import unexpectedly carries an executable Runtime")
        if any(item.get("source", "").lower().endswith((".html", ".js", ".wasm")) for item in descriptor["files"].values()):
            raise AssertionError("content-only import contains executable Runtime files")

        set_music(page, "none")
        launch_region = page.get_by_role("region", name=f"{args.game.upper()} game launch", exact=True)
        # Current UI exposes an explicit update choice without auto-launching an
        # imported package. Preserve the imported-to-remote provenance check.
        expect(launch_region.get_by_role("button", name="Update now", exact=True)).to_be_enabled(timeout=30000)
        prompt_text = launch_region.inner_text()
        assert "import" in prompt_text.lower(), prompt_text
        launch_game(page, args.game, update_choice="update-now", timeout=180000)
        events.wait(timeout=180000)

        updated = page.evaluate(snapshot_js, args.game)
        catalog = page.evaluate("base => fetch(new URL('release-catalog.json', base), { cache: 'no-store' }).then(response => response.json())", base)
        expected_revision = catalog["games"][args.game]["revision"]
        if updated["generation"]["descriptor"]["revision"] != expected_revision:
            raise AssertionError("imported content did not update to the associated remote release")
        if updated["installation"]["source"] != "local":
            raise AssertionError("remote update erased the imported installation provenance")
        frame_url = runtime_url(page)
        if f"/runtime/{args.game}/" not in frame_url or not frame_url.split("?", 1)[0].endswith(f"/{args.game}.html") or "managedData=1" not in frame_url:
            raise AssertionError(f"updated import did not use the App-managed Runtime: {frame_url}")

        print(json.dumps({
            "game": args.game,
            "engine": args.engine,
            "importRevision": descriptor["revision"],
            "updatedRevision": expected_revision,
            "sourceAfterUpdate": updated["installation"]["source"],
            "runtime": frame_url,
        }, ensure_ascii=False))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
