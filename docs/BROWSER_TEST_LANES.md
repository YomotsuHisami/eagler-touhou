# Browser test command inventory

This is the current command map after the React publication migration. Browser
commands are explicit, on-demand lanes; `npm run check` does not launch a browser.
The migration was checked with source/type/fixture/VM tests, not with a local
browser or native game run. A syntax check, synthetic first-frame event, viewport
emulation, or successful fixture build is not native/gameplay/device acceptance.

## Inputs and isolation

- Current native Launcher lanes require an explicitly assembled **loopback**
  publication, supplied as `--url`, a documented positional URL, or
  `EAGLER_NATIVE_SITE_URL`. `scripts/serve.mjs` development discovery is not a
  substitute for its Host, Package and immutable Runtime manifests.
- Serve an already assembled site with
  `node scripts/serve-static.mjs /absolute/site/path 8130`. A nested publication
  uses its declared mount in the URL. Do not pass a production site or relay.
- `tests/support/current_ui.py` checks local origin/mount, marker, Host and Runtime
  generation identities. Relay inputs are also loopback-only; explicit local
  test relay overrides do not change the stored publication.
- These checks prove publication **shape and identity**, not the authenticity of
  a game. Native lanes retain their real WASM, frame, state/hash, input, audio or
  persistence assertions. Private DATA/Package inputs remain local.
- `tests/support/build-current-protocol-fixture.mjs` builds sealed synthetic
  publications for UI/protocol tests. Its `protocol-fixture.json` explicitly
  denies native Runtime, retail data and persistent-save evidence. It supplies
  no counterfeit native frame or WASM probes.
- Current controls use accessible labels and the retained
  `[data-runtime-host] iframe`. Tests do not reconstruct the removed DOM,
  install a fake `__eaglerBoot`, force-click hidden actions, or introduce a
  second production navigation/session owner.

## Current commands

All 42 advertised browser/performance entrypoints are covered below. All rows are `npm run <command>`; use `--` before script arguments. The source
file contains the full options. Browser/native execution is unverified in this
migration environment, including unchanged native harnesses.

| Command | Current boundary and inputs |
| --- | --- |
| `verify:practice` | Explicit assembled loopback `--url`; unchanged median Lighthouse100-point/category/metric gate, default motion and visible catalog/settings/lobby scenarios; ordinary certificate validation, no fake reference Host |
| `test:ui:browser` | Framework and separate synthetic component fixtures; builds the harness, then runs `playwright.ui.config.ts` |
| `test:ui:nested:browser` | Actual nested Framework build/navigation; build `build:ui:nested` first |
| `test:ui:publication:browser` | Root/nested assembled synthetic origins, actual SW install/offline/update deferral; build root and nested artifacts first |
| `test:keyboard:browser` | Actual current keyboard binding against explicitly prepared real Runtime candidates; retains ownership/3-player/spectator probes |
| `test:package-store:browser` / `test:package-installer` | Real browser IndexedDB with synthetic bytes; complete canonical Package module closure, no development Host or game input |
| `test:package-large-object:browser` | Real IndexedDB/Blob/ArrayBuffer large-object and offline-read contract; no game boot claim |
| `test:webkit` | Explicit assembled `--url` or `EAGLER_NATIVE_SITE_URL`, real TH06/07/08 Runtime; WebKit support evidence, not physical iOS acceptance |
| `test:pwa:browser` | Actual current UI marker and production SW with synthetic ABI/Runtime recovery fixtures; independent nested artifact |
| `test:import-update:browser` | Positional assembled URL and real old/new Package inputs; actual import review/commit and Runtime protocol |
| `test:card-filter:browser` | Positional assembled URL; current rail/minimap hold/scrub/drag/keyboard, ignored retired filter preference, retained settings sheet |
| `test:edge-drawers:browser` | Current React notice edge gestures and accessible close/reopen behavior |
| `test:localized-entries:browser` | `--url=LOOPBACK_MOUNT`; actual Framework root/English alias, locale persistence and bundled fonts |
| `test:language-fallback:browser` | Positional assembled URL and real Package ZIP; optional remote translation404, authenticated first-frame, unchanged saved language |
| `test:touch-settings:browser` | Current shared touch options/editor, cross-product persistence and current settings/help controls |
| `test:multiplayer-guide:browser` | Sealed built Framework artifact, isolated intercepted origin; actual React guide tabs/disclosures/responsive geometry |
| `test:multiplayer-language-preference:browser` | Positional assembled URL; direct multiplayer settings restores shared/independent language after Host metadata, including reload |
| `test:test-build-cards:browser` | Self-built sealed synthetic publications; Host subset, test flag, invalid marker and metadata failure; hidden products remain excluded |
| `test:legacy-package:browser` | Positional assembled URL and real historical Package; actual one-way import and real Runtime protocol |
| `test:offline-reload:browser` | Positional assembled URL; actual installed generation, offline reload and real Runtime first-frame |
| `test:legacy-mount-retirement:browser` | Isolated old-mount SW fixture; retained release/cache retirement protocol, not a current Launcher renderer |
| `test:mp-runtime-exit:browser` | Sealed controlled first-frame preflight plus real local relay; early/stale exit, cancel, successful check/safe return, and separate two-endpoint launch/loss decision; explicit `--url` enables native first-frame/WASM check, `--th08-data` pins exact Host bytes |
| `test:th07mp-launch:browser` | Positional assembled URL, 2/3 players and optional real Package; native frame/stage/RTC/direct/time-sync assertions retained |
| `test:th07mp-ui:browser` | Positional assembled URL with local relay; real room/seat/host/guest/refresh behavior using current panels |
| `test:th07mp-webrtc:browser` | Existing standalone real transport harness; RTC/relay/recovery/skew/hanging-signal coverage unchanged |
| `test:th09-mixed-entry:browser` | Sealed synthetic TH09 protocol plus real relay; title/Launcher entry both directions and configure invariants; no native TH09 claim |
| `test:th09mp-launch:browser` | Portable wrapper forwards explicit assembled `--url`/environment to both title/touch and card/no-music scenarios; real WASM, confirmed-frame/hash and optional spectator assertions |
| `test:th06-netplay-launcher:browser` | Explicit assembled `--url`/environment; own isolated relay override, two native Runtimes, confirmed frame300/canonical hashes |
| `test:multiplayer-replay-launcher:browser` | Sealed synthetic protocol; dedicated MP generation, prepare without launch, explicit Open and no room/netplay options |
| `test:multiplayer-spectator-launcher:browser` | Sealed synthetic protocol and actual local relay; late spectator admission, name/count/role configuration |
| `test:adonis-launcher:browser` | Explicit assembled `--url`, exact descriptor/DATA/fonts/MP package; two players+spectator, native progress and actual calibration-report/event equality |
| `test:adonis-rollback-control:browser` / `test:th09-rollback-control:browser` | Assembled local UI/relay; current checkbox/Space/fixed delay, guest-disabled controls, new-room reset, responsive geometry and localization |
| `test:adonis-mp:browser` | Existing independent native production-shell determinism/calibration/rollback/physical-input harness; unchanged |
| `test:adonis-replay:browser` | Existing independent native replay export/playback equality harness; unchanged |
| `test:origin-migration:browser` | Canonical standalone recovery page and isolated origin/storage fixtures; no server upload |
| `test:music-selection:browser` | Current synthetic protocol/real IndexedDB/UI music matrix; local provenance, verified optional audio, configure and recovery boundaries |
| `test:storage:browser` | Explicit assembled `--url`/environment and score fixtures; real save commands, nested ownership, restore failure and durability; visible supported products by default |
| `test:browser-capabilities` | Explicit assembled `--url`/environment; actual Runtime carrier/lifecycle capability evidence |
| `test:browser-compatibility:browser` | Sealed Framework first-script ES5 gate and unchanged standalone guide; isolated UA/probe fixtures with native canvas restored afterward |
| `test:th20-import-launch:browser` / `test:th20-touch:browser` | **Hidden-product native-adapter only**, independent verified-plan component fixture; see [TH20 fixture inputs](../tests/native-th20/README.md) |

