# iOS WebKit Runtime handoff - 2026-08-28

## Current target

Fix real-iPhone Safari/WebKit startup for the Package runtime path in `eagler-touhou` without regressing Android, offline Package launch, input bridges, THPrac, audio, save data, or multiplayer.

Workspace root: `D:\workspace\eagler`

Main frontend repo: `D:\workspace\eagler\eagler-touhou`

Public test server: `43.138.163.67`

Public URL: `https://test.touhou.vip/eagler-touhou/`

Server resource mode must remain `import-partial`.

Do not overwrite sparse/partial release data such as `games.json`, `legacy-games.json`, Runtime payloads, or `runtimeUpdates` during App Shell deploys.

Do not use `reset`, `checkout`, `restore`, or `clean`. Do not commit/push unless explicitly requested.

## History session

Current history archive: `docs/history-session/29.md`

Session key:

`v1/3NuaTwqnyxKwDQxtUV48uCYGmkcQIE4CnjVICjLaxkkhf5oiA2t6JWxS2QxZOCoS8lgZUQPxKuS7`

The active history session contains the final r684 Runtime storage migration, the failed r685/r686 raw direct-carrier experiments, the r687 self-contained direct Runtime carrier, the r688 Service Worker ordinary-URL carrier, the failed r689 Service Worker-side memory transport, the r690 iOS page-side Package memory bridge, and the current r691 Service Worker capability-handoff fix described below. Use its latest checkpoint rather than the older intermediate states embedded in historical sections of this document.

In a new ChatGPT conversation, bootstrap exactly once, then read this file. Do not bootstrap twice.

## Real-device evidence that changed the architecture

The affected real iPhone repeatedly stalled at the nested Runtime-host stage even though desktop/Playwright WebKit passed.

The decisive r678/r680 on-device diagnostics were:

```text
iframe.src = https://test.touhou.vip/eagler-touhou/runtime-host-v2.html?... 
href = about:blank
readyState = complete
document = yes
mount = undefined
load = no
hostReady = no
```

r680 additionally recreated the inner iframe, set `src` before insertion, then replaced the old iframe. The real iPhone still showed the same result: the HTML `src` attribute changed, but the browsing context remained the initial `about:blank` Document.

Conclusion: the failing boundary is nested iframe navigation commit on the real iPhone, not HTTP delivery, Service Worker routing, `load`, or the Runtime-host handshake.

Earlier Nginx logs had already shown the real iPhone requested `runtime-host-v2.html` and received HTTP 200. Therefore do not go back to debugging CDN/Nginx/SW for this specific first-launch symptom unless new evidence contradicts it.

## Current public r691 state

Visible public revision currently deployed on 43: `r691`.

Public Workbox build:

`7d75d8733b7968834979`

Public backup created immediately before the r691 cutover:

`/var/www/eagler-touhou.backup-20260828-r691-sw-capability-handoff`

Current authoritative public identities:

```text
deployment import-partial
legacy import-partial
runtimeUpdates 1
r691 true
Workbox 7d75d8733b7968834979
deployment inventory = 63
public HTTPS verifier = PASS (63 files, 8,290,632 bytes, exact bytes/SHA)
TH07 descriptor revision = 9dde1d9e47b934d1
TH07 runtimeStorage = arraybuffer-v2
TH07 runtimeCarrier = service-worker-url-v1
normal Runtime version remains 44d435e1f28c932e
normal Runtime hosted bytes remain 3,152,108
```

### Real iOS r690 result: failed earlier at the Service Worker handoff boundary

The affected real iOS device did not reach the DATA/OGG checks on public r690. It stalled at:

```text
TH07本地游戏
正在启用本地 Runtime 文件服务
正在准备
```

That status is emitted before the Runtime iframe is navigated. The audit found a real handoff hole in r690: `waitForServiceWorkerController()` accepted any non-null `navigator.serviceWorker.controller`, without proving that the controller was the current App Shell worker or that it understood the r690 Package Runtime/page-memory protocol. At the same time, App Shell update reloads were deliberately deferred while the Player was open, and r690 opened the Player before completing this SW ownership check. A stale r688/r689 controller could therefore sit between a newer Launcher document and the current Runtime protocol.

### r691 Service Worker capability handoff

r691 keeps the r690 page-memory architecture but hardens the pre-navigation ownership boundary:

- the Service Worker exposes `eagler-touhou/app-shell-sw-capabilities/1` through an explicit `MessageChannel` handshake;
- the controlling worker must declare `packageRuntimeUrlV1: true`;
- iOS additionally requires `iosPageMemoryV1: true`;
- a merely non-null stale controller is no longer accepted;
- if a compatible newly activated worker exists but Safari has not switched `navigator.serviceWorker.controller` yet, the Launcher gives `clients.claim()` / `controllerchange` a bounded chance to finish and then performs one safe page reload **before the Player is opened**;
- the Player is now opened only after a capability-compatible SW controller has been confirmed (or after the non-SW insecure-development fallback is selected).

This specifically targets the r690 real-device stall without changing the Package generation, Runtime payload, DATA, OGG, descriptor, or Android transport path.

Local r691 acceptance:

- `node --check app.js`: PASS.
- `node --check app-shell-sw-src.js`: PASS.
- `node scripts/test-local-launcher-contract.mjs`: PASS.
- `node scripts/test-player-contract.mjs`: PASS.
- `npm run build:app-shell`: PASS; Workbox `7d75d8733b7968834979`.
- `node --check app-shell-sw.js`: PASS.
- `npm run test:webkit`: PASS for TH06 and TH07.
- iPhone-UA WebKit TH07 DATA through `page-memory`: exactly `23,829,135 / 23,829,135` bytes; Runtime reached `运行中`.
- iPhone-UA WebKit TH06 DATA through `page-memory`: exactly `8,064,942 / 8,064,942` bytes; Runtime reached `运行中`.
- the auxiliary Package-object probe now consumes `response.body.getReader()` like the OGG loader, rejects stream overflow immediately, and received exactly `8,990,160 / 8,990,160` bytes through `page-memory` for both games.
- source audit confirms TH07 OGG uses `fetch -> response.body.getReader()` via `fetchResourceBytes()`, so installed `/__package__/...` OGG is covered by the same r690/r691 page-memory fetch bridge; there is no XHR bypass on that path.
- Windows Playwright WebKit still has no AudioContext, so actual OGG decoding/playback itself is not covered by this desktop gate.

