"""Current-UI music selection + real IndexedDB integration, with synthetic bytes.

Builds sealed protocol publications and imports complete, SHA-256-declared STORE
ZIPs through the actual Resource manager. No retail DATA, audio decoding, native
gameplay, physical audio, or persistent native-save acceptance is claimed here.
The fixture Runtime observes authenticated configure commands and resource writes;
this test never constructs a production plan or reaches into launcher globals.
"""
from __future__ import annotations

from contextlib import contextmanager
from functools import cache
import hashlib
import json
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_STORED, ZipFile

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from support.current_ui import (
    FRAME_SELECTOR, RUNTIME_FRAME_CLOSED_JS,
    diagnostics, exit_game, import_package, management_tab, open_current,
    open_product, prepare_game, require_local_publication, runtime_frame,
    runtime_url, set_music, start_prepared, suppress_notices,
)

PROJECT = Path(__file__).resolve().parents[2]
CONFIGURE_ERROR = "HTTP 503 music configuration failed"


@cache
def visible_products():
    """Use product policy, rather than accidentally re-advertising hidden TH20."""
    result = subprocess.run([
        "node", "--input-type=module", "-e", """
        import {PRODUCT_GAMES, PRODUCT_IDS, productEnabledForBuild} from './lib/contracts/product-catalog.mjs';
        console.log(JSON.stringify({
          games: Object.keys(PRODUCT_GAMES).filter(id => productEnabledForBuild(id, false)),
          products: PRODUCT_IDS.filter(id => productEnabledForBuild(id, false)),
          music: Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([id, product]) => [id, {
            configureMode: product.musicRuntime.localOggConfigureMode, midi: product.musicCapabilities.midi,
          }])),
        }));
        """], cwd=PROJECT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def package_archives(site, directory, games):
    """Package parser/installer receive genuine ZIP containers and declarations."""
    archives, descriptors = {}, {}
    for game in games:
        descriptor = json.loads((site / f"{game}.package.json").read_text())
        archive = directory / f"{game}-synthetic.package.zip"
        with ZipFile(archive, "w", compression=ZIP_STORED) as output:
            output.writestr("package.json", json.dumps(descriptor))
            for file in descriptor["files"].values():
                payload = (site / file["source"]).read_bytes()
                assert len(payload) == file["bytes"]
                assert hashlib.sha256(payload).hexdigest() == file["sha256"]
                output.writestr(file["source"], payload)
        archives[game], descriptors[game] = archive, descriptor
    return archives, descriptors


@contextmanager
def publication(games, *, configure_error="", midi=True):
    """Executed only by this explicit browser lane, never by static validation."""
    with tempfile.TemporaryDirectory(prefix="music-current-ui-") as temporary:
        root, process = Path(temporary), None
        site = root / "site"
        command = ["node", "tests/support/build-current-protocol-fixture.mjs",
                   f"--output={site}", "--games=" + ",".join(games), "--ogg=1", "--midi=" + ("1" if midi else "0")]
        if configure_error:
            command.append("--configure-error=" + configure_error)
        built = subprocess.run(command, cwd=PROJECT, check=True, capture_output=True, text=True)
        metadata = json.loads(built.stdout.strip().splitlines()[-1])
        marker = json.loads((site / "protocol-fixture.json").read_text())
        assert marker["nativeRuntime"] is False and marker["retailData"] is False
        host = json.loads((site / "host-manifest.json").read_text())
        assert all("ogg" not in entry["music"] for entry in host["games"].values())
        archives, descriptors = package_archives(site, root, games)
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        try:
            process = subprocess.Popen(
                ["node", "scripts/serve-static.mjs", str(site), str(port)], cwd=PROJECT,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"Synthetic publication server exited: {process.returncode}")
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=.25):
                        break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Synthetic publication server did not start")
                    time.sleep(.05)
            base = f"http://127.0.0.1:{port}" + metadata["mountPath"]
            require_local_publication(base, games=games)
            yield base, archives, descriptors
        finally:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


