# Site assets and host-generated game visuals

## Game-card backgrounds

The final hosted site uses `assets/th06-card.webp`, `assets/th07-card.webp`,
`assets/th08-card.webp`, `assets/th09-card.webp`, and `assets/th10-card.webp`. Host assembly extracts the title artwork from original
game files supplied by the deployer and converts it to WebP without enlarging
or cropping it. A deployer may instead provide a custom card image; WebP input
is preserved and PNG/JPEG input is normalized to the same final WebP contract.

The original JPG/PNG bytes are staging input only. They are deliberately
**not** stored in the public source repository, are not copied into the final
host merely to support the card UI, and are not part of the resource-free
Runtime Release. The source tree therefore contains references to stable final
host paths without owning the original-game-derived bytes.

The currently pinned card encoder is Pillow WebP quality 55 / method 6. The
cards are UI presentation derivatives that are darkened and cropped by the
Launcher, so the delivery profile favors first-load size over archival image
quality. This is
a host-delivery policy rather than a game-data identity: custom WebP overrides
are not transcoded again.

## Interface font

The ordinary site UI uses local, page-specific WOFF2 subsets of Yatra One for
Latin letters and numbers and ChillRoundGothic for Chinese, Japanese and other
text. Medium is used for ordinary CJK text, bold for headings, and Heavy only
for the two main game-card titles. The build recipe is
`scripts/build-site-ui-fonts.mjs`; upstream revisions and OFL notices are pinned
there and stored next to the generated fonts. GNU Unifont remains only as the
last missing-glyph fallback.

Full CJK fonts and the game font are not stored in the public repository; a
deployer supplies a compatible local Japanese font when preparing a private
deployment.

The publication audit uses an explicit allowlist for source-public assets.
Adding a file under `public/assets/` does not make it publishable; host-generated
original-game-derived files are rejected from source publication candidates.

## Site brand assets

The final hosted `assets/th06.ico` is reconstructed from the application-icon
resource in the deployer's original `th06.exe`, unless the deployer supplies a
custom replacement. Like the card backgrounds, it is generated during host
assembly and is not tracked as public source content.

`assets/fonts/touhou98.woff2` is the self-hosted Web font from
`font-touhou98@1.0.0`; the masthead wordmark `eagler☯touhou` uses it. Upstream
project and license metadata are recorded in `THIRD_PARTY.md`.

`docs/assets/eagler-touhou-wordmark.svg` stores the same `EAGLER☯TOUHOU`
wordmark as font outlines for the repository README.

## PWA application icons

The PWA icons preserve the site's established TH06 executable icon instead of
introducing a separate Launcher mark. `scripts/prepare-host-artwork.py` derives
`assets/pwa/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and
`apple-touch-icon.png` from the same host-generated `th06.ico`. The maskable and
Apple variants add the platform-safe inset and background. Like `th06.ico`, all
four files are Host inputs and are not tracked as public source content.

## Announcement brand icons

`assets/notice-bilibili.svg` is the Bilibili brand glyph taken from the exact
`fa7-brands:bilibili` icon set used by the local Mizuki frontend reference
(`@iconify-json/fa7-brands@1.2.4`, Font Awesome Brands 7.3.1). The SVG path is
stored locally so the announcement does not depend on an icon CDN.

`assets/notice-qq.svg` and `assets/notice-github.svg` use the `qq` and `github`
glyphs from that same pinned package, with a light fill for the dark notice.

`public/assets/notice-touhou-cloud.png` is the provider-published Touhou Cloud icon
declared by `https://cloud.touhou.best/`.

Providers without explicitly documented redistribution permission are rendered
as text-only links. Their site icons are not copied into this repository.

The masthead collection menu and TH08 maintenance warning embed the `language`,
`history`, `person`, and `warning` glyph paths from
`@iconify-json/material-symbols@1.2.86`, matching Mizuki's Material Symbols icon
system. They are inline in `index.html`, so they add no separate delivery asset
and remain available offline. Material Symbols are licensed under Apache
License 2.0.

## Multiplayer room UI

The room reuses `assets/launcher-background.webp` without runtime blur. Player
and spectator avatars are intentional initial placeholders; no generated artwork
is published. `assets/room-*.svg` are unmodified Phosphor regular icons, with
license in `assets/room-icons-LICENSE.txt`. They ship in the offline App Shell.

The game statistics panel optionally uses deployer-supplied
`assets/score-character-sheet.png`; the local room preview also references
`assets/room-th09-portraits.png`. These original-game-derived sheets are private
host inputs and are not included in the public source or offline manifest.
Local preview copies live in ignored `private-assets/`; the private frontend
asset mapping supplies their stable URLs to preview and host assembly. SVG view boxes select
portraits and CSS masks fade them toward the panel center. Provenance for the
local reference sheets is recorded in `assets/score-character-sheet-CREDITS.txt`.

## Local independent character portraits (frontend-redesign)

The current score and local room components no longer consume the two legacy
sprite sheets described above. `src/contracts/character-art.mts` is the shared
identity/roster map, and `src/launcher/character-art.mts` renders independent PNGs.
DAIRI artwork is operator-imported into ignored `private-assets/dairi/` for
loopback preview only. The source package carries an empty public manifest, CSS,
code and credits, not artist PNGs. No DAIRI originals enter Host publication.
See [DAIRI_ART.md](docs/DAIRI_ART.md) for the artist's source, terms and importer.