Public r691 deployment acceptance:

- remote sparse stage contained only `index.html`, `app.js`, and `app-shell-sw.js`;
- staged SHA-256 identities were `fcc8def846ed5fec4237859abd16fb548ff0fbd94f7b2782c8e0d5762d254ac8`, `de49280e9a1bbd64983db34f1d3725479639fe555994673ea0848b8fe999c0f6`, and `31626f2b384bdd9aad14b5e12a783fa2a9fa6cb55da24db8a56da74565329c5c` respectively;
- no `.wasm`, `.data`, or `.ogg` payload was staged or published;
- `deployment.json.resourceMode` remains `import-partial`;
- `legacy-games.json.shared.resourceMode` remains `import-partial`;
- Runtime/descriptor identities remain unchanged;
- `node scripts/verify-deployed-site.mjs https://test.touhou.vip/`: PASS 63/63, 8,290,632 bytes.

**Real iOS acceptance of r691 is pending.** Test on the same affected device without clearing site data and without reimporting the Package. That is intentional: the test must exercise the stale-Service-Worker handoff. A one-time `正在切换到新版 Runtime 文件服务…` followed by an automatic refresh is acceptable. It must not remain indefinitely at `正在启用本地 Runtime 文件服务…`. If it proceeds into Runtime/DATA, continue checking whether the historical `934.7 / 47.2 MiB` OGG over-read and `データファイルが存在しません` error are gone.

## Historical public r690 state

Visible public revision currently deployed on 43: `r690`.

Public Workbox build:

`6c1270c40568c62a1272`

Public backup created immediately before the r690 cutover:

`/var/www/eagler-touhou.backup-20260828-r690-ios-page-memory`

Current authoritative public identities:

```text
deployment import-partial
legacy import-partial
runtimeUpdates 1
r690 true
Workbox 6c1270c40568c62a1272
deployment inventory = 63
public HTTPS verifier = PASS (63 files, 8,284,791 bytes, exact bytes/SHA)
TH07 descriptor revision = 9dde1d9e47b934d1
TH07 runtimeStorage = arraybuffer-v2
TH07 runtimeCarrier = service-worker-url-v1
normal Runtime version remains 44d435e1f28c932e
normal Runtime hosted bytes remain 3,152,108
```

### Why r690 replaced the r689 hypothesis

The affected real iOS device tested public r689 without clearing site data or reimporting the Package. Both symptoms remained unchanged:

```text
OGG 音乐
934.7 / 47.2 MiB
...
error : データファイルが存在しません
```

Therefore converting a disk-backed Blob to `ArrayBuffer` **inside the Service Worker** was insufficient. The failing boundary is now treated as the iOS Service Worker synthetic-response/network stream path itself, not merely the Blob object supplied to `new Response()`.

TH07's generated DATA loader and the Runtime OGG installer share the same important behavior: both consume `response.body.getReader()` streams. The abnormal OGG counter proves the Runtime can receive many more response bytes than the declared resource total, while the game later cannot open `/th07.dat`. r690 therefore stops sending the affected iOS Package payloads through the Service Worker response stream at all.

### r690 iOS page-side Package memory bridge

The production architecture remains:

```text
Launcher
-> one #gameFrame
-> ordinary /__runtime__/.../index.html URL
-> Service Worker for Runtime HTML / JS / WASM
```

For iOS only, the Service Worker injects a small fetch bridge into the Runtime HTML before it executes. Runtime fetches for:

- the generation-pinned `.data` object under `/__runtime__/...`; and
- generation-pinned Package objects under `/__package__/...` (including installed OGG)

are intercepted in the Runtime page and resolved by calling the same-origin parent Launcher function `window.__eaglerReadPackageBytesV1(...)`.

The Launcher then reads the current generation's IndexedDB Package object **in the page process**, materializes an `ArrayBuffer`, checks the actual byte count against `descriptor.files[fileId].bytes`, and returns those bytes directly to the Runtime page. The Runtime constructs a page-local in-memory `Response`; those bytes therefore do not pass through a Service Worker synthetic response.

The diagnostic transport header for this new path is:

```text
X-Eagler-Storage-Transport: page-memory
```

Android/Chromium do not receive the injected iOS bridge and keep the existing Service Worker transport.

Local acceptance before deployment:

- `node scripts/test-local-launcher-contract.mjs`: PASS.
- `npm run build:app-shell`: PASS; Workbox `6c1270c40568c62a1272`.
- `npm run test:webkit`: PASS for TH06 and TH07.
- iPhone-UA WebKit TH07 DATA through `page-memory`: exactly `23,829,135 / 23,829,135` bytes, Runtime reached `运行中`.
- iPhone-UA WebKit TH06 DATA through `page-memory`: exactly `8,064,942 / 8,064,942` bytes, Runtime reached `运行中`.
- iPhone-UA WebKit Package object test (`shared-msgothic`): exactly `8,990,160 / 8,990,160` bytes through `page-memory`.
- Existing simultaneous move/focus iOS touch regression remained PASS.

Public deployment acceptance:

- sparse stage contained only `index.html`, `app.js`, and `app-shell-sw.js`;
- no `.wasm`, `.data`, or `.ogg` payload was staged or published;
- `deployment.json.resourceMode` remains `import-partial`;
- `legacy-games.json.shared.resourceMode` remains `import-partial`;
- TH07 descriptor/runtime identities remain unchanged;
- `node scripts/verify-deployed-site.mjs https://test.touhou.vip/`: PASS 63/63, 8,284,791 bytes.

**Real iOS acceptance of r690 is still pending.** Test the same affected iOS device without clearing site data or reimporting the Package. The two decisive checks remain whether `934.7 / 47.2 MiB` disappears and whether `error : データファイルが存在しません` disappears. If r690 still fails, capture the new exact progress/error; the page-side bridge now has strict per-object byte-count validation, so a size mismatch should be much more specific than the old game-level error.

## Current public r689 state

Visible public revision currently deployed on 43: `r689`.

Public Workbox build:

`f82fb28553a7798bd283`

Public backup created immediately before the r689 iOS hotfix cutover:

`/var/www/eagler-touhou.backup-20260827-r689-ios-memory-hotfix`

Current authoritative public identities:

