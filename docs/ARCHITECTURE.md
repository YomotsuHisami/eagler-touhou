# Architecture

This document is the long-lived architectural map for `eagler-touhou`.
It describes current subsystem boundaries, authoritative contracts, and the
main data flows. It is not a development diary or a list of historical fixes.

When a change moves ownership between subsystems, introduces a new persistent
data path, changes an offline boundary, or adds/removes a browser-visible
metadata contract, this document must be updated in the same change.

For user-visible capability/support status, see `PRODUCT_SURFACE.md`.
The bounded thcrap/thprac Runtime adapter surface is specified in
`../integrations/RUNTIME_CONTRACT.md`.
Legacy ZIP and browser-storage migration scope and retirement conditions are
owned by `../legacy/README.md`.

## Engineering governance

The project optimizes for a formal, maintainable, repository-quality
architecture with as little unnecessary production code, test code, tooling,
compatibility scaffolding, duplicated configuration and historical workaround
surface as practical.

- Architectural changes MAY be large when they are evidence-driven, have a
  clear owner, and improve the long-term system. A large refactor MUST NOT be
  used as an excuse for an opportunistic rewrite without contract evidence.
- Refactoring is about making ownership clearer, not making files smaller.
  Splitting code MUST NOT create glue layers, tiny fragments or abstractions
  whose only purpose is physical separation.
- Existing internal implementations have no compatibility authority of their
  own. Compatibility is preserved only where required by an explicit public
  contract, persisted user data, Replay compatibility, published protocol or
  other demonstrated external dependency.
- "It currently runs" is not evidence that an architecture is correct.
  Refactoring work SHOULD actively look for duplicate owners, half-migrations,
  implicit dependencies, obsolete compatibility paths and same-class defects.
- When behavior is unclear, the contract MUST be established from evidence:
  callers, implementation, tests, repository history, generated artifacts and
  protocol/schema boundaries as applicable. Do not guess a contract from one
  source in isolation.
- Mature, externally validated patterns are preferred over project-specific
  inventions in high-risk browser areas, especially WebKit/WebView behavior,
  browser lifecycle, persistent storage and Runtime integration.
- Practicality takes precedence over abstraction purity. An abstraction SHOULD
  be removed or avoided when it increases compatibility risk, maintenance cost
  or system complexity without protecting a real boundary.
- A failed architectural attempt SHOULD have its effects removed rather than
  being kept alive through compensating patches and additional compatibility
  layers.
- Production ownership is resolved before test cleanup. Tests follow the stable
  contract owner, not the physical source file. When an owner is migrated, its
  test debt is migrated, rewritten or deleted in the same ownership change;
  unrelated test-directory cleanup waits for its own owner work.
- Tests are evidence for contracts, not the source of architectural authority.
  Product and architecture contracts outrank legacy tests, and an old test has
  no grandfathered right to preserve an obsolete implementation shape.
- Documentation is part of the architecture. Important newly discovered
  contracts and ownership boundaries MUST be recorded in long-lived project
  documentation rather than existing only in chat history or tests.
- When one defect or ownership problem is found, the implementation SHOULD be
  checked for same-class problems in the relevant bounded subsystem rather than
  fixing only the first occurrence.

## 1. System context

`eagler-touhou` is the Web launcher and distribution/hosting layer around the
portable TH06, TH07, TH08 and TH10 Runtime builds.

At runtime the system is intentionally split into four major authorities:

```text
Browser Launcher
  |
  +-- Host metadata -------- host-manifest.json
  +-- Package publication -- release-catalog.json -> Package Descriptor
  +-- Local Package Store -- IndexedDB objects/generations/installations
  +-- Runtime launch ------- same-origin Runtime HTML/JS/WASM
                              + Package-owned DATA/resources

Host / release tooling
  |
  +-- Runtime Release ------ distributable Runtime HTML/JS/WASM only
  +-- deployer originals --- DATA/music/language/artwork build inputs
  +-- static site assembly - dist/site
  +-- offline package ------ Package Descriptor + STORE ZIP
```

Original-game-derived resources are not source-repository assets and are not
part of Runtime Release.

## 2. Browser Launcher

The isolated React Router frontend migration on `experiment/ui-rebuild` is
described in [UI_REBUILD.md](UI_REBUILD.md). Its independent application/session
owners and acceptance gates are experimental; production ownership below remains
in effect until an explicitly verified cutover.

The Launcher owns product selection, installation/update orchestration,
settings UI, touch UI, Replay/file management, multiplayer lobby UI, Runtime
launch orchestration and diagnostics.

The stable deployed browser entry is the root `/app.js` facade; its authored
source is `public/app.js`, and it imports the generated
`assets/launcher/app.mjs`. Authoritative orchestration lives in
`src/launcher/app.mts`; stable responsibilities use focused typed owners rather
than growing a replacement monolith.
Examples of already separated owners include:

- `src/launcher/remote-metadata.mts` - independent Host Manifest / Release
  Catalog fetch; compiled to `assets/launcher/remote-metadata.mjs`.
- `src/launcher/app-shell-client.mts` - Service Worker registration/update
  lifecycle and deferred reload policy; compiled to
  `assets/launcher/app-shell-client.mjs`.
