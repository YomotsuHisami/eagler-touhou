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

# 大厅恢复设计检查

2026-10-13。范围：恢复原版主页面大厅骨架、网站卡片、卡片内返回、底部鸣谢；房间内 UI 尚未迁移。

## Source visual truth

- 原版：`/home/grass1337/Projects/eagler-touhou-frontend/.cache/redesign/audit-02-reference-lobby.jpg`，远端 frontend-redesign 分支，样式此前已核对源文件。
- 最新实现：`/home/grass1337/Projects/eagler-touhou-frontend/.cache/redesign/lobby-restored-desktop.jpg`；卡片细节 `/home/grass1337/Projects/eagler-touhou-frontend/.cache/redesign/lobby-restored-card.jpg`。
- 手机中文／英文：`lobby-restored-mobile.jpg`、`lobby-restored-mobile-en.jpg`。
- 正常线上目录预览：`lobby-restored-live.jpg`。
- 桌面 CSS 视口 1280×720，devicePixelRatio 1.75；原版及当前卡片实际尺寸均约 908.93×620 CSS px。原图 1269×820 px，当前全页 1269×865 px，卡片细节 909×620 px。全页高度差包含鸣谢备案行和全页捕获范围，不作为卡片比例差异；按相同 CSS 视口和卡片边界判断。
- 手机 CSS 视口 390×844；截图均 380×981 px，文档宽 380px。未修改图片或制作假截图。
- 比较状态均为 TH08、Lunatic、#6102、1/3、招募中。原版自带模拟房间；当前为独立 loopback 原生联机服务上的真实 WebSocket 测试席位，没有放入用户线上目录。

## Findings and iteration history

1. [P1, 已修] 初次实现把大厅做成独立页面，移除网站入口、品牌和鸣谢，返回丢失作品。现在 `LibrarySurface` 保留共用的目录／品牌／Footer，只替换右侧内容；旧 lobby 地址仍有效，新主页面入口使用 view=lobby。返回在大厅卡片底部左侧，返回对应单人作品并恢复多人按钮焦点。
2. [P2, 已修] 原版大厅高 620px，而上一轮强制最少 720px，并在列表前放置大块作品／调查区。已恢复原版 max(620px,100dvh-180px) 规则、列表主体及底部布局，帮助／检查／调查放入紧凑的更多菜单。
3. [P2, 已修] 第一轮恢复时网站字标被旧卡片 display:block 规则覆盖，更多菜单也占整行。已提高网站卡片规则优先级并恢复标题行 flex，字标居中，菜单只占角落。
4. [P2, 已修] 手机底部操作受旧样式影响占满多行。中文恢复三个操作同一行、42px 高；英文长标签允许换行，按钮均留在视口内。
5. [P1, 已修] 主页面目录查询首次加载造成初始 HTML 不匹配及 watchdog 未退休。初始 HTML保持与静态预渲染一致，目录作为 live workspace mode 展示；Root watchdog 正常退休，暖切换保留 chrome；新页面控制台无错误、没有 emergency 状态。
6. [P1, 已修] 全部房间切回此前作品被业务选择的旧值挡住。筛选以 URL filter 为准；网站卡片请求全部房间，能够再次选择原作品。真实服务和 mounted tests 均复核。

## Five required fidelity surfaces

- 字体：复用已有 ET Chill Round 和 touhou98 字体；EAGLER / TOUHOU 字标使用原版相同文字与字体，标题 28px／900、脚部操作 14px／700。核对字标、标题、排行行和操作文字；没有另画 logo。
- 布局：在同一比较输入中查看原版与最新截图，重点核对左侧网站卡片、620px 主卡、列表栏位、底部左返回／右创建及加入、下方完整鸣谢。查看卡片细节截图，控件和小字可读。手机返回、创建、加入中文同行；英文换行但无溢出。
- 颜色：主卡 rgb(23,23,20)，列表 rgb(32,32,29)，创建复用红色，加入恢复浅底红字；未替换为其他配色。
- 图片：封面／背景／返回图标复用已有原始资源，字标复用原版 font 和文字；没有生成替代素材、CSS 绘画或修改第三方图片。
- 文案：恢复 TOUHOU PROJECT、Eagler Touhou、返回启动器、创建房间、通过房间号加入和原 SiteFooter 全部人名／链接。示例调试提示替换为真实房间数，人数及输入方式来自服务；没有假称与原版示例数据完全相同。

## Interaction evidence

- 进入 root directory、刷新进入、旧 lobby.html 地址均可用；品牌、网站卡片、credits 存在，返回链接在卡片内。
- 返回 TH08 后 query 为 game=th08，选中作品保留，焦点到 optionsLobbyLink；鸣谢保留。
- 网站卡片切到全部房间，再选择 TH08 成功。
- 顶部设置打开原多人选项 carrier，页面没有重复字段 ID；隐藏副本没有被加入。
- 中文手机三个操作 right<=343.43、视口390；英文三个操作 right<=269.39，文档宽380，没有横向溢出。
- 实际加入对局／房间内选机未在本轮验收。

## Follow-up polish

- [P3] 原版完整进出卡片的退出／进入动画仍可进一步逐帧对齐；此轮已保留暖切换的目录、品牌及 Footer。
- [P3] 更多菜单和真实输入方式标记是原架构功能的紧凑保留，与旧模拟数据有合理内容差异；本轮不删除功能。
- 不宣称完整 WCAG 合规或全部历史冻结测试通过。

## Implementation checklist

- [x] 恢复网站卡片、品牌、卡片底部返回和原鸣谢。
- [x] 对比同尺寸桌面和手机，修正 P1／P2问题。
- [x] 203 个相关不同用例经修复后覆盖通过；类型检查、生产构建及差异格式检查通过。
- [x] 保存实际截图与进度，普通 8138 预览保持运行。

final result: passed


## 2026-10-13：Game Info 与联机大厅卡片动画验收

本轮范围是已恢复框架上的卡片交换；房间 UI 和大厅／房间动画尚未迁移。本结果不作为房间阶段或整个项目的完成声明。

### Visual truth 与证据

- 原版源码：`frontend-redesign/src/launcher/app.mts` 中 transitionLobby／measureCardEntrance；`frontend-redesign/public/styles.css` 的最终桌面、竖屏及返回覆盖。参考版本保持不变。
- 桌面同态视口：1280×720、TH08 大厅、完整动画开启、文档 scrollY=0。原版 `motion-reference-lobby-viewport.jpg` 为 1280×720；当前 `motion-current-lobby-viewport.jpg` 为 1270×714，按共同 CSS 视口比较，捕获像素约有 1% 的工具密度差，不据此声称逐像素相同。真实卡片 CSS bounds 两者均为 x=315.99、y=86.57、宽908.93、高620；`motion-desktop-metrics.json` 记录。
- 原版桌面参考与当前桌面截图已在同一次图片工具输出中查看；完整手机对照同样在同一次输出中查看。手机均为390×844 CSS 视口，原版全页380×844、当前380×981；全页高度取决于既有内容及动态视口捕获，不能据此推算动画方向或精确卡片高度。
- 动态聚焦证据：`motion-reference-forward.json`、`motion-reference-return.json`、`motion-current-forward.json`、`motion-current-return.json`，以及两版 desktop-entry 截图。手机参考 `motion-reference-mobile-forward.json` 中确认 innerWidth=390；当前 mobile-forward／mobile-return 轨迹确认向上退出、下方进入及反向返回。先前误用1280宽的手机参考采样已被正确390宽证据覆盖。
- 保存了 `motion-reference-mobile-entry.jpg`／`motion-current-mobile-entry.jpg` 和双方 mobile-lobby 完整截图。动画截图捕获于入场过程，不将不同进度的单帧称作像素对齐；以位移轨迹、完成态和原 CSS 的时间／缓动共同验收。
- 原版为演示 #6102，当前为真实服务空列表。原版手机演示提醒、目录初始滚动、已有存档统计、原生额外作品和服务内容属于既有差异，本轮未用假房间或删除原生功能来伪造完全同态。

### Findings 与修复历史

- [P1 已修复] 原实现直接替换卡片：现在保持旧真实卡片至220ms退场结束，再提交原路由并以280ms入场；按原版左右／上下及返回反向运动。
- [P2 已修复] 路由暖切换强制回顶：工作区相关链接及目录入口使用 preventScrollReset。内容变短导致浏览器自然收缩滚动范围仍可能改变 scrollY，与强制回到顶部区分记录。
- [P1 已修复] 规范化 POP 绕过动画、旧阻塞目的地重置新动画：固定父页政策继续生效，允许安全的卡片交换进入 motion blocker；presentation 目的地无需复用清理许可。真实浏览器返回与 mounted 用例均通过。
- [P1 已修复] 退场中选其他作品被旧阻塞挡住：改选可取消旧动画／目的地，保持最新作品意图。严格模式 mounted 验证真实卡片及 iframe／目录／Footer 的身份。
- [P1 已修复] 浏览器意外取消动画可使退场等待永不完成：异常取消与420ms保护超时释放导航；自身取消依旧中止旧意图。异常退场／入场回归均恢复交互和焦点。
- 未发现本轮动画范围剩余 P0／P1／P2；桌面和竖屏真实位移已观测。竖屏没有横向溢出。

### 五项检查与交互验收

字体、字标、立绘、背景、颜色与文案继续使用已有资产和实现，未新增替代素材；静态布局保持已恢复框架。仅右卡片滑动，目录／顶部／鸣谢不参加出入场动画，目录位于滑动卡片之上。桌面边缘距离来自真实卡片 bounds，减少动态效果不播放装饰运动。

