# Mouse hold-drag and multiplayer options — 2026-09-26

Mouse covers now require a 300ms hold for direct horizontal dragging. Native link/image drag and text selection are disabled within rails; pointer capture, release click suppression and cancellation cleanup preserve ordinary select-then-open clicks. Native CUA mouse tests passed: horizontal wheel left the rail at 0; held left drag reached 120.3px; reverse drag returned to 0; release left Tools closed and selection empty; vertical wheel moved the page by 179.95px without panning the rail. Subsequent short clicks still selected 07 and then opened it. Added the held-cover/wheel regression to the existing browser test entry point; equivalent native interactions were run through CUA, not the standalone Python test runner.

Multiplayer now reuses the single-player option rows, typography and palette, with unboxed groups, no red guide bars, no blur and capsule actions. Room entry comes before settings. Per the final correction, the outer Settings fold defaults closed. Inside it, shared single-player preferences and Watch Replay are direct top-level controls before files, advanced and touch groups. Desktop touch defaults closed/last; mobile touch defaults open before the other subgroups, after those two top-level controls. Existing room drawer mounting and multiplayer action IDs remain intact.

CUA verified desktop fold defaults and expanded control order, advanced expansion without clipping, and 390px mobile layout without horizontal overflow. Screenshot: `.cache/library-qa/multiplayer-options-final.png`. Local preview has no configured relay or game runtime, so live room creation/join, replay playback and cross-device acceptance are not claimed. Launcher build, product surface, multiplayer preferences and lifecycle checks passed; diff whitespace check passed.

# Approved options panel implementation — 2026-09-26

Status: passed for the requested launcher UI scope. No unresolved P0/P1/P2 visual findings.

Reference: `C:/Users/Ritosa/.codex/generated_images/01a0dcef-590c-78e3-b2e5-ef241acafc15/exec-49e901be-d32c-4130-b350-6646384f8b84.png`.
Compared reference and rendered desktop/mobile panels together in `.cache/library-qa/options-approved-comparison.png`.
Evidence: `.cache/library-qa/options-desktop-final.png`, `.cache/library-qa/options-mobile-final.png`, and untouched `.cache/library-qa/options-mobile-raw.png`.
The browser's mobile capture painted at half scale in its output canvas; the normalized mobile evidence crops that painted region and doubles it. Layout sizes were separately measured from the DOM.

Implemented the actual existing card artwork, bottom-only cover fade, circular back control, original site number font, site charcoal/paper/vermilion palette, three unboxed groups, default-open touch/files and default-closed advanced settings. Removed the visible top-right game title while retaining its accessible label. Kept notice text, credits and repository link in a compact expandable notice. Existing settings IDs and action handlers remain owned by the launcher.

Responsive review: desktop 1280×720, phone 390×844, small phone 360×640. No horizontal document overflow on either phone size. The desktop and standard phone show all three group headers. Small phones scroll only the middle settings area. At desktop, scrolling the expanded advanced group left the footer unchanged at y=623.8–703.8. Footer background is transparent, all four touch rows have 0px borders, and panel/backdrop/content/footer compute filter and backdrop-filter to none. The shorter desktop cover and number preserve room for the settings and fixed actions at 720px height; the larger phone cover uses the available height. Typography intentionally reuses the site's existing fonts rather than the mockup's generated lettering.

CUA checks passed: selecting a different numeric item does not open the panel; second activation opens it; Escape closes it and restores focus to its card; touch and file groups collapse/reopen; advanced settings expand and scroll; import opens its existing window; touch enable opens its existing replay-compatibility confirmation (cancelled); multiplayer settings still expand and keep their original controls. Replay management opens, but the preview lacks game runtime files and reports a read failure, so replay loading and actual game launch are not claimed as verified.

Validation: `npm run build:launcher`, `node tests/test-product-surface.mjs`, `node tests/test-launcher-lifecycle.mjs`, and `git diff --check` passed. No commit, push, or deployment performed.

# Select before opening Tools, no blur — 2026-09-26

Both number navigation and cover cards now select a different title on first
activation. Only activating the current title opens Tools. Long-press browsing
and its release suppression remain intact. Updated localized assistive copy.

Tools now uses the existing panel/ink/paper/red tokens for its surface, controls,
switches and primary action. Removed the blue-tinted blurred backdrop and the
extra whole-library brightness filter; a neutral translucent overlay provides
separation without blur. Native mouse checks via CUA passed: 07 number first
click selects, second opens TH07; after returning, 08 cover first click selects,
second opens TH08. Computed filter and backdrop-filter are `none` on Tools,
backdrop and game library. Desktop screenshot inspected; no browser errors.

# Single-row persistent selection — 2026-09-26

User removed the upper named menu. Deleted its generated markup, styling and
gesture branches; held scrubbing now uses only the lower number row. Keyboard
Left/Right/Home/End previews the corresponding card directly.

The pale background now belongs only to `.is-current`, including after release.
Removed the pressed-origin background and competing candidate selection state.
Native mouse verification via CUA: hold 06, move to 07 with vertical drift;
while still held, 06 computed transparent and only 07 had #f1e4e6. Release kept
07 highlighted without opening Tools. The upper panel count is zero. Screenshot
inspection confirmed the single navigation row and persistent 07 selection.
Build, product-surface and launcher lifecycle checks passed; diff check passed.

