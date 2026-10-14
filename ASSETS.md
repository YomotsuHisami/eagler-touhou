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

`favicon.ico` is the site's yin-yang icon, rendered from the U+262F glyph in
`font-touhou98@1.0.0`. It is tracked as a source brand asset and copied to
`assets/favicon.ico` during host assembly. An operator may supply a custom override.
The preview is `docs/assets/eagler-touhou-icon.png`.

`assets/fonts/touhou98.woff2` is the self-hosted Web font from
`font-touhou98@1.0.0`; the masthead wordmark `eagler☯touhou` uses it. Upstream
project and license metadata are recorded in `THIRD_PARTY.md`.

`docs/assets/eagler-touhou-wordmark.svg` stores the same `EAGLER☯TOUHOU`
wordmark as font outlines for the repository README.

## PWA application icons

The PWA icons derive from the site's font-based yin-yang icon.
`scripts/prepare-host-artwork.py` produces `pwa/icon-192.png`,
`icon-512.png`, `icon-maskable-512.png` and `apple-touch-icon.png`, with the
maskable and Apple variants using the platform-safe inset and background.
These sizes are generated during host assembly.

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

## Character artwork in the statistics workspace

The statistics UI uses the existing credited `frontend-redesign` PNGs at
`public/assets/dairi/`, plus ten newly downloaded portraits registered in the
same metadata and provenance list. The files are delivered through the sealed frontend
artifact and its explicit App Shell resource list; they are not game DATA or
part of a Runtime Release. TH08 team artwork uses two independent portraits.
Only recorded positive play-frequency totals select artwork. Missing counters
and unavailable images have explicit states instead of invented statistics.
Attribution and source notices remain separate from the project license; see
`THIRD_PARTY.md`, `assets/dairi/CREDITS.txt` and `docs/dairi-art/`.

Room privacy SVGs (`room-lock-open.svg`, `room-lock-closed.svg`) reuse the exact lock paths from frontend-redesign/public/dev-lobby.mjs; packaged as local assets with the existing room-copy icon and registered for App Shell caching.


File table actions reuse the unmodified Heroicons v2.2.0 outline download/trash
SVGs in `public/assets/heroicons/`, with their MIT notice alongside them. They
are rendered as masks in the existing theme color; no generated bitmap or
hand-drawn replacement is used for the file controls.