实机完成前进、卡片内返回、竖屏往返、快速双击、更少动画、浏览器返回；焦点随可操作的新卡片恢复。`motion-reduced.json` 所有采样无动画阶段，测试后恢复用户原先关闭更少动画的偏好。最终正常预览无 warning/error、无重复 ID。动画中途取消由可控 mounted 状态检查覆盖；实际快速点选可能已经进入大厅，只作为新筛选正常工作的检查，不声称实机必然命中了退场中途。

相关回归133/133，新增异常取消后动画定向5/5，覆盖134个不同用例；最终类型检查、生产构建与差异格式检查通过。没有启动本轮游戏、加入线上房间或宣称完整联机对局通过。

### 后续

3B 必须先对照原版房间状态，再迁移房间骨架／玩家席位／选机及大厅 ↔ 房间相同动画。房间动画仍未实现，不将其降为已完成后的装饰细节。

final result: passed

最终构建补充截图：`.cache/redesign/motion-current-final.jpg`（1269×865，全页含鸣谢，仅作内容保留证据；动态视口的全页捕获不用于精确尺寸对齐）。临时参考服务和四个测试标签已清理，原8138预览及用户标签保留，视口恢复默认。


## 2026-10-13：公告页遗留入口清理

用户提供的截图指出公告卡片右下角多人游戏入口应删除。已移除实际节点、空footer和对应样式，并把公告页动画返回焦点改为刷新公告。实际运行截图为`.cache/redesign/site-button-removed.jpg`；公告正文、刷新、Eagler Touhou网站卡片、Game Info多人入口与鸣谢保留。静态呈现15项和返回焦点1项通过，类型检查及构建通过；实机残留按钮计数0，控制台error为空。仅此明确删除项，无新增设计方向。

final result: passed


## 2026-10-13：3B第一轮房间、席位、选机与卡片切换

### 范围与 visual truth

来源为参考分支的实际运行：`frontend-redesign/public/dev-lobby.mjs`／`dev-lobby.css`，以及外层`src/launcher/app.mts`／`public/styles.css`。先进入房主房间截图，再实现生产RoomWorkspace。参考截图：`.cache/redesign/room-reference-desktop.jpg`、`room-reference-th08-desktop.jpg`、`room-reference-mobile.jpg`；实现截图：`room-current-desktop.jpg`、`room-current-th08-desktop.jpg`、`room-current-th08-desktop-viewport.jpg`、`room-current-mobile.jpg`、`room-peer-synced.jpg`。旧first-draft不是验收结果。

桌面采用1280×720、TH06或TH08、Normal、2席位、P1本地房主、P2空位、选择主人公、完整动画开启。TH08原版／当前全页像素分别1269×820／1269×833；手机双方CSS视口390×844，全页像素380×844／380×880。全页捕获会改变动态视口和文档总高，不从截图高度推算CSS卡片尺寸；按共同CSS视口和实际bounds核对密度。当前桌面卡片x315.99、y86.57、908.93×620，席位330px；手机当前卡片480px、参考479.84px，当前scrollWidth380。桌面和手机原图／实现图均在同一次工具图片输出中查看。聚焦检查来自角色／模式操作后的AX与DOM、双PNG实际加载、服务机体读回及保存的位移轨迹，不将不同动画进度单帧称作像素一致。

原版是本地模拟连接／编号／玩家状态，当前使用原项目真实relay。不同房间号、真实连接文案、原生设备／输入标识和更多菜单不作为像素匹配承诺。新架构的原生附加作品及已接受的目录布局继续保留。

### Findings 与修复历史

- [P1 已修复] 旧房间全屏样式隐藏目录、单卡、顶部或鸣谢：新工作区样式覆盖隐藏规则，保持原共用框架，保留Native/title overlay自身全屏呈现。
- [P2 已修复] Game Info立绘的右对齐、透明度、混合和横向遮罩影响房间：房间专用重置，源PNG居中、淡出遮罩及双角色适度重叠。
- [P2 已修复] 真实短连接文案使原版两行头部挤成一行，增大席位／立绘：连接区固定第二行，保留原版布局层次。Native选择控件补原option-select类别和清晰aria-label，去掉原生／增强选择框同时可见。
- [P2 已修复] 手机空位加入按钮与P2标题重叠，卡片偏高：空位操作移到下方右侧，手机房间480px。原有触控按钮最小实际面积仍为44px，操作区可见，无横向溢出；3席位在内部滚动区展示。
- [P1 已修复] 服务退休先于Router替换，退出后旧卡片短暂闪回：退出保持到实际DOM节点替换，取消和1200ms兜底清理。最终desktop/mobile-exit及browser-back-trace均为room exit→lobby entry→完成，无中途复位。
- [P1 已修复] 新房间规范化地址时使用旧Router视觉回调，误触发第二次退出：比较Router给出的currentLocation与nextLocation。最终mobile-enter轨迹为lobby exit→room entry→完成；专项layout时规范化回归通过。
- [P1 已修复] 武器确认时准备按钮尚未变为可用，提前focus失败：布局后恢复焦点，实机确认后activeElement=mpReady；待loadout ACK时拒绝确认／准备，绝对选择再次检查当前epoch／座位／连接与阶段。

本轮核心范围无剩余P0／P1／P2。原型的房间内解锁目录并原地改作品没有真实服务对应协议，当前明确保留锁定和提示，换作品先返回大厅，这是有意的产品约束；未伪造后台切换。原型局部滚动区内的第三席位操作位置继续保留，桌面内部滚动可访问，手机实际点按和第三席位已验证。

### 五项检查与实际交互

字体及字标使用已有字体；结构与比例按上述实际bounds对照；颜色使用原panel／席位／准备状态配色；所有角色采用已有DAIRI原PNG，锁图标提取原SVG路径、copy复用现有资产，两锁SVG注册到发布和App Shell清单。角色名字及武器／组合／单人文案以原型和现有Runtime配置对应；连接、准备、权限、旁观及资源错误保持真实服务数据，未在应用填充演示房间／玩家。

实机连接8140／127.0.0.1:8139隔离验收环境，普通8138不改配置。TH06选择魔理沙B、ACK后确认；真实WebSocket验收客户端P2换机体后浏览器立绘同步，原移除确认生效。TH08组合→八云紫单人，独立真实relay读回索引5；第三席位、房间设置抽屉、角色重选与焦点、手机往返、浏览器Back、规范化和终止房间错误返回均检查。最后新建#6506仅作图，不启动游戏。图片实载、无重复ID、最终console无warning/error、gameFrame src=null。

回归采用真实组件／服务配合明确synthetic DOM与relay数据；原有room／multiplayer／lobby文案与完整产品配置受已提交来源保护，新增UI文案允许扩展。整库历史冻结基线不作通过声明。相关五组最终测试日志为`.cache/redesign/room-final-regression.log`；最终类型检查、构建、图标清单核对与git diff检查通过。

### 后续范围

完整准备／取消准备、房主开局、真实双浏览器Native对局、旁观、重连、离开及资源错误恢复仍须下一轮端到端验收。触摸滑动／点按处理已实现；本轮实机输入验证为桌面键盘、鼠标及手机视口，未模拟完整触摸手势，也未验证实体手机。原版角色替换退场残影的进一步逐帧细调可作为P3；本轮完成卡片完整退场／入场，不将核心房间动画推迟。

临时参考服务、relay、验收客户端及测试标签清理；原8138预览、用户标签和原存档保留，视口恢复默认。

final result: passed

最终相关回归：五组216/216，fail 0；类型检查、生产构建、静态图标注册与diff检查通过。

## 2026-10-13：3B反馈——创建流程和切换方向修正

用户指出选定作品还要填写创建表单，且大厅进入房间动画反向；前轮动画检查仅确认存在退场／入场，没有检查退场位移符号，遗漏了P2方向问题。本轮对局验收明确暂缓。

原版实机 TH07：点击创建直接进入模拟房主房间，默认2席／Normal；桌面 `lobby-card-out` 从0到−100%，房间 `multiplayer-card-from-right` 从右侧进入；返回为向右退场／从左进入。390×844原版为 `lobby-card-up`／`lobby-card-from-bottom`。以此修正生产服务入口与Router方向判定，不改版式、字体、配色、立绘、目录或鸣谢。

当前隔离真房间 TH07 #7946（底部按钮）、#5910（空列表按钮）：创建全程无打开dialog，实际2席／Normal／公开；桌面退场从0到−100%、入场右侧，返回按钮反向；390×844上退／下进，浏览器Back下退／上进，规范化无重复退场。图片实际加载、没有游戏启动，console warning/error为空。全部作品未选定作品时保留原版选择入口；已选作品不再进入创建表单。旧表单配置和回执不能影响直接创建，重点击及原生连接／成员／作品门禁通过专项回归。

证据：`.cache/redesign/create-motion-browser-traces.json`、`create-direct-room.jpg`；定向四组224/224，最终`create-motion-final-regression.log`；类型检查、生产构建及diff检查通过。只完成本轮指定流程与方向验收，不声明对局验证。临时环境清理后普通8138供用户验收。

final result: passed

## 2026-10-13：房间顶部统一整站样式、删除更多、保持单行

设计目标是既有整站的工具按钮，不是克隆用户截图中的旧问题。用户问题截图：`/tmp/codex-clipboard-2299f757-fb3f-42cf-8b36-a04c40387c50.png`（裁切图、原视口未知，只作问题定位）。实际整站视觉依据：`.cache/redesign/room-toolbar-global-reference.jpg`，TH07 Game Info；旧房间`.cache/redesign/room-toolbar-before.jpg`，TH07／2席／Normal／公开。完整实现`.cache/redesign/room-toolbar-desktop-final.jpg`，同作品／席位／难度／隐私，随机房间号不同。1280×720 CSS视口的三个截图均1270×714像素，直接同密度比较，没有跨密度放大或重采样；Game Info和房间的业务内容、角色不同，仅比较共享样式与外围结构。