- `src/launcher/network-activity.mts` - network request/progress ownership;
  fetch tracking preserves the browser's native `Response.body` identity for
  WebView compatibility while XHR-backed package transfers can expose byte
  progress. Package XHR requests have a no-progress deadline; native fetch
  consumption has a bounded deadline covering headers and body. Background
  updates use the same transport without owning the foreground progress UI.
- `src/launcher/runtime-session.mts` - monotonic Launcher Runtime-session identity.
  Every iframe navigation/reset creates or invalidates an epoch token; asynchronous
  resource work must capture the token and revalidate it after awaits before it
  mutates Runtime FS or Launcher live-session state. WindowProxy identity is not
  a session identity. The Launcher appends the token as `runtimeEpoch` to every
  Runtime navigation; the current Runtime protocol envelope carries the same
  positive epoch on every command, response and event. Runtime shells accept
  Host commands only for their URL epoch, and the Launcher accepts inbound
  messages only for the current Runtime-session epoch. Same-origin direct bridges
  such as managed DATA delivery and TH07's optional immediate-input path are
  bound to the same epoch. `event.source === frame.contentWindow` therefore
  remains only an iframe/source check; per-navigation freshness comes from the
  epoch.
- `src/launcher/launcher-lifecycle.mts` - user-operation lifecycle policy shared by
  App Shell reload deferral, Runtime close/save confirmation and post-import
  continuation validation. It keeps these commit/abandon decisions out of DOM
  event handlers while the handlers still own presentation.
- `src/launcher/offline-language-index.mts` - browser-local discovery metadata for
  verified remote language packs retained in Cache Storage. It lets a cached
  non-Japanese selection remain discoverable after an offline reload when Host
  Manifest cannot be fetched; Package-owned language entries remain authoritative
  when installed.
- `src/launcher/runtime-preparation.mts` - Package-backed Runtime DATA/resource
  selection and read integrity plus managed Runtime URL construction. DATA
  selection is declared `runtimeRequirement.dataFile`, then canonical
  `game-data`, then a single installed `.data` target; ambiguity is rejected.
  An explicitly declared but missing DATA file cannot fall through to another
  file. Missing/damaged DATA and unavailable browser storage are distinct
  failures, and managed DATA rejection reaches Launcher readiness immediately.
- `src/launcher/replay-files.mts` - Launcher-side Replay filename/path policy,
  import collision allocation and Replay ZIP entry planning. `.rpy` and
  `.rpyx` are Launcher-recognized file identities used by current adapters;
  `.rpyx` is not a required format for a new Runtime. When an existing thprac
  adapter needs practice metadata, that Runtime owns its embedded `PRAC`
  representation rather than the Launcher inventing a universal sidecar.
  Runtime file I/O, IDBFS lifecycle and Replay-manager DOM interaction remain
  in `src/launcher/app.mts` orchestration.
- `src/launcher/runtime-diagnostics-model.mts` - pure browser/Runtime
  diagnostics interpretation: user-agent environment labels, compact graphics
  renderer identity, selected WebRTC candidate-pair resolution and bounded RTT
  variation sampling. Browser timers, `getStats()` calls, Runtime-global reads
  and diagnostic DOM rendering remain in `src/launcher/app.mts`.
- `src/launcher/touch-layout-model.mts` - persisted touch-layout schema,
  normalization/migration, browser-storage lifecycle, orientation profiles,
  control stacking and viewport offset model. Storage failures are non-fatal;
  an all-default/empty layout removes the persisted override. DOM editing,
  geometry and gesture ownership remains in `src/launcher/app.mts` until that UI subsystem
  has a justified owner of its own.
- `src/launcher/touch-layout-editor-state.mts` - browser-local editor/settings
  window-position schema and storage lifecycle. It owns normalized relative
  positions independently for portrait/landscape; `src/launcher/app.mts` still owns actual
  DOM geometry, dragging and collision/clamp presentation.
- `src/launcher/touch-runtime-protocol.mts` - Host-to-Runtime touch/live-control
  message boundary. It owns readiness/spectator gating for live control
  snapshots plus direct-touch, touch-cancel and thprac-mouse message shapes;
  DOM pointer interpretation remains in the Launcher UI owner.
- `src/launcher/site-notice.mts` - non-blocking packaged `NOTICE.txt` parsing,
  branded-link rendering, notice lifetime/scroll behavior and browser-local
  notice preference ownership.
- `src/launcher/first-use-notice.mts` - generated `content/FIRST_USE_NOTICE.html`
  loading, empty/error handling and one-time browser-local onboarding state. Known
  legacy changelog seen keys migrate to the new seen flag so existing players are
  not treated as newcomers after the product rename.
- `scripts/build-content-pages.mjs` - browser-content compilation boundary. FAQ,
  First-use Notice and Multiplayer Guide Markdown are rendered during the source build;
  raw authored HTML is escaped and unsafe link/image protocols are rejected before
  the generated HTML enters the publication/App Shell allowlist.
- `src/launcher/multiplayer-guide.mts` - on-demand generated `content/MULTIPLAYER.html`
  loading and dialog lifecycle. The guide is an App Shell resource so installed Launchers
  retain the instructions offline with the rest of the current UI generation.
