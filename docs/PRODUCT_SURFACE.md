# Product surface

This document is the human-readable inventory of the capabilities that the
project intentionally supports. It answers "what is part of the product?";
implementation ownership belongs in `ARCHITECTURE.md`.

The machine-readable authority for whether a capability is all-game required,
Launcher-inherited, profile-required, optional, a format adapter, an
implementation detail or compatibility-only is
`src/contracts/adapter-capabilities.mts`. Per-product optional differences are
declared in `src/contracts/product-catalog.mts`. If this prose/table disagrees
with those contracts, fix this document rather than teaching another Runtime or
Launcher path to follow the prose.

Status meanings:

- **Supported** - part of the intended current product surface and expected to
  remain working across ordinary releases.
- **Partial** - usable but not yet at the capability's declared product
  contract, or intentionally limited. It does not mean a later adapter should
  copy an older title's implementation.
- **Optional** - supported when the deployer enables/provides the dependency.
- **Compatibility** - accepted for migration/read purposes, but no new data is
  produced in that format.
- **Maintainer-only** - development/release infrastructure, not an end-user
  feature.

## Games and Runtime variants

The table below is a snapshot of the currently registered four games, not a
second capability registry. Required rows must stay supported for every formal
adapter; optional rows follow the Product Catalog declarations.

| Capability | TH06 | TH07 | TH08 | TH10 |
| --- | --- | --- | --- | --- |
| Browser Runtime | Supported | Supported | Supported | Supported |
| Normal single-player | Supported | Supported | Supported | Supported |
| Multiplayer Runtime | Supported | Supported | Not supported | Not supported |
| Local package installation | Supported | Supported | Supported | Supported |
| Hosted package installation | Supported | Supported | Supported where published | Supported where published |
| Offline installed-game launch | Supported | Supported | Supported where the deployed Runtime/package is complete | Supported where the deployed Runtime/package is complete |
| Physical gamepad/controller input | Supported | Supported | Supported | Supported |
| Touch controls | Supported | Supported | Supported | Supported |
| Replay import/export | Supported | Supported | Supported | Supported |
| thprac integration | Supported | Supported | Supported | Not supported |
| thcrap language packages | Supported | Supported | Not part of the current formal language pipeline | Not part of the current formal language pipeline |

"Supported" does not mean every upstream/private build combination is a public
release. Publication still depends on the selected Runtime Release and host
configuration.

## Launcher features

### Game directory and launcher workspace - Supported

- One vertical directory entry per game, shared by single-player and multiplayer.
- Selecting a game updates the persistent launcher panel beside the directory.
- Desktop launcher has an 820 px minimum height and starts below the header.
  Credits follow it in the same right-hand column, independent of directory height.
- Desktop directory extends from the header edge to the viewport bottom, with
  its heading overlaying the cards in its original position. Initial scroll padding
  places cards below the heading. When cards approach its text area, the heading
  slides left out of view and returns once clear; portrait retains its normal heading.
  The helper hint is removed.
- On desktop mouse layouts, hovering near the visible directory top/bottom
  automatically scrolls it in that direction, accelerating toward the edge.
  Leaving the directory stops scrolling; portrait/touch and reduced-motion
  modes disable this behavior.
- Directory cards are square with artwork filling the card. The number sits at
  the top left; the title and smaller English name overlay the lower artwork
  without background panels or dark overlays. Original font families are retained.
  The selected entry stays larger than unselected entries.
- Desktop landscape layouts with a fine mouse pointer magnify nearby entries
  with a Dock-style wave. Portrait/touch layouts and reduced-motion preferences
  disable the pointer wave; selected-entry emphasis remains.
- The game-info cover/title and mode selector are temporarily hidden. Existing
  product routes and Runtime behavior remain registered. Saves and replays stay
  scoped to their game/product. A small top-left button opens save/replay tools.
- Game info reads original TH06–TH10 DAT bytes from existing local IDBFS in
  read-only transactions without booting a Runtime. It refreshes after player
  close/durable sync and verified save import. TH10 follows the language-specific
  path (including launch fallback); multiplayer never substitutes solo scores.
- Rankings, practice results, clear/unlock flags, play counts, times and BGM
  flags are grouped into initially collapsed tables. Durations use hours and minutes. Spell careers are aggregate only,
  without individual spell names/descriptions. Missing data remains distinct
  from zero; original default ranking slots and uncertain TH09 time are labeled.
- Empty game info shows only “游戏保存后，成绩与进度将在这里显示”.
  The existing save/replay dialog contains a local DAT library with selectable
  rows and an individual download button per save. Adding a file validates its
  game signature, bounds and checksums. Parsed text uses textContent.
- Selecting a library save updates the statistics immediately and persists a
  pending choice. Before the next launch, Runtime reads/backups the old save,
  writes and syncs the selected bytes, then verifies them before allowing launch.
  Game progress updates the active slot after durable sync. Failed verification
  prevents launch and retains the pending choice; backups remain downloadable.
