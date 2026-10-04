# Current-main frontend migration handoff

Updated 2026-10-04. Continue on `experiment/ui-main`; do not merge or deploy as
part of this handoff. Preserve reusable TS business/protocol/storage code while
retiring obsolete UI only after its capabilities and publication paths migrate.

## Verified published checkpoints

- `83fe4c066d2f135e26b10d3d3c388bcd98d9108e`: earlier bounded sample; 208 synthetic
  browser tests passed. This does not establish original-game or phone acceptance.
- `b7ad9e3ee42c12921e8681279b6ded882e1193f2`: resources, Replay, measured touch editor,
  shared dirty-draft/Runtime guard, general published TH06–TH11 preparation and
  explicit Start. Exact snapshot: 210 Node checks and type/build checks passed.
  Browser CI: 231/236; four failures were an invalid background-toolbar visibility
  lookup while a modal was open; one WebKit motion test missed its arbitrary
  opacity window during a 650ms sampling gap.
- `665b563494395d769b4c21b65ff828c5f46e0ae2`: scoped tests repair. It checks the actual
  prepared state while the modal is open and accepts genuinely running interior
  animation frames. Real duration, continuity and DOM-identity assertions remain.
  Exact snapshot: 213 Node checks, SPA and fixture builds passed. Recheck this
  revision's browser CI: 234/236 passed. The remaining two failures were old-document metadata fetches during reload. A shared document fetch gate and 11 deterministic lifecycle cases now address that source race; actual WebKit confirmation awaits the next CI.

Main's reviewed content baseline remains `a1426aba791a1eb2e1d52b2e9bf489d7af91761e`.
`experiment/ui-rebuild` is an untouched historical backup, not the new entry.

## Latest published CI and active checkpoint

- `2c4178c6c75ea7995fa2540f99da4c5d122851c2`: core CI passed; main 599/608,
  nested 6/6 and publication 9/9. The real-HTTP WebKit failed-module recovery
  cases passed. Publication success retains the explicitly limited WebKit
  origin-unavailable scope; navigator.offline emulation is still unverified.
  Remaining main failures: four same-task warning Escapes still reached the
  old parent Radix layer, and five notice assertions expected desktop 18px
  instead of original mobile 17px. The next scoped fix marks only warnings as
  local Escape owners, shields lower parent callbacks and dismisses only the
  exact current gate prompt. History/frame/launch and parent-zero assertions
  remain. Typography source is unchanged; tests now follow its 780px breakpoint.


- `e45d1e6d25d0179af99aa9272106e006ffd22ad0`: exact source passed 840 service
  and 20 route cases plus builds/publication/core. Core CI passed; main 592/604,
  nested 6/6, publication 7/9. Preflight, pending Help and earlier cold-route
  failures passed. Follow-up preserves requirements while addressing:
  - Warning open/reopen must establish its keyboard scope synchronously and
    let Radix capture Start before applying initial focus
  - Closing child dialogs may restore from Radix's exact parent-container
    fallback, while newer user controls/frames/modals remain protected
  - Actual first-use prose uses h3; separate two-level synthetic content keeps
    h2 typography coverage without waiting for nonexistent real headings
  - Failed modulepreload caching matches WebKit bug 270357. Explicit Reload
    now performs bounded same-origin generated-module raw revalidation before
    ordinary reload. This remains a hypothesis until real-HTTP CI confirms it
  - Playwright 1.63 / WebKit 2359 offline emulation matches issue 42775. Per review,
    revised CI closes only its owned fixture origin, proves uncached failure
    and actual Service Worker navigation/reload, then retains update/data checks.
    Chromium/Firefox additionally keep setOffline; WebKit navigator.offline
    acceptance remains BLOCKED/UNVERIFIED, not replaced by an equivalent pass

  Sources: https://bugs.webkit.org/show_bug.cgi?id=270357 and
  https://github.com/microsoft/playwright/issues/42775 (fix #42894 still open
  when reviewed 2026-10-04). No browser security settings or production origin
  are changed by these fixture controls.

