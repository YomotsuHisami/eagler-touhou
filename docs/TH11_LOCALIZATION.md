# TH11 THCRAP localization adaptation

TH11 follows the existing Host → static THCRAP ZIP → Launcher → Runtime
boundary used by TH06/07/08/10. The original Japanese game data remains the
fallback when a patch file or entry is absent. The Runtime does not fetch
THCRAP repositories.

## Source ownership

- Use the Japanese `th11.dat` to compile patches. Do not use `th11c.dat` or
  the prelocalized Traditional Chinese files from mixed retail folders.
- `thdat -x 11` extracts the original archive. `thmsg -d/-c 11` compiles
  `stNN_NN[a-c].msg.jdiff`; `thmsg -d/-c -e 11` compiles `eNN.msg.jdiff`.
  The opcode table is `MSG_TH11`/`END_TH10` from THCRAP's `th06_msg.cpp`,
  including `OP_DELETE` for dialogue opcode 25.
- The shared compiler prepares the THCRAP PNG replacements, `spells.js`,
  `themes.js`, `musiccmt.js`, and the TH11 `stringlocs.v1.00a.js` keys.
  Every published language ZIP includes a licensed, codepoint-subset OTF
  named by its own `localization/options.json`.
- The language ZIP contains neither retail `th11.dat`/`th11.data` nor
  `msgothic.ttc`. It does not reuse any locally pretranslated game archive.

## Build and publish boundary

Use `scripts/prepare-th06-language-pack.mjs` with `--game th11`, one of
`--language lang_zh-hans` or `--language lang_en`, and explicit `--archive`,
`--thdat`, `--thmsg`, `--font-file`, `--output`, and (on Windows)
`--temporary-root` arguments. Run both languages into the same output
directory. The result is `catalog.json` and `language/lang_*.zip`.

`th11/portable/build.mjs` compiles the SDL3 Runtime with THCRAP and SDL3_ttf
support, and `th11/portable/package-eagler.mjs` produces the Launcher Runtime
directory. A Hosted build supplies the prepared language directory to
`scripts/package-server.mjs` as `--th11-language-packs`. The Host Manifest and
Package Descriptor derive the language choices from that catalog; do not
handwrite them. To make one web-importable resource-and-language ZIP, use
`node scripts/package-offline-game.mjs <assembled-site> th11 <output.zip>` and
`node scripts/verify-offline-game-package.mjs <output.zip> th11`. This uses
the same STORE ZIP producer as the earlier games and includes retail-derived
data, OGG music, both shared Launcher fonts (`msgothic.ttc` and `unifont.otf`),
and both language ZIPs. Handle it as
private game data; publication requires appropriate asset rights.

The Launcher installs and validates the selected pack before launch. The
Runtime mounts it at `/thcrap/th11/` and consults it for compiled dialogue and
endings, per-sprite PNG replacements, music titles/comments, spell names,
THCRAP string IDs, and Unicode glyphs. Missing overrides fall back to the
original game. The Launcher already maps its selected language to the common
`thpracLocale` contract (`ja` → `ja-JP`, `lang_zh-hans` → `zh-CN`, others →
`en-US`). TH11 does not yet offer a thprac adapter; this is only the shared
selection mechanism for a future adapter, not a claim that TH11 thprac is
present.

## Verification

Run `node tests/test-thcrap-compiler.mjs`,
`node tests/test-thcrap-static-pack.mjs`, and
`node scripts/verify-server-build.mjs <assembled-site>`. Serve the assembled
site locally and run `EAGLER_TEST_URL=<local-site> node
tests/smoke-th11-localization.mjs`. Set `EAGLER_TEST_MUSIC_ROOM=1` to enter the
Music Room, or `EAGLER_TEST_STORY=1` to start Stage 1. Set
`EAGLER_TEST_SCREENSHOT`, `EAGLER_TEST_MUSIC_ROOM_SCREENSHOT`, or
`EAGLER_TEST_STORY_SCREENSHOT` for visual records. The browser smoke
checks that both selected packs mount their font, image, dialogue, ending and
string tables and that the native game renders frames. It does not establish
pixel-perfect parity or exhaust every story, ending and spell branch; those
remain separate visual regression work.

Dialogue text also preserves THCRAP's runtime layout commands. TH11's
`cpp/sdl/ThcrapLayout.hpp` ports tokenization, tabstop definitions and
left/center/right alignment from `thcrap_tsa/src/layout.cpp` rather than
stripping tags during MSG compilation. Tabstops persist across lines;
`<t$Suika >` prints the name and defines its width, and `<l$>` on the next
line advances to that tabstop. Bold/italic/underline commands select a
temporary font style. Both ASCII English and UTF-8 Chinese use this path
when a language pack is mounted; Japanese without a pack keeps the original
baked-font path. This is a Runtime fix, not a change to the language ZIP.

After `node portable/build.mjs` in the TH11 repository, run
`node th11_web/tests/browser/thcrap-dialogue.mjs` there. It checks the pure
layout algorithm and renders Stage 1 dialogue for all six shots with both
prepared language packs. Its test-only probes are linked into a separate
`artifacts/thcrap-dialogue` harness, never the production Runtime. Screenshots
and `report.json` are written beside that harness.

Set `EAGLER_TEST_PACKAGE=<offline.zip>` to verify fresh-profile import and
startup in Japanese, Simplified Chinese and English. That mode blocks hosted
shared-font and language downloads and checks both shared fonts in the Runtime,
so missing fonts cannot be masked by the local Hosted site.