- `src/launcher/game-preferences.mts` - persisted Launcher option schema,
  normalization/legacy cleanup, music-mode normalization, stable preference
  storage-key construction and non-fatal browser-storage read/write lifecycle.
  The owner accepts explicit primary/fallback preference IDs; product selection,
  preference-ID selection and save timing remain in `src/launcher/app.mts` orchestration.
- `src/launcher/i18n.mts` - browser UI locale/catalog owner. The single tuple
  table owns both supported locales and directly derives the `UiMessageKey`
  union, so application translation calls are strict while `data-i18n` and
  other DOM attributes are validated at the untyped HTML boundary. Locale
  detection, persistence, static DOM translation and locale-change notification
  are owned here; there is no parallel root JavaScript implementation.
- `src/launcher/language-catalog.mts` - Launcher language-selection catalog
  composition. Canonical Host Manifest `languageOptions` are overlaid by
  installed Package language components, then localized and ordered using the
  product-catalog priority supplied by the caller. Schema-1 `languages` remains
  a bounded read-only fallback for older Host deployments; current producers
  must publish `languageOptions`. Browser storage, network/cache acquisition and
  Runtime pack validation remain separate owners.
- `src/launcher/music-availability.mts` - effective music-mode selection from
  audio/MIDI capability plus installed and remote OGG availability. Remote
  continuation is revision-bound and import mode cannot invent a remote
  source; effective fallback never rewrites the persisted explicit preference.
  Download, decode, Package Store and Runtime lifecycle remain in `src/launcher/app.mts`.
- `src/launcher/language-pack-validation.mts` - pure validation of unpacked
  `thcrap-static-pack/1` manifests and files before they cross into Runtime.
  Game/language identity, path confinement, duplicate declarations, file count
  and byte sizes fail closed; Cache/fetch/progress and ZIP decompression remain
  Launcher orchestration.
- `src/launcher/sha256.mts` - browser-side SHA-256 ownership for imported
  package/resource integrity checks. It prefers WebCrypto when available and
  keeps the verified pure-JavaScript fallback required on supported insecure
  HTTP origins where `crypto.subtle` is unavailable.
- `src/launcher/multiplayer-identity.mts` - local multiplayer participant
  identity policy. It owns display-name normalization and one-time persistent
  locking plus product-scoped, tab/session-scoped lobby client IDs. Room state,
  lobby transport, seat assignment and rendering remain in `src/launcher/app.mts`.
- `src/launcher/multiplayer-preferences.mts` - product-scoped multiplayer UI
  preference persistence and normalization. It owns the share-singleplayer-
  settings flag and remembered loadout storage; product detection, declared
  player-count subset, ordered difficulty/loadout tables, UI interaction and
  room/lobby behavior remain in `src/launcher/app.mts` and the Product Catalog.
- `src/launcher/multiplayer-lobby-snapshot.mts` - normalization of authoritative
  relay room snapshots before they enter Launcher UI state. It reuses the
  participant-identity owner for names/client IDs and consumes the selected
  product's player-count, difficulty and loadout bounds as inputs. Malformed or
  product-invalid rooms/seats fail closed; live WebSocket lifecycle and room
  orchestration remain in `src/launcher/app.mts`.
- `src/launcher/multiplayer-runtime-options.mts` - validated conversion from
  selected room state into Runtime `netplay*` configure fields. Valid loadouts
  are the Product Catalog's declared `{character, shot}` pairs; this layer must
  not invent universal A/B-shot, character-count or 2P/3P assumptions beyond
  the shared platform limits.
- `src/launcher/multiplayer-relay-url.mts` - multiplayer relay URL composition.
  It owns product-namespaced transport room IDs and normalization between lobby,
  player-gameplay and spectator-gameplay query roles. Launcher-owned role
  parameters are mutually exclusive while unrelated deployment-owned query
  parameters are preserved. WebSocket/RTC lifecycle, live room state and
  Runtime transport implementation remain outside this owner.
- `src/launcher/network-diagnostics.mts` - user-triggered WS, TURN, NAT and IPv6
  capability checks. It prefers the dedicated Relay diagnostic protocol and
  falls back to an isolated legacy signaling handshake so an older but fully
  playable Relay is not reported as unavailable merely because it lacks the
  newer diagnostic endpoint.
  The full relay-to-relay DataChannel echo remains the TURN success proof; its
  same-browser RTT contains two client-to-TURN round trips and is normalized
  before presentation so it is comparable to the single WebSocket server RTT.
- `src/launcher/multiplayer-runtime-options.mts` - validation and construction
  of the Launcher-to-Runtime multiplayer option payload. Per-game difficulty
  and character bounds remain product-catalog inputs rather than duplicated
  facts; room/lobby state and WebSocket/RTC lifecycle remain outside this owner.
- `src/launcher/multiplayer-room-session.mts` - product-scoped, tab-scoped
  multiplayer room-session persistence. It owns the sessionStorage key,
  serialization, room/product matching and bounded restoration of player count,
  difficulty, seat and transient room UI flags. URL/history routing, product
  selection, lobby connection and live room state remain in `src/launcher/app.mts`.