# Desktop held-number scrubbing correction — 2026-09-26

User clarified the failing gesture: desktop mouse held on the lower numbers.
The prior check did not cover early movement or leaving the exact button boxes.
This follow-up supersedes the earlier broad gesture acceptance claim below.

- Capture the active pointer on the pressed number until release/cancellation.
- Horizontal intent starts scrubbing even before the 350ms timer; it no longer
  cancels the hold after 10px of movement. A stationary hold still opens names.
- Map horizontal position to nearest choices continuously across gaps, with
  vertical tolerance. Reversing direction updates the large-card preview.
- Remove the weaker library number shadow override, restoring the original
  two-layer black text shadow while retaining ET Yatra and current sizing.

Verified in the local 1280 x 720 preview with native CDP mouse input via CUA:
held 06 → 10 with 36px vertical drift → 06 → 08; release retained 08 without
Tools. Immediate press-drag-release selected 10 without Tools. A fresh short
click opened TH07 Tools. Computed number font and original two-layer shadow
were checked. The tracked browser regression now covers held and immediate
drags, reverse travel and drift; this session's execution used CUA, not that
standalone regression runner. No real-phone verification claimed here.

# Site identity and immersive library correction — 2026-09-26

final result: passed

This revision supersedes the lavender / system-font direction below. User feedback
requires the original site palette and distinctive number font, quieter controls,
short press for Tools, and long press for rapid title browsing.

## Resolved findings

- P1: removed all library overrides of `--ui-font`, `--art-font`, and
  `--red-bright`. Large numbers again use ET Yatra at 52px / 42px. Menus and Tools
  use the existing neutral #191a17 surface; pressed states reuse #f1e4e6 / #b33142.
- P1: short click/tap now enters the corresponding existing Tools action.
  A 350ms hold opens named choices. Held movement across either the original
  numbers or the menu changes the large-card preview. Release commits without
  opening Tools; a fresh short tap works immediately after the hold.
- P1 found in real mouse QA: focus transfer could close a menu between down and
  up. Directory pointerdown now retains focus until click; focusout respects
  relatedTarget and waits until focus transfer completes. Retested real mouse
  menu click: 08 selected, Tools remains closed. Synthetic-only verification
  did not expose this bug and was not used as its final acceptance evidence.
- P2: removed the small-index lift and underline, decorative menu staggering
  and lavender surfaces. Feedback now uses the site's quick press compression,
  tonal state color, and 200ms menu entrance. No idle navigation backing plate.
- Reduced visual competition: removed shelf captions, darkened the existing
  background overlay, gave covers slightly more height, and kept unselected
  art quieter. No extra preview, page, or artwork was added.

## Visual evidence

Viewed before/current images together in `.cache/library-qa/site-desktop-comparison.png`
and `site-mobile-comparison.png`. Mobile is CSS 390 x 844, captured in a 0.8 stage
and normalized; both mobile shelves select 08. Desktop first-shelf comparison
selects 08 at 1280 x 720; crop excludes app chrome and the captures have different
vertical scroll offsets, so card/navigation content is the comparison surface.
`site-hold-menu.png` and `site-tools.png` capture the other interaction states.

Typography: original identity restored, title legibility preserved, no wrapping
regression. Layout: stable two-row library, 44px number hit areas, unchanged
floating Tools ownership. Colors: original site accent and neutral surfaces.
Images: original cover files and crops remain, darker background reduces visual
competition. Copy: real localized titles retained; action explanation is assistive
text only. No unresolved P0/P1/P2 findings in this correction scope. Perceived
immersion remains a design preference for the user to judge in the preview.

## Verification

Build, product-surface contract and launcher lifecycle checks passed. Actual mouse
short click opens TH10 Tools. Actual held horizontal drag previews TH08 without
Tools, then releases successfully. Actual menu click verified after the focus fix.
The 390px browser fixture covers font/palette inheritance, hover, short tap,
held sliding, no repeated motion for the same candidate, release click suppression,
immediate subsequent tap, stationary menu selection, cancellation, geometry,
overflow and reduced motion: all passed. Console errors: none in the final tab.
No real-phone touch claim and no gameplay/runtime or live-relay acceptance claim.
No commit or deployment performed.

## Previous revisions (superseded)

# Launcher numbered library QA — 2026-09-26

final result: passed

## Latest revision: option 1, with Shirone / Mizuki styling

The selected reference is `exec-0a48f958-b2a6-48d4-a13d-a7c38a81ba82.png`
(1672 x 941 design board). The user's later styling direction explicitly modifies
its surfaces and typography. Inspected the official live Shirone and Mizuki sites,
and Shirone's DESIGN.md. The mock's board labels and presentation frame are not app UI.

### Findings resolved

- P2: the removed hint briefly remained visible because there was no shared
  screen-reader-only utility. The hint now has a scoped visually hidden rule.
- P1: proximity snapping swallowed small vertical-wheel deltas converted to
  horizontal movement. Removed CSS snapping from free scrolling; index selection
  owns one cancellable eased animation. A 70px wheel delta now advances the rail.
- P2: legacy mobile rules disabled number transitions. Library typography has
  explicit motion rules, with verified zero-duration reduced-motion overrides.
- No open P0/P1/P2 findings in this UI scope.

### Visual comparison