**第一轮发现与修正**：旧顶部[P2]方圆按钮、绿色状态字与粗大房间号偏离整站胶囊／细描边／暖白灰字；[P2]连接区域强制第二行浪费空间；更多菜单按用户要求删除。改为共用redesign.css工具按钮规则、已有字体与颜色变量、44px控件、16px房间号，清除旧绿色及更多样式；标题和控件单行，窄屏在具名工具组内水平滚动。实际全屏整站参考与实现放在同一比较输入检查；聚焦证据为用户问题裁切与最终`room-toolbar-header-final.jpg`（880×92），用于确认两行／更多已移除，而非对未知源视口作像素相等判定。

**第二轮发现与修正**：[P2]手机工具栏滚动条计入容器高度，标题中心比控件低约5.14px。`room-toolbar-mobile.jpg`对`room-toolbar-mobile-final.jpg`在同一比较输入检查：390×844 CSS、均380×822像素，TH07／2席／Hard／私密、随机房间号不同；后一张因键盘操作保留难度焦点圈，属于交互状态差异。固定标题的52px对齐槽，最终各控件及标题中心均约329.54px；900×720窄桌面也在同一中心线上。手机pageWidth380、工具clientWidth229／scrollWidth503；900桌面pageWidth890、工具416／593。横向溢出仅在工具栏，正文、席位和页脚没有页面横向溢出。`room-toolbar-mobile-end.jpg`显示工具条末尾，键盘聚焦房间号自动滚到约274px且按钮完整可见。测量记录`room-toolbar-layout.json`。

五项检查：字体使用原ET Yatra／ET Chill Round，工具按钮与Game Info实际font同为500 13px／18.2px，边框同为var(line)、999px圆角；标题保持屏幕层级，房间号16px作为标识强调。间距为一条紧凑工具栏和已有细分隔线，无第二排菜单。颜色使用原paper／muted／line／red／panel，按下状态红色轻底，禁用状态沿用既有透明度；没有新增局部绿色体系。图片复用原锁／复制SVG、原DAIRI PNG，最终实载没有拉伸或替换素材。文案及连接／权限／房间号来自真实服务，删除的是用户指定的房间更多及其下拉内容，整站设置、目录和鸣谢保留。

实际交互：原MainSelect切Hard及回Normal、公开／私密切换有ACK回显；全局设置打开原房间设置抽屉并返回；手机难度菜单处于视口内、不会被滚动容器裁切；横向键盘访问房间号；真实房间创建／返回保持原路由动画。本轮没有启动对局，也未验证实体手机触摸手势。互动检查时console warning/error为空；收尾隔离验收代理因上游资源流中断退出，出现暂时图片失败，修复忽略的本地代理取消清理并恢复；最终#3856锁／复制naturalWidth=150、灵梦PNG=672后重拍顶部。普通8138服务始终运行，其锁图标HTTP 200；该临时环境故障不涉及生产组件的资产路径。

相关房间组件／服务36/36通过；类型检查、最终构建、diff检查通过。临时房间、浏览器标签和代理／relay清理，视口恢复，用户标签／房间不操作。无本轮可操作P0/P1/P2遗留；窄屏单行横向滚动是本次布局要求下的明确设计选择。

final result: passed

## 2026-10-13：可切换作品的真实房间

功能目标来自用户：同一房间中切作品，完成目录锁定。视觉沿用已验收的整站工具栏；对照依据`.cache/redesign/room-toolbar-desktop-final.jpg`，最终实现`room-products-final-host.jpg`与`room-products-final-peer.jpg`。CSS视口1280×720，截图均1270×714，直接同密度查看，不重采样。先前静态房间为TH07／两席空P2，最终为TH08／实际两玩家，主体资产及内容差异是产品／角色状态变化；切换导致目录定位及页面滚动不同，不以全屏截图位置差异判定版式漂移。双端角色不同，房主有第三席按钮，成员没有，因此席位可用高度不同。

锁按钮仍共用13px／500字重、暖白／红／灰、细描边、胶囊和44px触控高度，整站字体、间距及单行布局未重做。仅增加按下／禁用状态和兼容提示。实载原DAIRI PNG，TH08双方均两张角色；字号／颜色／文案与先前整站工具规则一致。网站卡片和全部鸣谢保留，房间更多仍为0。纯功能变化没有新增装饰素材，未替换资产；顶部控件在全图可清晰判断，无新增需要放大的细节。

真实双页面8140／8142及本机新版relay：#4933两个独立身份保持P1／P2，TH07→TH08→TH09→TH08同步；房主解锁后目录可选，重新锁定后inert；非房主不能解锁。P2准备后切换，准备状态和确认阶段清空；打开设置时阻止房主切换，关闭恢复。旧TH07邀请码被服务器解析为当前TH09，初次刷新失座位作为[P1]恢复问题记录，已通过权威状态后再入席和可切换会话标记修复，后续P1刷新及P2旧邀请码恢复原座位均成功。URL与房间号、图片加载、gameFrame src=null均检查。没有启动Native对局，也未做实体手机触摸验收。

控制台检查：8142首次冷载保留了旧启动模块的Host Manifest／TH11 Release Catalog告警记录，故不声明全程零告警；切换、权限、同号同步与恢复经实际UI和独立relay用例确认。额外广泛BrowserSession检查在未修改的Replay队列／activity禁用场景失败，不计入本轮通过范围。相关四组221/221、会话存储、真实relay切换、成员安全、限额、类型检查、最终生产构建和diff检查通过。

8142测试客户端清理；8140房主预览和8139新版relay供用户验收，原8138与用户线上房间保留。新版功能需要同步更新relay，旧relay仅提供兼容的锁定提示；不宣称已部署到线上。没有本轮待修P0/P1/P2。

final result: passed


## 2026-10-13 — Player-card loading and independent host seats

**Result: passed for the requested room UI/management flow.** Real local TH08 room #1091, updated relay on 8139 and client on 8140. User's 8138 room was not used or changed. No Native match started (`gameFrame` has no src).

- Main's existing automatic preparation is visible in each occupied card as an almost full-width capsule. Local and actual independent 8142 peer both showed Loaded/100%; peer state followed relay reports. Synthetic preparation tests cover partial percentages, runtime indeterminate progress, failure/retry and early-Ready prevention; the live cache completed too quickly for a sustained download screenshot.
- The host moved from P1 to P2, added P3, removed empty P1 and remained owner after compaction to P1, then moved back to P2. P2 ownership survived a real page reload with a second player present. The host kicked the actual P1 test peer through the confirmation dialog; that peer returned to the lobby. No non-owner administrative controls appeared on the peer client.
- Desktop focus originally inherited an ID-level important outline offset from canonical styles.css, causing the reported clipped red frame. Final computed offset is negative (inside the card); the final screenshot shows a complete red border. The same old stylesheet enforced 44px minimum button heights. Scoped overrides now preserve circular 36×36 desktop / 28×28 narrow device buttons and 32×32 narrow removal buttons, with expanded touch hit areas. All three TH08 shot choices end above the progress bar (last bottom 697.7, progress top 709.7 in the observed document).
- At 390×844: no page horizontal overflow; all seat bounds are disjoint; both empty-slot remove controls had opacity 1 without hover. The card area scrolls vertically, making the P2 capsule and P3 deletion control accessible while toolbar/footer remain usable. Clicking the P3 circle returned to two seats with the same P2 host and visible add-third button. This is a desktop browser narrow-viewport check, not physical phone/tablet testing; device classification including iPad desktop UA / Android tablet is covered by unit and wire tests.
- Keyboard instructional copy and old bottom red cross removed; ready state uses a check beside the player name. After real loading and character confirmation, Ready was enabled and the relay accepted it. Final page retains P2 host ready with add-third visible, no match launched.
- 225/225 related component/service/navigation tests passed. New real relay room-card management test and existing product-switch, membership-security and abuse checks passed. Typecheck/build/diff checks passed. No claim of full-repository test completion.

Evidence: `.cache/redesign/room-cards-desktop.png`, `.cache/redesign/room-cards-mobile.png`; logs under `.cache/redesign/room-cards-*`. Temporary peer tab/server cleaned up; 8140 preview and 8139 relay retained for acceptance. Updated backend required for independent ownership/seat removal/peer device types; normal 8138 preview still uses the old upstream relay.


## 2026-10-13 — separate room progress and device, choice-aware readiness

Passed the requested refinement. Progress capsule and device button now occupy sibling slots in one bottom flex row, with a real gap and independent borders/backgrounds. Existing room typography, capsule corners and muted red loading fill are retained; prepared state changes only the progress fill to muted green.

Real browser evidence: two independent clients on 8140/8142 in TH06 room #2423 displayed local Choose character and remote Choosing character after real preparation. Host confirmation changed both clients to Loaded; Ready changed both to Ready/green; cancellation restored Loaded and Escape reselect restored choosing on both. The screenshot `room-progress-desktop.png` captures host Ready and peer Choosing character. No Native match was started. Cached resources completed quickly; deferred preparation tests cover slow/runtime-loading ordering and failure/retry.

Final TH08 room #3781 verified confirmed group selection survives a real reload. At 390×844, measured capsule 255.7×34 and device 34×34 with 8px gap, same vertical position; page scroll width 380 <= viewport390. `room-progress-mobile.png` shows green ready capsule beside the separate circular desktop device indicator (viewport resizing does not pretend to change actual device identity). This is a narrow desktop viewport, not physical handset verification. Temporary viewport reset and peer cleanup performed.