- `src/launcher/multiplayer-spectator-rail-position.mts` - spectator-rail
  browser-local position persistence. It owns the canonical storage key, the
  exact historical dotted-key one-way migration and finite-coordinate parsing;
  drag gestures, viewport clamping and DOM positioning remain in `src/launcher/app.mts`.
- `src/launcher/game-zoom.mts` - magnifier/viewport transform state, scale and
  pan clamping, two-pointer pinch geometry and Runtime-window pointer bridge
  lifetime. Launcher orchestration supplies availability, the orientation-
  specific viewport base offset and reset/focus actions.
- `src/launcher/route-state.mts` - canonical Launcher URL/history state
  transformations for player routes, multiplayer room routes, direct room
  entry/back-stack seeding and reload behavior. DOM `popstate`/`pageshow`
  orchestration remains in `src/launcher/app.mts`; it consumes route operations rather than
  reimplementing URL/history mutation rules.
- `package/` - Package Descriptor validation, generation planning, IndexedDB
  persistence, acquisition/install transactions, ZIP parsing and published-
  package launch helpers.
- `legacy/` - bounded read/migration compatibility for pre-Package-Store data;
  these modules remain compatibility readers/adapters, not new-state producers.

### Touch-layout persistence boundary

The touch-layout data model is a shared Launcher capability for every formal
adapter rather than state keyed per game. The current persisted schema has independent
`landscape` and `portrait` profiles. Each profile owns normalized control
positions/scales/stacking priorities plus a horizontal game-viewport offset.

Older layout schema versions are read and normalized into the current schema;
later optional controls may be absent from an older profile and are filled from
current default geometry by the editor. Invalid coordinates, scale, priority
or viewport values fail closed instead of partially applying corrupt layout
state. The model owns data compatibility only; PointerEvent drag/resize,
fullscreen/editor windows and actual Runtime input routing remain presentation
and interaction responsibilities.

Editor chrome position is deliberately stored separately from gameplay touch
layout. Moving the editor/settings windows must never mutate the portable
control/viewport layout schema. The editor-state owner tolerates unavailable
browser storage and corrupt individual window entries without making the touch
editor unusable for the current session.

### Site-information surface

`NOTICE.txt` and the generated `content/FIRST_USE_NOTICE.html` / `content/MULTIPLAYER.html`
are packaged Launcher content, not remote control-plane metadata. Their authoritative
sources remain `content/FIRST_USE_NOTICE.md` and `content/MULTIPLAYER.md`.
`src/launcher/site-notice.mts` owns the transient notice controller and treats notice
loading as non-blocking. `src/launcher/first-use-notice.mts` owns First-use Notice
loading and one-time onboarding state. `src/launcher/multiplayer-guide.mts` owns the explicitly opened gameplay
guide. Browser runtime code does not parse Markdown: `scripts/build-content-pages.mjs`
renders all browser-facing Markdown before publication, escapes authored raw HTML,
and filters unsafe link/image protocols. The resulting HTML fragments are precached
as App Shell files.
An empty `content/FIRST_USE_NOTICE.md` source generates an empty fragment and is a valid
packaged state: it must not auto-open an empty dialog, while explicit user access
reports that no first-use notice is present. A non-empty notice auto-opens only for
a browser that has not completed onboarding; later content edits do not interrupt
returning players.
Load failure is also non-blocking. The user's notice-enabled/dismissed and
first-use-notice-seen state are browser-local UI state. These files must not be
confused with Host Manifest / Release Catalog, which remain the only top-level
remote metadata contracts.

Durable browser-local Launcher state that must survive Origin migration uses
the `eagler-touhou-` namespace unless a historical public key is explicitly
retained as a bounded migration input. A legacy key must be allowlisted
exactly; migration must not widen to an unrelated prefix merely to preserve one
old setting. The spectator rail therefore uses
`eagler-touhou-mp-spectator-rail-position-v1`; the historical
`eagler.mpSpectatorRail.mobilePosition.v1` value is accepted only as a one-way
legacy input and is retired after successful local migration. That bounded
migration is owned by `multiplayer-spectator-rail-position.mts`; the Origin
migrator separately allowlists the same exact historical key so it can cross
the old HTTP/new HTTPS boundary before the Launcher starts.

### Browser module delivery

Deployed `/app.js` is the stable browser facade and module entrypoint; its
source-checkout owner is `public/app.js`.
`lib/browser-module-graph.mjs`
derives its complete relative-ESM dependency closure, including literal
`import("./feature.mjs")` edges emitted by the optimized Launcher.

That derived closure is consumed by `lib/frontend-manifest.mjs` for both:

- frontend publication, and
- App Shell precache ownership.

Therefore a newly imported Launcher module cannot silently become
network-only because somebody forgot to add it to a second file list.
Feature code may be dynamically imported to avoid first-screen evaluation,
but every emitted feature chunk remains part of the eager Launcher App Shell.
`styles.css` is the render-blocking shell stylesheet; `features.css` starts
downloading with the document without blocking first paint and is also owned by
the App Shell. Non-literal dynamic imports and bare-package imports are rejected
by this offline closure contract.