- `10cd54a78de48a2b80554625cce595c2a42db708`: all five final parity repairs and
  interaction/test-consumer migration. Exact source: 830 service +20 route
  checks, root/nested/harness builds,15 publication cases and full core pass.
  Core CI passed; main browser 516/596, nested navigation 6/6, publication 1/9.
  These results do not complete browser acceptance. Trace-backed follow-up:
  - Preflight fixture violated immutable Runtime URL and TH08 DATA contracts
  - Standalone modal fixtures lacked their required composition/DOM RouterProvider
  - Cold-route interception also held an eager game-preferences chunk
  - Gesture tests assumed native CSS smooth scrolling despite the tested RAF owner,
    sampled after animation completion, or requested unsupported mobile wheel injection
  - Directory join label includes room identity; notice geometry was read during entry
  - WebKit inspector-aborted modules were not re-requested on Reload; HTTP503→200
    recovery and inspector-abort detection are now separate explicit cases
  - Publication install had reached offline-ready; its card selector omitted locale
    query. Plain-preview fixture used browser-restricted4190. Source now uses4178
    with browser security unchanged; actual offline/update assertions remain

  The follow-up changes fixtures/assertion timing and adds composition/contract
  regressions. Runtime validation, production modal/boot behavior and timeouts
  are not loosened to manufacture a pass. Exact next-commit CI remains required.

- `8d0a2e7d04da4577305f9b6149909524fc0b1367`: 104-file retirement and
  main-panel continuity checkpoint. Exact exported tree passed 658 service/SSR
  plus 18 route cases, both strict typecheck projects, root/nested builds, ten
  actual nested-artifact publication cases and the complete repository core
  check. Remote ref/tree were read back; GitHub core CI passed. Main UI CI
  passed 435/476 cases. Captured DOM identifies higher Help incorrectly hidden
  by a later-mounted library modal; Escape also reaches lower modal owners.
  Donation tests still target background controls beneath the restored sheet.
  One viewport geometry assertion sampled an unfinished animation. Independent
  nested/publication lanes ran but failed setup after a test-side root/nested
  build-output contamination; their browser acceptance is not established.
  It includes modal-contained prepared Start/Exit controls and task notices.
  Fixes require a new exact commit CI; none is accepted solely from diagnosis.

- `dc0e8ddfb6d0ded0d6312684408fde8edbdc8cc4`: default React publication consumers
  and launcher-capability restoration. Exact source passed 657 UI/route Node
  cases, ten actual nested-artifact publication cases and full core check.
  GitHub core passed; main browser CI **408/420**. Earlier viewport/refresh fixes
  passed. Three OS-motion restoration cases exposed stale cached media state;
  nine room cases crossed the fixture's real 650–899ms metadata retry timer.
  Subsequent source fixes synchronous snapshot reads while preserving subscriber
  delivery, and injects a controlled room-fixture clock with explicit retry
  coverage. Existing travel and requests===1 assertions are retained. Browser
  confirmation is pending. Nested/publication browser lanes were skipped; the
  next workflow runs these independent lanes even if main-UI assertions fail.


- `6a02ce9ff3dbbc1965dd3c886bfcfc30f659527a`: 142-file service/player/publication
  checkpoint. Exact isolated source passed 571 Node UI/route checks, eight actual
  nested-artifact publication cases and full repository core checks. GitHub core
  CI passed. Main browser CI: **305/308**; nested/publication browser steps were
  skipped after that failure. One title-dialog fullscreen gutter case and two
  WebKit/mobile refresh module-import failures are fixed in subsequent source,
  awaiting the next exact commit CI. Do not label these browser fixes accepted.


- `04e5fc1b36441eb30132823239ac2ebe64dced21`: integrated resource imports/removal,
  saves, room/Runtime handoff, progressive audio, touch viewport and notices.
  Exact local check: 413 Node checks plus both builds. Core CI passed; browser
  CI passed 252/264, all 12 failures in the viewport fixture readiness probe.
- `1782e4fd50f5c626b6213ede29164c9a02c84fe3`: fixture probe after iframe commit.
  Core CI passed; browser CI passed 262/264. Two Chromium geometry assertions
  exposed a 15px library scrollbar gutter in the fullscreen Runtime. The next
  source checkpoint disables this gutter only while the Runtime is visible;
  strict viewport geometry assertions are retained. These Runtime cases passed
  in 6a02ce9; its distinct fullscreen title-dialog gutter case is noted above.

