# Adapting a game to Eagler Touhou

This is the implementation guide for adding another Touhou game to the current
Eagler Touhou architecture. It is intentionally stricter than a feature wish
list: an adapter is complete only when the same declared product facts survive
the entire chain from Runtime source to a verified public deployment.

Read this together with:

- [`ADAPTER_CAPABILITIES.md`](ADAPTER_CAPABILITIES.md) for the required / optional /
  format-adapter / compatibility classification;
- [`GAME_ADAPTER_CONTRACT.md`](GAME_ADAPTER_CONTRACT.md) for ownership rules;
- [`ARCHITECTURE.md`](ARCHITECTURE.md) for subsystem boundaries;
- [`PRODUCT_SURFACE.md`](PRODUCT_SURFACE.md) for what is intentionally exposed;
- [`../src/contracts/runtime-protocol.mts`](../src/contracts/runtime-protocol.mts)
  for the browser message vocabulary;
- [`../integrations/RUNTIME_CONTRACT.md`](../integrations/RUNTIME_CONTRACT.md)
  for thcrap/thprac-specific integration.

Do not treat every mechanism found in an older Runtime as a product feature.
`ADAPTER_CAPABILITIES.md` distinguishes required behavior from optional product
features, adapter-internal implementation details, format adapters and legacy
compatibility. For example, TH06/TH07 EAGX Replay sidecars are existing
implementation details; they are not a requirement for the next title.

The main rule is:

> **Declare product differences; do not teach shared orchestration another game
> name.**

If adding a title requires a new `if (game === "thXX")` in Launcher, Host,
Package or deployment code, first determine whether the difference is really a
product capability, a DATA provider, a Runtime layout, a storage rule, or an
optional feature that should be declared instead.

## 0. Workspace prerequisite

Do **not** start a new Eagler title adaptation from the game repository alone.
A fresh adaptation workspace must contain a current checkout of
`eagler-touhou` before implementation work begins.

`eagler-touhou` is not an optional packaging step added after the Runtime is
finished. It owns the shared Product Catalog, adapter capability taxonomy,
Runtime protocol, Launcher/Package contracts, host preparation model and the
machine-backed acceptance commands used throughout this guide. A game Runtime
developed without those authorities in the workspace can appear functional
while already violating the integration contract.

The minimum starting workspace therefore contains:

```text
eagler-touhou/       current shared Launcher/Runtime contract authority
thXX-eagler/         the canonical title adaptation repository
```

When shared runtime infrastructure is relevant, also materialize the exact
`eagler-common` revision declared by the consumer repository. Do not substitute
an arbitrary sibling branch head for a pinned dependency.

## 1. Definition of done

After registering the product, run:

```text
npm run adapter:inspect -- --game=thXX
```

The report is generated from the same Product Catalog, capability taxonomy,
Runtime protocol and content declarations used by the build. Treat its
`obligations` as the machine-readable checklist and its `nonObligations` as an
explicit warning not to copy existing adapter mechanisms blindly.

Its `protocol.configureOptions` section is also the authority for the Runtime
configuration wire. Do not pass the whole Launcher preference object to a new
Runtime. Fields such as magnifier state, touch-layout editing and Restart-button
visibility are Launcher-owned; canonical Runtime fields are individually marked
required, profile-required, optional or diagnostic. Historical wire aliases are
listed separately under `protocol.legacyConfigureAliases` and are never a new
adapter requirement.

A new game is not considered adapted merely because its title screen appears.
The adapter is complete when all applicable items below have an owner and a
passing test:

- product identity, artwork, Runtime entry and source/support metadata;
- a generated Launcher card/surface for every declared ordinary/Multiplayer
  product (`tests/test-product-surface.mjs` fails if catalog registration and
  the built no-JavaScript/SEO surface drift apart);
- authoritative DATA identity and Runtime DATA layout;
- Runtime Release production and verification;
- `eagler-touhou/1` shell lifecycle and request/response behavior;
- keyboard and physical gamepad input plus blur/visibility cleanup;
- touch controls, direct touch, cancellation and sensitivity semantics;
- score/config/save persistence and Replay list/read/write/remove/sync;
- required OGG/no-music behavior plus any optional MIDI profile the product
  explicitly declares;
- Package Store install/update/import behavior;
- Hosted, External and Import publication behavior;
- App Shell/offline Runtime ownership;
- required Replay management plus explicit optional declarations such as
  Multiplayer, thprac, language packs, MIDI and focused-state hitbox
  enhancement; every active optional profile must pass its complete behavior
  list, while an inactive profile is not missing adapter work;