```text
deployment import-partial
legacy import-partial
runtimeUpdates 1
r689 true
Workbox f82fb28553a7798bd283
deployment inventory = 63
public HTTPS verifier = PASS (63 files, 8,277,595 bytes, exact bytes/SHA)
TH07 sparse update variant = normal
TH07 descriptor revision = 9dde1d9e47b934d1
TH07 runtimeStorage = arraybuffer-v2
TH07 runtimeCarrier = service-worker-url-v1
normal Runtime version remains 44d435e1f28c932e
normal Runtime hosted bytes remain 3,152,108
```

### r689 iOS-only Service Worker Blob -> memory transport hotfix

Real-device evidence after r688 changed the remaining diagnosis again. On iOS only, the Service Worker ordinary-URL carrier successfully reached the actual TH07 executable, but the game then reported:

```text
OGG 音乐
934.7 / 47.2 MiB
...
error : データファイルが存在しません
```

This is materially different from the earlier iframe/Runtime-carrier stalls: the Runtime now executes, but Blob-backed Package resources are not being consumed correctly on the affected iOS WebKit path.

The important storage split is:

- Runtime HTML / JS / WASM are ArrayBuffer-backed and already worked through r688;
- DATA / OGG and some Package-local objects can remain Blob-backed in IndexedDB;
- Android/Chromium did not reproduce the failure.

r689 therefore does **not** change the general Service Worker URL architecture and does **not** change Android. It adds an explicit iOS-only transport marker:

```text
iOS Runtime URL / Package URL: ios-memory=1
Android / Chromium URL: no ios-memory marker
```

When the Service Worker sees the iOS marker for a Blob-backed Package object, it first executes `await blob.arrayBuffer()` and constructs the `Response` from the in-memory bytes instead of handing the disk-backed Blob directly to the network response path. Runtime subresources inherit the iOS mode from the controlled Runtime client's URL; Package-local OGG/font URLs receive the marker directly.

The diagnostic response header is:

```text
X-Eagler-Storage-Transport: memory
```

Local browser regression evidence before deployment:

- iPhone-UA WebKit: TH06/TH07 DATA returned HTTP 200 with `transport=memory` and both Runtimes reached ready;
- WebKit `/__package__/...` test with a ~23.8 MiB Blob returned HTTP 200, full byte length, `transport=memory`;
- Chromium equivalent DATA path remained `transport=blob`;
- complete Launcher WebKit and Chromium regressions passed, including magnifier, THPrac, touch/mouse bridge and Alt+Enter handling.

Public deployment/readback evidence:

- public `app.js` contains the `iosWebKitTouch`-gated `searchParams.set("ios-memory", "1")` branch;
- public `app-shell-sw.js` contains the `ios-memory`, `blob.arrayBuffer()` and `X-Eagler-Storage-Transport` paths;
- public Workbox marker is `f82fb28553a7798bd283`;
- `node scripts/verify-deployed-site.mjs https://test.touhou.vip/` passed all 63 authoritative files after the final cutover;
- TH07 descriptor remains `9dde1d9e47b934d1`, `arraybuffer-v2`, `service-worker-url-v1`; Runtime/DATA/OGG payload identities were not republished for r689.

**Real iOS r689 result: FAIL.** The same affected device retained both the abnormal `934.7 / 47.2 MiB` OGG accounting and `データファイルが存在しません`. r689 is historical and superseded by r690.

### Important 43 deployment path detail discovered during r689

The nginx vhost uses:

```text
root /var/www/eagler-touhou;
```

Therefore URL `/eagler-touhou/app.js` is physically served from:

```text
/var/www/eagler-touhou/eagler-touhou/app.js
```

and similarly for `index.html` / `app-shell-sw.js`. The outer duplicates `/var/www/eagler-touhou/app.js`, `/var/www/eagler-touhou/index.html`, etc. are **not** the files served by the public `/eagler-touhou/...` URLs. During r689 an initial cutover touched those outer duplicates, the public verifier caught the mismatch, and the outer files were restored from the pre-r689 backup before the correct inner files were deployed. Future sparse App Shell deploys must target the inner `eagler-touhou/` directory according to the paths in `deployment.json`.

### r688 architecture decision - ordinary same-origin URLs served from Package Store by Service Worker

The r687 self-contained Blob carrier still stalled on the real Android WebView at `本地 Runtime 页面已准备`. That made the remaining conclusion straightforward: stop treating Blob navigation as the production mobile Runtime carrier and use the browser's normal document/subresource loading pipeline.

r688 therefore uses this public HTTPS topology:

```text
Launcher
-> #gameFrame
-> /eagler-touhou/__runtime__/<game>/<generation>/<variant>/index.html
-> normal relative JS / WASM / DATA requests
-> App Shell Service Worker
-> generation-pinned Package Store objects in IndexedDB
-> Runtime ready / configure / launch
```

Important properties:

- there is still exactly one game iframe;
- `player.html`, nested Runtime iframe, `about:blank` carrier and `srcdoc` are not used;
- public HTTPS/mobile Runtime navigation itself is no longer a `blob:` URL;
- Runtime HTML/JS/WASM/DATA appear to Emscripten as ordinary same-origin URL resources with normal MIME types;
- Package Store, Descriptor, current/pending generation and atomic update ownership remain unchanged;
- the virtual Runtime URL includes the generation id, so a running generation stays pinned even if a background update changes current;
- Service Worker `activate` uses `clients.claim()` so the first Launcher session can immediately use the local Runtime file service;
- Launcher waits for a real Service Worker controller before navigating `#gameFrame`;
- first Service Worker installation is not treated as an App Shell update/reload: `updatefound` records whether a controller already existed before installation;
- Runtime ready/error listeners are attached before assigning `frame.src`, preventing a very fast local Runtime from winning the event-listener race;
- Package-local non-Runtime objects such as fonts and OGG can use generation/file-id-pinned `/__package__/...` ordinary URLs instead of falling back to Blob resource URLs;
- the old self-contained Blob path remains only as a non-secure/development fallback, not the public mobile carrier.

The descriptor carrier epoch is now:

```json
"runtimeStorage": "arraybuffer-v2",
"runtimeCarrier": "service-worker-url-v1"
```

The carrier-only r687 -> r688 migration deliberately does **not** reacquire unchanged Runtime bytes. `arraybuffer-v2` objects are already valid Package Store data for the Service Worker, so changing `direct-blob-v1` to `service-worker-url-v1` creates a new generation descriptor while reusing the existing objectIds. Only an older Runtime storage epoch still forces Runtime HTML/JS/WASM reacquisition.