# Read-only storage observations and narrowly scoped corruption of an object that
# the real UI has already installed. Never invent installation/generation identity.
STORE_OPERATION = r"""
async ({game, operation = 'read', fileId = 'game-data'}) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('eagler-touhou-package-store-v1');
    request.onupgradeneeded = () => {request.transaction.abort(); reject(new Error('Import the Package through the UI first'));};
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const read = (store, key) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error);
  });
  try {
    const installation = await read('installations', game);
    if (!installation?.currentGeneration) throw new Error('No confirmed local import');
    const generation = await read('generations', [game, installation.currentGeneration]);
    if (!generation || generation.game !== game || generation.id !== installation.currentGeneration) throw new Error('Invalid installed identity');
    const ref = generation.files[fileId];
    if (!ref?.objectId) throw new Error('No installed object for ' + fileId);
    if (operation !== 'read') {
      if (!['delete-object', 'corrupt-object'].includes(operation)) throw new Error('Unknown fixture fault');
      const existing = await read('objects', ref.objectId);
      if (!existing) throw new Error('Fault requires an existing object');
      const buffer = existing.data instanceof ArrayBuffer ? existing.data : await existing.blob.arrayBuffer();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('objects', 'readwrite'), store = tx.objectStore('objects');
        if (operation === 'delete-object') store.delete(ref.objectId);
        else {
          const damaged = new Uint8Array(buffer.slice(0)); damaged[0] ^= 255;
          // Keep the original length and recorded digest so launch must rehash.
          const replacement = {...existing, data: damaged.buffer}; delete replacement.blob;
          store.put(replacement, ref.objectId);
        }
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    }
    const files = {};
    for (const [id, reference] of Object.entries(generation.files)) {
      const object = await read('objects', reference.objectId);
      const buffer = !object ? null : object.data instanceof ArrayBuffer ? object.data : await object.blob.arrayBuffer();
      const digest = buffer === null ? null : [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
      files[id] = {objectId: reference.objectId, revision: reference.revision,
        bytes: buffer?.byteLength ?? null, sha256: digest, target: generation.descriptor.files[id].target};
    }
    return {source: installation.source, generationId: generation.id,
      pendingGeneration: installation.pendingGeneration ?? null,
      revision: generation.descriptor.revision, files};
  } finally {db.close();}
}
"""

RUNTIME_OBSERVATION = r"""
frame => ({
  synthetic: frame.contentWindow.__eaglerSyntheticProtocolFixture === true,
  messages: frame.contentWindow.__eaglerTestMessages,
  writes: frame.contentWindow.__eaglerTestWrites,
  musicMode: frame.contentWindow.Module?.touhouMusicMode,
})
"""


def store(page, game, operation="read", file_id="game-data"):
    return page.evaluate(STORE_OPERATION, {"game": game, "operation": operation, "fileId": file_id})


def assert_installed(snapshot, descriptor):
    assert snapshot["source"] == "local" and snapshot["pendingGeneration"] is None, snapshot
    assert snapshot["revision"] == descriptor["revision"], snapshot
    assert set(snapshot["files"]) == set(descriptor["files"]), snapshot
    for file_id, declaration in descriptor["files"].items():
        actual = snapshot["files"][file_id]
        assert all(actual[key] == declaration[key] for key in ("revision", "bytes", "sha256", "target")), actual


def assert_data_unchanged(before, after):
    assert after["generationId"] == before["generationId"], (before, after)
    assert after["source"] == "local" and after["pendingGeneration"] is None, after
    assert after["files"]["game-data"] == before["files"]["game-data"], (before, after)


@contextmanager
def local_page(browser, base, descriptors):
    context = browser.new_context(viewport={"width": 1100, "height": 850}, service_workers="block")
    suppress_notices(context)
    blocked, errors = [], []
    mount = urlsplit(base).path
    payloads = {mount + file["source"] for descriptor in descriptors.values() for file in descriptor["files"].values()}

    def local_only(route):
        path = urlsplit(route.request.url).path
        if path == mount + "release-catalog.json":
            route.fulfill(status=404, body="No published Package catalog in this local-import scenario")
        elif path in payloads:
            blocked.append({"method": route.request.method, "path": path})
            route.fulfill(status=404, body="Only locally imported Package bytes are available")
        else:
            route.continue_()

    context.route("**/*", local_only)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        yield page, blocked
        assert not errors, errors
        assert not blocked, {"unexpectedPayloadRequests": blocked, "ui": diagnostics(page)}
    finally:
        context.close()


def music_control(page):
    return page.get_by_role("form", name="Game settings", exact=True).get_by_label("Background music", exact=True)


def choose_independent_music(page, product, mode):
    if product.endswith("mp"):
        page.get_by_role("form", name="Game settings", exact=True).get_by_label("Share single-player settings", exact=True).uncheck()
    control = music_control(page)
    expect(control).to_be_enabled(timeout=60000)
    for choice in ("ogg-full", "ogg-stream"):
        expect(control.locator(f'option[value="{choice}"]')).to_have_count(1)
        assert not control.locator(f'option[value="{choice}"]').is_disabled()
    set_music(page, mode)