Opened source and implementation together in
`.cache/library-qa/number-mobile-comparison.png` and
`.cache/library-qa/number-desktop-comparison.png`.
The mobile comparison shows both shelves selecting 08 at scrollTop 0, CSS viewport
390 x 844. Its iframe stage is displayed at 0.8 scale and normalized to 390 x 844;
the screenshot's browser raster introduces a small additional scaling difference.
Desktop comparison isolates the first shelf with 08 selected at 1280 x 720.
The mock is a design board, not a specified browser viewport, so exact pixel
identity is not claimed. Its mobile content crop is 406 x 806 and normalized for
composition comparison. Focused menu and tools evidence is in `number-menu.png`,
`number-desktop-tools.png`, and `number-mobile-tools.png` in the same directory.

- Typography: preserved the brand asset; rounded site sans for UI and clean
  tabular numerals. Large numbers are 52px desktop / 42px mobile. Selected number,
  title and subtitle respond together. Titles remain readable without wrapping.
- Layout rhythm: two horizontal shelves, bare 44px-hit-area numeric indices,
  no visible navigation caption or container. 22–24px card radii and a 24px menu
  follow the later rounded theme direction. Short desktop viewports use shorter
  cards; rail arrows remain as an explicit alternate navigation affordance.
- Color/tokens: soft lavender primary, dark plum menu/sheet surfaces, tonal
  controls and restrained shadows replace per-game swatch colors. The real
  launcher background is preserved; its busier texture is a P3 polish option.
- Assets: existing catalog-owned covers are retained, correctly cropped, with
  no miniature images, placeholders, duplicate artwork preview or generated art.
- Copy/content: existing real product titles, subtitles, availability and
  localization retained. The hold explanation remains assistive text only.

### Verification

- `npm run build:launcher`, `node tests/test-product-surface.mjs`, and
  `node tests/test-launcher-lifecycle.mjs`: passed.
- Browser fixture evidence: `.cache/library-qa/number-interactions.txt`.
  Hover is inert; hold/cancel/move/outside/blur lifecycles pass; held sliding only
  marks a candidate and release selects once; animated offsets are monotonic;
  no second corrective jump; keyboard focus does not select; wheel movement
  works; mobile tools preserves all shelf geometry and stays inside viewport;
  close restores focus and scroll offset.
- Real browser mouse hold, move and release verified separately. Reduced-motion
  UI setting gives number transition duration 0s and immediate positioning.
  Browser console error list was empty. Native touch momentum still needs a
  physical-device check; synthetic touch lifecycle testing is not that check.
- This is frontend preview validation using real art and a local host-manifest
  fixture. Game binaries / live relay launching are outside this UI check.
  No commit, publication or deployment performed.

## Previous UI iterations (superseded)

# Launcher library layout QA — 2026-09-26

final result: passed

Latest revision: abstract palette navigation and floating settings sheets.
This supersedes the thumbnail navigation and in-flow settings layout below.

## Current revision — palette and settings feedback

The user's latest direction replaces miniature covers with abstract local color
samples, uses the large cards as the only artwork preview, and requires tools
to enter smoothly without disturbing the library.

- Sampled the central cover regions of TH06, TH07, TH08 and TH10 and declared
  three colors per title in the product catalog. CSS renders abstract swatches;
  the navigation contains no images. Unavailable TH09 retains a neutral fallback.
- The small dock highlights the corresponding card. Hover/focus previews and
  scrolls it into view. A 420ms mouse/touch hold expands the named choices;
  moving while held previews another title and release confirms it. A simple
  tap previews; keyboard Enter/arrow keys provide an equivalent menu path.
- Large-card lighting, border color, dock state and menu selection are linked.
  No separate preview panel was introduced. Menu entrance, press and collapse
  retain soft motion, disabled by the reduced-motion preference.
- Settings is a fixed sheet with a fading backdrop: from the right on desktop,
  from the bottom on mobile. Short menus fit their content; long menus scroll.
  The library is inert while open, Tab cycles through the sheet, Escape/backdrop
  returns to the selected card, and nested select Escape closes that select.

### Evidence and fixes

- Current paired comparison: `.cache/library-qa/palette-comparison.png`, with
  the prior thumbnail implementation on the left and current palette on the
  right, inspected together. Desktop: `palette-desktop.png`; mobile:
  `palette-mobile.png`; settings: `palette-desktop-tools.png` and
  `palette-mobile-tools.png` in the same directory.
- Desktop rail dimensions were unchanged by opening tools: width 1180.58px,
  height 228.88px, with unchanged x/y. Mobile rail dimensions were unchanged:
  width 361.95px, height 273.22px, with unchanged x/y.
- [P1, fixed] Explicit mouse capture lost the held choice in the embedded
  browser. Document-level move/up ownership now follows the held pointer across
  menu elements. Real browser mouse-down, held movement to TH10 and release
  confirmed the TH10 card focus, closed the menu and did not open settings.
- [P2, fixed] Viewport-width sizing and the reserved scrollbar offset a mobile
  sheet by 2px outside the page. Percentage sizing restores 8px side margins.
- [P1, fixed] A more-specific multiplayer selector suppressed the sheet's open
  state. Corrected specificity and checked both desktop and mobile MP sheets:
  opacity 1, return visible, and mobile panel within the viewport.