The published retirement/visual checkpoint has 476 main UI, six nested and
nine publication browser cases. Working-tree gesture/music/help/native-lane
repairs add further cases; their checks must be recorded separately.

Production old UI retirement: 17 entry/controller/build files deleted, 732 lines
of unused mixed-module DOM/translation/history adapters removed, and standalone
page styles reduced from about 267KB to 3.2KB. Canonical TS models/contracts,
Package/legacy storage readers, Runtime protocol/cache/leases, recovery/info pages,
minimal prebuilt self-hosting and old-release verification remain. The actual
keyboard listeners are extracted into runtime/keyboard-binding.ts for shared
production/test use.

Visual source restores a persistent library under the 480px right-hand settings
sheet and mobile cover-led bottom sheet, shared child management views and room
options; Runtime remains root-owned and takes over without replacing the frame.
Root metadata now supplies title/description/OG/theme through server-safe route
locale data. New synthetic screenshots cover library/settings/resources/Replay/
saves plus populated directory and room sheets, but pixels/focus/animation still
need review from the next exact CI artifact. Physical phone and gameplay remain
unverified.

Remaining test-consumer work: optional historical browser CLI lanes still have
old selector/global assumptions. Inventory and shared-helper ports are in
progress; do not advertise these as current native acceptance or silently remove
unique coverage. New React CI is a distinct synthetic lane, not a replacement
for real-game/storage/device evidence.

## Current ownership

- Framework SPA Router owns location and history. `/play/:productId` is the UI
  namespace; `/games/**` remains game resources. The root RuntimeControls blocker
  coordinates registered unsaved drafts before Runtime exit consent.
- RuntimeService alone owns the retained iframe, native file protocol, epochs and
  Package/code leases. Exclusive prepared file sessions prevent Start/cancel from
  racing Replay or save transactions. No React view writes IDBFS independently.
- Preferences and resource/launch/file controllers are plain TS services. Views
  emit intents. Providers retain jobs across route changes and fence document loss.
- Package installer owns serialization, Web Locks, staging and atomic generation
  commits. Resource removal must detach a confirmed current pointer and preserve
  retained generations/objects; it is not a save-data deletion or forced GC.
- New build ownership proof lists source modules, chunk bytes and lazy imports.
  Legacy app/lobby DOM bootstraps and Node-only modules may not enter the new graph.

## Continuing work, not yet an overall completion claim

The integrated implementation includes local ZIP/raw-DATA import, confirmed
base-resource detach, root provider/view splitting, legacy links, directory and room
state with authoritative Runtime handoff, MIDI, progressive OGG, language cache and
fallback, live touch/viewport/magnifier, locale/notices/help, and save replacement
with fresh-owner byte reread. Check the exact commit and CI before accepting any
browser result. Injected transport/storage tests are not live relay or durable
browser/gameplay evidence.

Prepared-control amendment: the library modal previously obscured root Start/Exit
and task notices. A stable ManagementSurface presentation slot now places those
existing controls inside the active modal, preserving their root controllers and
save guard. Normal-click CI cases cover Start/file locks/Exit/save failures; no
forced click or duplicate Runtime was used.

Additional preserved-main behavior restored in the current source: card/minimap hold/scrub/wheel gestures, notice-edge gestures,
and local-OGG MIDI-sentinel/effective fallback semantics. Catalog MIDI capability
must remain authoritative (a sentinel is not evidence that TH10 supports MIDI).
These repairs have targeted source coverage; browser/native verification remains separate.

Remaining acceptance gates:

1. Recheck the exact published retirement + visual + CI-fix revision. Review all
   primary-surface screenshots and interrupted navigation traces, fixing defects.
2. Finish advertised historical browser-lane ports or documented equivalent
   replacements; preserve unique native/storage/WebKit/Adonis acceptance scope.
3. Confirm root/nested offline/update browser lanes, which prior main-UI failures
   prevented from running. Producer/core tests alone do not establish them.
4. Real game, relay, crash-durable saves and physical phone/browser versions remain
   unverified. Never bypass browser restrictions or relabel synthetic evidence.

## Reproduction

Use Node 24 and the locked dependencies:

