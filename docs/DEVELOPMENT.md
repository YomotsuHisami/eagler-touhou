# Development

Read `ARCHITECTURE.md` before making cross-module changes. It is the long-lived overview of current system boundaries, data flow, and contract ownership. `PRODUCT_SURFACE.md` is the single list of formally supported product capabilities, and `../integrations/RUNTIME_CONTRACT.md` defines the bounded thcrap/thprac Runtime boundary. This document owns only the development environment, commands, and maintenance workflow; it does not duplicate the architecture inventory.

Local development content declarations live in `lib/development-content.mjs`. `lib/development-host-manifest.mjs` constructs a valid `web-development` Host Manifest from the actual Runtime, DATA, and music inputs. `npm start` serves it directly at the site-root `/host-manifest.json` endpoint and also serves a valid empty `release-catalog.json`. The source root does not store a generated `games.json`; `npm run check` validates the development Host Manifest contract directly.

Each `retail-memory` product can point its development host at prepared content with
`EAGLER_TH<NN>_CONTENT_DIR`: TH09/TH10/TH11/TH20 read `<dir>/<game>.data`;
TH08 selects DATA separately with `EAGLER_TH08_DATA_FILE`. TH08/TH10/TH20 read OGG under
`<dir>/bgm-ogg`, TH09/TH11 under `<dir>/music`. Shared fonts come from `EAGLER_DEVELOPMENT_VANILLA_FONT`
and `EAGLER_DEVELOPMENT_UNICODE_FONT`, defaulting to the sibling workspace paths. Without a content
root the manifest carries only the declared DATA identity, and the Launcher must rely on an imported
Package instead — that is the end-user path. Host DATA and music paths in the manifest are always
answered relative to the site root, so a content root outside the workspace is served as
`../<relative path>` and never as an absolute filesystem path.

Product content names and Runtime mounts live in the machine-independent `lib/content-definition.mjs`. Maintainer-only workspace, build-profile, Runtime Release, publication, and related contracts are also centralized under `lib/`. Author-maintained HTML, CSS, site images, fonts, and vendored browser files live under `public/`, which the development server maps to the URL root. The publisher still assembles those files into a flat deployment root from an explicit manifest; the `public/` directory name never enters the artifact. Shared application contracts and Launcher TypeScript source live under `src/contracts/` and `src/launcher/`, respectively. `tsconfig.launcher.json` compiles them into the gitignored `.cache/build/browser/assets/`. The development server maps those generated files to stable `/assets/contracts/` and `/assets/launcher/` URLs, and the site and self-host bundle packagers copy them into their own `assets/` output. Formal publication starts from the machine-independent build-time seed in `lib/publication-host-seed.mjs`; the package server then materializes and validates the real Host Manifest. Ordinary users do not write these internal parameters manually.

## Workspace

The TH11 and TH20 Eagler runtime owners are sibling directories `th11-eagler`
and `th20-eagler`, respectively. Clone `YomotsuHisami/th11` and
`Goan114/touhou20` at their `eagler` branches into those directories.
`config/workspace.json` owns the mapping; use `EAGLER_WORKSPACE_ROOT` when
running the Launcher from an isolated worktree.

Full Runtime development requires sibling source repositories. `config/workspace.json` exclusively owns their physical directory names; do not duplicate a sibling-path table in Node, Python, or PowerShell scripts.

Upstream tracking and Eagler integration are separate worktree roles. The
canonical `thXX-eagler` checkout is the Launcher/workspace Runtime input;
`worktrees/thXX-upstream` is original/upstream evidence only. High-refresh,
Multiplayer, THPrac and THCRAP adaptation starts in an additional topic
worktree and reaches `thXX-eagler` only after its focused review and gates.
See [Adaptation Worktree Isolation](playbooks/adaptation-worktrees.md).

```powershell
mkdir eagler-touhou-workspace
cd .\eagler-touhou-workspace
git clone https://github.com/YomotsuHisami/eagler-touhou.git
git clone --branch eagler https://github.com/YomotsuHisami/th06.git th06-eagler
git clone --branch eagler https://github.com/YomotsuHisami/th07.git th07-eagler
git -C .\th06-eagler submodule update --init vendored/SDL vendored/SDL_image vendored/SDL_ttf
git -C .\th07-eagler submodule update --init vendored/SDL vendored/SDL_image vendored/SDL_ttf
git -C .\th06-eagler\vendored\SDL_ttf submodule update --init external/freetype external/plutosvg external/plutovg
git -C .\th07-eagler\vendored\SDL_ttf submodule update --init external/freetype external/plutosvg external/plutovg
```