- Synthetic touch checks passed: short/long hold, release, movement and cancel,
  outside press, blur, held-slide preview, confirmation, no accidental launch,
  hidden menu inertness and no horizontal overflow. The same fixture passed
  tools geometry, bounds, inert background, return focus and retained rail offset.
- Browser checks also covered mobile import-dialog access, repeated settings
  opening, multiplayer Tab wrapping and Escape. No application console errors.
- Reduced motion produced 0s transitions for both navigation and tools.
- Launcher build, product-surface and lifecycle checks, and whitespace validation
  passed. Standalone browser regression scripts were updated, not executed.

No remaining actionable P0/P1/P2 findings in the inspected current states.
Physical touch feel, Runtime launch and live relay remain unverified by this
UI-only preview. No commit, push or deployment was performed.

## Previous revision — thumbnail navigation

- Removed the All / Original / Multiplayer filter UI, its persisted preference
  handling and its layout reservation. Both available shelves remain visible.
- Replaced visible rail scrollbars with frosted-glass thumbnail capsules.
  Mouse hover, keyboard focus, tap or a 420ms touch hold opens the navigation.
  Thumbnail selection scrolls to a game without launching it.
- Added spring-shaped expansion, staggered thumbnail entrances, hover lift,
  pressed feedback and animated collapse. Reduced-motion settings disable these
  transitions (verified computed duration: 0s).
- Current desktop evidence: `.cache/library-qa/minimap-desktop.png`.
  Mobile 390px evidence: `.cache/library-qa/minimap-mobile.png`.
  Joint PS reference/current implementation board:
  `.cache/library-qa/minimap-comparison.png`, inspected side by side.
- Desktop hover opens the panel, moving away closes it, and selecting TH10
  reaches the rail end without selecting a product. Mobile thumbnails stay
  inside the shelf; no document horizontal overflow was measured.
- An authored browser fixture exercised the production module with synthetic
  pointer events: short hold, 420ms hold, release, movement cancellation,
  pointer cancellation, outside press and blur retirement all passed. Touch
  thumbnail selection scrolled to the last game, closed the panel and left it
  inert. These checks validate event handling, not physical iPhone input.
- Launcher build, product-surface checks, launcher-lifecycle checks and
  `git diff --check` passed. Updated browser regression scripts were not run as
  a standalone suite; the interactive browser checks above were run instead.

No remaining actionable P0/P1/P2 findings in the inspected revision. Runtime
launch, live multiplayer and physical-device gesture acceptance remain outside
this isolated UI preview. No commit, push or deployment was performed.

Scope: the launcher library, selection/settings presentation and browsing interactions.
This is not a Runtime, real-device, offline or public-network acceptance result.

## Visual target and evidence

- User reference: `C:/Users/Ritosa/AppData/Local/Temp/codex-clipboard-3b98ad4f-18ef-428b-9e09-c504e9ee9e10.png` (3840 × 2160).
- Local preview: `http://127.0.0.1:28131/eagler-touhou/`.
- Desktop, 1280 × 720 CSS viewport: `.cache/library-qa/desktop-final.png` (1270 × 714 captured pixels).
- Joint reference/implementation comparison: `.cache/library-qa/comparison.png`. Reference scaled to the desktop capture dimensions; both represent the browsing state. The highlighted implementation card is hovered, not launched.
- Mobile, 390 × 844 CSS iframe viewport: `.cache/library-qa/mobile-full.png`; cropped viewport evidence `.cache/library-qa/mobile-normalized.png`.
- Desktop multiplayer settings: `.cache/library-qa/desktop-multiplayer.png`.
- Mobile single-player settings: `.cache/library-qa/mobile-settings-full.png`.

The in-app browser's full-page export captured content at half scale inside a
larger canvas. The mobile viewport was cropped from that export and normalized
from 195 × 422 to 390 × 844 for comparison. The final desktop evidence uses the
normal viewport screenshot API, which does not have that export artifact.
DOM measurements independently confirmed viewport and scroll geometry.

## Intentional adaptation

The reference supplies art-led cards, dark background, horizontal shelves and a
visible focus outline. The requested product uses two shelves instead of one.
Existing Touhou artwork, fonts, game names, settings, product routing and
localization remain authoritative. Desktop cards are shorter to fit both shelves
at 720px height. The reference's Astro artwork, trophy percentages and news feed
are not part of this launcher's requested content.

## Findings and comparison history

1. [P1, fixed] Legacy selection CSS squeezed unselected games into narrow strips.
   Scoped legacy game geometry away from `.library-layout`, disabled its obsolete
   FLIP transition and kept equal card widths. Reopened selection in the browser;
   the corrected multiplayer screenshot shows readable cards on both shelves.
2. [P2, fixed] Initial desktop cards pushed the bottom shelf beyond a 720px screen.
   Reduced desktop card height and corrected grid row allocation. Final measured
   shelf bottoms: approximately 405px and 718px. The joint comparison shows both
   game rows, with the next card exposed at the right edge.
3. [P1, fixed] Deferred multiplayer CSS hid the new return button and widened the
   panel beyond its grid column. Exempted `.library-back` from that hide rule and
   constrained the multiplayer panel to its column. After rebuilding/reloading,
   measured panel width was 360px and back-button height 38px; clicked return on
   desktop and in the 390px mobile view successfully.

No remaining actionable P0/P1/P2 findings in the inspected launcher states.

