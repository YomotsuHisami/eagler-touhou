"""L4 Runtime Storage conformance, using the real Launcher and compiled Runtimes.

Preconditions: explicit legal score fixtures; current source served at --url;
installed Python Playwright engines; Runtime/DATA available to that Launcher.
Mutations: fresh browser contexts only; import fixture, sync, reload, export;
command case adds/removes a flat probe; nested case is separate and opt-in.
Invariant: exact user bytes survive restore and temporary Runtime teardown.
Proves: named game/browser lifecycle and host storage commands.
Does NOT prove: gameplay unlock semantics, Replay, crash durability, real iOS.
"""

import argparse
import os
import sys
import hashlib
import json
import subprocess
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "support"))
from current_ui import (require_local_publication, suppress_notices, open_product, set_music,
    import_package, prepare_game, launch_game, exit_game, runtime_frame, runtime_visible,
    runtime_url, import_save, export_save, RuntimeEvents, diagnostics)
RESTORE_FAILURE_SCRIPT = """expectedName => {
  if (location.pathname.split('/').pop() !== expectedName) return;
  let moduleValue;
  Object.defineProperty(globalThis, 'Module', {
    configurable: true,
    get: () => moduleValue,
    set: value => {
      moduleValue = value;
      if (!Array.isArray(value?.preRun) || value.__storageRestoreFailureInstalled) return;
      value.__storageRestoreFailureInstalled = true;
      window.__eaglerStorageRestoreFailureInjected = true;
      value.preRun.unshift(() => {
        const originalSyncfs = FS.syncfs.bind(FS);
        let injected = false;
        FS.syncfs = (populate, callback) => {
          if (populate && !injected) {
            injected = true;
            window.__eaglerStorageRestoreFailureTriggered = true;
            queueMicrotask(() => callback(new Error('injected restore failure')));
            return;
          }
          originalSyncfs(populate, callback);
        };
      });
    },
  });
}"""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def registry():
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import {PRODUCT_GAMES} from './product-catalog.mjs'; console.log(JSON.stringify(PRODUCT_GAMES))"],
        cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return json.loads(result.stdout)