- The adaptation notice has intrinsic height above the launch actions, so the
  options area no longer competes with statistics for flexible vertical space.
- The most-played loadout is selected from recorded play totals, excluding the
  aggregate block and avoiding per-difficulty double counting. Ties use stable
  character order. Its artwork fades from the panel left into the dark center;
  TH08 teams use both portraits. Missing counts do not fall back to clear counts.
- The header settings dialog, immediately before reduced motion, owns Advanced
  and Touch settings. Preferences are global across games and modes, initialized
  once from the existing selection; touch layouts retain their global storage.
  Unsupported language/music choices fall back for the current game without
  replacing the saved preference.
- The global thprac preference is intent, not runtime capability. Only normal
  single-player launches with explicit Host thprac support may receive thprac
  options or expose its touch buttons; missing capability is treated as unsupported.
  Switching games never clears the user's requested preference.
- Game and mode selection is reflected in the URL and browser history.
- Desktop Up/Down immediately select the previous/next game, excluding text
  fields, modal dialogs, and active play/rooms. Home/End navigate directory
  focus; Enter selects a game. The
  launcher panel is not a modal and does not trap keyboard focus.
- Portrait screens up to 780px place a horizontally scrollable directory above
  the full-width launcher; Left/Right navigate directory focus in this layout.
  Swipe left/right on the directory or noninteractive statistics area to select the next/previous
  game. Vertical page scrolling remains native, and short gestures do not switch.
  Desktop and landscape layouts keep the vertical directory.

### Game/package management - Supported

- Remote package installation through Release Catalog + Package Descriptor.
- Local Package ZIP import.
- Atomic Package Store generation switching.
- Separate package components for base data, language/music and other declared
  resources where available.
- Updating a locally imported game with a later canonical package revision.
- Explicit package/install diagnostics and network activity visibility.

### Offline use - Supported in secure contexts

- Launcher App Shell offline reload through Workbox.
- Offline Runtime HTML/JS/WASM bootstrap when included in the deployment
  precache contract.
- Installed Package DATA/resources from browser-local Package Store.
- Offline refresh of the Launcher followed by launching an already installed
  game.

HTTPS (or a browser-trusted local/loopback context) is required for the full
Service Worker storage/offline model.

### Touch / mobile controls - Required for every formal game adapter

- Direct touch movement and configured touch movement modes.
- Custom control placement, scale and stacking order.
- Separate portrait and landscape touch-layout profiles, shared across
  supported Launcher products rather than maintained once per game.
- Saved horizontal game-viewport placement as part of each orientation profile.
- Optional thprac Tab/cheat-menu controls participate in the
  same layout editor when that feature is enabled.
- Touch sensitivity.
- Low-speed control modes.
- Pinch/zoom magnifier behavior.
- Mobile orientation/layout handling.
- Always-hitbox display without changing authoritative collision state.
- Touch input resolves to the same authoritative logical input/Replay semantics
  as keyboard/controller input; Eagler Touhou does not define a separate
  touch-Replay format or touch-only Replay metadata feature.

### Site information and notices - Supported

- A transient Launcher notice is loaded from the packaged `NOTICE.txt` and may
  contain the project's maintained feedback/community links.
- Players can disable or re-enable the notice from the masthead menu; that
  preference is stored locally.
- The masthead also exposes interface language, the packaged First-use Notice and the
  About page, while FAQ remains a direct site-information entry.
- `content/FIRST_USE_NOTICE.md` is optional operator-maintained onboarding content.
  The build pre-renders it to precached `content/FIRST_USE_NOTICE.html`; an empty
  source is supported and does not auto-open. A non-empty notice auto-opens once on
  a new browser and remains manually accessible afterwards. Editing the content does
  not force the notice back open for returning players, and known historical changelog
  seen markers migrate as already-onboarded state.
- Reading `NOTICE.txt` or generated First-use Notice content must never become a prerequisite
  for package management or game launch.
- Notice display is non-blocking: failure to load `NOTICE.txt` must not prevent
  game/package use.

### Replay and user files - Required for every formal game adapter

- Import/playback of original Replay/save files and original-compatible export
  whenever the recorded authoritative input is representable by the retail
  format.
- A Runtime may use a clearly identified project extension for deterministic
  data the retail format cannot encode; such a sidecar/extension is an adapter
  implementation detail, not a universal "touch Replay" product feature.
- File actions prepare the Runtime/storage bridge on demand; a user does not
  need to launch the game manually once before save/Replay tools become usable.
- Separate multiplayer Replay handling.

### Language support - Supported for TH06/TH07

- Japanese base game.
- Host-selected thcrap language packages.
- Self-host default preparation of Japanese, Simplified Chinese and English.
- Per-language font subset generation and packaging.
- Selected language resources can travel inside offline/import packages.

Language availability is a deployment input; the Launcher does not promise
that every server publishes every thcrap language.

### Music modes - OGG/no-music required; MIDI optional

Every formal game adapter must support normal OGG music and an explicit
no-music mode. MIDI is an optional product capability and is exposed only when
the product declares it and the concrete Runtime/Host path can actually play
it. Exact published OGG content remains deployment/package data rather than a
hard-coded site promise.