## Required fidelity surfaces

- Typography: existing local Chinese UI and display fonts; game names remain
  readable on every inspected complete card. English subtitles are secondary.
- Layout: two independent shelves; stable dimensions after selection; desktop
  side panel and mobile dedicated settings view. No document horizontal overflow
  at 390px (document width 380px including the scrollbar allowance).
- Color: dark existing artwork backdrop, bright titles, muted secondary text and
  a clear light hover/selected outline. Settings retain their established colors.
- Assets: actual catalog-owned Touhou cover images, no replacement illustrations
  or approximated icons. Poster cropping preserves existing focal positions.
- Copy: localized single-player/multiplayer headings, pagination and return action.
  The product's existing titles and functional settings remain in place.

Focused inspection used the mobile crop and multiplayer settings screenshot for
title wrapping, card focus and return-button visibility; these are easier to read
than the reduced full comparison board.

## Interaction and validation evidence

- Wheel over a mobile-width shelf changed horizontal scroll from 0 to ~512px
  without selecting a game; the other shelf remained independent.
- Next-group control reached the far end (~671px); keyboard End focused the last
  visible game and Enter opened its settings.
- Single-player and multiplayer selection resolved to the expected title/mode.
- Return restored the library and focus; verified for both modes on mobile and
  for multiplayer on desktop.
- Initial iteration only: category filtering was verified; it has since been
  removed at the user's request (see latest revision above).
- `npm run build:launcher`: passed, including TypeScript compilation.
- `node tests/test-product-surface.mjs`: passed, including each catalog product's
  membership in its correct shelf.
- `node tests/test-launcher-lifecycle.mjs`: passed.
- `git diff --check`: passed.
- Final browser console: no application errors; expected Service Worker warning
  because this isolated UI preview intentionally does not serve the worker.

## Remaining acceptance limits

The normal development server could not start because its configured TH06 DATA
file is absent. The UI preview uses cached host metadata and real local artwork;
it has no live multiplayer relay and does not validate game launch/downloads.
Touch uses native browser overflow scrolling. The available in-app browser does
not support trusted touch dispatch. Synthetic DOM pointer lifecycle checks pass,
but physical iOS/Android swipes and inertia still require device testing.
No commit, push or deployment was performed.

## Multiplayer room integration (2026-09-26)

Merged the room worktree with the current library UI from the common base, then integrated the reviewed result into this checkout. The existing library layout, cover crop, MULTIPLAYER badge, card interaction and game-library module remain in place. The room retains its layout and uses the library palette and shared option-group, switch and launch-action rules. The same settings fold and cover header move between the menu and room; the menu fold is collapsed by default, with shared settings and Replay/import at its top.

Occupied seat avatars show only the first character of the participant's chosen display name, or `?` when absent. The adjacent game loadout remains visible. Local relay browser verification displayed 琪 for a named peer and ? for an empty name; no full nickname appeared in the seat label. The Launcher also limits the `name` field of outgoing lobby messages to that first character; an absent name stays empty on the wire.

Checked menu → room → settings → menu at desktop and 390×844 portrait. The settings fold and cover had one instance before, during and after the room; disclosure state survived the move. Replay button computed font, color, corner radius and shadow matched in both locations; the mobile room settings scroller had equal client/scroll width (373px). Library launcher build and relevant DOM, i18n, identity, product, preference, network and relay tests pass. Two temporary QA players were removed from room 9419. No physical device acceptance was performed.


---

# Launcher directory layout — 2026-09-28

final result: passed

## Scope and visual targets

This review checks the user's annotated layout changes, not a pixel-for-pixel copy of the old layout shown underneath the annotations.

- Desktop source: `/tmp/codex-clipboard-fc40d4ca-3e58-4010-85c6-8630c85b16b8.png` (2222 × 1810). Red means one vertical game directory; blue means the selected game's launcher.
- Portrait source: `/tmp/codex-clipboard-3ce7e863-bf95-4d9a-8f06-52775498ada4.png` (857 × 1592, including browser frame). Red is the top directory; blue is the launcher below.
- Desktop implementation: `launcher-desktop.png`, 1750 × 1425 capture from 1760 × 1433 CSS viewport. TH07 selected, solo mode.
- Portrait implementation: `launcher-mobile.png`, 380 × 822 capture from 390 × 844 CSS viewport. TH07 selected, solo mode, settings collapsed except save/replay.
- Comparison evidence: `desktop-comparison.png` and `portrait-comparison.png`. Desktop full frames are normalized to equal height. Portrait reference is cropped to its page content (85,21–752,1498), then normalized to the implementation's capture width. The screenshots have different original display scales; compare layout regions and existing visual tokens, not raw pixel distances.

## Findings and corrections

No remaining P0/P1/P2 layout findings in the reviewed states.

1. Desktop directory initially inherited a column layout inside each entry, clipping subtitles. Explicit row layout corrected it; final desktop capture shows five distinct entries.
2. The existing multiplayer stylesheet initially hid the new mode toolbar. The toolbar is now excluded from that hiding rule; solo and multiplayer remain reachable in both directions.
3. The first narrow layout inherited a negative rail margin and squeezed the launch action. The margin was removed. The user's later portrait request replaces this narrow two-column arrangement with a horizontal top directory and full-width launcher; final portrait comparison verifies the new arrangement and single-line launch label.
4. Existing selection routing replaced history entries. Directory selection now uses the existing launcher-options history helper, preserving Back navigation between games and modes.
5. During development an old preview process retained a stale bundle-file inventory. Restarting the preview fixed the temporary load failure. Final browser console inspection reported no errors.