## TH20 is not a public Launcher product

The catalog's `hidden: true` policy is unconditional; `testBuild` does not expose
TH20. Its existing unique native import/OGG/touch/frame tests use an independent
fixture under `.cache/th20-native-harness`, actual current Runtime/touch/session
components and explicit verified inputs. They do not authorize a production card,
route or weakened resource validation. The fixture is excluded from the UI
artifact. Its build, preview, typecheck and identity-test commands are documented
in its README. Native frame/input assertions remain required and unrun here.

## Retired test implementation requirements

The following implementation locks were replaced, not renamed into acceptance:

- Old `#gameFrame`, `#mpRoomView`, `#launch`, native-dialog IDs and `__eaglerBoot`
  were replaced by actual current controls/retained-frame observation. Unique
  native frame/hash/save/RTC assertions were retained.
- Old static HTML card enumeration and deferred `ui-fonts*.css` injection belonged
  to the removed renderer/optimizer. The replacement checks live Framework
  membership, hidden-product exclusion, locale metadata and actual bundled fonts.
- The rollback control's old top-row switch/guest-hidden placement is replaced
  by a native checkbox in the network panel with guest mutation disabled. Real
  relay authority, pointer/Space interaction and responsive target geometry remain.
- Multiplayer `Check game` preflight exercises the exact multiplayer Runtime
  without transport, requires an authenticated first frame and safely returns to
  the same room. Its controlled synthetic early-exit/cancel/pass checks remain
  separate from the two-endpoint launch/exit assertions. `--url` selects a real
  assembled publication and additionally requires native WASM memory at the
  first-frame event; `--game th08 --th08-data=FILE --url=...` pins retail DATA to
  that Host rather than inventing source metadata. Actual native preflight and
  all browser outcomes are UNVERIFIED here.
- Old three-label calibration-strip assertions are replaced by the visible
  current report JSON compared with authenticated native measurement events.
- Launch warning acknowledgments remain caller-specific, following the original
  handlers: ordinary Start and seated room launch acknowledge touch/none/MIDI
  warnings. MP Replay viewer and Check game preflight did not invoke that gate;
  their explicit Start/MIDI activation behavior is preserved without extending
  warnings to those flows. Browser helpers accept only the three known launch
  warning kinds, never unrelated save/loss/import dialogs.
- Pure source/model/SSR tests complement these lanes but do not replace their
  browser/relay/native boundaries. New protocol fixtures never claim game
  rendering, native audio, physical touch or durable Runtime storage.

## Deterministic checks

`tests/test-current-ui-support.py` runs with Python's standard library only and
checks mounted URLs, sealed identities and local UI/relay guards without HTTP.
`tests/test-ui-publication.mjs` validates synthetic fixture publication and the
actual protocol script in a VM, plus the complete Package-browser module closure.
`tests/native-th20/test-verified-plan.mjs` checks the hidden fixture's input
identities and production isolation; its synthetic inputs are not native runs.