89 related component/service tests passed, real relay selection/ready/product-version checks passed, existing product-switch and snapshot-normalizer tests passed, typecheck and both builds passed. An old preview process exited during an earlier reload; restarted the local preview and completed reload verification on the replacement tab. No full-repository or gameplay test claim. Logs/evidence: `.cache/redesign/room-progress-*`.

## Retained room return and dissolve — 2026-10-13

The existing red directory primary action becomes 回到房间 while membership is retained; its styling and neighboring actions stay in place. The room footer adds a subdued red-text 解散房间 beside 返回大厅, using the shared site-wide decision dialog. Cancel leaves the room untouched; confirm plays the existing departure transition before the relay closes the room.

Real browser QA: TH08 #8550, host on P2, returned to lobby and refreshed past the default 12-second reconnect grace. Return restored the same room and seat/host identity. A second independent player joined through 8142. Cancelling dissolution kept both players; confirming sent both to the lobby with 房间已解散 and restored 创建房间. No match was started. Private-member, wrong-version and non-host rejection are additionally covered by a real local relay test.

Final room #4845 verified 390×844 layout: all four footer controls stayed on one horizontal line, Return/Dissolve each ~65×44px with 6px separation; page scrollWidth380 <= innerWidth390. This checks a narrow desktop viewport, not a physical phone. Viewport restored to 1280×720. Screenshots: `.cache/redesign/room-retention-lobby.png`, `room-retention-room.png`, `room-retention-confirm.png`, `room-retention-mobile.png`. Final 8140 tab remains for acceptance; temporary 8142 server stopped.

Validation: 142 directory/room/service checks and 1 actual BrowserLauncher navigation check passed; real relay retention test and existing room-card/product-switch/member-security tests passed. Typecheck, React build and diff whitespace check passed. Complete retention/dissolution requires the matching relay, supplied by local 8139 for the 8140 preview; no online deployment or Native gameplay test was performed.


## Lobby toolbar, bounded scrolling and confirmed replacement — 2026-10-13

Implemented the requested header with existing site button treatment: 玩法介绍 / 检查网络 / 参加问卷 / circular Refresh. Removed lobby More and browser-membership banner. Existing global Settings remains available. Real guide content and network modal opened successfully; survey URL/target/rel retained.

Real local-browser flow: TH07 host #6853 returned to the lobby, selected test room #6307 and cancelled the shared confirmation; #6853 and the red Return button remained. A second attempt confirmed the exact requested dissolve warning, removed #6853 and joined #6307 as P2. Returning as a guest left #6307's host in place. No gameplay was launched. The directory/relay tests also exercise wrong credentials, delayed confirmation, missing/full target preservation, guest ownership limits, correlated replies and stale repeated requests.

At 1280×720 the room-list body scrolls independently (content786px, viewport380px; Home/End reach either edge without moving the header/footer after focus). At 390×844 the card is820px high and fits between y11.5 and831.5 after page scrolling. Heading and all four action centers differ by less than0.01px. Eight local fixture rooms create1144px of content inside658px; scrolling to486px preserves header y52.1 and footer y775.0. Page width380 <= viewport390. Narrow checks use the desktop browser viewport, not physical mobile devices. Temporary viewport overrides are reset.

Evidence: `.cache/redesign/lobby-toolbar-desktop.png`, `lobby-toolbar-mobile.png`, `lobby-switch-confirm.png`. Screenshots with many rooms use temporary local relay fixtures, not public rooms. Related tests161/161 passed; final view-only follow-up46/46 passed. Real switch, existing retention and membership-security relay checks, TypeScript and production React build passed. No full-repository or match-validation claim. Updated relay required; user8138/upstream rooms untouched. Progress tracked in the ignored local document.

Final360×800 follow-up: all five header centers identical, header scrollWidth/clientWidth both293 after compact spacing adjustment. Fixture connections closed, local relay restarted with default room quota, preview retained.


## Inline code entry and automatic product selection — 2026-10-13

Removed the visible room-count eyebrow. The existing footer code button now expands in place from170px to250px on desktop, with a placeholder input and red right-arrow circle. Existing site font, capsule border and colors retained. Reduced-motion CSS disables expansion/fade; Escape collapses and restores focus, Enter submits. Browser QA caught a delayed-visibility autofocus failure not visible in synthetic DOM; visibility now updates immediately while width/opacity still animate.

Live local QA: starting on TH07, an unknown code displayed an inline error with no navigation. Entering private TH08 #8246 initiated the existing workspace exit phase, joined asP2, normalized the invite toTH08/8246 and selected the TH08 directory card. Return left the private host in place and kept the TH08 selection. Native gameFrame had no src; no match launched. Temporary local fixture host cleaned up. Original8138/upstream room untouched.

390×844: page scrollWidth380; expanded form132.7×42, independent arrow34×34, input89.6px and all footer controls aligned. Existing820px card height and internal room-list scrolling retained. Evidence: `.cache/redesign/inline-room-code-mobile.png`, `inline-room-code-desktop.png`. This is desktop viewport testing, not a physical handset/virtual-keyboard test.

Final directory/service tests106/106 passed; initial-presentation/navigation59 checks passed before focus-only refinement. Real relay lookup covers private/off-filter resolution, product migration, full/missing rooms, own full room, ambiguous legacy codes and throttling. Existing real room-switch regression, typecheck, final build and diff check passed. No complete-repository or gameplay validation claim.

Final360×800 follow-up: Return, Create and the124px expanded code form share top612.7/height42; page width350 <=360. Default viewport restored and final expanded lobby preview retained.


## One-screen portrait lobby and local acceptance wiring — 2026-10-13

Supersedes the previous 820px-tall mobile lobby requirement. Portrait layout assigns one small viewport to the masthead, horizontal directory and lobby together; the list flexes and scrolls, while toolbar and footer remain visible. Credits remain below the viewport. Short portrait screens use smaller directory cards and gaps. At390×844 the header begins at0, lobby spans287–824 and footer ends809. At375×667 list scrolling reached143px without moving body (scrollTop0), header or footer. Desktop lobby sizing is unchanged. These are desktop responsive viewport checks, not physical mobile keyboard tests.

The former8138 preview mistakenly served the new UI with the older public relay. It now serves the same local current-branch relay8139 as8140, with roomLookup=1 and roomSwitch=1. Production has not been deployed: the user redirected the deployment request to local backend setup. Local and public rooms are separate.

Real8138 browser flow: enter TH08 code8242 from TH07 lobby, join asP2 and automatically select TH08. Create7714, retain on lobby return, select8243, cancel (7714 survives), then confirm (7714 dissolved, actual room8243 joined). No Native match launched. Temporary local fixtures cleaned up. 106 directory/service tests, real relay code lookup/switch/retention tests, final build and diff check passed. Evidence: `.cache/redesign/lobby-one-screen-mobile.png`, `acceptance-8138-joined-room.png`.

Final short-screen pass:320×568 gives a316px lobby/126px list with footer bottom533;360×800 expanded code entry ends at765 with body scrollTop0. Temporary viewport reset and extra QA tab closed; original user8138 tab reloaded against the matching local backend.


## Responsive room card — 2026-10-13

Narrow/portrait room header hides the visible title and idle connected label while preserving the section's accessible name and non-idle connection feedback. Difficulty, cheat movement and directory lock remain together; privacy/code form a second group that wraps as a unit and aligns left.600px fits one line,390/320px use two;320px page width310 without overflow. Desktop title/status remain visible.

Room height follows roster content: local fixture4936 at390×844 measured619.7px for2P,749.7px for3P and619.7px after removingP3. Content client/scroll heights match408/538; footer gap12px. Scrolling over a player card moved page scrollY175→305 while room/content/local-seat scrollTop stayed0. Vertical gestures are now native pan-y/pinch-zoom, with horizontal-only character swipes.44 room-view checks including vertical/diagonal/cancel/tap regression, typecheck, build and diff check passed. Responsive browser QA used the same frontend build on8140 and local relay8139, isolated from user room2801. No match or physical-device touch validation. Test room and peer removed, temporary viewport reset, original8138 room refreshed. Evidence: `.cache/redesign/room-responsive-2p.png`, `room-responsive-3p.png`.


## Compact portrait player cards — 2026-10-13

Narrow/portrait seats use a two-column grid: artwork on the left, raised loadout details over the progress capsule plus separate device circle on the right. Normal seat height falls from174px to148px; selection options grow the content row rather than overlapping the status. Corrected the legacy button minimum-height override that stretched27px avatars to44px tall; avatars now measure27×27. Reselect respects its28px narrow-screen minimum and clears the mode prompt.

Live local QA:320px TH08 fixture4527 with all three mode choices grows to186.6px, with8px between choices and progress and4px between reselect and prompt. Confirming returns to148px; ready state retains its green fill and已准备.390px content clientHeight/scrollHeight both368.1280×720 retains desktop flex layout,44×44 avatars and full-width bottom progress. Temporary room/tab removed, viewport reset; actual8138 room2801 remains P2/咏唱组 with148px seats and27×27 avatars. Browser viewport checks only; no physical-device or Native-match claim.

Final build and diff whitespace check passed. CSS-only change; no new unit tests. Evidence: `.cache/redesign/room-compact-seats-8138.png`, `.cache/redesign/room-compact-seat-options.png`, `.cache/redesign/room-compact-seat-build.log`.


## Room entry focus and scrollable locked directory — 2026-10-13

RoomWorkspace now owns one-time local-seat focus after both seat synchronization and entry-animation inertness clear, including direct entry/reload and changing seats. Settings/dialog/hidden/launch states defer focus; progress updates do not steal it. Removed the competing animation-completion focus lookup from LauncherApplication.

Locked navigation no longer makes the whole directory inert. Disabled cards cannot activate or navigate and leave the Tab order; the rail retains a keyboard scroll focus target, touch panning and desktop wheel scrolling. Unlock restores selection.

