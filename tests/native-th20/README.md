# Hidden TH20 native adapter lane

This fixture is **test-only low-level/native-adapter coverage**. TH20 is still
`hidden: true`, including in `testBuild`. It is not a public Launcher product,
card, route, launch gate, readiness claim or release-acceptance lane.

The old TH20 browser scripts depended on the retired Launcher DOM and its
development server. Their distinct checks are now retained behind an explicit
verified-plan component fixture:

- The actual current `createRuntimeService` owns one permanent native iframe,
  epoch, imported Package generation, managed DATA, resource mount and lifecycle
- The actual current `RuntimeViewport`, `RuntimeTouchOverlayForContext`,
  `RuntimeControlsForService` and host keyboard binding provide the controls
- Host bytes are SHA-256 pinned by preflight; the Package ZIP is pinned from the
  explicit local input, and every imported file is checked before installation
- Canonical Host/Package validators require the same DATA hash, length and
  layout, complete fonts, non-executable resources and canonical imported OGG
- The supplied immutable Runtime generation must match the Host and current
  Runtime Manifest. The real Runtime preparation service verifies all its files;
  fallback generations are rejected before native navigation
- Native success requires authenticated real `ready`/`first-frame` events plus
  the real `__th20Runtime.core.memory` being `WebAssembly.Memory` and its presented
  frame counter reaching at least 120. The fixture never fabricates native globals
  or readiness events

## Explicit local inputs

The following are future opt-in commands, not a record of native execution.
They require permission to run a loopback server and browser, Playwright's
Chromium installation, and lawfully supplied original files. No original bytes
are included in the source repository or harness build.

1. Supply an **already assembled** current React publication with its matching
   `ui-publication.json` (including its public navigation/mount contract),
   Host Manifest, immutable Runtime Manifest and actual TH20 Runtime files.
   Private build files such as `ui-ownership.json` are neither required nor served
2. Supply a local modern TH20 Package ZIP containing DATA, both required fonts and
   its OGG component. The import lane additionally requires DATA larger than
   127 MiB, preserving its unique large-object Package Store regression check
3. Record the exact 64-character lowercase Runtime generation from this Host

Build the fixture separately, then mount it beside the explicit publication:

```sh
node scripts/build-th20-native-harness.mjs
node scripts/serve-th20-native-harness.mjs --publication=/absolute/path/to/assembled-publication --port=4198
```

The builder writes only `.cache/th20-native-harness/__th20_native__/`. The preview
wrapper binds only `127.0.0.1`, reads the explicit publication in place, and
mounts only `/__th20_native__/` from the separate fixture directory through the
portable publication server. Other resources and mounted navigation stay owned
by the explicit publication; private build metadata stays unavailable. It does not copy/stage original Package
or Runtime bytes and must never be used as a production server or publisher.
Do not copy the fixture into the assembled publication.

For a root-mounted publication:

```sh
python tests/test-th20-import-launch-browser.py \
  --url=http://127.0.0.1:4198/ \
  --fixture-url=http://127.0.0.1:4198/__th20_native__/index.html \
  --package-zip=/absolute/path/to/real-th20-package.zip \
  --runtime-generation=<exact-64-character-generation>
python tests/test-th20-touch-browser.py \
  --url=http://127.0.0.1:4198/ \
  --fixture-url=http://127.0.0.1:4198/__th20_native__/index.html \
  --package-zip=/absolute/path/to/real-th20-package.zip \
  --runtime-generation=<exact-64-character-generation>
```

For a nested publication, include its mount in both URLs, for example
`/preview/` and `/preview/__th20_native__/index.html`. No development metadata,
remote origin, default workspace Package, public `/play/th20` route or automatic
server start is accepted. Each run uses a fresh browser context and disables
Service Workers so an older cache cannot substitute for the explicit inputs.

The touch lane preserves free-direction analog movement, rate-limited versus
unlimited first-frame movement, the unlimited-used marker, real host keyboard
movement, pause/menu owner context, tap confirm, two-finger cancel, and menu
cursor ownership while a dialogue is displayed. It saves/closes the first
session before starting the next movement mode. Android Chromium emulation is
not proof of physical-device or iOS behavior.

## Verification status

The source-only gate is:

```sh
node --test tests/native-th20/test-verified-plan.mjs
npx tsc --project tests/native-th20/tsconfig.json
python -m py_compile tests/support/th20_native.py tests/test-th20-import-launch-browser.py tests/test-th20-touch-browser.py
node scripts/build-th20-native-harness.mjs
```

The Node tests use synthetic in-memory metadata/ZIPs solely to check identity
rejection and the separate fixture boundary. They start no server/browser and
run no native game. Successful compilation/builds and these contract tests must
not be described as real TH20 gameplay or browser acceptance. Actual native
browser runs remain **unverified** until the explicit commands above are run
with the real inputs and permission, and their results are separately recorded.
