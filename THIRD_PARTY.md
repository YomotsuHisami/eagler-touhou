# Third-party software

`vendor/webaudio-tinysynth.min.js` is generated from `webaudio-tinysynth@1.1.3`.

- Project: https://github.com/g200kg/webaudio-tinysynth
- License: Apache License 2.0
- Purpose: lightweight, sample-free General MIDI synthesis for the MIDI Web build.

Run `npm install --ignore-scripts` followed by `npm run vendor` to reproduce the vendored file.

`vendor/fflate.min.js` is generated from `fflate@0.8.2`.

- Project: https://github.com/101arrowz/fflate
- License: MIT
- Purpose: import and export original-format replay files as a ZIP archive without changing `.rpy` bytes.

The repository contains disabled experimental translation-adapter code informed by the public thcrap repository and patch formats.

- Project: https://github.com/thpatch/thcrap
- License: Unlicense
- Purpose: future research into language-pack discovery and patch-resource preparation. It is not enabled in the default game builds or public UI.

Server-side conversion of original archive/message formats uses `thdat` and `thmsg` from thtk 12 when they are configured by the server administrator.

- Project: https://github.com/thpatch/thtk
- License: 2-clause BSD-style license
- Purpose: extract administrator-provided original resources and compile translated `msg*.dat` files. These tools and original game data are not browser downloads.

The repository contains disabled experimental practice code informed by thprac.

- Project: https://github.com/touhouworldcup/thprac
- License: GNU GPL v3
- Purpose: source reference for future TH06/TH07 advanced-practice work. The current public build does not claim complete thprac compatibility and does not load or inject the Windows DLL.

The game runtimes are built with SDL, SDL_image, SDL_ttf and Emscripten. Their
source and license notices live in the separate TH06/TH07 runtime repositories
and toolchain; they are not vendored into this frontend repository.

- SDL: https://github.com/libsdl-org/SDL
- SDL_image: https://github.com/libsdl-org/SDL_image
- SDL_ttf: https://github.com/libsdl-org/SDL_ttf
- Emscripten: https://github.com/emscripten-core/emscripten