Real local TH08 fixture2125: create→Right changed结界组 to咏唱组 without clicking a seat; reload→Right changed to红魔组; moving toP2 focused P2. Locked desktop rail scrollTop252.6→797.1 and clickingTH10 leftTH08/code unchanged.390px rail scrollLeft0→380 with pan-x pan-y. Fixture dissolved and closed, viewport reset. User8138/2801 reload focuses P2 and retains咏唱组/3P roster. No Native match or physical handset validation.

91/91 room-view/navigation checks, typecheck, build and diff check passed. Screenshots: `.cache/redesign/room-entry-focus-8138.png`, `room-entry-focus-qa.png`; logs: `room-entry-focus-{tests,types,build}.log`.


## Loadout alignment, Ready capsule and locked directory motion — 2026-10-13

Loadout details now center over the progress capsule text, excluding the separate device icon and its gap through shared CSS variables. Verified at320px,501px and1280px: center difference below0.001px. Narrow Ready is80×44px; footer groups may wrap when insufficient space remains.320px page width310, without horizontal overflow.

Locked directory cards participate in the existing pointer wave; only keyboard activation filters disabled entries. Actual8138/2801 at1280×800: hovered TH07 scale1.12, neighboringTH06 scale1.0233, selectedTH08 scale1.1834. Clicking the locked card retainedTH08. Reduced-motion behavior remains intact. Viewport reset; no match started or physical phone testing claimed.

47/47 existing room/directory checks, build and diff check passed. Evidence: `.cache/redesign/room-label-pill-8138.png`, `.cache/redesign/room-locked-directory-wave.png`, `room-label-pill-{tests,build}.log`.


## Portrait centered directory carousel — 2026-10-13

When portrait and selectable, the directory uses a fixed center outline in the existing pink double-border treatment. Native horizontal scrolling/snapping moves cards through it; cosine-based scaling peaks at1.12 and affects neighboring cards. Symmetric padding allows both the site card and final product to center. Settled scrolling reuses existing route/product callbacks, with scrollend plus a180ms quiet fallback. Programmatic centering never activates another product; reduced-motion, dialogs, inertness and startup interactivity remain guarded.

Locked rooms keep the regular freely scrolling directory: no fixed outline, center padding, snapping or scroll-triggered activation. Desktop hover motion uses its original variable independently of the portrait wave.

Browser QA:390px TH06→TH07 scroll updated the URL/product; TH15 and site endpoints centered within0.3px. Outline center190px remains fixed; center scale1.12 and neighbor~1.024.320px clickedTH11 remains centered after resize, page width310. Lobby footer remains inside the viewport. Actual8138/2801 locked rail scrolled296→448 without changingTH08/room; selector display:none, snap:none, padding14px.1280×800 desktop hoverTH07 remains1.12. Viewport reset, QA tabs closed; no physical-device or Native-match testing.

92/92 room/navigation checks passed; after the startup observer guard and quiet-period coverage, final room/initial-presentation checks63/63 passed. Final typecheck, build and diff check passed. Evidence: `.cache/redesign/directory-carousel-mobile.png`, `directory-carousel-locked-room.png`, and `directory-carousel-{tests,final-tests,types,build}.log`.


## Inline room code dismisses on outside interaction — 2026-10-13

Outside pointer presses, keyboard focus departure and non-busy blur now collapse the inline input and cancel pending lookup; Escape no longer dismisses it. Input and join arrow share the interaction boundary. The temporary blur caused by disabling a control during submission does not cancel the request, and dismissal preserves the outside focus target.

Actual8138 TH07 lobby: Escape keeps input open; Tab reaches the arrow without collapse; clicking it submits unknown99999999 and displays the expected not-found error. Clicking the non-focusable lobby title collapses the form and hides the error without focusing the trigger.48/48 directory checks, typecheck, build and diff check passed. No room entry/creation or gameplay. Evidence: `.cache/redesign/lobby-code-dismiss-8138.png` and `lobby-code-dismiss-{tests,types,build}.log`.


## Compact Game Info and one-screen desktop layout — 2026-10-13

Removed the requested back arrow, refresh button, ranking-slot count, duplicate archive caption, explanatory notes and detailed score tables from Game Info. The existing parser/data remain intact. Current save now sits beside Files/Replays in the toolbar. Summary order is game title / highest stored score / most-played loadout. Portrait artwork and launch/multiplayer/import remain; the remaining stage is reserved for later content.

Desktop Game Info fills the remaining viewport with a bounded directory and a full-width single-line credits footer. All original credits/links persist in the same Footer node; paragraph boundaries have equally spaced vertical separators and the longer divider fades at both ends. Portrait layout scrolls naturally, with a minimum220px artwork stage.

Actual8138 TH07 archive07 retains436,777,350 and咲夜A/195 plays after opening/closing the archive dialog.1024×600,1280×720 and1920×1080 have document scrollHeight equal to viewport height, with footer/actions visible; the three credit paragraphs share Y.320px page width310, file management/current save stay adjacent, portrait image~174px tall. Temporary viewport reset. No real match or physical mobile test.

64/64 score/save/navigation checks passed.10 actual BrowserLauncher checks passed; the archive preview check initially targeted the removed caption, was updated to assert the selected option/highest score and passed1/1. Typecheck, final build and diff check passed. Evidence: `.cache/redesign/game-info-desktop-8138.png` and `game-info-layout-{tests,types,build,browser-session,selected-save}.log`.


## Clear matrix, gameplay duration and shared save picker — 2026-10-13

The user clarified loadouts as columns and difficulties as rows. ClearMatrix shows Easy/Normal/Hard/Lunatic/Extra with compact loadout labels, green saved-clear squares and no dividing lines. Mouse/keyboard inspection highlights its row, column and headers; touch does not synthesize hover. SaveChoice now uses the shared MainSelect capsule/menu and native value owner. A missing option-select carrier class initially exposed the native control twice; fixed and verified as one40px trigger with a1×1 clipped carrier.

The decoder exposes clears/playSeconds without changing input bytes. Dedicated story markers/counters override ranking defaults; practice, ordinary unlocks and total-character records are excluded. TH07/08 use gameplay time, TH10 uses saved aggregate frames or unique loadout frames. Missing/unconfirmed TH06/09 duration remains unrecorded. Existing decode coverage remains TH06–TH10. Upstream reference: ThScoreFileConverter commitfeb02e2fa390cd0e0c599c97cc12399d9c07fd22, Th08/PlayableStages.cs and Th07/PlayStatus.cs.

Actual8138 TH07 archive07:30 cells,13 green,46h57min; selecting current no-save changes to0green/unrecorded, restoring07 restores all values. Hover Normal/咲A highlights10 cells and2headers. Duration and artwork-excluded area share centerx633.88.1280×720 remains one screen.1024×600 table250.68–383.23 and duration bottom414.43 both fit stage246.83–418.29; document scrollHeight600.390px page width380, matrix uses internal horizontal scrolling when needed. Browser viewport tests, no real match or physical handset validation.

34/34 score/save/binding checks passed; final priority and mouse/touch follow-up14/14; BrowserLauncher selected-save integration1/1; typecheck/build/diff passed. Preview services stopped during work for unknown reasons; memory check still showed16GiB available. Restored the same loopback services8138/8139/8140. The original browser error tab is policy-blocked, so continued in a fresh same-origin review tab. No security settings changed. Evidence: `.cache/redesign/clear-matrix-desktop.png`, `clear-matrix-mobile.png`, and `clear-matrix-{tests,final-tests,selected-save,types,build}.log`.

## Matrix and duration regions — 2026-10-13

Split the artwork-excluded stage into upper matrix and lower duration regions, using a 2:1 ratio with content minimums. Matrix aligns left and vertically centers; the time centers in the lower region. No visible duration text is rendered for missing records. Recorded zero displays 0时0分; recorded values display hours/minutes without a prefix, using the shared UI font and numbers 1.7 times unit size. Portrait summary stays in three columns, allowing long text to wrap within a column.

Actual 8138 TH07/07 remains 13 clear squares and 46时57分. At 1920×1080 the matrix center matches the upper region within0.01px and its left edge matches the region; the time is centered in the lower region. At1280×720 and1024×600 document height equals the viewport; the latter's table ends371.69 and time410.24 within the stage ending418.29. At390px the three summary columns occupy the same row and the matrix fits its199px region; at320px the page remains310px wide and only the matrix scrolls horizontally. Selecting the no-save current slot produces no duration node and an empty lower-region text; restored07 afterward. Viewport reset, no gameplay started.

15/15 statistics checks, typecheck, build and diff check passed. Evidence: `.cache/redesign/score-region-desktop.png`, `score-region-mobile.png`, and `score-region-{tests,types,build}.log`.

## Compact actions and complete matrix visibility — 2026-10-13

Footer Launch/Multiplayer/Import now match toolbar capsules:40px height,13px text with9×16px padding on desktop,12px text with9×12px padding in portrait. Widths follow content; Import retains its right alignment, and controls wrap when needed. Narrow footer top padding16→8px and score bottom padding24→12px move actions upward. Time numbers are now2.3 times their unit size.

Matrix uses the full artwork stage width with fixed columns and responsive square/gap sizes, displaying all loadouts without horizontal scrolling. Only squares fade progressively near the artwork; table labels remain legible. Fine-pointer proximity to the upper region reveals squares without latching; keyboard focus also reveals them. A completed touch/pen tap latches reveal until an outside pointer/focus interaction; a cancelled scrolling gesture does not. Short desktops adapt cell size to available stage height, including TH08's12 columns and adaptation notice. Neither scrolling nor these reveal events change product/score data.