- browser first-frame and storage conformance;
- production verifier acceptance.

An unsupported feature must be **declared unsupported**, not left ambiguous.
That sentence applies only to optional product capabilities. A capability listed
as **required** in `adapter-capabilities.mts` cannot be declared unsupported; the
adapter remains incomplete until it is implemented.

The inverse rule matters just as much: do not normalize native game behavior
merely because another adapted title behaves differently. Unless a named
required Eagler Touhou capability owns the behavior, the original title's
authoritative gameplay/menu semantics are the reference.

Likewise, a `profile-required` capability cannot be omitted once its parent
optional profile is declared. For example, Multiplayer is optional, but the
required behaviors inside the Multiplayer profile are not individually
optional.

## 2. The authority stack

Do not duplicate a fact in multiple layers unless the second copy is an
attestation or a generated identity.

| Layer | Owns | Must not own |
| --- | --- | --- |
| `PRODUCT_GAMES` | static product policy/capability ceiling, paths, storage names, Runtime layout class, source/support metadata | content hashes, deployed URLs, generated revisions |
| content definition | original-content shape and retail-memory DATA layout | workstation paths |
| development content | local source paths and development-only identities | formal release policy |
| Runtime source | game simulation, renderer/audio/input implementation, Runtime shell implementation | Host/package publication state |
| Runtime Release | verified distributable Runtime files, DATA provider/layout, concrete Runtime feature attestation | original game DATA/music/artwork |
| Host Manifest | concrete deployment Runtime URL, DATA identity, music/language availability, deployer capabilities | static product policy |
| Package Descriptor | installable files, targets, components, Runtime/data requirement | Launcher UI policy |
| Release Catalog | current installable Package revision + descriptor URL | Runtime/content details duplicated from descriptors |
| Launcher | orchestration and user interaction based on the declarations above | hidden per-game capability tables |

When these layers disagree, fix the owning layer instead of adding a fallback
guess in the consumer.

## 3. Register the product first

Start in `src/contracts/product-catalog.mts`. The registry is the capability
ceiling used by both browser and Node tooling.

Declare:

- `number`, `title`, `subtitle`, `cardArtwork`;
- `runtime`;
- `storage.saveRoot`, `scoreFile`, `configFiles`;
- `dataProvider`;
- `package.dataFileId` and `dataTarget`;
- `package.musicSourceDirectories` and `musicMounts`;
- optional `musicCapabilities.midi`; normal OGG and no-music are required and
  therefore are not per-product booleans;
- required Replay prefix;
- optional feature booleans (`thprac`, `languages`, `focusHitbox`);
- `support.sourceRepository` and any declared adaptation notice;
- multiplayer Runtime/config only when it actually exists.

For a directory Runtime also declare:

- `runtimeFileLayout: "directory"`;
- the closed required `runtimeAssets` set;
- `requiredShared` Runtime/package targets.

If users may directly select an original retail DATA file, declare
`package.rawDataImport.fileNames`. The Launcher then validates that file against
the Host DATA identity and installs it into the normal Package Store. Do not add
a title-specific raw-import branch.

### Capability ceiling versus concrete availability

Static product policy says what a title **can** support. A Host or Runtime
Release may attest less, never more.

Examples:

- `features.thprac: false` cannot be overridden to true by a Host;
- `musicCapabilities.midi: false` means a publication must not expose MIDI even
  if a generic Host Manifest shape contains a `midi` object;
- a Host can omit OGG even when the product is OGG-capable.

## 4. Pick the DATA provider deliberately

There are currently two provider classes in `lib/runtime-data-provider.mjs`.
They form explicit adapter profiles with Runtime layout; unsupported
combinations fail before publication rather than falling through two partial
Host paths.

### `emscripten-preload`

Use this when the generated Runtime JS owns an Emscripten preload DATA layout.
The Runtime Release verifier extracts the layout from the Runtime JS and
requires normal/multiplayer variants to agree.

Current supported profile: **flat Runtime + `emscripten-preload`**.

### `retail-memory`

Use this when the App-managed Runtime consumes a declared retail/content DATA
object supplied by the parent. The canonical layout belongs to
`lib/content-definition.mjs`; the Runtime must not invent another layout hash.

The same Package Store is used for both providers. The provider changes how the
Runtime receives DATA, not who owns installation or content identity.