```sh
npm ci --ignore-scripts
npm run check:ui
node scripts/build-ui-harness.mjs
```

Only in a permitted browser environment:

```sh
npm run test:ui:browser
npm run build:ui:nested
npm run test:ui:nested:browser
npm run test:ui:publication:browser
```

See [local acceptance](UI_MAIN_LOCAL_ACCEPTANCE.md) for external private asset
mounting. Public TH06 metadata and six matching runtime/DATA/font files from
`https://touhou.vip/` were retrieved and verified: 25,117,488 payload bytes, current
Runtime generation `67be4524066a23a17bd6fb084abf58899462447248331fb9081e66b27c0a7110`,
Package revision `0fdb4ee3acc78b2a`. Game bytes stay outside Git and the UI output.
Their hash/layout and HTTP mount checks passed; execution did not occur.

No PR, comments, merge, deployment, private data upload or production SW changes
are implied by this branch work. Unrelated reported security issues remain outside
this migration's approved changes.

## Final parity audit follow-through

Five concrete remaining capabilities were found by comparing original-main
callers against the complete new caller/build chain. They are not waived:

- Pre-module boot timeout/chunk failure recovery and route error presentation
- Epoch/intent-bound pre-start mobile-input and none/MIDI acknowledgments
- Real assembled-publication offline Host retention, without an invented Host;
  optional Release Catalog refresh must not block keep-current launch
- Explicit validated web-development Host acquisition and live Runtime mode,
  without relaxing published-generation attestation
- Room-scoped engine preflight (run MP Runtime without gameplay transport,
  require first frame, then safe close back to the same room). Current plan
  acquisition alone is not this check.

All five parity repairs are now implemented with targeted source coverage.
Engine preflight uses the same room/Runtime owners, an authenticated first-frame
requirement and private dry-run cleanup; ordinary game save guards remain.
The assembled-worker Host retention and six visible-game development fixtures
are model/source evidence, not real browser or native gameplay acceptance. Real native/browser evidence
remains separate from source or mocked protocol validation.

### Current visual review findings

The 8d0a2e7 Chromium evidence was inspected for library, settings/resources/Replay/
saves, directory/create, and room/options/network views. This review found the
primary directory buttons incorrectly combining neutral and primary Tailwind
text colors, producing near-white text on pale pink. The working tree uses
exclusive variants and adds exact foreground assertions. Higher Help is visibly
above the library but was incorrectly aria-hidden; the repair targets actual
Radix mount/dismissal ownership, not its title or screenshot visibility.

The viewport assertion also sampled y=7.7829 during toolbar entry after a rounded
y=8 wait. It now waits for exact settled model/DOM geometry, retaining the exact
assertion and leaving default motion enabled. Header/footer donation tests now
operate on the visible library entry; direct product donation and higher-modal
interruption cases separately retain the underlying settings sheet.

## Final source parity checkpoint after 8d0a2e7

The combined source passes strict UI/test TypeScript, dependency boundaries,
830 UI service cases and 20 routing cases. Root/nested/harness builds, 15
publication cases per mount, TH20 hidden native-fixture build/type/8 identity
cases, 14 Python helper/observer cases and full core checks pass. The exact
published commit and subsequent CI remain the authority for browser results.

Restorations include main card/minimap gestures, notice edges, compact touch
editor/whole-scene motion, contextual input Help, room-options-only swipe close,
effective local OGG/MIDI semantics, boot recovery, pre-start warning scope,
validated offline/development Host paths and actual room engine preflight.
MP Replay and engine preflight did not call original input/audio warnings;
their existing explicit Start/dry-run boundaries remain rather than adding
new prompts. The obsolete progressive-OGG limitation text is removed.

Historical browser commands now target the current controls and actual
publication boundary. They retain unique native/relay/storage/performance
assertions and remain unverified where not executed. See the command inventory
for explicit inputs, including the portable two-scenario TH09 wrapper.

Nested build cache identity now includes mount, default non-root output is
isolated, and locking follows the output directory. The exact earlier failed
mount-only command passes without changing root artifact identity. Declared
root/index GET/HEAD readiness works with default Accept; missing JS/WASM/DATA
and resource namespace behavior remain bounded. No production was changed.