Actual8138:320px TH09 shows16 columns/80 cells; table236.56px fits its236.56px wrapper and the page width is310px. Last column ends270.85 within stage right273.14. Desktop TH09 near-area pointer hasBODY focus and no touch latch while all16 masks become none; leaving the area restores gradients. Keyboard entry also reveals all16 columns.390px TH07 shows all6 columns, compact40px actions in one row and a300px stage. At1024×600 TH08 table ends345.22 and duration387.54 within stage end390.00; TH07 table ends364.84 and duration416.64 within stage end428.29. Both remain one-screen. Ratio measured2.3; original07 archive restored. Touch behavior covered by synthetic events, without claiming physical handset testing.

16/16 statistics/reveal checks, typecheck, final build and diff check passed. Local preview/relay processes stopped together again during QA, with no error recorded and18GiB available at inspection. Restored the same loopback8138/8139/8140 servers as transient user services outside the tool sessions; cause of the earlier exits remains unconfirmed. No production deployment. Evidence: `.cache/redesign/matrix-fit-desktop.png`, `matrix-fit-mobile.png`, `matrix-fit-16-columns.png`, `matrix-fit-desktop-revealed.png`, and `matrix-fit-{tests,types,build,services}.log`.

## Desktop category directory — 2026-10-13

Replaced the desktop heading with a48px edge-connected dock, rounded at its right end. Existing capsule palette/type is reused; category options scroll horizontally beneath the frame and head, with no scrollbar. All/Mainline/Decimal/Fan filter only the directory, preserving the Eagler Touhou site entry and current Game Info/room. All groups mainline→decimal→fan with spacing and gradient divider lines. Empty groups display the requested vertical尽请期待 in the shared UI font. Current published works are all mainline; explicit category metadata and numbered-work fallback prepare future entries without duplicating publication membership.

User rail scrolling retracts the dock to24px; mouse proximity or the head reopens it, and keyboard focus retains access. The first entry of a later group crossing the visible rail bottom opens a1600ms category notice without changing All. Programmatic startup alignment does not prompt. During real QA, focused filter buttons initially prevented retraction; the scroll handler now releases menu focus/proximity before retracting, covered by a regression check. Card hover wave, locked-room activation gates and selected-card alignment remain.

Actual8138 at1280×720: dock spansx0–277.99; workspace begins315.99. Menu wheel changes options scrollLeft0→57.71 while work scrollTop stays0. Fan filter leaves0 work cards,1 site entry and vertical尽请期待; URL/current07 archive stay unchanged. Native work scrolling collapses the dock to right24. FromscrollTop828.57→1188.57, decimal first entry reachesy564.16 within rail bottom652.94 and the dock announces小数点作; All remains selected. Notice expires and near-area entry atx40/y90 reopens the dock. At1024×600 dock right245.84 stays38px before workspace283.84, document height600.390px has0 desktop menus/groups,7 original work cards, the original游戏目录 heading and carousel center190; page width380. Viewport reset; no Native match.

114/114 category/initial/room/touch-navigation checks passed. After focus-retraction and head-toggle follow-up, final category checks8/8 passed; typecheck/build/diff passed. Synthetic nonempty decimal/fan fixtures cover grouping and exact arrival boundaries; real browser empty-group acceptance does not claim unpublished games were added. Evidence: `.cache/redesign/directory-category-{desktop,empty,collapsed,cue}.png` and `directory-category-{tests,final-tests,types,build}.log`.

## Stable enlarged category dock and flush rail boundaries — 2026-10-13

The dock now uses a header-height viewport anchor rather than directory-relative positioning. Removed the standalone menu icon/button, enlarged48→60px, and extended its right edge to12px before the workspace. Options have zero border and retain hover/focus highlights. A persistent red capsule follows the selected option with320ms translate/width transitions, including font/locale resize measurement; reduced motion remains honored. The dock itself supplies keyboard access in place of the removed button. Added a site→mainline divider, also when Mainline alone is selected.

The Game Info rail spans the original18px header gap and14px footer gap, while the workspace retains its existing offsets. Actual1280×720 TH06→TH07→TH08→TH07 switches: menu y98.5714, width303.9911, height60 throughout. Rail top matches header bottom62.5714; rail bottom matches credits divider666.9375 within0.0001px. Page height720. Buttons report0px borders, and the single indicator matches Mainline x102/w54 and All x12/w84; computed transitions are320ms. The removed button count is0 and scrolling leaves an approximately30px semicircle that still opens by proximity.

1024×600: both rail-boundary gaps are below0.0001px, menu height60 and workspace clearance12; page height600.390px retains the original heading,7 flat work cards and07 archive, without desktop dock/dividers. Viewport reset, currentTH07/07 and All restored.23/23 category/initial-presentation checks, typecheck/build/diff passed. No real match. Evidence: `.cache/redesign/directory-menu-polish-desktop.png`, `directory-menu-polish-boundaries.png`, `directory-menu-polish-geometry.json`, and `directory-menu-polish-{tests,types,build}.log`.

## Responsive action rows and lower-left duration — 2026-10-13

Desktop Launch and Multiplayer now split the available row equally, keeping Import intrinsic. Portrait Launch fills the full first row; Multiplayer fills the second row's space beside the unchanged Import.40px height and toolbar-matched font/padding remain. Matrix corner no longer displays Difficulty, while its accessible axis name remains. Duration moves outside the artwork stage into the lower-left score footer above Launch, prefixed游戏时长: and retaining2.3-times numeric size. Missing duration remains fully hidden.

Actual1280×720 TH07/07: Launch and Multiplayer both369.32px; Import85.14px unchanged. Duration and Launch sharex348.56, with duration above the button.390px: first-row Launch306.86px; second-row Multiplayer223.71px and Import75.14px. At320px widths236.57/153.43/75.14, no page overflow (310px) and duration scrollWidth equals clientWidth.1024×600 TH08: matrix bottom345.22 within stage bottom350.13, duration354.13–390.00, button begins466.29; document height600. TH06 has no duration node; originalTH07/07 restored and viewport reset.16/16 statistics/reveal checks, typecheck/build/diff passed. No gameplay. Evidence: `.cache/redesign/launch-row-time-{desktop,mobile}.png` and `launch-row-time-{tests,types,build}.log`.

## Persistent narrow category menu — 2026-10-13

Removed the old directory heading. Narrow layouts now have a centered persistent48px menu (maximum360px wide) above the rail, with the desktop's shared borderless options/red320ms selection capsule. Chinese All copy is全部作品. Portrait groups flatten into the horizontal carousel, separated by vertical gradient dividers; empty categories have card-sized尽请期待 entries that can reach the fixed center selector.

All scope and visual category are distinct. Scrolling reports the nearest center entry, updating only the menu highlight; work navigation still commits at settle. Manual category selection changes the scope and removes other categories from the DOM. Programmatic filter alignment activates no game. Empty entries report their category without invoking product/site callbacks. Resize retains their center, including repeated resize while an alignment is pending. Locked rooms retain the free unsnapped rail and current category, and filters cannot bypass work activation guards.

118/118 category/initial/room/touch-navigation checks passed after updating the removed-heading/grouped-boot expectations; all publication/card/noscript gates remain. Subsequent resize preservation coverage passed11/11 focused category checks. Typecheck, final build and diff check passed. Tests use synthetic nonempty decimal/fan fixtures; currently published works remain mainline.

Actual browser QA remains pending: two normal navigation attempts were denied because the browser's admin-enforced policy verification was unavailable. No alternate browser/control method or policy workaround was used, and no new UI screenshot was captured. Do not treat these tests as pixel/device acceptance. Pending checks:320/390px menu centering, All→decimal/fan center following, manual scope bounds, empty-entry endpoints/resize, lobby viewport fit, locked-room free scrolling and desktop regression. Evidence: `.cache/redesign/narrow-directory-{tests,final-tests,focused-tests,types,build}.log`.

## Portrait Game Info refinement and evidence-based loadouts — 2026-10-13 (visual QA pending)

Portrait toolbar now groups Current save/value/arrow in the existing40px MainSelect capsule between Files/Replays and Settings. The label is part of the clickable trigger; one hidden native select still owns the value. The single outline uses the existing palette rather than stacking the old global inset shadow. Recovery/error content remains separate. Very narrow English uses a second row to preserve the longer label/value. Summary retains three columns with content-weighted widths, aligned values and tighter typography/spacing.

The portrait artwork/matrix stage changes300→210px, using one vertically centered region rather than reserving an empty lower track. The time margin changes12→4px; the2.3-times numbers, lower-left alignment and two-row launch actions persist. Desktop allocation is retained. Matrix header hover/focus highlights only its own row or column; cells still highlight both axes. Header exit clears its highlight; touch motion and cancelled gestures retain their existing behavior.

The display-only featured-loadout selector preserves genuine play frequency first. Without positive play records, it uses known clear counters, then unique difficulty coverage. Aggregate/unknown/practice rows, repeated counters and invalid values are excluded. Unresolved ties and all-loadout/full-five-difficulty completion return no fallback. Labels distinguish most-played, most-cleared and widest coverage; missing selection renders a dash and default game artwork. The DAT parser and save bytes are unchanged.

61/61 score/save/select checks passed (22 score checks), plus1/1 actual BrowserLauncher component integration under synthetic DOM. Integration checks the capsule label opening the single menu, selection retention after menu/file-dialog close and selecting current-game save through the actual menu. Typecheck/build/diff passed; local preview artifact updated, existing loopback services retained. Evidence: `.cache/redesign/score-polish-{tests,regression,selected-save,types,build}.log`.

Real UI review remains blocked: the original browser navigation was denied because admin policy verification was unavailable. No security change, alternate control route or fabricated screenshot. Pending:320/390px Chinese and very narrow English toolbar, long save names/recovery state, summary baselines, compact stage/time spacing,16-column fit, desktop1024×600 full-page fit, and actual pointer header highlighting. Previous category-menu visual acceptance also remains pending. No real match launched, commit, push or production deployment.

