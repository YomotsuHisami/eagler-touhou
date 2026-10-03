# Launcher UI rebuild

## Scope and status

Experimental branch: `experiment/ui-rebuild`. This is an in-progress migration,
not a deployment or a claim of game/phone acceptance. Existing production
publication continues to use its existing entry until the migration gates pass.

The visual reference is `frontend-redesign` at
`7dae65f050810c5333d1643350490ba2bafb5e61`, including the user's cumulative
header, directory, score library and credited character portraits. Its base was
56 commits behind `main` at `5650957fbced4151cc84a596f48bdaab4aabe2db`.
The isolated branch reconciles those main changes instead of discarding the
visual work or reverting the current product/runtime/storage contracts.

## Ownership

- React Router Framework SPA owns application history and route hierarchy.
- `app/services` owns long-running work. Unsubscribing a view never cancels an
  installation; cancel is an explicit job operation.
- Existing `src/contracts`, Package installers/store, Runtime generation loader,
  preferences and replay rules remain their respective data/protocol authorities.
- `RuntimeHost` binds exactly one iframe at root lifetime, outside route changes.
  Its service validates origin, source, product and epoch, retains Package
  generations, rejects stale acquisition and preserves a game after failed save.
- The settings form is the same implementation in library and room contexts.
  Reusing it does not merge SP/MP storage identities.
- Motion owns window/navigation presentation; ordinary CSS owns simple control
  feedback. Inert visual snapshots have no business subscriptions or event
  handlers, contain no Runtime iframe, and never commit navigation.

No legacy `app.mts` or `lobby.mts` is imported into React. The parallel old entry
is a comparison/recovery source, not a second running owner within the SPA.

## Navigation contract

`/` is the directory, `/games/:productId` selects a product, and nested
`resources`, `replays` and `help` routes are task panels. `/lobby` and
`/rooms/:roomId?product=...` identify actual relay views. `/components` exercises
shared controls independently. A task panel opens on top of its still-mounted
parent; Close/Esc and browser Back resolve the same route. Direct links close to
an explicit in-app parent instead of blindly leaving the origin.

Asynchronous close validation must recheck route/intent identity. Closing twice
must not pop two entries. Navigation commits immediately after validation;
animations never own navigation or delay a later intent.

## Product authority

Use `src/contracts/product-catalog.mts` and `adapter-capabilities.mts`, not old
introductory prose listing only four games. The catalog currently contains
seven base games and five multiplayer IDs. `productEnabledForBuild` controls
actual visibility: TH09 and TH11 are test-only, TH20 is hidden. Runtime Release
and Host declarations further constrain available features. Experimental UI
must not enable a product solely because a route can be typed.

## Build and verification

- `npm run typecheck:ui`
- `node scripts/check-ui-boundaries.mjs`
- `npm run build:ui`
- `node --test tests/ui-runtime-service.test.mjs` (23 bounded cases)
- `node tests/test-ui-package-tasks.mjs` (9 cases)
- `node tests/test-react-room-service.mjs`
- `node tests/test-ui-replay-files.mjs` (16 cases)
- `node tests/test-ui-input.mjs` (16 cases)
- `node --test tests/test-ui-static-routing.mjs`
- `npm run test:ui:browser` (standard CI/browser environment)

The SPA output is `.cache/build/ui/client`. `scripts/serve-ui.mjs` is an isolated
loopback preview with explicit external artifact roots. Navigation fallback is
restricted to declared application routes and navigation requests. Missing JS,
WASM, font and other resource URLs stay 404. The emitted ownership manifest
prevents legacy entry scripts or Node-only facades from entering the browser
application graph. A successful build is not gameplay acceptance.

## Evidence and pending gates

A: Source/capability baseline established. Actual before/after browser screenshots
and device frame-time baseline are pending. The current cloud's shell Chromium
was denied an OS socket operation; CUA localhost navigation was blocked. Neither
limit was worked around or counted as a browser pass.

B: Framework, shared controls, library/settings/task navigation and independent
Runtime/package/room services implemented. Tests use deterministic Runtime ports
and synthetic storage or a real local relay; actual game WASM/DATA is not present
in this restored workspace. Real-game launch/help/exit remains unverified.

C: Migration is underway. Runtime input, file management, global UI preferences, shared game settings and
score presentation now have source implementations. Touch layout editing,
magnifier, remaining translated views, browser compatibility notices and complete
room-control/visual parity still require migration and acceptance gates. In
particular, the native-title TH09 `network-request` event is retained but its
interactive network overlay is not yet migrated; do not claim title-room parity.

D: Isolated production SPA build and safe static routing are available. Integration
with the existing App Shell /2, deep-link compatibility, offline route availability,
update deferral, cache generation rollback and hosted assembly remains pending.
Do not register a new experimental Service Worker on the production scope.

E: No cutover, legacy deletion, merge, production deployment, or expansion of
published products has been performed. Retire the old entry only after capability
parity and build/offline/rollback gates, preserving publication rollback.

Target phone/browser/refresh-rate and long-frame/input-feedback thresholds are
not yet measured. Desktop viewport/WebKit automation is not real Safari or phone
evidence. Default animations remain enabled; reduced motion is user preference,
not a substitute performance result.

### Reconciliation correction

The inherited frontend score view hard-coded TH10's `jp`/`chs` persisted score
path, violating the existing shared-orchestration contract gate. The unchanged
paths now live in Product Catalog storage metadata, consumed through
`scoreStorageFileForGame` by both old and new views and Runtime service. Wire
paths and on-disk identity have not changed.

Diagnostics/progress display is coalesced to four notifications per second;
critical Runtime events and protocol acknowledgments remain immediate. This is
a tested notification bound, not a measured phone frame-rate improvement.

Repository core gate subsequently passed in 47.4 seconds with one worker after
the score-path correction. The UI aggregate separately includes strict typing,
ownership, Runtime/Package/relay/Replay/input tests, UI preferences and static
routing plus the complete SPA build. Browser CI has been authored for normal
Chromium/Firefox/WebKit execution, same-environment legacy/new UI screenshots,
recordings, interrupt sequences and raw frame-time evidence. Until a run has
actually completed, none of those browser checks is marked passed.