Expected layout:

```text
workspace/
├─ eagler-touhou/
├─ th06-eagler/
├─ th07-eagler/
├─ th08-eagler/
├─ th10-eagler/
├─ worktrees/
│  ├─ th08-upstream/
│  ├─ th10-upstream/
│  └─ thXX-topic/       one high-refresh, Multiplayer, THPrac or THCRAP topic
├─ thprac-reallyportable/
├─ dependencies/
└─ toolchains/
```

Full Runtime development requires Node.js 22 or newer, CMake, Ninja, the Emscripten SDK, and Python 3. Ordinary self-hosting does not require CMake, Ninja, or Emscripten; its Python build dependencies are managed by `host/requirements.txt` and `host/lib/python-environment.mjs`.

## Install dependencies and run checks

```powershell
cd .\eagler-touhou
npm ci --ignore-scripts
npm run vendor
npm run build:launcher
npm run check
```

Install the separately pinned Python browser dependencies only when running an
explicit Browser lane:

```powershell
python -m pip install -r tests/requirements-browser.txt
python -m playwright install chromium webkit
```

Firefox is needed only by lanes that explicitly select it. These dependencies
do not belong in `host/requirements.txt`, which owns self-host asset/build
tooling, and they are not required by `npm run check`.

Start the local Launcher:

```powershell
npm start
```

Open `http://127.0.0.1:8130/`. Do not open `index.html` directly.

Game-card artwork and the site icon are legally owned Host inputs supplied by the operator and are not public source. A standard workspace may place prepared `th06-card.webp`, `th07-card.webp`, `th08-card.webp`, `th10-card.webp`, and `th06.ico` files under `..\games\host-artwork\`. The source development server serves those fixed files from that directory without copying them into the repository. A non-standard layout specifies the same input directory explicitly through `EAGLER_TOUHOU_ARTWORK_DIR`. Formal Host assembly still generates artwork from original resources or accepts an override through `--artwork-dir`.

## Build Runtimes

Run the resource-free source-build check:

```powershell
.\tools\maintainer\build-workspace-runtimes.ps1 `
  -EmsdkDirectory '..\toolchains\emsdk'
```

This mode writes `build-web-eagler-external` in both game repositories. It verifies that public source compiles and cannot launch the games directly.

A locally playable build embeds legally owned game resources in separate build directories:

```powershell
.\tools\maintainer\build-workspace-runtimes.ps1 `
  -EmsdkDirectory '..\toolchains\emsdk' `
  -EmbedLocalAssets
```

By default, resources are read from `..\th06-eagler\assets` and `..\th07-eagler\assets`, and output is written to `build-web-eagler-default`. Use `-Th06AssetDirectory` and `-Th07AssetDirectory` to specify other directories.

Full-site verification uses the formal self-host/release assembly path instead of maintaining a second test-distribution topology. Development Runtime builds may still be explicit inputs to their respective integration tests. Only `npm run release` with an explicit `--output` produces a formal candidate; an ordinary self-host verification site lives at `dist/site`.

New importable game packages use only the `eagler-touhou/package/1` Package Descriptor. A maintainer can generate an offline ZIP from an assembled site with `npm run package:offline-game -- <site> th06 [output.zip]`. Historical `game-data-pack/1` and `offline-game-pack/1` formats remain read-compatible only and no longer have producer commands.

`npm run package:runtime-release -- --output=PATH --th06-build=PATH --th06-multiplayer-build=PATH --th07-build=PATH --th07-multiplayer-build=PATH --th08-build=PATH --th09-build=PATH --th09-multiplayer-build=PATH --th10-build=PATH` is a low-level maintainer producer. It assembles eight completed and traceable Runtime builds into a resource-free Runtime Release and emits `runtime-release.json` with byte sizes and SHA-256 hashes. For TH09, build the ordinary and multiplayer directory Runtimes with `npm run web:eagler` and `npm run web:eagler:multiplayer` in `th09/th09_web`. It neither builds a Runtime nor reads original game content, and it does not replace the formal site assembly and acceptance performed by `npm run release`.

See `docs/ARTIFACTS.md` for the classification and consumption rules of other generated output.

Keep the two build modes isolated. Do not toggle `TH_EXTERNAL_ASSETS` in one CMake build directory: CMake reuses cached configuration, and an external-resource build does not contain game archives.

Generated `.data` and similar files contain original game resources. They are restricted to local use or an authorized private deployment and must not be committed or distributed.

## Routine verification

