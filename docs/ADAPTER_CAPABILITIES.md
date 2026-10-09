# Adapter capability classification

This document answers the question that previously caused the most adaptation
drift: **when a feature exists in an older title, is the next title required to
implement it, allowed to omit it, or expected not to copy it at all?**

The machine-readable authority is
`src/contracts/adapter-capabilities.mts`. This document explains the policy.
Product-level interaction and presentation details that are intentionally more
specific than the capability names are defined in
[`ADAPTER_BEHAVIOR_INVARIANTS.md`](ADAPTER_BEHAVIOR_INVARIANTS.md).

## 1. Required adapter capabilities

Required capabilities are part of Eagler Touhou's product contract for every
formal game adapter. They are **not** per-game booleans. A new adapter may not
set one to false just to make an incomplete port pass.

Current required capabilities include:

- authoritative gameplay fidelity: preserve the title's gameplay, collision,
  RNG, timers and native menu/state-machine semantics unless an explicit Eagler
  Touhou product contract intentionally adds or changes behavior;
- Runtime lifecycle: `ready -> configure -> launch -> first-frame -> exit/error`;
- keyboard input and held-key cleanup;
- physical gamepad/controller input through the title's normal logical input
  path;
- complete touch transport: controls, direct touch, cancellation and shared
  sensitivity semantics; touch is an input source, not a separate Replay model;
- shared Restart semantics: R restarts the current run through the title's
  pause-menu state machine when the Launcher touch Restart control is enabled;
- **always-hitbox** display, implemented visually without altering collision;
- blur/visibility/pagehide input cleanup;
- Runtime identity plus periodic frame/audio health diagnostics used by the
  shared diagnostics surface;
- durable save/config synchronization;
- Replay file management and original-compatible import/export;
- normal OGG music plus no-music mode;
- high-refresh presentation: displays above the title's authoritative update
  rate continue presenting at display cadence, while extra display frames never
  advance gameplay/RNG/Replay/timers/save state;
- canonical Package Store installation and offline installed-game launch.

If one of these is missing, the adapter is unfinished. Do not hide its UI and
call the title supported.

The same classification applies one level lower to `configure.options`. The
exhaustive machine-readable table is `RUNTIME_CONFIGURE_OPTION_BEHAVIOR` in
`src/contracts/runtime-protocol.mts`. This prevents a Launcher preference from
silently becoming a Runtime requirement and prevents a compatibility alias from
looking like current protocol. `npm run adapter:inspect -- --game=thXX` exposes
that table as `protocol.configureOptions`.

### Original behavior versus shared product behavior

"Required for every game" does **not** mean every game must behave identically.
The default rule is to preserve the original title. Cross-game normalization is
allowed only when the shared product contract explicitly owns that behavior.

For example, `always-hitbox`, touch transport, Restart R semantics and
high-refresh presentation are explicit Eagler Touhou requirements. A title's
native pause/menu timing, gameplay formulas, deathbomb window, collision and RNG
remain that title's authoritative behavior unless a named required capability
says otherwise. A previous adapter's QoL patch is not precedent by itself.

### Required touch profile

`touch-controls` is intentionally a parent capability, not a vague checkbox.
The machine-readable `REQUIRED_TOUCH_BEHAVIORS` list spells out what a complete
adapter must preserve:

- direct drag in both normal rate-limited and explicit unlimited modes;
- virtual joystick in digital and free-direction modes;
- hold-button, toggle-button and two-finger focus/low-speed behavior;
- Fire, Bomb and Escape/Pause through ordinary logical input;
- original deathbomb behavior, including keeping a held movement gesture alive
  when Bomb is consumed;
- actual use of non-zero Unlimited Touch movement marks the run as cheat-movement
  and forces the title's Result / saved-Replay processing-drop field to 100%;
- the user-enabled double-tap Bomb gesture;
- menu/dialogue navigation through normal direction/confirm/cancel/skip input;
- the shared 100–300% sensitivity range at Launcher and Runtime boundaries;
- isolation between touch, keyboard and physical gamepad owners;
- lifecycle/pointer cancellation without synthesizing actions.