Current supported profile: **directory Runtime + `retail-memory`**.

If a future adapter needs another combination, extend the provider/profile
contract and Host packaging path first. Do not rely on fields being accepted
independently when the implementation does not support their combination.

## 5. Runtime file layout

### Flat HTML/JS/WASM Runtime

The historical Emscripten path contains exactly `<game>.html`, `<game>.js` and
`<game>.wasm` for each Runtime variant.

### Directory Runtime

TH08/TH10 are the reference implementation. A directory Runtime is still a
closed hash-identified Runtime Release; it is not a general directory copy.

The build publishes `runtime-files.json`. `runtimeFileNames()` validates every
path and requires the product-declared `runtimeAssets` set. Original EXE/DAT/DLL
content must never enter Runtime Release.

Reference files:

- `th08-eagler/th08_web/sdl-runtime/shell.mjs`
- `th10-eagler/th10_web/sdl-runtime/shell.mjs`
- each Runtime's `eagler-host.mjs`
- `portable/package-eagler.mjs`

When adding another directory Runtime, copy the **contract shape**, not game
constants such as save paths, Replay prefixes or C++ export names.

## 6. `eagler-touhou/1` shell lifecycle

The message protocol is same-origin parent/iframe communication. A shell must
reject messages from a different `event.source`, origin, protocol or game.

Runtime-value protocol additions have three owners that must move together:

- `src/contracts/runtime-protocol.mts` - typed authority;
- `lib/contracts/runtime-protocol.mjs` (and the root facade) - stable Node/tooling export;
- protocol model/shell tests - behavioral proof.

Do not add a command/event only to one copy of that boundary.

The normal single-player lifecycle is:

1. Runtime iframe/module initializes storage and mounts managed DATA.
2. Runtime emits `ready`.
3. Launcher sends `configure` and waits for its response.
4. Launcher may install additional Package-owned resources.
5. Launcher sends `launch` and waits for its response.
6. Runtime starts the game loop.
7. After an actual presented frame, Runtime emits `first-frame`.
8. During play the Runtime emits periodic `frame-health` and `audio-health`
   diagnostics; transfer/progress events are emitted when their condition occurs.
9. On normal termination Runtime syncs durable state and emits `exit`.

`ready` and `first-frame` are not interchangeable:

- `ready` means command/storage/DATA infrastructure is ready;
- `first-frame` proves the launched game actually reached presentation and is
  what closes the startup watchdog.

For directory Runtimes the Launcher intentionally allows a longer launch and
first-frame window because user-gesture/audio initialization may be deferred.

### Required commands

The core command vocabulary is exported as `RUNTIME_PROTOCOL_COMMANDS`.

| Command | Adapter obligation |
| --- | --- |
| `configure` | must reject unsafe reconfiguration while the game is running; install supplied resources/options/music state |
| `resources` | install additional Runtime resources without changing product identity |
| `keyboard` | inject one key transition |
| `keyboard-clear` | release/reset held keyboard state |
| `touch-controls` | update touch button/focus/joystick/sensitivity snapshot |
| `touch-cancel` | terminate active touch ownership/gestures |
| `direct-touch` | inject direct coordinate touch stream |
| `launch` | start the configured game; do not emit `first-frame` before presentation |
| `list` | enumerate allowed user files |
| `read` | return an allowed user file as byte values |
| `write` | validate and persist an allowed user file |
| `remove` | delete an allowed user file and sync |
| `sync` | flush game/save state and durable filesystem storage |

The command table distinguishes **response mode** from **implementation
requirement**. Fire-and-forget input commands have an optional ACK but remain
required adapter behavior. `retry-music` is conditional: a Runtime that owns a
recoverable prelaunch music-transfer path and emits `music-error` /
`music-incomplete` must implement it, while directory Runtimes whose music is
installed by Package/Launcher need not. `thprac-mouse` is profile-required only
when thprac is declared. Do not implement dummy success responses merely to make
the vocabulary appear complete.

### Canonical `configure.options`

Do not infer Runtime options from the Launcher preferences object. The canonical
wire fields are exported as `RUNTIME_CONFIGURE_OPTION_KEYS` and typed by
`RuntimeConfigureOptions`. Launcher-only preferences such as magnifier state,
touch-layout editor state, Restart-button visibility and the persisted
`frameLimit60Enabled` name are **not** Runtime API. Where a Runtime action is
needed, the Launcher sends the canonical wire form instead (for example
`limitPresentationTo60`).