Acceptance before/following deployment:

1. Fresh Service Worker install lifecycle:
   - isolated Chromium test: `installing -> activated`, `controller=true`, no App Shell precache failure;
   - `clients.claim()` provides first-session control without requiring a manual reload.
2. Real TH06 + TH07 Package Store Runtime test using actual Runtime HTML/JS/WASM/DATA:
   - Chromium PASS;
   - iPhone-UA Playwright WebKit PASS;
   - each game loads `index.html`, `.js`, `.data`, `.wasm` as ordinary `/__runtime__/...` requests with HTTP 200;
   - MIME types are `text/html`, `text/javascript`, `application/octet-stream`, and `application/wasm` respectively;
   - both Runtimes reach `ready`;
   - `EM_PRELOAD_CACHE` is not recreated.
3. Full Launcher single-iframe regression:
   - Chromium PASS;
   - iPhone-UA Playwright WebKit PASS;
   - frame tree exactly `Launcher | /__runtime__/.../index.html?hosted=1`;
   - magnifier 160%, THPrac menu/mouse, Alt+Enter handling, custom Runtime events and touch ownership pass;
   - WebKit desktop automation still lacks usable AudioContext, so MIDI marker is not asserted there.
4. Local carrier migration regression from r687 shape:
   - `acquired=[]`;
   - Runtime and DATA objects keep the same objectIds.
5. Public carrier migration regression against deployed r688:
   - descriptor `9dde1d9e47b934d1`;
   - `runtimeStorage=arraybuffer-v2`;
   - `runtimeCarrier=service-worker-url-v1`;
   - `payloadDownloads=[]`;
   - normal + multiplayer six Runtime bootstrap objects, DATA and both shared fonts are all reused;
   - generated `/eagler-touhou/__runtime__/th07/<generation>/normal/index.html` returns HTTP 200 from the Service Worker.
6. Public deployment verifier:
   - 63/63 authoritative files PASS exact bytes/SHA;
   - deployment generatedAt `2026-08-27T13:17:48.114626Z`.

The next authoritative acceptance is the same real Android WebView / iPhone hardware that failed r685-r687. Do not clear site data before testing r688: the intended upgrade path is carrier-only generation migration with object reuse.

## Current public r687 state

Visible public revision currently deployed on 43: `r687`.

Public Workbox build:

`7709e90810695126db76`

Public backup created before the r687 cutover:

`/var/www/eagler-touhou.backup-20260827-r687-self-contained-runtime`

Current authoritative public identities:

```text
deployment import-partial
legacy import-partial
runtimeUpdates 1
r687 true
Workbox 7709e90810695126db76 true
deployment inventory = 63
public HTTPS verifier = PASS (63 files, 8,261,229 bytes, exact bytes/SHA)
TH07 sparse update variant = normal
TH07 descriptor revision = 074c3534c79ba252
TH07 runtimeStorage = arraybuffer-v2
TH07 runtimeCarrier = direct-blob-v1
normal Runtime version = 44d435e1f28c932e
normal Runtime hosted bytes = 3,152,108
DATA revision remains 5fe8d772191505bf and DATA was not uploaded
```

### r687 fix - restore the historically proven self-contained single-iframe Runtime carrier

The r686 migration hypothesis is superseded by stronger real-device evidence. The user tested both an r685->r686 upgrade and a completely cleared/reimported r686 install on real Android WebView; both stalled at `正在解析本地 Runtime 页面`. The earlier apparent "clear data fixes r685" result happened after the public server had already been rolled back to r684, so clearing site data likely removed the cached r685 App Shell and fetched the already-restored r684 Player path. It was therefore not valid evidence that the raw r685 direct carrier worked on real Android WebView.

The actual failing r685/r686 boundary was after HTML decode and before any Runtime message: raw Package HTML was navigated as a Blob URL and then expected to perform a second `packageBridge` parent/child bootstrap handshake before its Emscripten JS could load. Real Android WebView repeatedly stalled at this boundary even with completely fresh Package data.

r687 keeps the useful Package architecture but changes the carrier to match the pre-Player implementation that historically worked across phones:

```text
Package Store generation
-> read Runtime HTML/JS/WASM/DATA
-> create transient Blob URLs in Launcher
-> patch Emscripten JS stable pathname
-> inject Module.locateFile + final Blob JS URL into Runtime HTML
-> create self-contained HTML Blob
-> #gameFrame.src = blob:...#hosted=1&game=th07
-> Runtime ready
```

Important properties:

- there is still exactly one game iframe;
- `player.html` / nested `about:blank` do not return;
- Package Store / Descriptor / current-pending generations remain authoritative;
- Runtime HTML/JS/WASM remain ArrayBuffer-backed in Package Store;
- DATA/OGG/fonts/save/Replay ownership is unchanged;
- the active Runtime page no longer needs `packageBridge=1` at all;
- `entryUrl()` now points to a **preassembled self-contained HTML Blob** and returns only `#hosted=1&game=...`;
- Package bootstrap protocol code may remain as historical compatibility plumbing, but it is not on the active r687 launch path.

Dynamic acceptance performed before deployment:

1. Updated single-iframe fixture with realistic `template + external JS + WASM/DATA locateFile` shape:
   - Chromium PASS;
   - iPhone-UA Playwright WebKit PASS;
   - frame tree exactly `Launcher | blob:...#hosted=1&game=th07`;
   - no `packageBridge=1`.
2. Real TH06 + TH07 build browser test using actual Runtime HTML/JS/WASM/DATA through Package Store and `createPackageRuntimeAccess().entryUrl()`:
   - Chromium PASS: both Runtimes reach `ready`;
   - Playwright WebKit PASS: both Runtimes reach `ready`;
   - `EM_PRELOAD_CACHE` is not recreated.
3. Public r687 verification:
   - 63/63 authoritative deployment files PASS exact bytes/SHA;
   - public `package-runtime-access.mjs` contains the self-contained assembly stages;
   - public active `entryUrl()` contains `#hosted=1&game=` and does not return `#packageBridge=1`.

No TH07 Runtime bytes or Package descriptor identity changed for r687. The existing r686 generation can be reused directly; only the App Shell carrier changed.

## Historical public r686 state