The shared layout editor, touch Restart button and magnifier are also listed in
that profile, but their owner is `launcher`: a new Runtime reuses them rather
than adding game-specific commands. The Restart button emits the ordinary R-key
path; the separate required `restart-action` contract guarantees that R has the
same restart-current-run meaning in every formal adapter.

Each required capability, and every optional product capability that may be
advertised as supported, carries a machine-readable `verification` list. An
optional declaration therefore answers both “is this product supposed to have
the feature?” and “which evidence lanes prove that claim?”. The prefixes have
specific meanings:

- `repository:` - part of the normal `npm run check` gate;
- `workspace:` - part of `npm run check:workspace` and may read Runtime repos;
- `runtime:` - must be satisfied by the new game's own repository tests;
- `browser:` - behavior that needs the browser/device conformance lane.

The adapter-capability contract test verifies that every required and optional
capability has named verification ownership and that every repository/workspace
gate is really scheduled. A document that merely says “tested”, or a Product
Catalog boolean without evidence ownership, is not enough.

Several broad required capabilities also expand into machine-readable behavior
profiles so a future adapter cannot satisfy them with a superficial checkbox:

- `REQUIRED_INPUT_BEHAVIORS` - keyboard/controller logical-input equivalence,
  independent source ownership, lifecycle/disconnect cleanup and native menu
  semantics;
- `REQUIRED_STORAGE_BEHAVIORS` - declared save root, strict file allowlist,
  durable sync/restart/offline continuity and separation between Package bytes
  and mutable player data;
- `REQUIRED_MUSIC_BEHAVIORS` - genuinely audible normal OGG, explicit no-music,
  normal title music lifecycle, background/foreground output recovery without
  restarting title music state, visible failures and presentation/audio independence;
- `REQUIRED_PACKAGE_BEHAVIORS` - canonical Package Store ownership, DATA
  identity/layout validation, atomic generations, local-import parity and
  installed offline launch without an adapter-private shadow store.

`adapter:inspect` includes these as `inputProfile`, `storageProfile`,
`musicProfile` and `packageProfile` under `obligations`.

### Required presentation profile

High refresh is not satisfied by leaving a title permanently at 60 Hz. The
machine-readable `REQUIRED_PRESENTATION_BEHAVIORS` profile requires a fixed
authoritative game cadence plus display-cadence presentation when the display
is faster and the user has not enabled the 60 Hz presentation limit.

The profile deliberately does **not** require one interpolation
implementation. Existing adapters use different owner sidecars and renderer
hooks. What is required is the behavior: extra draws are side-effect-free,
only lifecycle-compatible continuous visual fields interpolate, discontinuous
state snaps, paused worlds stay frozen, and `first-frame` is emitted only after
an actual presentation.

Presentation Lab is a source-level verification mechanism, not a Runtime
protocol command or Product Catalog capability. Its common v1 contract owns
driver/observation semantics and fail-closed `unknown` coverage; each title
owns its native diagnostic ABI, owner registry and state evidence. Current
support is TH08 daily, TH10 limited/`unknown`, and no advertised TH06/TH07 Lab
support. A different verifier is valid when it proves the same required
presentation behaviors.

### Required Replay profile

Replay support is also behavioral rather than format-specific. The
machine-readable `REQUIRED_REPLAY_BEHAVIORS` profile requires original Replay
import/playback, original-compatible export whenever authoritative input is
representable, durable file management, effective-input determinism and live
input isolation during playback.

An extended representation is permitted only for input/state that the retail
format genuinely cannot represent. The extension must be explicit,
versioned/validated and must not become the all-game format contract. This is
why TH06/TH07 EAGX and TH08/TH10 motion trailers are implementation details,
not features a future adapter is expected to copy.

Replay behavior alone is not sufficient evidence of authoritative gameplay
fidelity. The separate machine-readable
`REQUIRED_REPLAY_VERIFICATION_BEHAVIORS` profile requires every formal title
adapter to own:

- a `quick` gate covering every built-in title Demo;
- a `daily` gate covering the declared Lunatic/Extra corpus and any applicable
  title-specific special difficulty;
- immutable content-addressed original-derived golden traces;
- strict fixed-tick comparison with earliest-divergence reporting;
- an explicit advanced oracle-maintenance path that ordinary candidate tests
  cannot invoke or use to bless themselves;
- diagnostic-only read-only observation that does not change normal gameplay,
  Demo rotation or the separately compiled multiplayer Runtime.

This is a Runtime/source-repository verification obligation. It does not add a
Launcher UI feature, Runtime wire command or product option. Each title owns its
state mapping, corpus, completion rules and original provider; shared code may
own game-agnostic trace validation and comparison.

## 2. Inherited Launcher capabilities

Inherited capabilities are universal Launcher features that a newly registered
game receives automatically. The adapter must satisfy the lower-level transport
they use, but **must not copy or fork their UI implementation into the Runtime**.

Current examples include:

- touch layout/sizing/sensitivity editor and orientation profiles;
- magnifier and host-side viewport zoom;
- fullscreen/orientation/viewport placement controls;
- Replay-manager UI (the Runtime still owes the required file protocol);
- Package install/update/import UI;
- Launcher interface localization;
- App Shell/PWA lifecycle;
- FAQ, notices and other site-information surfaces.

This category prevents the opposite mistake from optional features: an adapter
agent should not spend time rebuilding a Launcher-owned feature in every game.

## 3. Profile-required capabilities

Some optional product capabilities define a **profile**. The profile itself is
optional, but once a game declares it, every sub-contract of that profile is
mandatory. This prevents an adapter from claiming a broad feature while quietly
omitting the difficult pieces.

Examples:

- a game may omit Multiplayer entirely, but a Multiplayer-capable adapter must
  implement local-player visibility and spectator input isolation;
- a game may omit thprac, but a thprac-capable adapter must implement the shared
  touch/mouse/function-key bridge expected by Launcher controls;
- a game may omit downloadable language packs, but a language-capable Runtime
  must actually apply validated packs and fall back safely;
- MIDI is optional, but declaring MIDI means the Runtime must produce music via
  the MIDI path rather than exposing a silent selector.

Machine entries use `class: "profile-required"` and a `when` field naming the
parent optional capability. The broad profile is then expanded by the
machine-readable behavior lists:

- `REQUIRED_MULTIPLAYER_BEHAVIORS` - dedicated Runtime variant, declared room
  bounds, ready/start synchronization, deterministic peer authority, seat/input
  ownership, spectator policy, pause/restart, Replay, transport/relay fallback,
  local-player visibility, diagnostics and room-exit lifecycle;
- `REQUIRED_THPRAC_BEHAVIORS` - Runtime attestation, prelaunch session config,
  the supported practice parameter surface, Replay PRAC metadata, touch/mouse
  bridge, locale propagation and no false claims for unported upstream tools;
- `REQUIRED_LANGUAGE_BEHAVIORS` - Japanese baseline, validated publication,
  prelaunch resource/font application, safe fallback and original-resource
  fallback;
- `REQUIRED_MIDI_BEHAVIORS` - selector gating, audible MIDI transport, ordinary
  music lifecycle and separation from the required OGG path.

`adapter:inspect` reports each profile as `active: true/false` for the selected
product and includes the whole behavior list. An inactive profile is not missing
work; an active profile with an unimplemented behavior is incomplete support.

## 4. Optional product capabilities

Optional capabilities describe real differences between games or Runtime
projects. They have declarations in `PRODUCT_GAMES` and shared code may use
those declarations to expose/hide UI.