## Category frame, actionable All and lower artwork — 2026-10-13 (visual QA pending)

The narrow frame now hugs intrinsic option width with a320px/available-width cap, replacing the stretched360px frame. Its row participates in layout; reduced option/edge padding keeps the frame close to labels, centered with the existing48px height, moving red capsule and borderless options. Overflow belongs to the internal row. Desktop edge-dock sizing remains intact.

All now issues an independent home request even when the actual filter already equals All and the centered item highlights another category. It restores all groups and smoothly centers Eagler Touhou, navigating through the existing site callback only after settling. Resize retains this target; user wheel/drag interrupts it; late scrollend events do not repeat navigation. Locked/disabled-site rows can return to the beginning without bypassing activation guards. Desktop All returns the rail to its top while retaining the selected workspace.

Launcher artwork moves out of the matrix stage into the shared score-content containing matrix and time. It anchors to the lower-right content edge above actions, with bottom-aligned images/credit and time text layered above artwork. Desktop and portrait use the same anchoring rule; room portraits retain their existing layout.

145/145 category/initial/room/touch/statistics checks and1/1 synthetic BrowserLauncher archive-preview integration passed, plus typecheck/build/diff. Initial duplicate late-scrollend and media-listener parameter issues were fixed before the final run. Local build artifact updated without restarting the existing loopback services. Evidence: `.cache/redesign/directory-home-art-{tests,regression,types,build,selected-save}.log`.

Actual review remains unavailable: binding the current user tab was denied because the browser's admin policy verification failed. No alternate browser/control route, policy change or new screenshot. Pending:320/390px and wider portrait frame extents, sliding selection/All return, desktop/portrait feet-to-actions spacing including paired artwork and long durations, desktop1024×600 one-screen fit. Previous visual QA items remain open. No real match, commit, push or production deployment.

## Global/game settings workspace and follow-up corrections — 2026-10-13 (browser validation blocked)

Header settings now occupy the main workspace in the launcher, lobby or room. Game-card settings use the same card with an explicit game-only scope. Both responsive layouts animate other cards down, settings down from above, and reverse on return. A stable hidden/inert scene wrapper preserves the previous game/lobby/room and iframe. Directory game/site actions still return to their actual destination. Expanded section headings replace native disclosures; desktop has two columns and bounded overflow, portrait has natural page scrolling with no touch-body height clamp.

Sparse global defaults and explicit per-preference-owner overrides compose over legacy records. Global edits do not bulk rewrite existing configurations; game touch edits do not alter shared layout preferences. Actual product capabilities, language/music availability and live room movement rules constrain effective values. MIDI output selection writes its scope before applying the effective output, preserving a game's override. Global layout editing remains explicitly global; local cards route there. Editor/control identity survives metadata refresh and pending confirmation. Runtime/file preference captures share the same scope store, including session-only changes when persistence fails.

The adaptation notice now sits in the left side of the shared matrix/time/art area, so it no longer pushes artwork above the action boundary. Game Info only renders artwork for a determined recorded-play/clear-fallback loadout. No default portraits for missing/unsupported/tied saves, and no fading squares across an empty portrait area. Room selection artwork is unaffected. Desktop dock expands at the rail top or when its viewport area contains no visible card; covers retract it, with arrival/proximity/focus behavior retained.

Validation:121/121 combined checks,21/21 subsequent rule/invalidation checks,7/7 focused scope/animation/metadata/MIDI checks,156/156 lifecycle/initial/room/navigation checks,8/8 synthetic BrowserLauncher integrations; typecheck/build/diff passed. These are synthetic DOM/transport fixtures, not real gameplay, rendered geometry or hardware MIDI checks. Evidence: `.cache/redesign/settings-workspace-{types,build,final-tests,rule-final,settings-cards,lifecycle,browser-session,scopes}.log`.

Browser investigation did not repair policy verification. Inventory is healthy; original-tab reads still fail. Local config/log review found no local origin-deny rule or actionable validator error. Public browser capabilities only expose visibility/viewport; connection reinitialization followed by the same original-tab access still failed. No security reduction, alternate control path or screenshot. Pending actual checks:320/390px settings height, desktop columns, entry/return directions and focus in all three scenes, room selection retention, lower artwork with expanded adaptation notice, no-art records, rail-top/free-space dock behavior and desktop one-screen bounds. Local preview rebuilt; existing loopback services retained. No real match, commit, push or production deployment.


## Settings layout and classic directory — 2026-10-13

Browser access recovered after the user restarted the app. The same IAB/user tab
now supports reading, clicks, resizing and screenshots; no policy/configuration
was weakened. The earlier browser-blocked entry remains a historical record.

The actual narrow layout had inherited desktop grid areas and a horizontal item
container, squeezing the touch group into a zero-width column. Expanded groups
now have dedicated block layout; desktop placement only applies to desktop.
Touch/display share the first desktop row, advanced settings use two columns
below. Old row padding and disclosure spacing are removed in this workspace.
No internal settings scroller remains. The sheet fits ordinary desktops; a very
short window grows the page rather than cutting off controls. The directory
remains bounded by the Header and footer divider and does not inflate the sheet.

Five category choices have equal button sizes, including Classic works after
Mainline. The narrow frame is centered and capped at340px/available width; all
five Chinese labels fit at320px. Classic has its own empty group and filter;
all placeholders now read 敬请期待. Mainline→Classic→Decimal→Fan ordering and
manual filtering/automatic carousel highlight remain independent.

Actual browser checks:1280×720 capture;1280×600 and1024×768 have page height
equal to viewport height and complete settings content;1024×500 grows to580px
with the final option accessible.390×844 and320×740 have a single full-width
settings column and no horizontal overflow. Header settings clicked twice returns
to the same th11 workspace/URL. Classic shows no game entries; All returns to
the site entry after carousel settlement.

Evidence: `.cache/redesign/settings-layout-desktop.jpg`,
`.cache/redesign/settings-layout-narrow.jpg`,
`.cache/redesign/settings-layout-browser-qa.json`.
Directory/touch navigation72/72, initial presentation/settings primitives20/20,
types, production build and diff checks passed. No real gameplay or physical
device assertion is made.


## Category activation, horizontal menu edges and masthead visit — 2026-10-13

Actual IAB checks on390×844 and1280×720: choose Mainline while the site/notice
is selected; the directory and the game workspace now both select th06. Narrow
settlement commits an explicit category alignment, but resize/initial alignment,
empty groups and lock guards retain their existing ownership. Desktop opens the
first visible category game only when previously on the site.

Desktop menu edge motion was exercised in both directions using native mouse
movement: right0→66→194px, left194→140px, with the selected category/game and
vertical game rail unchanged. Traditional mouse movement is supported alongside
pointer movement. Text selection cannot interfere and touch compatibility input
is excluded. Leave/blur/motion preference and limit stops have mounted coverage.

Header brand/actions were enlarged. At320×740 the logo's right edge is138.25px
and navigation starts141.71px, with no overlap or horizontal overflow. The narrow
FAQ label wraps and icons are narrower at this breakpoint. The ten-click subtitle
sequence was exercised on narrow/desktop: the linked Grass1337 visit appears,
stays for2 seconds after entering, then restores the same real update-age node.
Header height is unchanged during the exchange. The existing footer destination
is shared; no external link was opened during QA.

Evidence: `.cache/redesign/directory-header-visit-narrow.jpg` and
`.cache/redesign/directory-header-visit-desktop.jpg`.25 directory/brand tests,
15 initial-presentation checks and54 touch-navigation checks passed; types,
production build and diff check passed. No gameplay assertion is made.


## Desktop site frame, stable Header and cover reuse — 2026-10-13

Site/game/settings now share a desktop viewport frame and a single full-width
credits row. The category dock aligns with the card top.110px rail padding and
scroll padding reserve room for its expanded state and the enlarged first cover.
Card motion is clipped by the sheet; max-content Header rows and desktop sticky
placement prevent Header movement as the workspace changes.

IAB evidence at1280×800: page800px, card/menu top87.071px, menu bottom147.071px,
site cover top166.271px, credits use a flex row. Five settings open/close samples
retain Header Y0/height69.071px and scrollY0. Rear Fan option center166.286px
matches rail center166.393px. At1024×600 the page remains600px and notice content
has equal scroll/client height318px.390×844 has no horizontal overflow and uses
normal page flow. The refresh action is removed; return focus targets the title.

Hidden categories retain all7 successfully loaded cover elements. Mounted tests
verify their identity and exclude hidden entries from selection. Local preview
covers are also cached on disk, fresh in the browser for1 hour, and respond304
to matching ETags; both preview ports were checked. The relay was not restarted.
No user room was entered/disbanded by the temporary QA tab.

126 current-scope checks passed, plus types/build/diff verification. A wider old
BrowserSession run exposed outdated removed-control assertions and was stopped;
that entire legacy suite remains unverified/pending migration. No all-suite or
gameplay claim is made. Screenshot:`.cache/redesign/desktop-shell-site.jpg`;
measurements:`.cache/redesign/desktop-shell-qa.json`.


## Saves/replays workspace and settings scroll timing — 2026-10-14

Files now use the same main workspace frame as game/settings. Desktop has two
columns, each with its own list region; narrow mode stacks saves then replays.
Headings/imports align left/right, exports sit at each row's right edge. Back
occupies the opener's top-left position and restores its focus. The exchange
uses upward departure and entry from below, reversing on return. Nested global
settings retain the files/replay owner beneath them. Recovery, backup, rename,
and TH10 hint tools remain available. Imports/downloads reuse actual models.