```powershell
npm run check
npm run check:workspace
npm run test:shell
npm run test:server
npm run test:test-build-cards:browser
npm run audit:publish
npm run verify:server -- D:\Sites\eagler-touhou
npm run verify:deployed -- https://example.invalid/
npm run verify:practice
```

`npm run check` is the fast single-repository gate for the normal edit loop. It runs deterministic source syntax, generated-output freshness, module/format/package contracts, and public-resource audits. It does not access the public network, launch a real browser, require sibling game repositories, or require original game resources. Independent checks run with bounded concurrency; set `EAGLER_CHECK_JOBS=1` when diagnosing concurrency issues.

`npm run check:workspace` is the explicit cross-repository integration gate. It additionally reads every formal Product Catalog Runtime repository (currently TH06/TH07/TH08/TH10) and runs local Runtime, HTTP, and format integrations. It also owns a small number of fast cross-repository checks where structure itself is the contract: shared Runtime protocol vocabulary, required Replay behavior plus each existing adapter's declared Replay-extension ownership, and the safety boundary that always-hitbox presentation must not alter gameplay RNG or `EffectManager`. EAGX, `.rpyx` motion trailers and PRAC mirrors are existing implementation mechanisms, not a shared ABI that a new title must copy. Ordinary implementation shape, local browser tests, the full OGG baseline, public networking, complete Runtime builds, and formal Release verification remain on-demand or pre-release lanes; broader coverage alone is not a reason to add them to the default `check`. Real iPhone/iPad Safari coverage requires Apple hardware and is not represented as an automated repository gate.

The canonical TH08/TH10 Eagler Runtime repositories are `th08-eagler` and `th10-eagler`. Their upstream-tracking worktrees are `worktrees/th08-upstream` and `worktrees/th10-upstream`; do not use those upstream worktrees as Launcher Runtime inputs. Private derived Web content is not owned by source repositories and lives under `games/web-content/` in the standard local workspace. Development metadata therefore uses verified DATA identities by default; set `EAGLER_TH08_DATA_FILE` to a private verified `th08.data` when the local development Launcher should acquire TH08 DATA automatically, and set `EAGLER_TH08_CONTENT_DIR` to a private directory containing `bgm-ogg/` when local TH08 OGG is needed. Set `EAGLER_TH10_CONTENT_DIR` to a private directory containing `th10.data` and `bgm-ogg/` when a local hosted TH10 content lane is needed. Formal release takes original content through the generic `GameDirectories` map. Historical `ThNNDirectory` aliases are read compatibility only and are not the template for another title.

Public-network, public Relay/TURN, and performance-profiling tasks belong to the remote/operations lane. Their scripts must receive an explicit target URL. Repository commands never embed `touhou.vip` or `test.touhou.vip` as defaults, preventing ordinary local tests, accidental invocation, or forks from contacting project infrastructure when a target is omitted.

These non-hermetic maintainer probes live under `tools/maintainer/`. Their inputs, evidence boundaries, and commands are documented in `tools/maintainer/README.md`. They are neither ordinary automated tests nor general deployment tools for self-host operators.

`npm run verify:practice` is an independent local browser/release acceptance lane. It uses temporary HTTPS/HTTP2, an isolated Chrome/Chromium profile with default motion preferences, synthetic Host artwork, and a valid Host Manifest without private DATA. Its fixed high-speed local reference profile uses Lighthouse desktop with 10 ms RTT and 40 Mbps throughput. To control normal Lighthouse measurement variance, the formal lane collects five runs and uses Lighthouse's own `computeMedianRun` to select the representative report; it never selects the highest score, and output lists every run's Performance score and TBT. The representative report must score 100 for Performance, Accessibility, Best Practices, SEO, and all five core performance metrics, and it must pass three catalog, single-player selection, and multiplayer-entry browsing scenarios based on user-visible semantics. Reports default to the operating system's temporary directory; a formal candidate may use `--report=PATH` to write evidence outside the repository. This reference environment detects Launcher regressions but does not replace real hosting, formal artwork, device, or public-release acceptance. Use `--profile=standard --diagnostic=1` for an environment-sensitive baseline with Lighthouse's standard 40 ms/10 Mbps desktop profile. `--diagnostic=1` also exposes complete scores when the reference profile misses a threshold. Debugging may use an odd `--runs=1`, `3`, `5`, `7`, or `9`; the formal command remains a hard five-run gate.

`npm run test:runtime-release-host` is an explicit release-chain integration. It first generates a resource-free Runtime Release, then points the logical workspace at an empty directory without game source repositories, and assembles and verifies a Host using only the Runtime Release and explicit original-resource inputs. This test is heavier than the default edit gate and therefore is not part of `npm run check`.