## Required visual surfaces

- Typography: existing UI and display fonts retained; game names, directory heading, settings, and actions have clear hierarchy. Small English subtitles are retained on desktop and omitted from compact portrait cards.
- Layout: one directory, five entries; desktop left/right, portrait top/bottom. Settings use natural vertical page scrolling; portrait cards scroll horizontally within the directory. No document overflow at 320, 390, 768, or 1760 CSS px.
- Colors: existing dark surfaces, pale text, red primary action, and pale-pink selected state retained.
- Assets: catalog-owned cover art and existing launcher background retained. Preview artwork is downloaded into the ignored `.cache/frontend-preview` directory, not committed as source.
- Copy: directory, mode, and launcher labels have Chinese and English messages. Existing settings and controls retain their owners.

Focused review: the portrait comparison is large enough to inspect the directory labels, selected state, mode control, save/replay actions, and launch button. The desktop screenshot was also inspected independently. Extra close-up crops were unnecessary.

## Validation

- Launcher TypeScript build: passed.
- Product surface, route-state, and game-preference tests: passed.
- Whitespace/diff validation: passed.
- In-app browser: single-click game selection, both mode directions, browser Back, advanced settings expansion, reversible frame-limit toggle, vertical/horizontal keyboard navigation, and selecting TH10 through the horizontally scrolling directory passed.
- Portrait widths 320, 390, 768 and desktop 1760 checked through rendered geometry; no horizontal document overflow.
- The browser regression file was updated for the new layout; its standalone Python runner was not executed. Equivalent interactions were verified in the in-app browser.
- Full repository gate is not green: runtime-build-profiles fails on TH10 multiplayer registry mismatch; i18n fails on the existing `nav.lessMotion` selector expectation. Both were reproduced from an untouched HEAD export.

## Limits

This is a frontend preview. Local game runtimes/data and a multiplayer relay are not configured, so actual gameplay, imports/exports with real saves, and room connections were not validated. Production deployment and offline update behavior were not tested.

## Implementation checklist

- [x] Single shared game directory.
- [x] Persistent launcher and mode selection.
- [x] Portrait horizontal directory above full-width launcher.
- [x] Desktop vertical directory beside launcher.
- [x] Keyboard, history, responsive and visual verification.

final result: passed


## 2026-09-28 — Square cover cards and transparent labels

final result: passed

Scope: user's square-card request and follow-ups preserving original fonts and removing black title/number backgrounds.

- Cover art uses `contain` in the upper three quarters of each square card. Number and title occupy the remaining quarter, with transparent backgrounds; their bounds do not overlap the artwork.
- Original font families retained. Desktop number/title sizes are 28/20 px; portrait sizes are 25/16 px.
- Selected scale is 1.16 on desktop and 1.12 in portrait. Desktop mouse proximity adds up to 0.12 with a smooth neighbor falloff; portrait has no wave.
- Browser verification at 1179 × 1035: square 160 px base cards, transparent card/title/number backgrounds, full cover containment, selected card larger. Pointer near TH07 produced waves 0.0210/0.1198/0.0140/0/0; leaving the directory cleared all wave properties and restored scales 1/1.16/1/1/1.
- Portrait 390 × 844: square 132 px cards, selection updates launcher to TH07, horizontal directory, no wave properties, original fonts. At 320 px there was no horizontal document overflow.
- Final screenshots inspected: `square-directory-desktop.png` and `square-directory-mobile.png` in the task outputs folder. Compared against the supplied directory reference: rectangular cropped cards are now square with full art, labels below, and larger selection. Existing launcher style retained.
- Launcher build, product-surface test, and diff whitespace check passed after the final CSS changes. Earlier route-state/game-preference checks passed. Full-gate baseline limitations and frontend-only runtime limits remain as documented above.
- Preview module resolution now supports rebuilt hashed modules; refreshed preview successfully loads.

No remaining visual blockers in the reviewed desktop and portrait states.

final result: passed


## 2026-09-28 — Compact directory spacing

Desktop card gap reduced from 24% to 17% of card size (38.4 to 27.2 px at the reviewed viewport); portrait gap reduced from 20 to 14 px. Directory scrollbars are hidden via scrollbar-width and the existing WebKit rule, while overflow remains scrollable. Browser confirmed scrollbar styles are none and wheel scrolling changes the directory offset to 114.29 px. Launcher rebuild and diff check passed. Screenshot: compact-directory.png in task outputs.

final result: passed


## 2026-09-28 — Labels over cover artwork

User clarified that labels should sit directly on the artwork. Number moved to the top-left; Chinese title and visible smaller English name are stacked near the bottom. Removed the separate footer area: artwork now fills the square via centered cover sizing, which crops the sides of 4:3 originals. No background panels or dark cover overlays; only a small text shadow for legibility. Font families, compact spacing, hidden scrollbars, selection scale, and desktop wave behavior remain.