`RUNTIME_CONFIGURE_LEGACY_OPTION_KEYS` lists old names that existing adapters may
still read for compatibility. A new adapter must not implement those aliases or
treat them as part of the current protocol.

### Events

Core events are `ready`, `transfer`, `first-frame`, `runtime-info`,
`frame-health`, `audio-health`, `exit` and `error`. `runtime-info` is emitted
once per successful launch, while frame/audio health are periodic live
diagnostics. `RUNTIME_PROTOCOL_EVENT_BEHAVIOR` is the machine-readable owner of
phase, cadence and required/conditional/optional semantics; do not infer those
rules from one existing shell.

Canonical optional/conditional events cover music fallback/completion/error
state, `notice` and player debug. `notice.message` is displayed by the Launcher.
Historical `thprac-session` is deliberately outside both canonical event lists:
it appears only in `RUNTIME_PROTOCOL_LEGACY_EVENTS` so older TH06/TH07 shells
remain readable without turning that Runtime-owned implementation detail into a
new-adapter protocol obligation.

Likewise, historical preload shells may still accept `configure.music="wav"`.
That value is listed only in `RUNTIME_CONFIGURE_LEGACY_MUSIC_MODES`; the current
Launcher contract is normal OGG, optional MIDI, or `none`. Do not copy WAV
configure support into a new Runtime just because the preload compatibility test
still exercises it.

Runtime health diagnostics are observational only; they must never become
simulation authority.

## 7. Runtime lifecycle outside the game loop

The browser lifecycle is part of the adapter contract because stale input and
unsynced IDBFS state cause game-visible bugs.

At minimum, a mature Runtime shell must:

- clear keyboard state on blur/visibility loss;
- cancel active touch state on blur/pagehide;
- pause its scheduling loop while hidden when appropriate;
- sync durable game state when leaving/backgrounding;
- resume Web Audio only in a browser-legal user gesture path;
- handle WebGL context loss explicitly rather than continuing with corrupted
  presentation state.

Never let presentation-rate work advance gameplay, Replay, RNG, collision,
timers or save state.

## 8. Storage and Replay contract

`storage.saveRoot`, `scoreFile` and `configFiles` are product facts. The Runtime
owns a strict path allowlist under that root; the Launcher must not be given an
arbitrary filesystem API.

Replay management is required and requires all of the following:

- a declared `replay.prefix`;
- Runtime `list/read/write/remove/sync` support;
- import/playback of the title's original Replay format and ordinary export in
  that format whenever the recorded authoritative input is representable by it;
- any project-specific extended Replay used for otherwise-unrepresentable input
  must be clearly identified, validated/versioned and treated as a Runtime
  implementation detail rather than an all-game file-format requirement;
- persistence across Runtime reload;
- the storage conformance lane passing.

Extended Replay metadata is an adapter capability, not permission to silently
change authoritative gameplay. **There is no separate "touch Replay" product
feature.** Touch is only another input source: by the time input reaches
authoritative game/Replay recording it must have the same logical meaning as
the equivalent keyboard/controller action. Do not add touch-only Replay state
or metadata merely because an adapter uses direct touch internally.

## 9. Touch contract

Touch support is more than drawing buttons.

The normative sub-behavior list is `REQUIRED_TOUCH_BEHAVIORS` in
`adapter-capabilities.mts`. A port is not touch-complete until all Runtime-owned
entries apply. Current shared behavior includes both direct movement modes,
both joystick modes, all three focus modes, Fire/Bomb/Pause, double-tap Bomb,
menu/dialogue input, the 100–300% sensitivity contract, mixed-input isolation
and lifecycle cancellation. Launcher-owned layout/Restart/magnifier affordances
must be reused rather than reimplemented.

### `touch-controls`

Carries the latest logical snapshot:

- fire/focus state;
- monotonic Bomb/Escape serials;
- joystick axes;
- sensitivity percentage.

### `direct-touch`

Carries pointer identity, phase and game-surface coordinates for direct
movement. Coordinate conversion belongs at the Runtime/browser boundary, not in
game simulation.

### `touch-cancel`

Must release active pointer ownership without manufacturing gameplay input. It
is required on focus/lifecycle changes.

The Runtime must preserve normal keyboard behavior. A touch implementation is
not complete if Bomb/deathbomb, focus, pause/restart, menu transitions or Replay
recording behave differently merely because the same action came from touch.
Touch-side motion/gesture helpers are transport implementation details and must
not become a second authoritative input or Replay model.