class StorageCase:
    def __init__(self, page, url, game, storage, out):
        self.page, self.url, self.game, self.storage, self.out = page, url, game, storage, out
        self.events, self.errors, self.console = [], [], []
        self.runtime_errors = []
        self.observer = RuntimeEvents(page, game)
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("console", lambda message: self.console.append({"type": message.type, "text": message.text}))

    def prepare(self):
        open_product(self.page, self.url, self.game)
        set_music(self.page, 'none')

    def launch(self):
        print(f"{self.game}: launch", flush=True)
        if not runtime_visible(self.page):
            self.observer.clear()
            launch_game(self.page, self.game)
        self.observer.wait()
        state = diagnostics(self.page)
        self.events.append({"launch": {**state, "events": list(self.observer.events)}})
        assert not self.errors, self.errors

    def command(self, command, **payload):
        return self.page.evaluate("""async ({game,command,payload}) => {
          const frame = document.querySelector('[data-runtime-host] iframe');
          const target = frame.contentWindow;
          const source = new URL(target.location.href);
          if (source.origin !== location.origin) throw Error('Runtime document is not same-origin');
          const epoch = Number(source.searchParams.get('runtimeEpoch'));
          if (!Number.isSafeInteger(epoch) || epoch <= 0) throw Error('Runtime navigation epoch missing');
          const request = `storage-conformance-${crypto.randomUUID()}`;
          return await new Promise((resolve,reject) => {
            const timer=setTimeout(()=>{window.removeEventListener('message', receive);reject(Error(`${command} timeout`));},10000);
            function receive(event) {
              const m=event.data || {};
              if(event.source!==target || event.origin!==location.origin || m.protocol!=='eagler-touhou/1' || m.game!==game || m.epoch!==epoch || m.request!==request) return;
              clearTimeout(timer);window.removeEventListener('message',receive);
              if(!m.ok) reject(Error(m.error || command));
              else resolve(m.bytes ? {...m,bytes:Array.from(new Uint8Array(m.bytes))} : m);
            }
            window.addEventListener('message',receive);
            target.postMessage({protocol:'eagler-touhou/1',game,epoch,command,request,...payload},location.origin);
          });
        }""", {"game": self.game, "command": command, "payload": payload})

    def read(self, name):
        return bytes(self.command("read", path=name)["bytes"])

    def close(self):
        exit_game(self.page)

    def import_score(self, fixture):
        before = runtime_url(self.page)
        import_save(self.page, fixture)
        assert runtime_url(self.page) != before, "save import must restore a new native Runtime epoch"

    def export_score(self):
        return export_save(self.page, self.out / "exported-score.dat")

    def persisted_score(self):
        return bytes(self.page.evaluate("""async ({saveRoot,scoreFile}) => {
          const db=await new Promise((resolve,reject)=>{
            const r=indexedDB.open(saveRoot);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
          });
          try {
            return await new Promise((resolve,reject)=>{
              const tx=db.transaction('FILE_DATA','readonly');
              const r=tx.objectStore('FILE_DATA').get(`${saveRoot}/${scoreFile}`);
              r.onsuccess=()=>resolve(Array.from(r.result?.contents || []));r.onerror=()=>reject(r.error);
            });
          } finally {db.close();}
        }""", self.storage))

    def wait_persisted_score(self, expected, timeout_ms=5000):
        deadline = time.monotonic() + timeout_ms / 1000
        observed = b""
        while time.monotonic() < deadline:
            observed = self.persisted_score()
            if observed == expected:
                return
            self.page.wait_for_timeout(50)
        raise AssertionError({
            "expectedBytes": len(expected), "expectedSha256": digest(expected),
            "observedBytes": len(observed), "observedSha256": digest(observed),
        })

    def run_restore_failure(self):
        self.prepare()
        self.observer.clear()
        region = self.page.get_by_role('region', name=f'{self.game.upper()} game launch', exact=True)
        region.get_by_role('button', name='Prepare game resources', exact=True).click()
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            events = list(self.observer.events)
            if any(event['event'] in ('error', 'fatal', 'first-frame') for event in events): break
            self.page.wait_for_timeout(100)
        else: raise TimeoutError({'events': events, 'ui': diagnostics(self.page)})
        frame_state = runtime_frame(self.page).evaluate(
            "frame => ({url: frame.contentWindow.location.href, injected: frame.contentWindow.__eaglerStorageRestoreFailureInjected === true, triggered: frame.contentWindow.__eaglerStorageRestoreFailureTriggered === true})"
        )
        assert frame_state["injected"] and frame_state["triggered"], {"events": events, "frame": frame_state}
        assert any("injected restore failure" in (event.get("error") or "") for event in events), events
        assert not any(event.get("event") in ("ready", "first-frame") for event in events), events
        return {"events": [{"restoreFailure": events}]}

    def run(self, fixture, mode, package=None):
        expected = fixture.read_bytes()
        assert expected, "fixture must be nonempty"
        score = self.storage["scoreFile"]
        self.prepare()
        if package:
            print(f"{self.game}: import explicit content package", flush=True)
            import_package(self.page, self.url, self.game, package)
        # Save management uses the current prepared native file owner, without
        # gameplay. Import retires/restores it and verifies every byte.
        prepare_game(self.page, self.game)
        self.import_score(fixture)
        self.close()
        assert self.persisted_score() == expected, "import must be durable before reset/reload"
        self.prepare()
        self.launch()
        assert self.read(score) == expected, "restored bytes must be available on first frame"
        if mode != "score-only":
            probe = "conformance-probe.dat" if mode == "commands" else "probe/nested.dat"
            payload = [0, 1, 127, 128, 255]
            self.command("write", path=probe, bytes=payload)
            assert self.read(probe) == bytes(payload)
            assert any(f["path"] == probe for f in self.command("list")["files"])
            self.command("sync")
            self.close()
            self.prepare()
            self.launch()
            assert self.read(probe) == bytes(payload), "probe restore"
            if mode == "commands":
                self.command("remove", path=probe)
                self.command("sync")
                assert all(f["path"] != probe for f in self.command("list")["files"])
                for invalid in ["../escape", "/escape", "a/../escape", "a\\escape", "", "a//b"]:
                    try:
                        self.command("write", path=invalid, bytes=payload)
                    except Exception as error:
                        assert "invalid path" in str(error), str(error)
                    else:
                        raise AssertionError(f"accepted unsafe path: {invalid!r}")
        self.close()
        assert self.persisted_score() == expected, "normal close persistence"
        self.prepare()
        prepare_game(self.page, self.game)
        assert self.export_score() == expected, "prepared native export exact bytes"
        self.close()
        self.wait_persisted_score(expected)
        self.prepare()
        self.launch()
        assert self.read(score) == expected, "restore after temporary teardown"
        if mode == "commands":
            assert all(f["path"] != "conformance-probe.dat" for f in self.command("list")["files"]), "remove durability"
        self.close()
        assert not self.errors, self.errors
        self.runtime_errors = [event for event in self.observer.history if event["event"] in ("error", "fatal")]
        assert not self.runtime_errors, self.runtime_errors
        return {"bytes": len(expected), "sha256": digest(expected), "events": self.events}