## 3. Browser-visible metadata contracts

There are exactly two top-level remote metadata contracts.

### `host-manifest.json`

Owned by `host-manifest.mjs` and host assembly.

It describes the deployed host/runtime/content state, including available
products, Runtime/content identity, music/language publication and relevant
server capabilities.

Static `product-catalog.mjs` feature declarations are the capability ceiling.
The per-game Host Manifest `features` object may contain only optional boolean
`thprac` and `focusHitbox` Runtime capabilities; those values may reduce the
available Launcher surface but cannot enable a capability unsupported by the
product. Missing values retain the bounded `host-manifest/1` legacy default.
Replay management remains Launcher/product policy, while actual language
availability is expressed by `languageOptions` and installed Package language
components rather than a generic Host feature override.

`product-catalog.mjs` owns product-level policy shared by Launcher and
publication tooling. In particular, canonical language ordering has one
authority there; the Launcher may localize language display titles while host
assembly may use publication-facing titles, but neither surface owns a second
ordering table.

### `release-catalog.json`

Owned by `release-catalog.mjs` and package publication.

It describes installable Package revisions and their Package Descriptor URLs.
It does not duplicate Host Manifest Runtime/content state.

Development serving uses the same endpoint names. Its Release Catalog may be
valid and empty.

### Package Descriptor

`eagler-touhou/package/1` is the per-package authority for files, components,
Runtime requirements and installable content.

New package production uses this format only.

## 4. Package acquisition and persistence

Remote installation and local ZIP import converge at the same Package Store
boundary.

Parsing may inspect an incomplete ZIP, but installing it requires every
`descriptor.base.files` entry before any generation is staged. Optional entries
may remain absent. Remote reuse checks that referenced objects still exist;
matching revision strings alone do not establish a reusable installation.

Launcher reads current installation state at launch time. Storage access errors
must not be converted to an empty installation, and only DATA acquisition or
confirmed missing/damaged DATA may open the automatic game-import recovery UI.
Language, audio and Runtime errors retain their own startup diagnostics. The
same game content generation serves ordinary and multiplayer Runtime variants.
Startup resource continuations revalidate their Runtime session after waits;
reset cancels foreground acquisition and local music installation. A failed
music transfer must finish its UI ownership even when the game already launched.

```text
remote Release Catalog                local ZIP
        |                                 |
        v                                 v
 Package Descriptor / ZIP          ZIP parse + validation
        |                                 |
        +--------------+------------------+
                       v
               Package installer
                       |
                       v
              Package Store (IDB)
                       |
            current/pending generation
                       |
                       v
                 Runtime launch
```

Package Store owns immutable objects plus generation/install metadata. A new
generation is prepared before `current` switches, so interrupted updates do
not intentionally replace a working install with a partial one. Pending
mutations carry an operation owner and pending source; failure/cancellation may
remove only the staging generation owned by that operation, while current source
metadata changes only in the successful commit transaction. Competing browser
documents wait on this IndexedDB-owned pending state rather than cancelling one
another. Stale mutation ownership is heartbeat-recoverable.

New object bytes and their pending-generation reference are persisted in one
IndexedDB transaction. Runtime readers also publish long-lived generation
leases; garbage collection keeps current, pending and non-stale leased
generations alive. Runtime leases deliberately use a long expiry window so a
frozen/background page is not treated as exited merely because it stopped
running a short heartbeat.

Runtime preparation copies ArrayBuffer-backed Package objects before exposing
them to Runtime loading, still reads historical Blob-backed objects for
compatibility, and checks declared byte counts before returning DATA/resources.
It must never silently select between multiple inferred `.data` candidates.

Historical `game-data-pack/1` and `offline-game-pack/1` ZIPs are read-only
acquisition compatibility. Newly imported legacy ZIPs are adapted into the
canonical Package Store; they do not create new legacy storage state.

## 5. Runtime boundary

Runtime HTML/JavaScript/WebAssembly are App-owned, same-origin files. Package
DATA and other package-owned resources remain in Package Store and are made
available through the Launcher/Runtime preparation path.

The active browser carrier is deliberately simple: the Launcher navigates the
single game iframe directly to the ordinary same-origin Runtime entry URL. The
managed URL is generation-bound with `managedData=1`, `gameGeneration`, and
`runtimeVariant`; the selected immutable DATA object is then supplied from the
active Package generation through the Launcher-managed DATA bridge used by the
generated Emscripten loader (`Module.getPreloadedPackage`). Runtime HTML/JS/WASM
do not come from Package Store, and Package DATA is not synthesized through a
Service Worker response. Historical nested-iframe, Blob Runtime, virtual
`/__runtime__/` / `/__package__/`, and iOS page-memory carrier experiments are
not compatibility surfaces.

The Launcher does not execute historical Runtime HTML/JS/WASM embedded in old
legacy packages.

The browser/Runtime protocol is `eagler-touhou/1`. Every formal Product Catalog
game provides its normal Runtime through that protocol. A separate Multiplayer
Runtime exists only when the product declares the optional Multiplayer profile;
current TH06/TH07 products do, while TH08/TH10 do not. Runtime file layout and
retail-format preparation remain per-adapter implementation/format concerns.

