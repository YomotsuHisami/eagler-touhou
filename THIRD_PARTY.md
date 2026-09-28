# Third-party software

`public/vendor/webaudio-tinysynth.min.js` is generated from `webaudio-tinysynth@1.1.3`.

- Project: https://github.com/g200kg/webaudio-tinysynth
- License: Apache License 2.0
- Purpose: lightweight, sample-free General MIDI synthesis for the MIDI Web build.

Run `npm ci --ignore-scripts` followed by `npm run vendor` to reproduce the vendored file.

`public/vendor/fflate.min.js` is generated from `fflate@0.8.3`.

- Project: https://github.com/101arrowz/fflate
- License: MIT
- Purpose: import and export original-format replay files as a ZIP archive without changing `.rpy` bytes.

`marked@18.0.12` is used by the maintainer content build.

- Project: https://marked.js.org/
- License: MIT
- Purpose: pre-render FAQ, First-use Notice, and Multiplayer Guide Markdown into static browser HTML during the source build. Marked is not shipped as a Launcher runtime dependency.

The masthead wordmark uses `font-touhou98@1.0.0`.

- Project: https://github.com/thwiki/font-touhou98
- License: MIT
- Purpose: render the `eagler☯touhou` brand wordmark with the Touhou PC-98-derived Web font.
- Vendored file: `public/assets/fonts/touhou98.woff2`; the README wordmark at
  `docs/assets/eagler-touhou-wordmark.svg` is derived from the same font.

The ordinary site UI uses self-hosted subsets of Yatra One and
ChillRoundGothic.

- Yatra One project: https://github.com/google/fonts/tree/main/ofl/yatraone
- ChillRoundGothic project: https://github.com/Warren2060/ChillRoundGothic
- License: SIL Open Font License 1.1
- Purpose: Yatra One renders Latin letters and numbers; ChillRoundGothic renders
  the remaining UI, including headings that previously used a serif face.
- Vendored files: `public/assets/fonts/yatra-one-latin.woff2`,
  `public/assets/fonts/chill-round-gothic-site-medium.woff2`,
  `public/assets/fonts/chill-round-gothic-site-bold.woff2`, and
  `public/assets/fonts/chill-round-gothic-site-heavy.woff2`
- Weight scope: Medium for ordinary CJK text, Bold for headings, and Heavy only
  for the two main game-card titles.
- License notices: `public/assets/fonts/OFL-YatraOne.txt` and
  `public/assets/fonts/OFL-ChillRoundGothic.txt`

The repository contains server-side translation adapters informed by the public
thcrap repository and patch formats.

- Project: https://github.com/thpatch/thcrap
- License: Unlicense
- Purpose: discover, validate and prepare selected language-pack resources for
  the Host/Launcher pipeline. This is a bounded adapter, not a claim that every
  upstream patch or language is compatible.

Server-side conversion of original archive/message formats uses `thdat` and `thmsg` from thtk 12. The self-host bundle does not redistribute thtk binaries. On Windows, the Host build downloads the pinned official thtk 12 release ZIP from the upstream GitHub release, verifies SHA-256 `f6acc00f377b6537e8d504794aec8445cb1e0d6490d2c89d56b3315677765154`, and stores it under the local `.cache/` build-tool cache. On non-Windows systems, `thdat` and `thmsg` must already be available on `PATH`.

- Project: https://github.com/thpatch/thtk
- License: 2-clause BSD-style license
- Purpose: extract administrator-provided original resources and compile translated `msg*.dat` files. These tools and original game data are not browser downloads.

The repository contains a bounded practice adapter informed by thprac.

- Project: https://github.com/touhouworldcup/thprac
- License: GNU GPL v3
- Purpose: map the documented TH06/TH07 practice subset into Web Runtime
  options and Replay metadata. The public build does not claim complete thprac
  compatibility and does not load or inject the Windows DLL.

The site fallback font is a WOFF2 subset of GNU Unifont 15.1.05.

- Project: https://unifoundry.com/unifont/
- Copyright: 1998-2024 Roman Czyborra, Paul Hardy, Qianqian Fang, Andrew
  Miller, Johnnie Weaver, David Corbett, Nils Moskopp, Rebecca Bettencourt,
  Ho-Seok Ee, et al.
- License: SIL Open Font License 1.1 (GNU Unifont is also offered under GPLv2+
  with the GNU Font Embedding Exception).
- Purpose: last-resort glyph coverage for interface text.
- Vendored files: `public/assets/fonts/unifont-site.woff2`,
  `public/assets/fonts/OFL-Unifont.txt`.

The game Runtimes use the SDL family and Emscripten. TH06/TH07 retain their
existing SDL-era Runtime dependencies, while the current TH08/TH10 directory
Runtimes are C++ / SDL3 / Emscripten builds and also carry their own audio/
decoder dependencies in the sibling Runtime repositories. Runtime-specific
source and license notices belong to the corresponding TH06/TH07/TH08/TH10
repository or toolchain; they are not duplicated into this Launcher repository.

- SDL: https://github.com/libsdl-org/SDL
- SDL_image: https://github.com/libsdl-org/SDL_image
- SDL_ttf: https://github.com/libsdl-org/SDL_ttf
- Emscripten: https://github.com/emscripten-core/emscripten


The announcement uses the Bilibili brand icon from the same Font Awesome 7
Brands collection referenced by the Mizuki frontend.

- Package: `@iconify-json/fa7-brands@1.2.4` (Font Awesome Brands 7.3.1)
- License: CC BY 4.0
- Purpose: identify the Bilibili, QQ group, and GitHub links in the site announcement.
- Vendored files: `public/assets/notice-bilibili.svg`, `public/assets/notice-qq.svg`, `public/assets/notice-github.svg`

`public/assets/notice-touhou-cloud.png` is the provider-published Touhou Cloud mark
declared by `https://cloud.touhou.best/`. It is included for provider
identification with permission confirmed by the project owner.

The masthead collection menu uses inline Material Symbols from the same
Iconify collection and version referenced by Mizuki.

- Project: https://github.com/google/material-design-icons
- Package: `@iconify-json/material-symbols@1.2.86`
- License: Apache License 2.0
- Glyphs: `language`, `history`, `person`, and `warning`
- Purpose: identify interface language, first-use notice, and about actions without a
  runtime icon service or network dependency.

## Phosphor room controls

- Project: https://github.com/phosphor-icons/core
- Package: `@phosphor-icons/core@2.1.1`
- License: MIT, included in `public/assets/room-icons-LICENSE.txt`
- Unmodified regular icons: caret-left, caret-right, copy, gear-six,
  sliders-horizontal, chart-bar, users.

## Score statistics decoder

The original-game DAT decoding algorithms and field layouts in
`src/launcher/score-dat.mts` are adapted from
[ThScoreFileConverter](https://github.com/y-iihoshi/ThScoreFileConverter),
Copyright IIHOSHI Yoshinori, BSD-2-Clause. The full license is retained in
`third_party/score-format/LICENSE.txt` and published as `assets/score-format-LICENSE.txt`.

## Score panel character portraits

The optional, deployer-supplied character-selection sprite sheet is original Imperishable Night
artwork by ZUN / Team Shanghai Alice, sourced from
[The Spriters Resource](https://www.spriters-resource.com/pc_computer/touhoueiyashouimperishablenight/asset/34555/).
The image bytes are not included in the source repository. Its attribution is distributed in `assets/score-character-sheet-CREDITS.txt`.