### thprac - Supported for TH06/TH07/TH08 when built/published

- Portable thprac integration.
- TH08 includes source-level section/ECL/STD patches, its game-specific resource,
  gauge, time, night, familiar and rank parameters, and embedded Replay metadata.
- Direct touch pointing and optional function-key controls needed by the practice UI.
- Runtime/Host verification requires the corresponding capability attestation;
  a host must not advertise thprac merely because a UI toggle exists.

## Multiplayer surface

### Current Multiplayer products - TH06MP / TH07MP

- Room creation and room-code join.
- Product-declared player-count subset within the shared 2P/3P platform.
- Product-declared character/loadout and difficulty tables; the shared
  Launcher/Relay must not assume TH06/TH07's A/B-shot or difficulty layout for
  a future Multiplayer title.
- Ready state before match start.
- Spectator role before match start.
- Pause/restart behavior supported by the multiplayer Runtime.
- Multiplayer Replay support.
- WebRTC peer transport.
- WebSocket Relay fallback when configured.
- Connection/rollback diagnostics exposed by the Launcher/Runtime integration.

### Deliberate limitations

- Spectators must enter the spectator seat before match start. The short
  post-start connection grace applies only to spectators already admitted at
  start; a newly requested spectator joins the next match instead.
- TURN availability is server-managed and not guaranteed by a static self-host site/bundle.
- A Host without WebSocket Relay configuration remains valid, but loses that
  fallback path and should report it as a warning rather than a build failure.

## Deployment modes

### `hosted` - Supported

The deployer may publish Launcher, Runtime and deployer-generated game content,
plus Package publication metadata.

### `import` - Supported

The site publishes Launcher/Runtime needed for the import experience while the
player supplies the game package. This mode does not publish original game
content and does not pretend to offer remote game package revisions that are
not actually present.

### `external` - Supported

The deployer publishes the Launcher, Package metadata and App-managed Runtime
on a user-facing site while a matching complete Hosted site owns the game and
shared Package payloads. The user-facing infrastructure redirects those
payload routes to the Hosted resource Origin. Both sites must derive from the
same verified Hosted generation.

### Manual external package source - Optional

A deployer may expose an administrator-provided external package/download link.
The Launcher opens the configured source; absence of this setting is a normal
optional warning, not a failed Host build. This manual link is independent of
the `external` resource mode.

## Self-host surface

Supported deployer workflow:

```text
install Node.js + Python
use a source checkout or unpack a self-host bundle
place originals under games/
edit eagler-touhou.config.json when needed
npm run host
```

The Host tooling owns locked Node dependencies, a private Python environment,
thtk resolution, selected language preparation, music conversion, artwork,
site assembly, Workbox generation and verification.

`dist/site` is disposable output. `.cache` is intentionally reusable across
rebuilds.

The Import build uses the same originals/self-host assembly inputs and produces
installable package ZIPs; it is not a separate game-resource ownership tree.

## Compatibility-only surface

The following are accepted only to migrate existing users/data:

- `eagler-touhou/game-data-pack/1` ZIPs;
- `eagler-touhou/offline-game-pack/1` ZIPs;
- pre-Package-Store Launcher browser state that can be migrated into the
  canonical Package Store.

No new producer should emit these old package/storage formats.

Historical generated sites, archived validation copies and old deployment
snapshots are not supported product APIs.

## Maintainer-only surface

These are engineering/release facilities rather than player features:

- sibling TH06/TH07/TH08/TH10 Runtime source workspaces;
- CMake/Ninja/Emscripten Runtime compilation;
- Runtime Release production;
- publication/release verification;
- local browser/WebKit and other explicit browser gates;
- publication audits and remote deployment probes.

Ordinary self-host users should not need the Runtime source repositories or
Emscripten toolchain.

## Change rule

Update this file in the same change when a capability is:

- added to or removed from the intended user/deployer product surface;
- promoted from Partial/Optional to Supported;
- deliberately restricted or deprecated;
- moved to Compatibility-only status.

Pure refactoring that preserves behavior belongs in `ARCHITECTURE.md` and does
not require rewriting this feature inventory.

- The Multiplayer action beside Launch exchanges game info for a lobby card,
  horizontally on desktop and vertically in portrait. Return restores solo info;
  reduced-motion skips movement. Production retains the existing relay flow.
- On loopback hosts, multiplayer opens `public/dev-lobby.html`, a local design
  fixture with synthetic rooms, character selection, readiness, and device/avatar
  placeholders. It does not connect players or launch network sessions. Run
  `node scripts/serve.mjs 8131` and open the loopback URL to review it. These
  preview files are not included in production/offline manifests. Real relay
  integration and physical touchscreen validation remain follow-up work.
- Optional character portrait sheets are deployer-supplied assets, excluded from
  public source. TH06/07/10 currently reuse TH08 portraits in the visual preview.
- Launcher actions are ordered Launch, Multiplayer, then Import when available.