Presentation Lab and comparable source diagnostics are outside this browser
protocol. Their workbench UI, instrumented WASM, native diagnostic ABI and
evidence reports belong to `eagler-common` plus the title repository. They must
not enter Product Catalog declarations, Package Store, normal Runtime Release
or the Launcher launch path. A title may use Lab to prove the required
presentation capability without making Lab itself a player-facing capability.

## 6. Offline model

Offline support has two independent storage authorities:

1. **App Shell / Runtime bootstrap files** - Workbox precache.
2. **Installed game/package data** - Package Store in IndexedDB.

The Service Worker install eagerly caches every Launcher module in the browser
module closure plus the Launcher feature styles. Code splitting changes when
feature JavaScript is parsed/evaluated, not whether it belongs to the installed
Launcher. Package DATA is not routed through the Service Worker.

Deployment-declared Runtime HTML/JS/WASM remains in the App Shell contract but
is currently marked as a deferred Runtime path by Host assembly. It is fetched
when that Runtime is prepared rather than competing with the first Launcher
paint. Changing Runtime bootstrap from deferred to eager installation is a
separate product/performance decision from Launcher code/CSS splitting.

This separation is intentional: Workbox owns Web application availability;
Package Store owns installed game content.

App Shell activation is an update lifecycle concern and must not publish a
worker whose required offline set is incomplete.

## 7. Multiplayer boundary

The Launcher owns lobby/session UI and signaling integration. Multiplayer
Runtime logic remains in the corresponding Runtime variant of each product that
declares the Multiplayer profile.

Transport preference is:

```text
WebRTC peer connection
        |
        +-- direct / STUN / server-managed TURN as available
        |
        +-- WebSocket Relay fallback when configured
```

Relay services are operational/server infrastructure, not static self-host bundle
content. Host configuration may point at a WebSocket Relay; TURN remains
server-managed rather than pretending to be a static-site setting.

`server/netplay-relay.mjs` is the single source owner for the shared product-
neutral lobby, signaling, route-barrier and emergency WebSocket relay service. Lobby
readiness is bound to a monotonically increasing settings version; match-affecting
changes invalidate prior ready acknowledgements, offline grace seats never satisfy
start conditions, and `start` is idempotent while a match is starting/running.
Spectator admission is snapshotted at match start: the post-start grace period is
only for those already admitted spectators to establish their receive stream, not
for admitting new mid-game spectators.
`server/render-coturn-config.cjs` and `server/coturn.env.example` own its coturn
deployment support. Runtime repositories may integration-test against these
Host-owned services, but must not carry private copies of the server
implementation or its npm dependency tree. Room namespaces use the declared
Multiplayer product identity (current examples are `th06mp-*` / `th07mp-*`) and
consume player-count/difficulty/loadout bounds directly from
`product-catalog.mjs`; the relay must not maintain a second table of product
facts.

The multiplayer tool surface is available before remote Host Manifest loading
finishes so local settings and Replay management never depend on Relay health.
Only its online-room fold is closed and disabled until a valid `netplayRelay`
configuration arrives. The same Relay exposes a bounded, roomless diagnostic
connection for explicit user-initiated WebSocket RTT checks and short-lived ICE
server credentials. Browser diagnostics report TURN RTT only after the selected
candidate pair is confirmed relay-to-relay. NAT labels are deliberately
conservative: NAT4 requires observed endpoint-dependent IPv4 mapping, while a
missing server-reflexive candidate is reported as a failed check rather than a
fabricated NAT type. IPv6 availability requires a global IPv6 server-reflexive
candidate. Candidate addresses are interpreted in memory and are never stored.

A seated, unready player may run the lobby's local game preflight. It exercises
the selected multiplayer Runtime and its normal resource preparation without
joining the room's gameplay transport, waits for that exact Runtime session's
first-frame acknowledgement, then tears the Runtime down through the existing
return-to-room path. The action is unavailable after the player becomes ready,
so a preflight cannot overlap a match start for which that player is eligible.
Because it does not use gameplay transport, temporary lobby Relay reconnection
does not disable the preflight for an already seated player.

## 8. Host and release architecture

### Runtime Release

Runtime Release is the normal deployer-facing Runtime input. It contains
project-distributable Runtime HTML/JS/WASM and layout metadata, but no original
game DATA/music/artwork.

### Self-host workflow / bundle

The self-host bundle is a distributable product boundary, not a source checkout
snapshot. `lib/self-host-bundle.mjs` explicitly owns the files and npm
dependencies that may cross that boundary. Ordinary self-host commands are
Node entrypoints under `host/`; the bundle must not require PowerShell or ship
`tools/maintainer/`.

Persistent user/deployer inputs are principally:

```text
games/
eagler-touhou.config.json
runtime-release/        # shipped with the self-host bundle release
```

Disposable/generated state is principally:

```text
dist/
node_modules/
.cache/python/
```

`.cache/` is intentionally persistent reusable build cache, not disposable
site output.

### Formal site assembly

The assembly path combines Runtime Release, deployer-owned originals, selected
music/language resources and repository-owned frontend files into a verified
static site. The verifier checks metadata/profile consistency and offline
Runtime/App Shell completeness.