### r686 migration fix - historical hypothesis, superseded by r687 real-device evidence

After r685, a real Android 16 WebView initially appeared to stall at `正在解析本地 Runtime 页面`. At the time, a subsequent successful launch after clearing site data was interpreted as proof that the direct carrier itself was valid. **That interpretation is now known to be unreliable** because the public server had already been rolled back to r684 before the clear-data test. Later r686 tests on the same real Android WebView reproduced the stall both with old data and after a complete clear/reimport. Therefore r686's generation-migration work is retained as valid Package hygiene, but it did not fix the carrier failure.

r686 therefore keeps the r685 execution topology unchanged:

```text
Launcher
-> #gameFrame
-> direct Package Runtime blob: HTML
-> Blob JS/WASM/DATA from Package Store
-> WebGL/WASM game
```

The migration contract is now explicit:

```json
"runtimeStorage": "arraybuffer-v2",
"runtimeCarrier": "direct-blob-v1"
```

`arraybuffer-v2` does not introduce a new physical persistence primitive; Runtime HTML/JS/WASM are still persisted as ArrayBuffer-backed Package objects. The version bump is an epoch/fence so older r684/r685 code cannot silently accept the new descriptor and commit a generation that reuses bootstrap objects from the old carrier. The old public r684 validator accepts only `arraybuffer-v1`, so it rejects the v2 descriptor instead of creating a false "already migrated" state during a mixed App-Shell/catalog cutover.

When installing the v2/direct descriptor over a generation with an older `runtimeStorage` or missing/different `runtimeCarrier`:

- all Runtime HTML/JS/WASM bootstrap file IDs across all declared Runtime variants are forced into the acquisition plan even if their content revisions are unchanged;
- TH07 therefore refreshes both normal and multiplayer HTML/JS/WASM (6 objects total);
- DATA, shared fonts, OGG, language resources and other components remain normal revision-based reuse and are not reacquired merely for the carrier migration;
- `attachPendingPackageObject()` now preserves `storageMode: "arraybuffer"` in generation file metadata instead of dropping it;
- current/pending commit remains atomic;
- no site-data wipe is required and Replay/save compatibility is untouched.

The normal TH07 Runtime bytes themselves did **not** change in r686:

- HTML `8733da0618ea1471`
- JS `1798c80ef0038253`
- WASM `667f6bac27f1c9dd`
- Runtime version `44d435e1f28c932e`

Only the Package descriptor/storage/carrier migration identity changed. Final descriptor revision is `074c3534c79ba252`.

Two migration regressions prove the intended behavior:

1. Local browser migration fixture seeds a pre-carrier generation and installs the new descriptor. PASS: Runtime HTML/JS/WASM are newly acquired while DATA keeps its original objectId.
2. Public-browser migration fixture seeds an r684-style TH07 generation against the actual public r686 site. PASS: exactly these six Runtime files are downloaded:

```text
/games/th07/th07.html
/games/th07/th07.js
/games/th07/th07.wasm
/games/th07/multiplayer/th07.html
/games/th07/multiplayer/th07.js
/games/th07/multiplayer/th07.wasm
```

and `game-data`, `shared-msgothic`, and `shared-unifont` are reused without replacement. The resulting generation reports descriptor `074c3534c79ba252`, `runtimeStorage=arraybuffer-v2`, and `runtimeCarrier=direct-blob-v1`.

Fresh direct-carrier acceptance still passes on iPhone-UA Playwright WebKit with exactly two frames total (`Launcher | blob:Runtime`) plus magnifier 160%, THPrac menu/mouse, Alt+Enter, and touch-pointer ownership. The r686 fix is therefore a migration repair, not another carrier redesign.

## Historical public r685 state

Visible public revision currently deployed on 43: `r685`.

Public Workbox build:

`21093e7d58efa2b854d5`

Public backup:

`/var/www/eagler-touhou.backup-20260827-r685-direct-runtime-carrier`

Remote state was verified after deployment:

```text
deployment import-partial
legacy import-partial
runtimeUpdates 1
r685 true
Workbox 21093e7d58efa2b854d5 true
deployment inventory = 63
public HTTPS verifier = PASS (63 files, 8,253,455 bytes, exact bytes/SHA)
TH07 sparse update variant = normal
TH07 descriptor revision = e812a2ca119c7336
TH07 runtimeStorage = arraybuffer-v1
normal Runtime version = 44d435e1f28c932e
normal Runtime hosted bytes = 3,152,108
DATA revision remains 5fe8d772191505bf and DATA was not uploaded
multiplayer Runtime bootstrap revisions remain unchanged
```

### r685 architecture decision - nested Player carrier retired

After final r684, a real iPhone reached far enough into startup that Safari replaced the page with:

```text
A problem repeatedly occurred on "https://test.touhou.vip/eagler-touhou/?game=th07"
```

This is qualitatively different from a Runtime JavaScript error/Toast: the WebContent process itself is being reloaded/killed. The user also supplied the decisive regression baseline: **before the Launcher/Player architecture rewrite, iOS could enter and run the game successfully**.

The r681-r684 execution topology was therefore retired rather than patched further. Do not restore it:

```text
RETIRED:
Launcher
-> #gameFrame player.html
-> inner #runtime inherited about:blank
-> injected Package HTML
-> WebGL/WASM game
```

Current r685 topology:

```text
Launcher
-> #gameFrame
-> direct Package Runtime blob: HTML
-> Blob JS/WASM/DATA from Package Store
-> WebGL/WASM game
```

This restores the practical single-iframe carrier that existed before the architecture regression while retaining the useful new data architecture:

- Package Store remains authoritative;
- Release Catalog / Package Descriptor remain authoritative;
- current/pending generation and atomic update behavior remain;
- `runtimeStorage=arraybuffer-v1` remains;
- Runtime HTML still decodes from direct stored ArrayBuffer bytes;
- Runtime JS/WASM/DATA still use transient Package Store object URLs;
- OGG/language/shared resources remain Package-driven;
- Replay compatibility remains;
- old release/runtime formats remain unsupported.

`app.js` now creates `createPackageRuntimeAccess(...)` itself, obtains `activePackageRuntimeAccess.entryUrl()`, and assigns that directly to `#gameFrame.src`. The Launcher itself answers `eagler-touhou/package-bootstrap/1` `bootstrap-ready` and Runtime JS diagnostics. There is no `new URL("player.html", ...)`, no `currentNestedRuntimeFrame()`, and no `focus-runtime` hop in the active Launcher path.