## 10. Music contract

Music has three separate authorities:

1. `musicCapabilities.midi` - the only current optional product-level music
   capability; normal OGG/no-music are required adapter behavior;
2. Host Manifest `music` - what this publication concretely provides;
3. installed Package state - what the browser has locally.

The Launcher resolves the effective mode from all three. Do not special-case a
game name to remove MIDI or OGG.

Runtime transport modes are `ogg`, `midi`, `none`. Launcher UI distinguishes
stream/full OGG decode policy separately through options.

A Runtime that does not support MIDI must never pretend it does and silently
produce no sound. Conversely, an Import publication must not disable MIDI for a
MIDI-capable Runtime just because no remote MIDI files are published.

## 11. Languages and thprac

`features.languages` and `features.thprac` are product ceilings. Runtime Release
then attests the concrete build. Host Manifest may reduce Runtime features.

Do not infer either feature from game number.

For languages:

- Japanese base language is represented by `languageOptions` with `pack: null`;
- packaged languages are Host/Package resources;
- font availability is a separate resource requirement;
- a missing optional language pack must fall back for that launch rather than
  corrupting the durable preference.

For thprac, follow `integrations/RUNTIME_CONTRACT.md`; unsupported upstream
features must not be exposed merely because the original thprac has them.

## 12. Runtime Release

The Runtime Release is the adapter's distributable code boundary. It must:

- include every registered product required by the formal build;
- contain normal Runtime and required multiplayer Runtime variants;
- identify every Runtime file by byte length and SHA-256;
- declare the product DATA provider/layout;
- attest Runtime features;
- pass `verifyRuntimeRelease` without original game content.

For directory Runtimes, keep `runtime-files.json` and the product
`runtimeAssets` declaration synchronized. Adding an arbitrary file to the
Runtime directory is intentionally rejected.

## 13. Package / Host / publication chain

An adapter is not complete until all three resource modes agree.

### Hosted

Publishes Runtime plus deployer-generated game/package content. DATA/music hashes
must match Host Manifest and Package Descriptor.

### External

Publishes Launcher, Runtime and Package metadata while Package file sources stay
under redirect-owned `games/` or `shared/` routes of the matching Hosted
generation.

### Import

Publishes Runtime but not original game payload. A user-supplied Package or
declared raw DATA import must still enter the normal Package Store.

Do not create an Import-only storage format or a second per-game database.

## 14. App Shell and offline ownership

Runtime code is App-owned and may be deferred in the App Shell, but it must be
part of the deployment contract required for offline installed-game launch.
Package DATA is browser Package Store state and must not be smuggled into App
Shell ownership.

After changing Runtime file layout or entry URLs, verify the generated App
Shell contract rather than only testing an online launch.

## 15. Multiplayer is a declared variant

Do not derive multiplayer capability from a title number. A multiplayer-capable
product declares both `multiplayerRuntime` and `multiplayer` bounds in the
product catalog.

Normal and multiplayer variants must agree on DATA layout. Multiplayer-specific
transport/session options belong to the multiplayer adapter; product facts such
as difficulty/loadout bounds stay in the catalog.

Relay/TURN deployment configuration is shared infrastructure, not a game
adapter. Use the canonical `EAGLER_NETPLAY_*` environment namespace. Historical
`TH07_*` variables are compatibility aliases for old deployments only; do not
copy that naming pattern for another title.

If the title declares Multiplayer, the Product Catalog entry must also declare
its supported `playerCounts`, ordered `difficulties`, and complete `loadouts`
table. The shared platform currently understands 2P/3P rooms, but an individual
product may declare only the subset it actually supports. Do not copy the
current TH06/TH07 assumptions that every title has A/B shots, the same character
ordering, or the same difficulty list. Every loadout `labelKey` must exist in
both Launcher UI locales; the repository i18n gate checks this.

Those three lists are the product authority. Do **not** add parallel
`difficultyMax`, `characterMax` or `loadoutCount` declarations: difficulty and
loadout bounds are derived from the declared tables, and valid character/shot
pairs are exactly the entries in `loadouts`.

### Do not extend legacy per-title release parameters

Formal release input uses `GameDirectories`, `LanguagePackDirectories` and a
verified Runtime Release. The old low-level maintainer parameters such as
`Th06Directory`, `Th06LanguagePacks`, `Th08Build` and `Th10Build` exist only for
bounded compatibility/validation workflows. **Never add `ThNNDirectory`,
`ThNNLanguagePacks` or `ThNNBuild` for a new title.** Put original-content and
Host preparation differences under `PRODUCT_CONTENT[game].hostPreparation`,
and extend the generic handler for a new preparation `kind` when the retail
format actually requires one.