def prepare_replay(page):
    management_tab(page, "replays")
    viewer = page.get_by_role("region", name="Multiplayer Replay viewer", exact=True)
    button = viewer.get_by_role("button", name="Prepare Replay viewer", exact=True)
    expect(button).to_be_enabled(timeout=60000)
    button.click()
    prepared = page.get_by_role("complementary", name="Multiplayer Replay viewer", exact=True)
    expect(prepared).to_be_visible(timeout=60000)
    return prepared


def assert_plan(page, game, descriptor, mode, multiplayer, *, launched=False):
    observed = runtime_frame(page).evaluate(RUNTIME_OBSERVATION)
    assert observed["synthetic"] is True, observed
    configurations = [item for item in observed["messages"] if item["command"] == "configure"]
    assert len(configurations) == 1, observed
    configure = configurations[0]
    policy = visible_products()["music"][game]
    wire_music = "midi" if policy["configureMode"] == "midi-sentinel" else "ogg"
    assert configure["game"] == game and configure["music"] == wire_music, configure
    assert observed["musicMode"] == "ogg", observed
    assert configure["options"]["oggDecodeMode"] == mode.removeprefix("ogg-"), configure
    assert configure["resources"] == configure["runtimeResources"] == configure["sharedResources"] == [], configure
    assert bool(configure["options"].get("replayViewer")) is multiplayer, configure
    assert not any(key.startswith("netplay") for key in configure["options"]), configure
    assert configure["options"].get("multiplayerPreflight") is not True, configure
    source = runtime_url(page)
    expected_root = f"/runtime/{game}/" + ("multiplayer/" if multiplayer else "")
    assert expected_root in source, source
    assert ("runtimeVariant=multiplayer" in source) is multiplayer, source
    ogg_ids = descriptor["components"]["ogg"]["files"]
    selected = descriptor["base"]["files"][1:] + (ogg_ids if multiplayer or launched else ogg_ids[:2])
    expected = [{"path": descriptor["files"][file_id]["target"],
                 "bytes": list(("SYNTHETIC FONT " + descriptor["files"][file_id]["target"]).encode())
                 if file_id.startswith("shared-") else list(("SYNTHETIC AUDIO " + Path(descriptor["files"][file_id]["source"]).name).encode())}
                for file_id in selected]
    assert observed["writes"] == expected, {"observed": observed, "expected": expected}
    assert any(item["command"] == "launch" for item in observed["messages"]) is launched, observed
    return {"wireMusic": configure["music"], "effectiveMusic": observed["musicMode"], "decode": configure["options"]["oggDecodeMode"],
            "variant": "multiplayer-replay" if multiplayer else "normal",
            "targets": [write["path"] for write in observed["writes"]]}


def launch_selected(page, game, descriptor, mode, multiplayer=False):
    if multiplayer:
        prepared = prepare_replay(page)
    else:
        prepare_game(page, game, timeout=60000)
    assert_plan(page, game, descriptor, mode, multiplayer)
    if multiplayer:
        audio = prepared.get_by_role("button", name="Prepare MIDI audio", exact=True)
        if audio.count():
            audio.click()
        prepared.get_by_role("button", name="Open Replay viewer", exact=True).click()
        expect(page.locator('[data-runtime-host]')).to_have_attribute("aria-hidden", "false")
        expect(page.get_by_role("toolbar", name="Game session controls", exact=True).get_by_text("Game running", exact=True)).to_be_visible(timeout=60000)
    else:
        start_prepared(page, game, timeout=60000)
    page.wait_for_function("""() => document.querySelector('[data-runtime-host] iframe')?.contentWindow?.__eaglerTestWrites?.filter(write => write.path.endsWith('.ogg')).length === 3""", timeout=30000)
    expect(page.get_by_role("complementary", name="Background music preparation", exact=True)).to_have_count(0)
    result = assert_plan(page, game, descriptor, mode, multiplayer, launched=True)
    exit_game(page)
    return result