def main():
    products = registry()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("EAGLER_NATIVE_SITE_URL"), help="Explicit loopback assembled current publication")
    parser.add_argument("--fixture-root", type=Path, required=True, help="explicit directory containing <game>/score.dat")
    parser.add_argument("--package", action="append", default=[], help="optional explicit content input GAME=PATH, imported through Launcher UI")
    parser.add_argument("--games", nargs="+", choices=products, default=[game for game, product in products.items() if not product.get("hidden") and not product.get("testOnly")])
    parser.add_argument("--browsers", nargs="+", choices=["chromium", "webkit"], default=["chromium", "webkit"])
    parser.add_argument("--cases", nargs="+", choices=["score-only", "commands", "nested-write", "restore-failure"], default=["score-only", "commands"])
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "validation" / "runtime-storage" / time.strftime("%Y%m%d-%H%M%S"))
    args = parser.parse_args()
    if not args.url: parser.error("--url or EAGLER_NATIVE_SITE_URL is required")
    args.url = require_local_publication(args.url, args.games)
    packages = {}
    for item in args.package:
        game, separator, value = item.partition("=")
        if not separator or game not in products or not Path(value).is_file():
            parser.error(f"invalid package input: {item}")
        packages[game] = Path(value).resolve()
    fixtures = {g: (args.fixture_root / g / products[g]["storage"]["scoreFile"]).resolve() for g in args.games}
    for fixture in fixtures.values():
        if not fixture.is_file():
            parser.error(f"missing explicit fixture: {fixture}")
    args.output.mkdir(parents=True, exist_ok=False)
    results = []
    with sync_playwright() as p:
        for engine in args.browsers:
            with getattr(p, engine).launch(headless=True) as browser:
                for game in args.games:
                    for mode in args.cases:
                        out = args.output / engine / game / mode
                        out.mkdir(parents=True)
                        with browser.new_context(accept_downloads=True, locale="zh-CN") as context:
                            suppress_notices(context)
                            if mode == "restore-failure":
                                runtime_name = products[game]["runtime"].split("?", 1)[0].rsplit("/", 1)[-1]
                                context.add_init_script(f"({RESTORE_FAILURE_SCRIPT})({json.dumps(runtime_name)})")
                            case = StorageCase(context.new_page(), args.url, game, products[game]["storage"], out)
                            fixture_bytes = fixtures[game].read_bytes()
                            record = {"game":game,"browser":engine,"browserVersion":browser.version,"case":mode,"level":"L4","url":args.url,
                                      "fixture":str(fixtures[game]),"bytes":len(fixture_bytes),"sha256":digest(fixture_bytes)}
                            try:
                                if game in packages:
                                    record["package"] = {"path":str(packages[game]),"sha256":digest(packages[game].read_bytes())}
                                if mode == "restore-failure":
                                    record.update(case.run_restore_failure())
                                else:
                                    record.update(case.run(fixtures[game], mode, packages.get(game)))
                                record["status"] = "PASS"
                            except Exception:
                                record.update(status="FAIL", error=traceback.format_exc())
                                try:
                                    case.page.screenshot(path=str(out / "failure.png"), timeout=10000)
                                except Exception as error:
                                    record["screenshotError"] = str(error)
                            record["pageErrors"] = case.errors
                            record["runtimeErrors"] = [event for event in case.observer.history if event["event"] in ("error", "fatal")]
                            record["console"] = case.console
                            results.append(record)
                            (args.output / "report.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
                            print(f"{engine}/{game}/{mode}: {record['status']}", flush=True)
                            if record["status"] == "FAIL":
                                print(record["error"], flush=True)
    raise SystemExit(1 if any(r["status"] != "PASS" for r in results) else 0)


if __name__ == "__main__":
    main()