Desktop and 390 px portrait screenshots reviewed (cover-labels-desktop.png and cover-labels-mobile.png in task outputs). All five subtitles display and fit their text containers; computed title backgrounds are transparent and artwork pseudo-overlays are absent. Portrait has no horizontal document overflow. Build and diff check passed. Browser regression expectation updated to cover sizing; standalone runner not executed.

final result: passed


## 2026-09-28 — Desktop placement and edge scrolling

Launcher uses measured panel height for a centered desktop top offset, then moves 28 px upward per user follow-up. Tall panels retain a 24 px top margin. Desktop rail height and bottom spacing are reduced to bring credits/site links higher without overlapping the launcher. Portrait rules are unchanged.

Desktop mouse proximity within 72 px of the visible rail edge scrolls continuously, up to 360 px/s. Animation frames stop at boundaries or pointer leave/cancel, blur, resize, hidden document, or disabled motion. Existing wave scaling tracks cards as they scroll. Browser verification moved the directory from 0 to 114.29 px at the bottom edge and back to 0 at the top; portrait resets wave properties and keeps a relative panel. Final desktop geometry at 1179 × 1035: launcher top 129.71 px, height 720 px; footer top 971.43 px, with credits visible in the initial viewport. Build and diff check passed. Screenshot: raised-launcher-footer.png in task outputs.

final result: passed


## 2026-09-28 — Full-viewport centering clarification

Removed the extra 28 px upward offset. Desktop panel centering uses the full viewport height without adding header height. Footer spacing remains compact. At the top of the 1035 px viewport, verified panel top gap 157.71 px and bottom gap 157.29 px (rounding difference below 1 px). Build and diff checks passed. Screenshot: viewport-centered-info.png.

final result: passed


## 2026-09-28 — Full-height directory and taller launcher

Desktop directory heading now overlays the rail without reserving vertical space. Header height is measured and the rail extends from its bottom to the viewport bottom. Removed the generated directory hint. Desktop launcher minimum height increased from 720 to 820 px; center offset +72 px moves the panel top from 157.71 to 179.71 px at the reviewed 1035 px viewport. Rail top 62.57 px exactly matches header bottom and rail bottom is 1035 px. Heading stays in its previous region and may overlap covers as requested.

Portrait 390 × 844 retains a static heading, 162 px horizontal rail, content-sized panel, and no horizontal page overflow. Build, product-surface check, and diff check passed. Final screenshot: expanded-directory.png.

final result: passed


## 2026-09-28 — Initial directory inset and unified right column

Added 124 px of scrollable top padding to the desktop rail: cards start below the visible heading text but can scroll into that region. Rail clipping bounds still run from header bottom to viewport bottom. Desktop directory is positioned independently so it no longer determines the right column height. Footer moved into the main grid below the launcher; portrait places it in row 3. Removed obsolete panel-height measurement.

Browser: desktop panel starts at 86.57 px, 24 px below the header, and footer at 934.57 px after the 820 px panel. Scrolling moves the first card from below the heading to top 87.49 px, above the heading text. Portrait footer follows the panel by 16 px, without document overflow. Final screenshot: header-aligned-workspace.png. Launcher build, product-surface check, and diff check passed.

final result: passed


## 2026-09-28 — Directory heading avoidance

Desktop heading and subtitle slide left and fade when a card approaches their text area, then return when clear. Collision checks include scaled cards, scroll events, resize, and selection changes. An 8 px entry threshold and 18 px return clearance avoid flicker; reduced-motion mode switches without animation. Portrait does not hide its heading.

Browser verified initial scroll 0: heading visible / opacity 1; scroll 86.29 px: heading slid out / opacity 0; return to scroll 0: heading visible / opacity 1. Screenshots: directory-heading-hidden.png and directory-heading-restored.png. TypeScript launcher build and diff check passed.

final result: passed


## 2026-09-28 — Keyboard and portrait swipe selection

Desktop Up/Down now activate the neighboring game immediately, with repeat suppression. Input/select/editable controls, modal dialogs, active play and rooms are excluded from the global shortcut. Portrait pointer gestures on the directory and launcher cover activate the next game on left swipe and previous on right swipe, requiring 40 px horizontal movement and directional intent. Native vertical scrolling stays enabled; cancelled gestures and post-drag clicks do not select accidentally. Native image dragging is suppressed in portrait gesture surfaces.

Browser verified desktop body ArrowDown TH07→TH08 and ArrowUp TH08→TH07, portrait cover right-swipe TH07→TH06, and directory left-swipe TH06→TH07. Portrait gesture verification used browser pointer drags, not physical touchscreen hardware. Build and diff checks passed. Screenshot: swipe-game-selection.png.

final result: passed

## 2026-09-28 — Global launcher settings and score-file inspection

Moved Advanced and Touch controls into a native modal opened immediately before reduced motion in the header. Removed duplicate multiplayer settings and moved its visibility preference into the same global surface. Global preferences migrate once from the current legacy selection; saves/replays remain product-specific. Desired thprac preference is retained, while runtime options, touch controls and thprac-only font preflight require explicit capability and single-player mode.

Browser verified cross-game frame-limit persistence (TH07 to TH06, original value restored), modal custom-select interaction, desktop expanded sections, and portrait 390×844 layout without horizontal overflow. Multiplayer fold now contains only replay/import and save/replay tools. Screenshots: global-settings.png and global-settings-mobile.png in task outputs. Launcher build, global-preferences tests, existing preference tests, product-surface tests and diff checks passed. Capability tests include unsupported/missing flags and multiplayer fallback. Actual unsupported Runtime launch was not tested; preview has no game Runtime/data or relay.

