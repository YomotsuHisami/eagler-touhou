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

A: Source/capability baseline established. Initial CI screenshots were inspected
on desktop and mobile viewports. They exposed composition drift: a wide
rectangular rail and expanded settings replaced the existing square-cover dock
and score card. The sample now follows the original final CSS composition;
corrected screenshots and physical-device frame-time baseline remain pending. The current cloud's shell Chromium
was denied an OS socket operation; CUA localhost navigation was blocked. Neither
limit was worked around or counted as a browser pass.

B: Framework, shared controls, library/settings/task navigation and independent
Runtime/package/room services implemented. Tests use deterministic Runtime ports
and synthetic storage or a real local relay; actual TH06 WASM/DATA is available only in a private external fixture root.
Real-game launch/help/exit remains unverified.

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
recordings, interrupt sequences and raw frame-time evidence. Later run results are recorded below with their exact evidence limits.

### Browser lane readiness

The first browser CI run at commit `204af41` stopped before any assertion: its
preview command used an unsupported separated port argument, and the root
readiness probe lacked the navigation Accept header. Preview now accepts both
argument forms, while Playwright uses explicit `--port=5174` and `/index.html`
readiness. An actual local HTTP process test verifies this exact CLI, default
Accept readiness, deep navigation and missing-WASM 404; this is not a browser
assertion. Cross-browser results remain pending the corrected run.

### First actual cross-browser findings

At `053f97b`, the standard browser lane ran 28 cases: 23 passed and five failed.
Four failures concerned the legacy visual reference: the test targeted the hidden
old title, initial first-use notice needed dismissal, and Firefox's existing
WebGL2 gate rejected the CI environment. The latter gate is not bypassed; that
legacy visual comparison must report an explicit unverified/skip result.

The mobile rapid-interruption failure was real: Escape preceded the lazy panel's
Radix registration after its URL changed. The persistent parent now owns pending
open cancellation and the authoritative router/React-commit gap. Twelve bounded
router regressions pass; the unchanged rapid browser test and an additional
artificially delayed cold module test remain the acceptance gate. No animation
was disabled or delayed to conceal this race.

Score portraits now follow the existing favorite-loadout evidence rather than
showing an invented default character for an empty save. Committed slot changes
notify the score view through one application-owned subscription; the existing
slot database remains its storage owner.

### Second browser evidence and sample fidelity

At `3db9578`, 27 browser cases passed, one Firefox legacy-reference case was
explicitly skipped for the unchanged WebGL2 gate, and four cold-open assertions
failed. The traces show each failing history baseline was read on `/`, before the
initial card navigation committed. The corrected test waits for the parent URL
and region, retains exact history length, and adds router index and Back/Forward
invariants. The original rapid interruption test passed all four projects.

Actual desktop and mobile-viewport screenshot review is underway. The sample now
uses the existing square-cover rail, compact masthead, empty-score evidence and
red capsule launch controls. The overflow menu uses Radix with the same preference
owner and storage keys. Donation and first-use-notice UI parity remain outstanding;
this checkpoint does not claim full header parity. Screenshots now wait for final
opacity while recordings continue to capture normal default animation.

The pending-open close adapter temporarily reads `UNSAFE_DataRouterContext` for
an event-time navigation snapshot across the router/React commit gap. This is an
unresolved architecture exception, not an approved stable public API boundary.
A public navigation-intent alternative is being evaluated with cancellation,
redirect and browser-history semantics before any replacement. Real game data,
physical phones, full capability parity and production/offline switching remain
unverified. No production switch or deployment has occurred.

### Pending history traversal and resumed validation

At `3955ef5`, the completed UI lane passed 35 cases with one explicit Firefox
legacy-comparison skip. The RuntimeHost browser harness also passed, using its
synthetic Runtime protocol fixture; this is not original-game acceptance.

A separate controller regression was then found: during loader-pending Forward,
the native history cursor already points at the child even though the rendered
route remains the parent. Treating this as a pending link/PUSH replaced the child
with a duplicate parent. The controller now distinguishes pending POP and closes
from the entered child's own history marker. Seven new actual React Router
regressions cover Forward, Back, direct entries, repeated closes and latch reuse
(19 controller tests total). Browser confirmation of these new paths is pending.
The existing private-context architecture exception remains explicit.