The active Workbox App Shell no longer precaches `player.html`, `player.js`, `runtime-host.html`, or `runtime-host-v2.html`. Fresh server packaging also no longer copies these retired carrier assets. They may remain physically present on the current public server only because the r685 App-Shell-only deploy preserved the existing 63-path inventory rather than deleting files during a live sparse deployment; **physical presence does not make them an active or supported architecture path**.

Direct carrier browser acceptance is explicit:

```text
Launcher URL
| blob:<same-origin UUID>#packageBridge=1&hosted=1&game=th07
```

Chromium PASS and iPhone-UA Playwright WebKit PASS both assert exactly two frames total (main Launcher plus one direct Runtime frame), no `player.html`, and no inner `about:blank`. The same regression also passes magnifier (160%), THPrac menu/mouse bridge, Alt+Enter and touch pointer ownership. Desktop Playwright WebKit has no AudioContext, so MIDI audio is not asserted there; this is an existing test-environment limitation, not a carrier failure.

### r684 Runtime storage migration - retained under r685

r684 introduced the ArrayBuffer-backed Runtime storage contract. r685 retains that storage work but does **not** retain r684's nested Player/about:blank execution carrier. The storage contract and execution carrier are now intentionally separate concerns.

The r684 change was triggered by two separate real-iPhone r683 reports:

- Device A passed HTML reading and reached `blank-host-ready` / `runtime-js-request` (`正在启动本地 Runtime 脚本…`), then the Player immediately failed back to Launcher with Toast `0003 SyntaxError: Invalid character`.
- Device B still failed back to Launcher at `runtime-access-html-bytes` (`正在读取本地 Runtime 页面字节…`).

This proves that `Blob.arrayBuffer()` is not a universal fix for Safari IndexedDB Blob behavior, and also exposes a second risk: r683 normal `th07.js` kept revision `98172aa8ab923c5a`, so an existing installation could legally reuse an older disk-backed JS Blob instead of reacquiring it.

### r684 Runtime storage migration

Package Descriptor now carries:

```json
"runtimeStorage": "arraybuffer-v1"
```

The current TH07 Package Descriptor revision is `e812a2ca119c7336`.

On the one-time transition from a descriptor without this marker to `arraybuffer-v1`:

- generation planning can force-reacquire Runtime HTML/JS/WASM on the storage-format transition even when a declared content revision did not change;
- Runtime HTML/JS/WASM are persisted through `putPackageObject(..., storageMode: "arraybuffer")`;
- DATA/fonts/components retain normal revision-based reuse and are not reacquired merely for this migration;
- Store normalization preserves the direct `data` ArrayBuffer and also constructs an in-memory Blob for Blob URL script/WASM loading;
- Runtime entry HTML uses direct stored bytes through `runtime-access-html-memory`, so the normal r684 path does not call `Blob.text()`, `Blob.arrayBuffer()`, FileReader, fetch, or navigation to materialize HTML;
- **there is no legacy Blob-backed Runtime HTML fallback anymore**. Per user direction, old release/runtime formats are not compatibility targets; only Replay compatibility is preserved. A Runtime entry that is not ArrayBuffer-backed is rejected instead of being read through `Blob.arrayBuffer()` or FileReader.

The final r684 sparse publication deliberately uses **new Runtime file revisions**, so existing installations cannot legally reuse the r683 disk-backed JS/WASM objects:

- normal HTML `8733da0618ea1471`
- normal JS `1798c80ef0038253`
- normal WASM `667f6bac27f1c9dd`

Those three normal Runtime files were uploaded sparsely. Existing multiplayer HTML/JS/WASM remain physically present and unchanged. DATA/OGG/fonts were not uploaded.

Public and local WebKit acceptance now explicitly assert the new path:

```text
runtime-access-html
-> runtime-access-html-memory
-> runtime-access-html-decode
-> runtime-host
-> runtime-host-ready
-> runtime-entry
-> runtime-ready
```

Both local WebKit and Service-Worker-controlled WebKit pass through `runtime-access-html-memory` without any legacy Blob-read stage. The final public HTTPS inventory verifier also passes after deployment.

The Package generation/installer/store contracts prove that `arraybuffer-v1` Runtime bootstrap objects use direct ArrayBuffer persistence while DATA remains revision-reusable. Desktop Playwright WebKit is only a gate; the next authoritative acceptance test remains the two real iPhones.

### r683 Runtime entry HTML fix - historical evidence

### r683 Runtime entry HTML fix

The r682 code at the failing real-device boundary was:

```js
const entryHtml = await withTimeout(
  entryObject.blob.text(),
  10000,
  "Package Runtime HTML read timed out",
);
```

The r683 path was:

```js
progress("runtime-access-html-bytes", "正在读取本地 Runtime 页面字节…");
const entryBytes = await withTimeout(
  entryObject.blob.arrayBuffer(),
  10000,
  "Package Runtime HTML byte read timed out",
);
progress("runtime-access-html-decode", "正在解析本地 Runtime 页面…");
const entryHtml = new TextDecoder("utf-8").decode(entryBytes);
```

This moved one real device past `Blob.text()`, but the later r683 Device B report proved `Blob.arrayBuffer()` can also fail on another real iPhone. r684 therefore no longer uses this as the normal path.

The current Package Store also has a global `indexedDB.open()` watchdog (`15s`) plus `onblocked` rejection and late-success cleanup. Player pre-ready Runtime `unhandledrejection` is fail-fast rather than waiting for the outer launch timeout.

TH06/TH07 source shells additionally contain Runtime Blob-script request/load/error/15s watchdog handling and a fail-closed 15s initial IDBFS restore watchdog. Their normal local Web runtimes were rebuilt after those shell changes.

The TH07 **normal** Runtime rebuild published for final r684 has new content revisions:

- `games/th07/th07.html` revision `8733da0618ea1471`
- `games/th07/th07.js` revision `1798c80ef0038253`
- `games/th07/th07.wasm` revision `667f6bac27f1c9dd`