The five supplied DAT files were read locally without modification; verified decoding/checksums and documented present versus absent/default records. No score integration added to game info pending user selection.

final result: passed


## 2026-09-28 — Local DAT statistics, save library and stable notice

Implemented validated TH06–TH10 DAT parsing, grouped statistics and most-played
character art. Empty state has only the requested centered sentence. Save/replay
modal preserves its dark style and adds selectable local saves with downloads.
Selection persists and is applied before launch through Runtime-owned writes,
with automatic backup, sync and byte-for-byte verification.

All five supplied DAT samples pass parsing/corruption tests. Browser storage
harness passed persisted score refresh, slot selection, backup, verified write,
progress update and failed-write rejection. The full preview shows imported TH07
statistics and the Sakuya background. TH08/09/10 empty-state notice top positions
were identical (778px at the tested viewport), with launch at 840px. Download UI
was exercised, but browser download-path observation timed out, so downloaded
bytes were not independently compared. Actual game launch remains untested:
this frontend preview has no Runtime/game data. Existing preference and product
surface tests pass. Screenshot: save-list.png in task outputs.


## 2026-09-28 — Portrait remaining-height layout

Portrait main grid now uses auto / flexible / auto rows with a stretched game-info
panel, dynamic viewport minimum height and compact safe-area footer padding.
Empty content has a smaller minimum so shorter phones can fit naturally.
Browser verified 390×844: document 844px, footer bottom 832px, panel 479.84px;
430×1100: document 1100px, footer bottom 1088px, panel 735.84px. The additional
256px went entirely to the panel. Screenshot: portrait-fill.png. Launcher build
and diff check passed. Per user request, 06.dat through 10.dat were added through
the local preview save picker and each confirmed selected for its matching game;
Runtime applies the pending selection at next launch.


## 2026-09-28 — Lobby transition and statistics controls

Multiplayer action sits left of Launch. Desktop card exits left then lobby enters
from the left; portrait exits upward then lobby enters from below, with a return
action and reduced-motion bypass. Existing room handlers are reused; missing
relay disables create/join and shows a configuration notice. Browser verified
entry and return, desktop lobby-card-out and portrait lobby-card-up animations.
390px layout keeps all three launch actions on one row without overflow.

Statistics details now all start closed. Up/Down from both a summary and focused
ranking region switched TH10→TH09→TH10. Durations use hours/minutes, including
TH10 frame counts and TH07–09 packed time fields. Browser checked TH10 values
and zero expanded sections after selection. Screenshot: game-info-controls.png.
Actual network room creation remains untested because preview has no relay.


## 2026-09-28 — Full lobby local design fixture

Retrieved live touhou.vip/lobby.html and lobby.css. Local dev-lobby files retain
the room directory, filters and native create/join dialogs, with explicitly
labeled synthetic rooms and no relay traffic. The launcher embeds this fixture
only on loopback hosts; production relay checks remain intact. The custom local
preview server serves these three dev-only files, outside the published manifest.
Browser verified all-game rows, filtering TH07, create dialog and local room
creation (#6205). Build and diff check passed.

## PR validation

- Launcher TypeScript build, DAT parser, global/game preferences, product surface,
  i18n, test ownership, frontend manifest, publication audit and diff whitespace
  checks passed.
- Full core gate attempted with `node scripts/check.mjs` (npm unavailable in this
  environment). It stops at the existing TH10 multiplayer build-profile/catalog
  mismatch; the concurrent artwork check also needs Python Pillow.
- Multiplayer now follows Launch in the action row; Import remains last.
- Local lobby/room UI is a loopback-only synthetic fixture, not real netplay.
  Physical touchscreen and live relay validation remain outstanding.
- Original character sheets remain in ignored private-assets; no user DAT files
  or extracted game artwork are included in the PR.

## DAT-driven portraits and room selection transitions (2026-10-03)

- Game-info artwork now requires a known favorite from DAT play-count records;
  empty, unreadable, unknown-character and zero-count data has no default art.
- Portrait loading no longer renders a transient missing-art label. Genuine
  missing/error labels use an absolute, fixed portrait box.
- Room character changes animate outgoing/incoming artwork in opposite horizontal
  directions. Selection text stays in place; unchanged artwork is reused for
  readiness/settings updates. Reduced-motion disables the movement.
- Launcher build, score DAT and character-art tests pass. Browser checks confirmed
  zero portraits for no-save TH08, hidden/absolute loading labels, both transition
  animations, rapid character changes and switching from TH08 to TH09.

## Host kick confirmation (2026-10-03)

- Local preview hosts see Kick at the upper-right of occupied remote seats on
  hover or keyboard focus; touch devices keep it visible. Self/empty seats and
  guests do not get the action.
- A matching dark dialog defaults focus to Cancel. Confirm rechecks host, room,
  occupancy and target bounds before removing a simulated player and updating
  lobby counts. Dialog keys do not change the selected character.
- Verified cancel/confirm and stale host/room guards in isolated checks; browser
  fixture verified P2 becomes empty and lobby occupancy changes from 2/2 to 1/2.
  This remains the local fixture; it does not issue a live relay kick command.
