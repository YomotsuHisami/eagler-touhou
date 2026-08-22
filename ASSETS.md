# Public visual assets

## Game-card backgrounds

`assets/th06-title00.jpg` and `assets/th07-title00.jpg` are the original
`title00.jpg` images extracted from game files owned by the deployer. They are
used as the two game-card backgrounds without the original menu-button layer.

These images are derivative, publication-sensitive Touhou Project artwork.
Their presence in the repository does not make them open-source assets and the
project claims no copyright over them. A downstream distributor must assess
whether its use is permitted and may replace them with appropriately licensed
artwork.

Older local WebP experiments are ignored by Git and excluded from packages. They
are not used by the current homepage and must not be described as its covers.

## Interface font

The ordinary site UI uses local, page-specific WOFF2 subsets of Yatra One for
Latin letters and numbers and ChillRoundGothic for Chinese, Japanese and other
text. Medium is used for ordinary CJK text, bold for headings, and Heavy only
for the two main game-card titles. The build recipe is
`scripts/build-site-ui-fonts.mjs`; upstream revisions and OFL notices are pinned
there and stored next to the generated fonts. GNU Unifont remains only as the
last missing-glyph fallback.

`assets/fonts/noto-serif-sc-touhou.woff2` is retained as a historical subset but
is no longer loaded by the site UI. Full CJK fonts and the game font are not
stored in the public repository; a deployer supplies a compatible local
Japanese font when preparing a private deployment.

The publication audit uses an explicit allowlist for this directory. Review the
rights and update that allowlist before adding any new visual asset.

## Site brand assets

`assets/th06.ico` is reconstructed directly from the application-icon resource
embedded in the deployer's original `th06.exe` and is used as the site favicon
and masthead icon. It remains original Touhou Project content and is therefore
publication-sensitive in the same way as the game-card artwork.

`assets/fonts/touhou98.woff2` is the self-hosted Web font from
`font-touhou98@1.0.0`; the masthead wordmark `eagler☯touhou` uses it. Upstream
project and license metadata are recorded in `THIRD_PARTY.md`.