`npm run test:multiplayer-replay-launcher:browser` is a focused Browser lane. It starts its own local HTTP site and uses a same-origin minimal Runtime stub to capture the Launcher's real `configure`/`launch` protocol. It proves only that Multiplayer Replay selects the MP Runtime/storage identity, sends `replayViewer: true`, and includes no room `netplay*` configuration. It depends on neither Relay, WASM, nor private DATA and does not pretend to test Runtime Replay playback.

`npm run test:multiplayer-spectator-launcher:browser` is the corresponding spectator Launcher orchestration scenario. Two raw lobby clients occupy the player seats and start a game. After receiving `start` while merely unseated, the Launcher must remain stopped; it may enter the Runtime only after explicitly joining as a spectator and receiving `spectator-start`. The test then validates spectator identity, counts, and mutually exclusive relay-role query parameters from the real `configure` payload. Actual spectator gameplay, backlog, and reconnect behavior remain owned by Runtime/relay browser and contract tests.

`npm run test:package-store:browser` is the hermetic Package Store/Installer Browser lane. In real Chromium IndexedDB it validates ArrayBuffer canonicalization, bulk reads, source lookup, GC/watchdog behavior, AbortSignal/AbortError propagation, replacement with user-supplied bytes when a local ZIP has the same revision, GC only after a successful switch, and preservation of the current generation plus removal of pending state after failed or size-invalid updates. Through the real `installPublishedPackage()`, it also proves that one AbortSignal propagates from the Release Catalog Descriptor fetch through Package file fetches and that cancellation leaves the current generation unchanged. `tests/test-package-store-contract.mjs` retains only the crash-atomic structural boundary that ordinary success/failure scenarios cannot prove: current/pending must switch inside one IndexedDB readwrite transaction. `npm run test:package-installer` reuses this Browser lane directly and no longer retains an empty source-shape test. `tests/test-package-launcher.mjs` owns only pure policies such as optional components and carry-forward behavior.

`npm run test:th06-netplay-launcher:browser` is an explicit cross-repository Browser lane. It obtains current development Runtime/DATA identities from `createDevelopmentHostManifest()`, launches two TH06MP Runtimes through the dedicated `th06mp` product and a real lobby room, forces the Host-owned WebSocket fallback, and verifies progress through at least confirmed frame 300 with matching canonical hashes. It depends on the current TH06MP build and therefore is not part of the default `npm run check`.

The local development site does not assume a Relay is running. To enable TH06MP/TH07MP in the ordinary Launcher, set `EAGLER_TOUHOU_NETPLAY_RELAY` before starting the server—for example, `ws://127.0.0.1:18142/` for a local Relay or an explicitly authorized test WSS. The value enters the development Host Manifest and passes the formal URL contract. Never write a temporary Relay address into the product catalog.

`ARCHITECTURE.md` exclusively owns normative test-admission rules under **Testing architecture**. Before adding a test, answer three questions: which stable invariant does it protect; what is the smallest boundary that can prove that invariant; and would the assertion remain valid after a behavior-preserving refactor? If those questions have no clear answers, do not write a test first and search for a justification later.

Feature-specific checks live under `tests/`. New dedicated Browser test entrypoints and runners belong under `tests/browser/`. Some established explicit Browser lanes remain at the test root and must continue to be owned by explicit `package.json` commands until one coherent test-layout migration moves them together. Old source-regex and layout locks are migration evidence only; they have no grandfathered authority. When a refactor exposes a brittle assertion, restore the real contract first, move coverage to the appropriate owner behavior, repository integration, browser/device, or other layer, and then delete or demote the old change-detector test. Never preserve an incorrect module boundary merely to keep an old test green.

Default tests must be hermetic, deterministic, and repeatable. They do not depend on the public network, sleep timing, persistent state from the user's machine, or undeclared sibling content. Real browsers, WebKit/WebView, device touch, public networking, and release-candidate verification are explicit heavy lanes used only for properties smaller tests cannot prove. Conversely, source grep cannot masquerade as a real-device regression test.

## Missing Runtime resources

If a game exits immediately after sound and input initialization, the Runtime usually failed to obtain the original game archives. Confirm that the locally playable build uses `TH_EXTERNAL_ASSETS=OFF`, then rebuild with `-EmbedLocalAssets`.

The public source-build check uses `TH_EXTERNAL_ASSETS=ON` and cannot launch from the development site directly. Do not solve missing resources by copying or committing `.data`.