Default-motion recording is now a separate test from the legacy screenshot
comparison so a Firefox legacy compatibility skip cannot suppress new-UI frame
records. Intervals start with the second RAF timestamp instead of mixing clocks;
records retain long-task support metadata and are diagnostic only, with no phone
performance threshold claimed.

The supplied original TH06 Runtime JS/WASM, game data and shared fonts are now
available in a private external artifact root. They are excluded from Git and
publication. Availability does not establish successful real-game execution;
the cloud browser restrictions remain unchanged and are not bypassed.

Isolated preview artifact routing now includes the official `games/`, `shared/`
and root `*.package.json` layout. HTTP tests verify explicit mounting, missing
resources, ranges and symlink containment; repeated/trailing-slash aliases cannot
expose the private build ownership manifest. The private TH06 artifact-root HTTP
check matched descriptor sizes/hashes for data and shared fonts, with Runtime
JS/WASM MIME/length/cache checks. This is resource delivery evidence only.

### Populated visual comparison

The `c11e327` standard and UI checks passed: 57 browser cases, three explicit
Firefox legacy-WebGL2 skips, and the synthetic RuntimeHost harness. Its new
Forward cancellation and new-UI motion-record tests passed all four projects.
The artifact contains synthetic imported/selected TH07 and TH08 saves, not user
save bytes or gameplay. Reviewing those screenshots exposed a genuine portrait
placement regression: React anchored art inside the score section, clipping
bodies at the settings divider. The corrected layer uses the existing panel
anchor, image geometry and opacity; browser assertions now check that geometry.
Score section order and decoded-cover accent are shared with the legacy view,
rather than independently reimplemented presentation rules. New screenshots are
still required after these corrections; a green behavior test is not visual parity.

### Framework API boundary

React Router remains pinned to 8.4.0 in Framework Mode. The temporary adapter
uses `UNSAFE_DataRouterContext`, `Router.state` and `Router.subscribe`; the latter
two are also explicitly private in the installed declarations. Owning a Data
Router instance would not turn these into supported public APIs and is not a
proposed escape hatch. Current Framework `getContext`, middleware and
instrumentation do not expose an equivalent synchronous committed-location plus
pending-action subscriber. The stable-hook alternative changes immediate
interruption semantics and has not been substituted. This is an unresolved
release/maintenance exception, bounded by the current navigation regression suite.

### Header and notice sample

Header/footer provenance, existing donation content, update-age display and
first-use content are being restored through the same shared modal primitives.
Global notice/donation visibility has one URL-query owner, preserving the active
product route and Runtime iframe. Automatic onboarding replaces the boot entry;
manual opening pushes an entry and closes through the shared close-intent path.
The existing seen keys, legacy migration and mark-on-available-display semantics
are shared with the old controller. Loading does not mark content seen, failed
loads remain retryable, and late automatic content cannot interrupt newer routes.
The update-age display only reads the existing endpoint; it registers no Service
Worker and is not evidence of Stage D update/offline functionality.

The header checkpoint `4b053c8` passed 81 browser cases with three explicit
legacy Firefox skips. The following query-interruption checkpoint exposed a
WebKit stale-onboarding race: after URL commit but before React location render,
a delayed content response still considered its old boot route current. The
async ownership check now uses the centralized event-time adapter and retires
its token across pending/committed navigation, including leaving and returning
to the same history key. The browser assertion is unchanged; revalidation of
this fix is required. This adds coverage, not a claim that the private API
exception is resolved.

`275dd7e` passed the unchanged stale-onboarding assertion in all four projects.
A separate mobile WebKit failure occurred when the refresh test reloaded before
initial lazy imports settled. The captured trace shows cancelled route imports,
Framework's built-in module-error reload recovery, then a second same-URL
navigation interrupting Playwright's `reload` call. Ready-page refresh and cold
import interruption now have separate tests. The latter tolerates only that exact
WebKit recovery signal with its observed module-error log, and still requires the
correct usable final route and normal dismissal. Other errors are not swallowed.
Notice/donation stills now wait for completed entry opacity while separate rapid
interruption tests continue to exercise animation-in-progress behavior.