The r683 Package Descriptor revision was `24b45131424d7011`. An intermediate r684 storage-only descriptor `52721a0172fff841` briefly existed on 43 while the normal Runtime bytes were still r683-era. The final r684 descriptor is `e812a2ca119c7336`, and the final normal Runtime is `44d435e1f28c932e`. Shared DATA remains revision `5fe8d772191505bf` and was not uploaded. The previous multiplayer HTML/JS/WASM files remain physically available and retain their previous content revisions.

`deployment.runtimeUpdates` contains exactly one current declaration: `game=th07`, `variant=normal`, `descriptorRevision=e812a2ca119c7336`, `hostedBytes=3152108`. DATA, OGG and fonts remain absent from the sparse Runtime publication.

### Emscripten Safari target hardening - linked and published for TH07 normal

TH06/TH07 `CMakeLists.txt` now link Web builds with:

```text
-sMIN_SAFARI_VERSION=140100
-sENVIRONMENT=web
```

Emscripten 24 defaults to `MIN_SAFARI_VERSION=150000`; its settings documentation states `140100` is the minimum supported Safari target. Both TH06 and TH07 were successfully relinked with these flags. The final public TH07 normal sparse update **does contain** the newly generated JS/WASM from this target hardening. TH06 was relinked locally but was not part of this TH07-only sparse publication.

The new TH07 JS SHA-256 is `1798c80ef00382534fdd58199377fe1c730c1ad75e8b5ad83b6f5c7072300e1c`; it no longer reuses the r683 `98172aa8...` object. Do not infer that Device A's old `Invalid character` was definitively caused by ECMAScript target level alone: the same device was also consuming an old IndexedDB Blob-backed JS object. Final r684 fixes both dimensions at once by forcing a new JS identity and an ArrayBuffer-backed Package object.

## r681 architecture base retained by r682

### r681 core design

The inner Runtime iframe is intentionally left on its initial inherited same-origin `about:blank` Document.

The Player no longer navigates that iframe to `runtime-host-v2.html`, Blob HTML, or any other URL.

Current Package startup path:

```text
Launcher
-> player.html
-> existing inner #runtime about:blank Document
-> install Runtime-host API directly into that Document
-> activate Package HTML/scripts in-place
-> Package bootstrap-ready
-> Player supplies Blob JS/WASM/DATA locate map
-> Runtime ready
```

Important: under r681, `href=about:blank#packageBridge=1&hosted=1&game=th07` is expected and is not an error.

Relevant implementation is in `eagler-touhou/player.js`, especially:

- `patchPackageHtmlForBlankRuntime()`
- `installRuntimeHostInBlankDocument()`
- `mountPackageEntryHtml()`

## WebKit semantics verified locally

The WebKit tests were strengthened after r681 to inspect the child realm directly.

Observed values in the in-place Runtime child:

```text
iframe src      = ""
href            = about:blank#packageBridge=1&hosted=1&game=th07
location.origin = null
window.origin   = http://127.0.0.1:8130
baseURI         = .../eagler-touhou/player.html?game=th07&generation=...&runtime=normal
referrer        = same Player URL
secureContext   = true
indexedDB       = object
caches          = object
Module          = object
```

This confirms the key distinction: `Location.origin` serializes as `null` for `about:blank`, while the Document/global security origin is inherited from the Player and remains same-origin. IndexedDB, CacheStorage and secure-context capabilities remain available.

Both of these passed after r681:

```text
python scripts/test-player-runtime-host-webkit.py http://127.0.0.1:8130/eagler-touhou/
python scripts/test-public-player-runtime-host-webkit.py http://127.0.0.1:8130/eagler-touhou/
```

The second test had an active App Shell Service Worker controller and also reached `runtime-ready`.

## Post-r681 WebKit audit work - DEPLOYED IN r682

The user then asked for an overall WebKit review instead of only chasing the last error. That audit found several stale assumptions and one real URL-semantics risk.

These changes were local-only at the original handoff, but are now included in public r682.

### 1. `location.href` compatibility added

r681 already patched Package HTML uses of `location.origin` because `about:blank` serializes it as `null`.

The audit found Package shells also use expressions such as:

```js
new URL(resource.url, location.href)
```

`document.baseURI` is inherited correctly, but explicit `location.href` remains `about:blank#...`. That is a different URL-resolution semantic and could break relative URLs even though current production Package resources are often absolute/Blob URLs.

Local `player.js` now also exposes the Player URL as a host href and patches Package HTML so explicit `location.href` consumers use the real Player URL. The strengthened tests now expose/verify both host origin and host href.

Do not remove this hardening without replacing it with an equally explicit Package-host URL abstraction.

### 2. r680 Runtime-host Service Worker ownership removed locally

The audit found stale r680 comments/logic claiming `runtime-host-v2.html` remained a precached offline fallback and that live navigation must bypass `respondWith()`.

r681 no longer navigates to that page at all, online or offline.

Local changes therefore removed `runtime-host-v2.html` from the new App Shell manifest and removed the SW pathname special-case.

The physical `runtime-host-v2.html` file is intentionally NOT deleted from the project/server because old cached r677-r680 pages may still request it. New r681+ pages should not depend on it.

After this cleanup the locally rebuilt App Shell is:

`c3865623f0617915dd27`

with 42 precache entries instead of 43.

This build is local only at handoff time.

### 3. stale `runtime-frame-replaced` Launcher path removed locally

r680 replaced the inner iframe and notified Launcher with `runtime-frame-replaced` so DOM/input bridges could be rebound.

r681 deliberately keeps the same inner iframe and never sends that event. The audit removed the now-dead Launcher handler and corresponding contract assertion locally.

### 4. old nested-Runtime browser test updated locally

`scripts/test-runtime-iframe-browser.py` used to locate the Runtime by looking for a frame URL containing `runtime-host-v2.html`.

That is invalid under r681.

It was changed to resolve the Runtime through the Player frame's `#runtime` element/content frame instead. Its absurd `time.monotonic() + 10000` waits were also reduced to intended 10-second waits.

The test was also updated to choose "continue current installed Package" when the local Release Catalog offers a newer server Package, otherwise it stalls in the decision dialog before Player navigation.

After those fixes the test reached the real r681 frame tree:

```text
Launcher
| player.html?game=th07&generation=runtime-iframe-fixture-th07&runtime=normal
| about:blank#packageBridge=1&hosted=1&game=th07
```

It also proved magnifier input still crosses into the real Runtime realm: zoom changed from 100% to 160%.

