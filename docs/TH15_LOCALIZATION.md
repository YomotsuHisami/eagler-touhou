# TH15 THCRAP localization (functional adaptation)

TH15 uses the existing TH10/11 boundary: official THCRAP patches → host
compiler → immutable language ZIP/catalog → validated Launcher installation →
Runtime `/thcrap/th15/` overrides. No retail translation archive is used and
the Runtime does not fetch THCRAP servers. This is functional support, not
original GDI/pixel parity or a completed all-scenes acceptance claim.

## Sources and exact title differences

- Official sources: `thpatch/thcrap`, `thcrap_tsa/src/th06_msg.cpp`,
  `layout.cpp`, and `spells.cpp`;
  `https://mirrors.thpatch.net/nmlgc/base_tsa/th15.js` and
  `th15/stringlocs.js`; `https://srv.thpatch.net/lang_zh-hans/` and
  `https://srv.thpatch.net/lang_en/`.
- TH15 uses `MSG_TH14`, not the TH10/11 opcode mapping: auto line 17;
  auto-end 7/8/9/11/32; delete 25; bubble position 28. The existing shared
  compiler preserves timecodes, wait behavior, untranslated boxes and
  inserts extra translated lines before the original box boundary.
- Endings use `END_TH10`: auto line 3, auto-end 5/6/9. Compile with
  `thmsg -e 15`, while stage scripts use `thmsg 15` and `thdat 15`.
- THCRAP's `|\tbegin\t,\tbase\t,annotation` Ruby syntax is not a pair of
  numbers. The Runtime uses measured layout widths and the TH15 +4 full-pixel
  correction from `ruby_offset_half`; original numeric Ruby remains intact.
  In the current complete English stage-patch set, three source rows mean
  one Ruby plus two ordinary rows, not a three-line ordinary bubble.
- `box_end` uses a 512 logical-pixel width cap, 19-pixel padding and 640-pixel
  logical screen. The Runtime applies that positioning calculation before
  drawing using look-ahead to the same box boundary. Text measurement is SDL
  TTF rather than GDI; equivalent font metrics are not assumed.
- Runtime JP 1.00b mounts only official `text.v1.00b.anm` as `text.anm`;
  `text.v1.00a.anm` is not substituted into a 1.00b runtime.
- Shared `th15/stringlocs.js` supplies Result and Music Room format IDs and
  full-width digits. Player Data consumes the actual THCRAP Result templates,
  not a new translated-name column format. Spell names are translated for
  display only; score, Replay, RNG and authoritative cadence are unchanged.

## Font and image ownership

Each language ZIP includes the licensed Unicode subset named by its own
`localization/options.json`. TH15 uses the existing TH11 SDL3_ttf/layout
implementation with TH15 font heights and its original point-copy raster
path. Missing tables/files fall back to the Japanese archive.

PNG patches are applied to matching sprites using the existing TH11 patch
rules, not by replacing unrelated atlas regions. Fixed-slot ASCII atlases
are deliberately excluded: TH15's ASCII text sites and `front.anm.jdiff`
have not been fully ported. Their presence in the source pack is not proof
that every HUD/Replay/Player Data ASCII string is localized.

## Preparation and publication

Use `scripts/prepare-th06-language-pack.mjs --game th15`, one of
`--language lang_zh-hans` / `--language lang_en`, and explicit `--archive`,
`--thdat`, `--thmsg`, `--font-file`, `--output`, `--temporary-root` arguments.
Use Japanese `th15.dat`. The output is `catalog.json` plus
`language/lang_*.zip`; those language ZIPs alone are **not** game-import ZIPs.

Build TH15 with `TH15_EMSDK` and
`node th15_web/scripts/build-sdl-application.mjs --release`, then
`EAGLER_FONT_ROOT=<measured-font-dir> node portable/package-eagler.mjs`.
Hosted assembly supplies `--th15-language-packs=<prepared-dir>` alongside
the existing prepared DATA/OGG and Runtime. Language choices and descriptor
entries must be derived by the existing builder, not handwritten into a site.
For a full private game ZIP use `package-offline-game.mjs` on that assembled
site and verify with `verify-offline-game-package.mjs`; its shared-font
inclusion remains the same as TH10/11. Do not publish retail data to Git.

The Launcher already derives `thpracLocale` from the selected game language
through `thpracLocaleForLanguage`. Future TH15 THPrac must consume that same
option when its capability is implemented; this change does not enable or
claim a TH15 THPrac adapter.

## Evidence and limitations (2026-10-06)

Passing: compiler/static-pack regressions; TH15 MSG/ending boundary test;
Ruby parsing/width and bubble-position formula tests; 136 stage scripts,
3,489 lines and 51 Ruby annotations in the synthetic-metric interpreter lane;
production Runtime startup and Music Room screenshots in ja/zh-hans/en;
Hosted package identity/manifest validation and Launcher TypeScript build.
The real assembled Launcher browser lane also passes Japanese, Simplified
Chinese and English selection, pack installation and production startup.

Prepared private language ZIP identities:

- `lang_zh-hans.zip`: 11,541,369 bytes;
  SHA256 `70ad5930a6fbe4b5d77cc1354630beffcf8b40d564e5573b2e88c486cca66b7e`.
- `lang_en.zip`: 13,710,043 bytes;
  SHA256 `618549090eb0d290b8e3a4e78a2d0a77a67ca9af415dcde37c0433a67809a2d5`.

2026-10-07 superseding English ZIP: 13,758,224 bytes; SHA256
`9a081d4f52e4f7a80f7fc0635cd2647dc92c1354855dadeed6834d1bd1441814`.
The client previously applied font-provider preference to ordinary game
artwork/tables, preventing the language leaf from overriding script_latin.
That preference now applies only to font options; the English Player Data
result00.png and ordinary tables use dependency-to-leaf precedence. Covered
by `tests/test-thcrap-patch-precedence.mjs` and production screenshots.
The real stage renderer also verifies the formerly omitted measurement bridge
with Sanae's Chinese/English Seiran dialogue and ruby; synthetic interpreter
tests alone did not exercise this intermediate scene service.

Not yet proven: all endings/long lines, physical mobile rendering, original
GDI visual parity, every HUD/Replay ASCII string, full `front.anm.jdiff`
semantics and a full resource+OGG import bundle. The local validation site
was deliberately built without OGG and is not a complete game package.

## Promotion — 2026-10-07

Launcher changes were rebased by fast-forwarding the experiment to origin/main
`f1d31d1` and restoring the topic. A generated multiplayer-guide conflict was
resolved by rebuilding from the updated Markdown source, not by restoring the
old HTML. TH15 is now visible in ordinary builds, with languages and high-refresh
options enabled; TH20 remains test-only. THPrac remains disabled.

Compiler/static-pack, patch precedence, TH15 MSG/ending boundary, catalog and
ordinary/test card browser gates pass. Private full import bundle (retail data,
18 OGG tracks, both language ZIPs, msgothic and Unifont) passed package hash checks;
retail resources and private build products are not committed. No remote website
deployment is included. A reported Music Room crash was interrupted before
reproduction; production-protocol Music Room smoke passes, but that report is
not represented as resolved or exhaustive browser acceptance.