The verified Hosted generation is the content-identity authority for its
derived publication modes. A formal release derives External and Import sites
from that same generation. External preserves the selected Runtime files,
Release Catalog and Package Descriptors while omitting `games/**` and
`shared/**`; deployment infrastructure redirects those relative Package
sources to the matching Hosted resource Origin. Import removes remote Package
publication and accepts user-supplied complete Packages. These derived sites
must not reconstruct content identity from an unrelated build.

See `ARTIFACTS.md`, `SELF_HOSTING.md`, `SELF_HOSTING_REFERENCE.md` and
`RELEASE.md` for artifact/self-host/release details. The paired External
deployment procedure is owned by `EXTERNAL_RESOURCE_MODE.md`.

## 9. Build-policy ownership

Physical sibling repository names are owned by `config/workspace.json`.
Runtime build policy is owned by `config/runtime-builds.json` plus
`lib/runtime-build-profiles.mjs`.

Node/PowerShell/Python callers should consume those owners rather than carrying
their own path/profile tables.

The default repository gate is `npm run check`; explicit sibling Runtime
integration is `npm run check:workspace`. Browser/network/release tests remain
explicit rather than making the normal edit loop depend on remote systems.

## 10. TypeScript migration rule

TypeScript migration is an ownership migration, not a file-extension rename.

The rules are:

- source is split by stable subsystem ownership;
- generated browser JavaScript is build output, not a second hand-edited source;
- browser entrypoints and their dependency closure remain machine-derived;
- no bundling is required merely to introduce TypeScript;
- a later bundler may change production chunk shape without changing subsystem
  source ownership or the offline-completeness contract;
- stable policy owners move independently, while the remaining browser
  composition layer migrates behavior-equivalently to one strict
  `src/launcher/app.mts`; TypeScript conversion must not be used as permission
  for another architecture rewrite.

The active unbundled migration contract is:

```text
public/**/*                     # authored browser files, mapped to URL root
src/contracts/**/*.mts
src/launcher/**/*.mts
        |
        | TypeScript (tsconfig.launcher.json)
        v
.cache/build/browser/assets/contracts/**/*.mjs # local generated shared contracts
.cache/build/browser/assets/launcher/**/*.mjs  # local generated browser output
```

`lib/launcher-build.mjs` owns freshness/build verification and maps generated
modules from the local build cache onto their stable public `assets/` paths. Source checkout
development, App Shell generation and site/self-host bundle assembly reach that owner
through `lib/frontend-manifest.mjs`. A packaged self-host bundle receives those compiled
modules at their stable public `assets/` paths; unlike the source checkout, it is
a distributable product rather than a compiler workspace. It carries no Launcher TypeScript source or compiler;
the only `src/` input is the App Shell worker template required for Host assembly.

`public/` is a source-layout boundary, not a deployment subdirectory. Its
allowlisted files are copied to the root of the assembled site, so public URLs,
Service Worker scope and relative asset references remain unchanged. Generated
browser modules stay in `.cache/build/browser`; deployable candidates stay under
the explicit artifact/release boundary rather than being written back into
`public/`.

The incremental builder treats the source/output file set as a closed set:
deleted sources invalidate stale generated modules, while source/config/compiler
or temporary declaration-bridge changes invalidate older outputs. The canonical
`npm run check` performs a forced compile so strict type-checking is never
silently bypassed by timestamps.

The authoritative Product Catalog, Host Manifest validator, and resource-mode
contract live under `src/contracts/`. Their historical root `.mjs` paths are
facades which only re-export compiled modules; they contain no policy or
validation behavior.

While a TypeScript module still imports an unmigrated root `.mjs` contract, a
co-located `.d.mts` may act as a temporary typed boundary. Such declaration
bridges are migration scaffolding, not a second implementation, and must be
deleted when the owning JavaScript module itself moves to TypeScript.

## 11. Compatibility boundaries

Compatibility code must have an explicit owner and retirement condition.

Current bounded compatibility includes:

- reading old package ZIP schemas;
- one-way migration of pre-Package-Store browser state;
- cleanup only after canonical Package Store state is committed.

Compatibility modules must not become new production/storage writers.

Historical artifacts, archived deployed sites and internal engineering notes
are evidence, not active architecture or compatibility APIs.

## 12. Refactoring evidence rule

Subsystem extraction must preserve observed behavior, not merely current file
shape. Before moving code whose semantics are unclear or historically fragile,
inspect its callers, focused tests, relevant build/runtime contracts and, when
needed, history evidence. Add or strengthen behavior tests before changing the
ownership boundary when the existing tests do not capture the important rule.

In particular, WebKit/runtime launch, Service Worker update lifecycle, touch,
Replay, package persistence and multiplayer synchronization must not be
"cleaned up" from intuition alone. Historical evidence is used to recover the
reason for a rule; `ARCHITECTURE.md` and executable tests then become the
long-lived owners of the recovered contract.

## 13. Testing architecture

Tests are executable evidence for stable product/architecture contracts. They
are not a checksum of the current implementation and they are not authoritative
merely because they already exist in `tests/test-plan.mjs`.