| Capability | Declaration | Meaning |
| --- | --- | --- |
| MIDI music | `musicCapabilities.midi` | Additional MIDI playback; normal OGG is still required |
| thprac | `features.thprac` | thprac integration |
| Languages | `features.languages` | thcrap/downloadable language pipeline |
| Multiplayer | `multiplayerRuntime` + `multiplayer` | Multiplayer Runtime and room bounds |
| Focus-hitbox enhancement | `features.focusHitbox` | Product-specific focused-state enhancement; **not** the required always-hitbox feature |
| Raw retail DATA import | `package.rawDataImport` | Acquisition convenience for selecting a retail DATA file directly |
| Adaptation notice | `support.adaptationNotice` | Temporary support/early-test presentation |

Multiplayer timing differences are declared under `multiplayer.inputTiming`.
`rollbackLimit: 0` permits only confirmed input with pure delay; UI, room
messages, Runtime configuration and spectator timing reject hybrid mode and
nonzero prediction. `measuredStartup` and `manualDelayLimit` retain their
declared startup ownership and bounds. This does not waive any required MP
profile behavior. Connection, measurement and fatal Runtime status remain
owned by the shared Launcher front end.

An optional capability should not be inferred from game number.

## 5. Adapter-internal implementation details

Some existing Runtimes contain mechanisms that are neither product features nor
legacy compatibility. They are simply how that adapter satisfies a higher-level
contract. A new adapter should copy the **behavioral requirement**, not the
mechanism.

Examples:

- TH06/TH07 `ReplayExtension` / EAGX sidecars. Those projects use the sidecar
  for their existing analog/touch and Multiplayer Replay architecture. EAGX is
  not a separate "touch Replay" product feature and a new title is not required
  to implement EAGX;
- TH08/TH10 sparse `motion-replay` trailers and their `.rpyx` presentation.
  These preserve continuous movement that the retail Replay input stream cannot
  encode, but the next adapter is not required to reuse that file extension or
  trailer design;
- owner-specific previous/current presentation sidecars used by current
  high-refresh implementations. Another Runtime may satisfy presentation
  purity with a different renderer architecture;
- directory-Runtime startup/prewarm caches. They improve startup but are not a
  browser protocol requirement.
- the Host/maintainer WAV preparation path used by existing preload Runtimes.
  WAV is not part of the current player-selectable music contract; a new title
  owes required OGG + no-music and only adds MIDI if the product declares it.

Machine entries use `class: "implementation-detail"`. They deliberately have
no product declaration and must not be used to hide a missing required
capability.

## 6. Format adapters

Format adapters are implementation details required by an original game's
formats. They are not product features and do not define UI availability.

Examples:

- PBG/PBGZ/THA archive or DATA decoding;
- Replay binary codecs/conversion;
- original score/config parsing;
- title artwork/music extraction;
- the current TH06/TH07 thcrap Runtime language compiler. It is a format
  implementation used by products that declare optional `languages`, not a
  language mechanism that every future title must copy.

Host-side format preparation is declared next to the original-content shape in
`lib/content-definition.mjs` under `hostPreparation`. This is deliberately not
a second product-feature registry: it answers **how the Host materializes a
declared capability/content format**, not whether the product has that
capability. Existing preparation kinds include verified OGG conversion,
prepared retail-content bundles, the current thcrap language compiler, and the
legacy preload-data/focus-hitbox materializer. Reuse a kind when the format is
actually shared; add a new kind only when the original format genuinely needs a
different preparation implementation.

Copy one only when the new title actually shares that format. A title-specific
decoder is not evidence that the next title needs the same decoder.

## 7. Compatibility adapters

Compatibility adapters exist because an **older Eagler Touhou release already
shipped** a state, path or format. They are bounded migration code, not an
architecture template.

Examples:

- retired `game-data-pack/1` / `offline-game-pack/1` readers;
- old browser storage migrations;
- historical Runtime/module path aliases.
- the old TH06/TH07 `touchBombZoneEnabled` screen-region Bomb gesture. Current
  Launcher sessions explicitly disable it; the supported shared Bomb inputs are
  the normal Bomb control and the user-enabled double-tap gesture.