The test then timed out only on its synthetic MIDI marker hook. That MIDI result is NOT yet proven to be a product regression; the old test monkey-patches `WebAudioTinySynth.prototype.send`, and that assumption may itself be stale. Investigate before changing product MIDI code.

## Current local tests after audit

PASS:

```text
node scripts/test-package-store-contract.mjs
node scripts/test-package-runtime-access.mjs
node scripts/test-player-contract.mjs
node scripts/test-local-launcher-contract.mjs
node scripts/test-shell-protocol.mjs
node scripts/test-runtime-update-publication.mjs
node scripts/test-server-feature-contract.mjs
npm run build:app-shell
python scripts/test-player-runtime-host-webkit.py http://127.0.0.1:8130/eagler-touhou/
python scripts/test-public-player-runtime-host-webkit.py http://127.0.0.1:8130/eagler-touhou/
python scripts/test-runtime-iframe-browser.py http://127.0.0.1:8130/eagler-touhou/
node scripts/verify-deployed-site.mjs https://test.touhou.vip/
```

The two WebKit tests verify origin/base/storage/Module semantics, not only `runtime-ready`, and explicitly pass through `runtime-access-html-bytes` and `runtime-access-html-decode` before `runtime-ready`.

`scripts/test-runtime-iframe-browser.py` now reaches the correct in-place Runtime and passes launch waiter, magnifier, MIDI marker, THPrac menu/mouse bridge, Alt+Enter and nested pointer consumption.

The public verifier downloaded and hash-checked all 63 deployment inventory files after the normal Runtime sparse update and returned `valid=true`.

The larger `run-launcher-playwright-webkit.py` run was not useful for r681 in the current local 8130 environment because it selected a legacy direct Runtime URL (`../th07-eagler/build-web-eagler-thprac/th07.html?...`) instead of `player.html?generation=...`. It reached first-frame/running, then correctly failed its own Package-path requirement. Do not cite that run as either PASS or FAIL for r681.

## Important Safari/WebKit risk discovered outside first-launch

Launcher `resetRuntime()` currently contains:

```js
frame.removeAttribute("src");
```

On Safari/iOS, removing an iframe `src` loads `about:blank`.

There is a WebKit issue around repeated WebGL iframe navigation to/from `about:blank` causing WebContent memory growth/crash behavior. This is NOT the proven cause of the current first-launch issue, but it is relevant to repeated game start/exit cycles.

Possible future symptoms:

- memory increases after repeated launch/exit
- Safari reloads the page
- second/third launch becomes unreliable

Do not mix this teardown/memory issue into the first-launch fix unless real evidence points there. It deserves its own bounded change and repeated-launch test because changing the outer `#gameFrame` lifecycle touches many persistent listeners.

## Package-shell URL/origin notes

The active r685 Runtime is a direct same-origin `blob:` navigation in `#gameFrame`, with:

```text
#packageBridge=1&hosted=1&game=<game>
```

The hash remains the shell's Package bootstrap signal. Do not reintroduce the old Player-origin patching or inherited `about:blank` assumptions. Relative Runtime JS/WASM/DATA resolution is owned by the Launcher-provided Package bootstrap/`locateFile` map, not by an intermediate HTML carrier.

## Current priority for the NEXT conversation

1. Have both affected real iPhones confirm visible `r685` and retry the same TH07 normal Package launch. This is now the highest-value acceptance test. Public identities are Workbox `21093e7d58efa2b854d5`, Package Descriptor `e812a2ca119c7336`, Runtime version `44d435e1f28c932e`.

2. The expected r685 carrier is **one child iframe only**. Runtime diagnostics/inspection should show the Launcher plus a direct same-origin `blob:` Runtime URL containing `#packageBridge=1&hosted=1&game=th07`. Any normal launch containing `player.html` or a nested `about:blank` Runtime means the retired architecture has accidentally returned.

3. Expected startup stages now stop describing Player/about:blank ownership. The important boundaries are `runtime-access-resolve -> runtime-access-read -> runtime-access-urls -> runtime-access-html -> runtime-access-html-memory -> runtime-access-html-decode`, followed by direct Runtime `bootstrap-ready/runtime-js-request -> runtime-js-loaded -> IDBFS -> runtime-ready -> first-frame`.

4. If Safari still shows `A problem repeatedly occurred`, record whether it happens before or after `runtime-js-loaded` / game first frame. Do **not** restore Player/about:blank as a workaround. The purpose of r685 is to return to the pre-architecture single-iframe carrier that real iOS had already proven usable.

5. If a normal JavaScript/Toast error returns instead of a WebContent crash, capture the exact text and last stage. Final Runtime content is still HTML `8733da0618ea1471`, JS `1798c80ef0038253`, WASM `667f6bac27f1c9dd`; DATA remains `5fe8d772191505bf`.

6. r685 is an **App-Shell-only carrier replacement**. The sparse TH07 Runtime publication was intentionally not changed. Do not regenerate/redeploy Runtime or DATA merely to retest the direct carrier.

7. Local regression status: Direct Runtime carrier contract PASS, Single Runtime iframe contract PASS, Package Store/generation/installer/Runtime access/Launcher PASS, server feature/shell protocol PASS, Chromium direct-carrier browser PASS, iPhone-UA Playwright WebKit direct-carrier browser PASS, public 63-file HTTPS verifier PASS.

8. `player.html`, `player.js`, `runtime-host.html` and `runtime-host-v2.html` are retired architecture assets. They are excluded from the active Workbox and fresh server packaging. Do not add new production dependencies on them.

## Deployment discipline

43 web root:

`/var/www/eagler-touhou`

App root:

`/var/www/eagler-touhou/eagler-touhou/`

Before every App Shell deploy verify:

```text
deployment.json resourceMode == import-partial
legacy-games.json shared.resourceMode == import-partial
runtimeUpdates count remains expected (currently 1)
```

Create a remote backup before overwrite.

Only upload current App Shell files plus generated `app-shell-sw.js`; do not replace release/runtime sparse data.

After deployment, read remote files back and verify visible revision, Workbox build, expected architecture markers, and partial-mode metadata.

## Project-level constraints still in force

- Never switch to Work mode.
- Use main MCP for local coding.
- No destructive git commands.
- No commit/push without user request.
- UI copy must not use `·`; use `-`.
- Keep user informed during long work, but do not ask unnecessary clarification.
- Real iPhone behavior outranks desktop Playwright WebKit when the two conflict.