This project uses the following normative rules.

### Test admission rules

- **MUST test a named invariant or user-observable behavior.** A maintainer must
  be able to state what contract would be broken if the test failed.
- **MUST prefer behavior over implementation shape.** A refactor that preserves
  the owned contract should normally leave the assertion unchanged. Test setup
  may change when dependencies move; the asserted behavior should not.
- **MUST NOT add change-detector tests.** Exact function text, copied source,
  implementation comments, private call order, arbitrary DOM nesting, CSS
  pixel values or source-line ordering are not valid regression contracts by
  themselves.
- **MAY inspect source/structure only when structure itself is the contract.**
  Examples include a public protocol/schema, generated-file ownership,
  forbidden security pattern, static publication allowlist, ABI layout, or a
  deliberately fixed accessibility requirement. Such assertions must state
  the architectural reason they are structural.
- **MUST keep regression tests at the behavior boundary that failed.** A bug
  found in Package Store, Service Worker lifecycle, touch, Replay or Runtime
  launch should be reproduced through that owner/API or the smallest realistic
  integration boundary. A source substring proving that the old patch is still
  present is not a regression test.
- **MUST be deterministic and hermetic in the default repository gate.**
  `npm run check` must not depend on public network services, wall-clock sleeps,
  undeclared machine state, persistent user state, sibling repositories or
  private game content. Temporary state must be isolated and repeatable.
- **SHOULD prefer real owned implementations or small fakes over interaction
  mocks.** Mock call-order/argument assertions are acceptable only when that
  interaction is itself the public contract. Third-party APIs should normally
  be wrapped and the owned wrapper boundary tested instead of cloning the
  third-party implementation into mocks.
- **MUST use the smallest test scope that can prove the invariant.** Broad
  browser/device/end-to-end tests are reserved for properties that smaller
  owner or integration tests cannot prove. More expensive coverage is not
  automatically better coverage.
- **SHOULD keep focused tests scenario-oriented.** One failure should identify
  one meaningful behavior whenever practical; unrelated product surfaces must
  not accumulate into a generic "release" or "everything" test.
- **MUST NOT treat an old test as grandfathered.** If a correct architectural
  refactor breaks a test because the test froze implementation detail, first
  recover the intended invariant from callers/history/contracts, then rewrite,
  relocate or delete the test. Production architecture must not be distorted
  merely to keep a low-value legacy test green.

### Test lanes

Use the cheapest lane that can prove the contract:

| Lane | Purpose | Default expectations |
| --- | --- | --- |
| owner behavior | pure/module-level invariants | fast, hermetic, public/owned API |
| repository integration | generated artifacts, local files/servers, cross-owner wiring | hermetic, repository-local |
| workspace integration | sibling Runtime/format/host integration | explicit `check:workspace` lane |
| browser/device | WebKit/WebView/touch/focus/render lifecycle | explicit real-browser/device lane |
| release/remote | deployment, public-network and release-candidate verification | explicit pre-release/operations lane |

The default repository gate intentionally contains only the first two classes.
Moving a test into a heavier lane requires a reason that the cheaper lane cannot
establish the same confidence. Conversely, a browser/device regression must not
be replaced by a Node source-regex test merely to make it cheap.

### UI testing rule

Launcher UI tests should observe the interface in the way a user or assistive
technology does: actions, roles/labels, enabled/disabled state, visible outcome,
navigation and persisted preference behavior. Exact wrapper elements and style
coordinates are implementation details unless they are themselves a documented
accessibility or layout contract.

### Evidence hierarchy

When code and a legacy test disagree during a refactor, use this order:

1. current product/architecture contract;
2. externally observable behavior and focused owner API;
3. verified historical regression evidence;
4. current implementation shape;
5. legacy source-shape assertion.

The last item is migration evidence only. It cannot overrule a stronger layer.

This policy is informed by established testing guidance: Google's guidance on
resilient tests and harmful change-detector tests, Testing Library's
user-centric/implementation-independent principle, Bazel's hermetic and
deterministic test model, and the common recommendation to keep expensive
end-to-end coverage small and purposeful. The project owns the rules above;
external references explain their rationale rather than acting as runtime
dependencies:

- https://testing.googleblog.com/2014/03/testing-on-toilet-what-makes-good-test.html
- https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html
- https://testing.googleblog.com/2016/09/testing-on-toilet-what-makes-good-end.html
- https://testing-library.com/docs/guiding-principles/
- https://bazel.build/reference/test-encyclopedia
- https://martinfowler.com/bliki/TestPyramid.html

## 14. Documentation ownership

Keep documentation split by purpose:

| Document | Authority |
| --- | --- |
| `README.md` | project introduction and common entry points |
| `PRODUCT_SURFACE.md` | supported user/deployer capability matrix |
| `ARCHITECTURE.md` | current subsystem/data-flow/ownership architecture |
| `DEVELOPMENT.md` | maintainer setup and development commands |
| `ARTIFACTS.md` | generated artifact classes and consumption rules |
| `SELF_HOSTING*.md`, `RELEASE.md` | self-host and release procedures |

Do not copy the same contract into several documents. Link to the authoritative
document instead.