## 16. Product-specific branches: allowed versus suspicious

### Usually legitimate

- original file decoding unique to one retail format;
- original binary/data-format parsers;
- compatibility migration for a historically published storage format;
- gameplay implementation inside that game's Runtime;
- a genuinely product-specific UI notice declared by the product.

### Usually a missing declaration/abstraction

- `if (game === "thXX")` to enable/disable music;
- game-name checks for touch or Replay management;
- hard-coded source repository links;
- separate Package Store/install code for the same DATA provider;
- separate Host publication logic for games with the same Runtime layout;
- a new protocol event that duplicates an existing event;
- copy/pasted lifecycle code with only constants changed.

When a branch is unavoidable, document **why the underlying contract differs**,
not merely which game triggers the branch.

## 17. Recommended implementation order

1. Add product declarations and product-catalog tests.
2. Implement/verify DATA provider and authoritative content layout.
3. Make Runtime Release pass before adding original content.
4. Implement the shell lifecycle and required protocol commands/events.
5. Pass keyboard/touch/storage/Replay conformance.
6. Add music and optional language/thprac capabilities.
7. Produce Hosted output and verify Package identities.
8. Derive External and Import from that same Hosted generation.
9. Verify App Shell/offline launch.
10. Run browser first-frame and public/deployment verification.

This order prevents Launcher workarounds from hiding an incomplete Runtime
contract.

## 18. Minimum verification checklist

Repository-level:

```text
npm run check
npm run check:workspace
```

Runtime-specific, as applicable:

- Runtime build/contract tests;
- shell protocol test;
- touch/deathbomb/input regression tests;
- Replay/storage tests;
- Runtime Release verification.

Generated candidate:

```text
npm run verify:server -- <site-root>
```

Browser/device lanes should prove at least:

- first launch reaches `first-frame`;
- reload/second launch works;
- installed DATA survives reload/offline use;
- keyboard and touch do not leave held input after focus loss;
- Replay/save list/read/write/remove survives Runtime restart;
- each advertised music mode is actually audible/disabled as declared;
- mobile and high-refresh presentation do not advance game logic.

Finally verify the real deployment with the appropriate public/deployment lane;
local green tests do not prove CDN/routing correctness.

## 19. Handoff template for the next adapter agent

Before handing off an unfinished adapter, record:

```text
Game / version:
Runtime architecture:
DATA provider + layout:
Runtime file layout:
Supported music modes:
Storage root / score / config:
Replay prefix + compatibility:
Touch status:
Language status:
thprac status:
Multiplayer status:
Known product-specific branches and why they are unavoidable:
Passing tests:
Failing/not-yet-run tests:
Generated artifact identity:
Public deployment status:
```

If the handoff cannot fill one of these fields, the adapter is not yet
self-describing enough for another agent to continue safely.

## 20. Remaining maintainer-only seams

Browser/Runtime/Host/Package behavior and formal original-directory input are
now driven by product declarations and game-id maps. The remaining maintainer
touchpoints are genuine content-format work, not permission to add another
title branch to shared orchestration:

- original-content preparation/baseline declarations such as
  `lib/content-definition.mjs`, `lib/development-content.mjs`, Host OGG
  baselines and any genuinely title-specific archive decoder;
- `scripts/prepare-host-artwork.py` and any title-specific content preparer when
  retail artwork/music needs a new format extractor. Declare the corresponding
  recipe under `PRODUCT_CONTENT[game].hostPreparation.artwork` so
  `adapter:inspect` exposes the requirement instead of leaving it hidden in the
  Python implementation;
- `host/lib/site-builder.mjs` only when a genuinely new `hostPreparation` kind
  is required. Registering another game that uses an existing language/OGG/
  prepared-content path should be declaration-only in `PRODUCT_CONTENT`;
- `lib/self-host-bundle.mjs` when the new format adapter adds maintainer files
  that must ship in the self-host distribution.

Formal release input uses `GameDirectories` and `LanguagePackDirectories` maps;
legacy `Th06Directory` / `Th07Directory` / ... names are compatibility readers
only and must not be extended for a new title.

These seams are not permission to add game-name branches to Launcher, Runtime
protocol, Package Store, Host publication or verifier logic.
