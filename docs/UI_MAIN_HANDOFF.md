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

Current retirement/visual source passes 658 UI service/SSR cases plus 18 route
checks and both typecheck projects. Discovery lists 468 main UI, six nested and
nine publication browser cases. Exact exported-tree builds/core checks and CI
must be rerun before acceptance.

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

Additional preserved-main behavior found by native-lane auditing is in active
working-tree repair: card/minimap hold/scrub/wheel gestures, notice-edge gestures,
and local-OGG MIDI-sentinel/effective fallback semantics. Catalog MIDI capability
must remain authoritative (a sentinel is not evidence that TH10 supports MIDI).
These later repairs are not included merely because old renderer files are gone.

Remaining acceptance gates:

1. Publish/recheck the exact retirement + visual + CI-fix revision. Review all
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