def valid_local_matrix(browser, base, archives, descriptors, products):
    results = {}
    with local_page(browser, base, descriptors) as (page, _):
        for game, archive in archives.items():
            import_package(page, base, game, archive, timeout=60000)
            assert_installed(store(page, game), descriptors[game])
        open_current(page, base)
        actual_products = set(page.locator('[data-library-product]').evaluate_all("cards => cards.map(card => card.dataset.libraryProduct)"))
        assert actual_products == set(products), actual_products
        for product in products:
            open_product(page, base, product)
            choose_independent_music(page, product, "ogg-stream" if product.endswith("mp") else "ogg-full")
        # Reload both groups after the MP edits, proving separate durable choices.
        for product in products:
            open_product(page, base, product)
            expected = "ogg-stream" if product.endswith("mp") else "ogg-full"
            expect(music_control(page)).to_have_value(expected)
        for product in products:
            game = product.removesuffix("mp")
            results[product] = []
            for mode in ("ogg-full", "ogg-stream"):
                open_product(page, base, product)
                choose_independent_music(page, product, mode)
                before = store(page, game)
                result = launch_selected(page, game, descriptors[game], mode, product.endswith("mp"))
                assert_data_unchanged(before, store(page, game))
                results[product].append(result)
    return results


def corrupt_local_initial(browser, base, archives, descriptors):
    results = {}
    # Browser coverage includes a MIDI-capable SP + dedicated MP Replay, and
    # every distinct non-MIDI runtime policy. Other eligible games have focused
    # service tests as well as the valid browser selection/configure matrix.
    for product in ("th06", "th06mp", "th09", "th10", "th11"):
        game = product.removesuffix("mp")
        with local_page(browser, base, descriptors) as (page, _):
            import_package(page, base, product, archives[game], timeout=60000)
            choose_independent_music(page, product, "ogg-full")
            before = store(page, game)
            damaged = store(page, game, "corrupt-object", "ogg:track1")
            assert damaged["files"]["ogg:track1"]["bytes"] == before["files"]["ogg:track1"]["bytes"]
            assert damaged["files"]["ogg:track1"]["sha256"] != before["files"]["ogg:track1"]["sha256"]
            open_product(page, base, product)
            if visible_products()["music"][game]["midi"]:
                if product.endswith("mp"):
                    prepared = prepare_replay(page)
                else:
                    prepare_game(page, game, timeout=60000)
                warning = page.get_by_role("status").filter(has_text="using MIDI for this launch").first
                expect(warning).to_be_visible(timeout=30000)
                observed = runtime_frame(page).evaluate(RUNTIME_OBSERVATION)
                configure = next(item for item in observed["messages"] if item["command"] == "configure")
                assert configure["music"] == observed["musicMode"] == "midi", observed
                assert not any(write["path"].endswith(".ogg") for write in observed["writes"]), observed
                assert not any(item["command"] == "launch" for item in observed["messages"]), observed
                results[product] = warning.inner_text()
                if product.endswith("mp"):
                    audio = prepared.get_by_role("button", name="Prepare MIDI audio", exact=True)
                    if audio.count():
                        audio.click()
                    prepared.get_by_role("button", name="Open Replay viewer", exact=True).click()
                    expect(page.get_by_role("toolbar", name="Game session controls", exact=True).get_by_text("Game running", exact=True)).to_be_visible(timeout=60000)
                else:
                    start_prepared(page, game, timeout=60000)
                expect(page.get_by_role("complementary", name="Background music preparation", exact=True)).to_have_count(0)
                exit_game(page)
            else:
                region = page.get_by_role("region", name=f"{game.upper()} game launch", exact=True)
                button = region.get_by_role("button", name="Prepare game resources", exact=True)
                expect(button).to_be_enabled(timeout=60000)
                button.click()
                expect(region.get_by_role("alert")).to_contain_text("ogg:track1", timeout=30000)
                assert not runtime_url(page), diagnostics(page)
                results[product] = region.get_by_role("alert").inner_text()
            assert_data_unchanged(before, store(page, game))
            assert store(page, game)["files"]["ogg:track1"] == damaged["files"]["ogg:track1"]
            open_product(page, base, product)
            expect(music_control(page)).to_have_value("ogg-full")
    return results


