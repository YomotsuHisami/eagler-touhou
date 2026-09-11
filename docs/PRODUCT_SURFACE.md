# Product surface

This document is the authoritative inventory of the capabilities that the
project intentionally supports. It answers "what is part of the product?";
implementation ownership belongs in `ARCHITECTURE.md`.

Status meanings:

- **Supported** - part of the intended current product surface and expected to
  remain working across ordinary releases.
- **Partial** - usable but not yet at feature parity with the mature TH06/TH07
  path, or intentionally limited.
- **Optional** - supported when the deployer enables/provides the dependency.
- **Compatibility** - accepted for migration/read purposes, but no new data is
  produced in that format.
- **Maintainer-only** - development/release infrastructure, not an end-user
  feature.

## Games and Runtime variants

| Capability | TH06 | TH07 | TH08 |
| --- | --- | --- | --- |
| Browser Runtime | Supported | Supported | Partial |
| Normal single-player | Supported | Supported | Partial |
| Multiplayer Runtime | Supported | Supported | Not supported |
| Local package installation | Supported | Supported | Supported where package/runtime inputs exist |
| Hosted package installation | Supported | Supported | Supported where published |
| Offline installed-game launch | Supported | Supported | Supported where the deployed Runtime/package is complete |
| Touch controls | Supported | Supported | Partial / Runtime-dependent |
| Replay import/export | Supported | Supported | Partial / Runtime-dependent |
| thprac integration | Supported | Supported | Not part of the current formal surface |
| thcrap language packages | Supported | Supported | Not part of the current formal language pipeline |

"Supported" does not mean every upstream/private build combination is a public
release. Publication still depends on the selected Runtime Release and host
configuration.

## Launcher features

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

### Touch / mobile controls - Supported for mature TH06/TH07 Runtime paths

- Direct touch movement and configured touch movement modes.
- Custom control placement, scale and stacking order.
- Separate portrait and landscape touch-layout profiles, shared across the
  mature TH06/TH07 Launcher path rather than maintained once per game.
- Saved horizontal game-viewport placement as part of each orientation profile.
- Optional thprac simulated-mouse/Tab/cheat-menu controls participate in the
  same layout editor when that feature is enabled.
- Touch sensitivity.
- Low-speed control modes.
- Pinch/zoom magnifier behavior.
- Touch-aware Replay extensions where the Runtime supports them.
- Mobile orientation/layout handling.

### Site information and notices - Supported

- A transient Launcher notice is loaded from the packaged `NOTICE.txt` and may
  contain the project's maintained feedback/community links.
- Players can disable or re-enable the notice from the masthead menu; that
  preference is stored locally.
- The masthead also exposes interface language, the packaged changelog and the
  About page, while FAQ remains a direct site-information entry.
- `CHANGELOG.txt` content is optional packaged release-note content. An empty
  file is a supported state and does not auto-open; a non-empty replacement is
  recognized by its content identity and may auto-open once for a user who has
  not seen that content yet.
- Reading `NOTICE.txt` or `CHANGELOG.txt` must never become a prerequisite for
  package management or game launch.
- Notice display is non-blocking: failure to load `NOTICE.txt` must not prevent
  game/package use.

### Replay and user files - Supported for mature TH06/TH07 Runtime paths

- Import/export of original-compatible Replay/save files where supported by
  the Runtime.
- File actions prepare the Runtime/storage bridge on demand; a user does not
  need to launch the game manually once before save/Replay tools become usable.
- Extended Replay sidecar/format support for project-specific touch metadata.
- Separate multiplayer Replay handling.

### Language support - Supported for TH06/TH07

- Japanese base game.
- Host-selected thcrap language packages.
- Self-host default preparation of Japanese, Simplified Chinese and English.
- Per-language font subset generation and packaging.
- Selected language resources can travel inside offline/import packages.

Language availability is a deployment input; the Launcher does not promise
that every server publishes every thcrap language.

### Music modes - Supported according to Runtime/host capability

The product model supports the configured Runtime music modes, including MIDI,
OGG-based modes and no-music operation where the corresponding Runtime/host
profile permits them. Exact available choices are product/build-profile data,
not hard-coded deployment promises in this document.

### thprac - Supported for TH06/TH07 when built/published

- Portable thprac integration.
- Touch-device simulated mouse/control affordances needed by the practice UI.
- Runtime/Host verification requires the corresponding capability attestation;
  a host must not advertise thprac merely because a UI toggle exists.

## Multiplayer surface

### TH06MP / TH07MP - Supported

- Room creation and room-code join.
- 2- or 3-player seat model where supported by the Runtime/session.
- Character/loadout and difficulty selection.
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

### External package source - Optional

A deployer may expose an administrator-provided external package/download link.
The Launcher opens the configured source; absence of this setting is a normal
optional warning, not a failed Host build.

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

- sibling TH06/TH07/TH08 Runtime source workspaces;
- CMake/Ninja/Emscripten Runtime compilation;
- Runtime Release production;
- publication/release verification;
- BrowserStack/WebKit and other explicit browser gates;
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
