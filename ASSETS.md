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

`assets/fonts/noto-serif-sc-touhou.woff2` is a subset used for the project UI.
Its license notice is stored next to the font. Full CJK fonts and the game font
are not stored in the public repository; a deployer supplies a compatible local
Japanese font when preparing a private deployment.

The publication audit uses an explicit allowlist for this directory. Review the
rights and update that allowlist before adding any new visual asset.
