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

- `04e5fc1b36441eb30132823239ac2ebe64dced21`: integrated resource imports/removal,
  saves, room/Runtime handoff, progressive audio, touch viewport and notices.
  Exact local check: 413 Node checks plus both builds. Core CI passed; browser
  CI passed 252/264, all 12 failures in the viewport fixture readiness probe.
- `1782e4fd50f5c626b6213ede29164c9a02c84fe3`: fixture probe after iframe commit.
  Core CI passed; browser CI passed 262/264. Two Chromium geometry assertions
  exposed a 15px library scrollbar gutter in the fullscreen Runtime. The next
  source checkpoint disables this gutter only while the Runtime is visible;
  strict viewport geometry assertions are retained. Browser confirmation pending.

The next checkpoint source passes 571 Node checks (553 UI service/contract +
18 route/deployment), type/boundary checks, root+nested SPA builds and harness
build. Eight publication cases pass with the actual nested artifact, and A/B
synthetic publication fixtures assemble. Browser lanes contain 308 main UI, six
nested-route and nine publication cases awaiting the exact commit CI.

Active source work adds existing-storage preservation/explicit font repair and
uninstall fencing, typed Chinese/English UI messages, fullscreen and diagnostics,
trusted iframe request resumption, actual nested SPA builds and opt-in publication
assembly/update lifecycle. Do not quote source work as published until the exact
ref is checked. Synthetic Runtime events and Node storage ports are not real-game,
physical-phone or crash-durability acceptance.

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

The next integrated implementation includes local ZIP/raw-DATA import, confirmed
base-resource detach, root provider/view splitting, legacy links, directory and room
state with authoritative Runtime handoff, MIDI, progressive OGG, language cache and
fallback, live touch/viewport/magnifier, locale/notices/help, and save replacement
with fresh-owner byte reread. Check the exact commit and CI before accepting any
browser result. Injected transport/storage tests are not live relay or durable
browser/gameplay evidence.

Remaining parity and retirement gates:

1. MP Replay-viewer, TH09 native-title room entry, directory network diagnostics
   and inline guide are now integrated with focused tests. Their new CI browser
   cases still await execution; live relay/gameplay remains untested.
2. Finish publication/client update tests for root and nested mounts, then migrate
   default Host/self-host/external publication consumers. Existing production entry
   defaults still use legacy artifacts; no deployment is part of this branch work.
3. Source publication supplies catalog artwork and the supported HTTPS save
   recovery link. Review remaining room-panel navigation and deployment-specific
   visuals against actual current-main behavior.
4. Remove obsolete UI/bootstrap/CSS/history code and update consumers/tests/docs.
   Reusable source contracts, Package/Runtime services and compatibility readers
   remain. Unused sample-only React preparation has been removed in source.
5. Original-game flow, durable browser storage, actual target phone and browser
   versions remain unverified. Continue independent source work; do not bypass
   browser access restrictions or represent synthetic tests as device evidence.

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