- the old TH06/TH07 `enhanceLocalPlayerVisibility` option name. Current
  Launcher state uses `multiplayerLocalPlayerVisibility`; existing Runtimes may
  read the old name only as a fallback.
- the old `unlimitedTouch` boolean. Current Launcher state and Runtime payloads
  use `touchMovementMode="touch-unlimited"`; existing TH06/TH07 shells may keep
  the boolean as a read-only fallback for older hosts;
- the old TH06-named `th06FocusHitbox` preference/Runtime field. Current code
  uses the generic optional capability name `focusHitboxEnabled`.
- the old formal-release parameters `Th06Directory`, `Th07Directory`, ... and
  title-specific `LanguagePacks` parameters. Canonical release input uses
  `GameDirectories` and `LanguagePackDirectories` maps; a new title must not
  extend the release schema with another per-title parameter.
- old saved Launcher `music="wav"` preferences. They migrate to the current OGG
  stream preference and do not make WAV a present-day product capability.
- historical `TH07_*` relay/TURN environment names. Shared netplay services now
  use `EAGLER_NETPLAY_*`; the TH07 names are accepted only as bounded aliases so
  existing deployments do not break. A new multiplayer title must not add a new
  title-prefixed relay configuration namespace.

Never add a new game to legacy compatibility scope automatically. New state
must use the current Package Store, Runtime protocol and storage owners.

## 8. Decision rule for a new feature

When adapting a title and encountering an older-game feature, classify it
before coding:

1. Is it promised by Eagler Touhou for every game? **Required** - implement it.
2. Is it already fully owned by shared Launcher UI? **Inherited** - use it; do
   not reimplement it in the game.
3. Is it mandatory only after another optional profile is enabled?
   **Profile-required** - attach it to that profile and implement it whenever
   the parent is declared.
4. Does it represent a genuine product difference? **Optional** - declare it.
5. Is it only the internal mechanism an existing Runtime chose to satisfy a
   higher-level contract? **Implementation detail** - understand it, but do not
   copy it unless the new architecture actually needs the same mechanism.
6. Is it only a way to read that game's original format? **Format adapter** -
   keep it inside the format/content owner.
7. Does it exist only because an older Eagler Touhou version shipped something
   obsolete? **Compatibility** - keep it bounded and do not copy it forward.

If none applies, stop and update this classification before adding another
game-name conditional to shared orchestration.

## 9. Player-visible option ownership

`GameOptions` contains user preferences whose implementation owners are not all
the same. A boolean preference is therefore **not** evidence that a game may
declare the behavior unsupported.

| Launcher preference | Capability class | Adapter responsibility |
| --- | --- | --- |
| `touchEnabled`, movement/focus mode, sensitivity, double-tap Bomb | Required `touch-controls` | consume the shared touch protocol with the same semantics/ranges |
| `restartButtonEnabled` | Inherited UI + required `restart-action` | Launcher owns visibility/layout; Runtime maps R to pause-menu restart |
| `alwaysHitbox` | Required `always-hitbox` | render hitbox without changing collision/RNG/simulation |
| `frameLimit60Enabled` | Inherited UI + required `presentation-cadence` | honor presentation limiting without changing fixed gameplay cadence |
| `magnifierEnabled` | Inherited `magnifier` | no game-specific implementation; Launcher owns viewport magnification |
| `focusHitboxEnabled` | Optional `focus-hitbox` | implement only for products that declare this enhancement |
| `thpracEnabled` | Optional `thprac` | implement only when declared; then profile obligations become mandatory |
| `thpracTouchControlsEnabled` | Inherited UI + profile-required `thprac-touch-bridge` | required whenever thprac is declared |
| `multiplayerLocalPlayerVisibility` | Profile-required Multiplayer behavior | required only for Multiplayer products |
| `externalMidiDeviceId` | Optional `midi-music` | Launcher-only: opaque `MIDIPort.id` of the picked output; empty means the first granted device. The external-MIDI on/off switch is offered only while the music selection is `midi`, is session-only, and is not a `GameOptions` field |