IAB checks:1280×720 and1024×600 stay one-screen with independent list regions;
390×844 and320×740 use one column without horizontal overflow. The old180px
archive-copy minimum caused clipped exports at320px and is removed in this
workspace: export right254.857px matches row right254.857px. A real archive
download produced4224bytes, equal to the previous export's SHA256. The IAB
download-event observer timed out despite that filesystem result; the generated
QA copy lives at`.cache/redesign/files-workspace-export.dat`. The browser has no
replays for this title;60-row/import/byte checks use explicit synthetic ports.

Entry measurement now runs after Router scroll restoration, with the pending
card concealed/inert. Motion excludes browser scroll anchoring. The focused
regression simulates changed restored geometry and pending cancellation. At
1280×720, game/settings/returned-game retain Header Y0/69.071px, card top87.071px
and width908.929px, page720px and scrollY0. At390×844, Back from settings scroll
421.714px restores scroll0 and the original game-settings button focus. This
checks the concrete layout/scroll behavior; no blanket claim for every viewport.

120 current-scope checks, types/build/diff passed. Old directory tests still
reference removed room dialogs and remain pending migration; no full-suite or
gameplay pass is claimed. Evidence:files-workspace-{desktop,narrow}.jpg and
files-workspace-qa.json in`.cache/redesign`.


## Room settings activity and visible settings card — 2026-10-14

SettingsWorkspace no longer carries the legacy tools class, which matched
.main.mp-room-open .tools hiding/zero-width rules. Actual desktop and494×1010
room checks show the card displayed as flex; narrow width448px, single column
410.857px, document width484px. Existing card styling and motion remain.

Settings activity is an independent, capability-negotiated room field. Entering
settings cancels only that player's Ready; both client and relay reject Ready
while editing. Closing restores the normal progress/choice label and requires
manual Ready. Percent/resource/selection are unchanged. Disconnect clears the
transient marker, and the current route is reannounced on reconnect or seat move.

Actual two-origin IAB check in disposable room6771: P1 selected and prepared,
opened global settings, and P2 observed Changing settings at100% with Ready off.
Header toggle returned to the same room; P2 saw Loaded at100%, and P1 Ready
remained false. No match was started. The local relay was updated/restarted;
user room5506 was re-established under the same number with the original P1
position awaiting choice. Room6771 was disbanded and QA tabs closed.

167 relevant model/view/navigation checks, live relay test, types/build/diff pass.
Screenshots in.cache/redesign:room-editing-peer.jpg, room-editing-settings.jpg,
room-editing-settings-narrow.jpg. Existing legacy full-suite migration is not
claimed complete.


## Minimal saves/replays, selected second variant — 2026-10-14

Final result: **passed** for this requested scope. No open P0/P1/P2 layout or
behavior findings in the checked states; this is not a full repository or
gameplay acceptance claim.

The selected second design was revised for the user's larger game title and
round native-clear/delete actions before implementation. Latest target:
`/home/grass1337/.codex/generated_images/01a13030-675b-7461-8a64-830a65253908/exec-1bb439a3-aa79-47f5-9aa5-6f6701819c38.png`
(1487×1058). Actual desktop: `.cache/redesign/files-minimal-desktop.jpg`
(1269×720 image; DOM viewport1280×720). The source was proportionally normalized
to1269px width only for analysis. Source and actual appear in one combined input
`.cache/redesign/files-minimal-comparison-final.png` (2538×903), with dark padding;
the aligned panel/header/first-row crops are in
`.cache/redesign/files-minimal-focus-comparison.png` (1817×280). Both were opened
and inspected together after the final build.

Intentional differences: the target contains sample saves/replays; the real TH07
browser has one imported07 archive, no native score and no replays. Native controls
are therefore disabled and the replay side uses its real empty state. No fake
records were inserted to imitate the target. The checked720px-tall desktop retains
the project's existing one-screen card/footer geometry instead of extending to
the1058px concept frame. Existing project fonts, warm dark surfaces, directory
assets, red selected-name treatment and pill imports are retained. Name/size/action
rows, title/import alignment and the two-column composition follow variant2.

Iteration findings resolved:

- P2: legacy row selectors left the native name/size smaller than the compact
  design. Explicit row rules now yield16px names and11px sizes on desktop,
 14px/10px in narrow mode; the enlarged game title is32px at1280px and24px narrow.
- P2: programmatic carousel realignment/late scrollend could change the current
  game and close this card during viewport/full-page capture. Only an actual
  user gesture or explicit category commit now submits carousel selection.
  The focused regression and final full-page capture keep the TH07 files route.

Live checks: desktop card x315.991/top87.071/w908.929/h565.866, equal405.893px
columns, each list overflow:auto, page720px tall. Narrow494×1010 screenshot is
484×1032, single column. At320×740 document client/scroll width310px; row right
254.857px matches the last44px delete action's right edge. Native/copy names,
sizes and both actions fit; inline rename input plus Save/Cancel stay within that
row width. Narrow screenshots: `.cache/redesign/files-minimal-narrow.jpg` and
`files-minimal-320.jpg`. Actual native4.1KB, archive name and bytes were left
unchanged. Native and copy confirmations were cancelled; rename was cancelled
with Escape, restoring name focus. Fresh desktop and original narrow console
checks reported no errors. Temporary viewport override reset; QA tab closed.

147 relevant checks pass (49 storage/files,73 navigation/initial,25 directory),
plus typecheck, production build and diff checks. Execution of delete/native-clear
uses isolated synthetic storage/runtime ports, including durable score-only
removal, confirmation cancellation, pending-writeback guard and both TH10 language
editions. Actual user data was never erased for QA; no match was started.

## Save names read-only follow-up — 2026-10-14

Final result: **passed** for the requested change. All names now render as static
text with full-name titles and the existing ellipsis, including imported archives.
The name button, row rename handler, form and unused rename CSS were removed.
Export/delete/native-clear behaviors are retained. Original IAB494×1010 check:
clicking the archive name leaves the same files card, the same name and no editor;
the element is STRONG and rename inputs/actions count0. Actual screenshot
`.cache/redesign/files-readonly-narrow.jpg` was opened for inspection.19 existing
file/storage checks, types/build/diff pass; logsfiles-readonly-{tests,types,build}.
No user names or save data were changed. This latest request supersedes the
earlier inline-rename acceptance above.

## Continued-clear matrix and grouped Launch content — 2026-10-14

Final result: **passed** for the requested color/status changes and Launch
content grouping. PR81 was closed at the user's request; these changes remain
local for acceptance.

The production decoder now separates continued/no-continue clear evidence.
TH06/TH07 dedicated arrays and both TH08 ending flags were verified against
native writers. TH10 requires a completed ranking to use its continue count;
TH09 aggregate story records do not classify individual continue history.
Per the latest user correction, unclassified aggregate clears retain the old
green/plain Cleared display, with no outline or additional uncertainty message.

Read-only browser evidence uses encrypted synthetic DAT files through the real
decoder, statistics model, ScorePanel, ClearMatrix and production stylesheet.
`.cache/redesign/clear-continue-desktop.jpg` (1280×720) shows TH06 mixed clears;
`clear-continue-th10.jpg` (1280×720) shows a continued Normal clear, no-continue
Hard/Extra and an aggregate-only Easy clear. Yellow is rgb(197,164,94), green is
rgb(127,160,106); the latter aggregate cell has title Cleared and outline:none.
The page is explicitly labeled as test data and never reads or writes the user's
save library. These screenshots are color/status evidence, not a full-launcher
layout or gameplay claim.

Launch now contains one inline flex content group so its icon and text stay
together; workspace hover no longer shifts the icon independently. The actual
user TH06 launcher was checked at1280×720 and390×844 without clicking Launch.
In both layouts the icon-to-text gap is8px and the group's center differs from
the button center by less than0.01px. Narrow document client/scroll widths are
both380px. Screenshots `launch-content-{desktop,narrow}.jpg` were opened and
inspected; real data is unchanged. Both browser console checks returned no
errors. Temporary viewport reset and QA tab closed.

60 relevant checks pass (53 statistics/save library/slots,7 shared action
styles/intent), plus UI typecheck, production build and diff checks. Earlier
whole-repository/legacy BrowserSession limitations remain documented; no match
was started and no real save was imported, changed or deleted for this QA.

## Launch SVG overflow correction — 2026-10-14

The user's subsequent screenshots showed that the earlier content-group check
missed the actual SVG: its18px grid container still contained a22px SVG because
the shared primary-icon rule used `!important`. The overflow shifted the visible
triangle downward even though the container and text line boxes were centered.
The prior grouping acceptance above was incomplete for this visual defect.

Workspace icons now use an18px flex container and an18px SVG, with an explicit
workspace override of the shared size. The primary triangle also has a small
font-relative optical offset to match the UI font's visible glyph center.
The8px icon/text gap and grouped horizontal center remain unchanged.

Actual TH07 browser screenshots were inspected at494×1010 and1280×720:
`.cache/redesign/launch-content-corrected-{narrow,desktop}.jpg`. SVG size is18×18
in both. Pixel analysis of the captured visible ink gives equal749px vertical
centers in narrow mode and598.5px/598px centers in desktop mode; rasterized edges
vary by half a pixel. This supersedes the earlier container-only proof. The
desktop capture also shows an unrelated HTTP502 metadata toast; it is not a
launch/icon failure. No gameplay or save changes were made.

The7 existing shared-action checks and production build passed again after the
SVG fix; earlier53 score/storage checks remain applicable. Logs:
`.cache/redesign/launch-content-corrected-{tests,build}.log`. Temporary viewport
override restored. Publication uses the explicitly requested LogRassWku account
and its fork, since that account cannot write directly to the upstream.