def missing_tail(browser, base, archives, descriptors):
    with local_page(browser, base, descriptors) as (page, _):
        import_package(page, base, "th06", archives["th06"], timeout=60000)
        before = store(page, "th06")
        store(page, "th06", "delete-object", "ogg:track3")
        open_product(page, base, "th06")
        set_music(page, "ogg-stream")
        prepare_game(page, "th06", timeout=60000)
        assert_plan(page, "th06", descriptors["th06"], "ogg-stream", False)
        start_prepared(page, "th06", timeout=60000)
        warning = page.get_by_role("complementary", name="Background music preparation", exact=True)
        expect(warning.get_by_role("alert")).to_contain_text("ogg:track3", timeout=30000)
        expect(warning.get_by_role("button", name="Retry remaining music", exact=True)).to_be_enabled()
        expect(warning.get_by_role("button", name="Stop background download", exact=True)).to_have_count(0)
        observed = runtime_frame(page).evaluate(RUNTIME_OBSERVATION)
        assert len([item for item in observed["writes"] if item["path"].endswith(".ogg")]) == 2, observed
        assert_data_unchanged(before, store(page, "th06"))
        message = warning.get_by_role("alert").inner_text()
        exit_game(page)
        return message


def missing_data_repair(browser, base, archives, descriptors):
    with local_page(browser, base, descriptors) as (page, _):
        import_package(page, base, "th06", archives["th06"], timeout=60000)
        before = store(page, "th06")
        missing = store(page, "th06", "delete-object")
        assert missing["files"]["game-data"]["sha256"] is None
        open_product(page, base, "th06")
        launch = page.get_by_role("region", name="TH06 game launch", exact=True)
        expect(launch.get_by_role("status")).to_contain_text("evicted or missing", timeout=30000)
        expect(launch.get_by_role("button", name="Prepare game resources", exact=True)).to_be_disabled()
        assert not runtime_url(page), diagnostics(page)
        assert store(page, "th06") == missing, "Inspection must not silently replace the local DATA installation"
        # The real import review is the explicit recovery path for missing DATA.
        import_package(page, base, "th06", archives["th06"], timeout=60000)
        repaired = store(page, "th06")
        assert_installed(repaired, descriptors["th06"])
        assert repaired["generationId"] != before["generationId"], repaired
        assert repaired["files"]["game-data"]["sha256"] == before["files"]["game-data"]["sha256"]
        set_music(page, "ogg-full")
        return launch_selected(page, "th06", descriptors["th06"], "ogg-full")


def configure_failure(browser, base, archives, descriptors):
    results = {}
    for product in ("th06", "th06mp"):
        with local_page(browser, base, descriptors) as (page, _):
            import_package(page, base, product, archives["th06"], timeout=60000)
            choose_independent_music(page, product, "ogg-full")
            before = store(page, "th06")
            if product.endswith("mp"):
                management_tab(page, "replays")
                region = page.get_by_role("region", name="Multiplayer Replay viewer", exact=True)
                button = region.get_by_role("button", name="Prepare Replay viewer", exact=True)
            else:
                region = page.get_by_role("region", name="TH06 game launch", exact=True)
                button = region.get_by_role("button", name="Prepare game resources", exact=True)
            expect(button).to_be_enabled(timeout=60000)
            button.click()
            expect(region.get_by_role("alert")).to_contain_text(CONFIGURE_ERROR, timeout=30000)
            expect(page.get_by_role("complementary", name="Prepared game", exact=True)).to_have_count(0)
            expect(page.get_by_role("region", name="Import and remove resources", exact=True)).to_have_count(0)
            page.wait_for_function('() => (' + RUNTIME_FRAME_CLOSED_JS + ')(document.querySelector(' + json.dumps(FRAME_SELECTOR) + '))', timeout=10000)
            assert not runtime_url(page), diagnostics(page)
            assert_data_unchanged(before, store(page, "th06"))
            results[product] = region.get_by_role("alert").inner_text()
    return results


def main():
    inventory = visible_products()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            with publication(inventory["games"]) as (base, archives, descriptors):
                products = valid_local_matrix(browser, base, archives, descriptors, inventory["products"])
                corrupted = corrupt_local_initial(browser, base, archives, descriptors)
                tail = missing_tail(browser, base, archives, descriptors)
                repaired = missing_data_repair(browser, base, archives, descriptors)
            with publication(["th06"], configure_error=CONFIGURE_ERROR) as (base, archives, descriptors):
                failures = configure_failure(browser, base, archives, descriptors)
        finally:
            browser.close()
    print(json.dumps({"musicSelectionBrowser": "PASS", "evidence": "synthetic current UI + real IndexedDB",
        "nativeRuntime": False, "audioPlaybackAcceptance": False, "hostPublishesOgg": False,
        "localOnlyProducts": products, "corruptLocalOptionalMusic": corrupted, "missingTailWarning": tail,
        "missingDataExplicitRepair": repaired, "configureFailurePreservesData": failures}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
