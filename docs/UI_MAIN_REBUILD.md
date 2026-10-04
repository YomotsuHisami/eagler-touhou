# Main-based frontend rebuild

## Baseline and scope

Source and visual baseline: `main` at `9899dff447a0f62fd0f2c5396d2f3f80b3b58058`.
Core continuity update: main `a1426aba791a1eb2e1d52b2e9bf489d7af91761e` (PR #35)
is synchronized by content: TH11 physical C, sampled touch pulse queue, hint
translation and their tests. The initial visual baseline is unchanged.
Implementation branch: `experiment/ui-main`, created directly from that commit.
`experiment/ui-rebuild` remains a backup; its visual additions and ancestry are
not the baseline. Publication of source checkpoints does not authorize deployment.

Current stage: A baseline audit and an initial B component/navigation sample.
The sample is not a complete launcher. Its narrow TH06 validation flow becomes available only when actual matching publication resources are mounted.
Canonical settings are now wired to an injected, shared preference owner. The TH06 preparation path and lifecycle controls are connected in source; real Runtime gameplay and mobile acceptance remain unverified. C migration, D publication/offline integration and E
cutover/retirement remain incomplete. The existing production entry is untouched.

## Dependency ownership and deployment decision

- React + strict TypeScript: component lifecycle and typed views
- React Router Framework SPA: the only route/history owner within the new entry
- Tailwind: compiled utilities and tokens drawn from current main's existing
  palette, fonts and layout; no stock template or prior experimental artwork
- Radix Dialog: dialog semantics, keyboard dismissal and focus containment
- Motion: selected entry/exit presentation, respecting reduced-motion preference
- Babel parser (build/test only): TypeScript-aware dependency-boundary checks
- Existing Package/Runtime/contracts: data formats, resource verification and
  game protocol authority; these are not replaced by a UI framework

React Router is selected because [self-hosting](SELF_HOSTING.md) promises a static
site deployable to an object store/CDN without a Node runtime, and [PWA](PWA.md)
retains offline cold navigation and a single cache worker. No current requirement
needs a rendering server. Next.js can support server deployments; introducing
that requirement here would change distribution responsibilities. Its static
export is possible but offers no established advantage for this browser-owned
Package/Runtime workflow. Framework SPA still prerenders the root during build,
so initial rendering must be browser-global safe.

Official references checked 2026-10-04:
- https://reactrouter.com/how-to/spa
- https://nextjs.org/docs/app/guides/static-exports
- https://nextjs.org/docs/app/guides/self-hosting
- https://nextjs.org/docs/app/guides/offline-support
- https://tailwindcss.com/docs/installation/using-vite

No private Router state/subscription bridge is carried forward. Public Link,
useNavigate and route hooks own the initial sample. The previous branch's
UNSAFE_DataRouterContext/Router.state/Router.subscribe adapter is unresolved
research, not an accepted dependency. Interrupted loading and async close guards
must be proven with public APIs before expanding the sample; eager small task
shells can keep the close surface present while business content loads.

## Current-main preservation checklist

The machine-readable Product Catalog plus Host/Runtime declarations control
visibility/capabilities. Prose tables can lag: do not reintroduce old four-game
limits or expose hidden TH20 from a hand-maintained list. TH11 details, touch
function key, keyboard ownership and existing storage/resource mounts require
explicit verification during extraction.

Preserve main's complete Adonis chain: product declaration, auto/manual and mode
proposal, launch options, current-run native result validation, P1 relay mirror,
frozen timing, spectator isolation and diagnostics. TH09 has a declared 9-frame
manual limit; other products use their own catalog limit. Do not replace actual
input-channel measurement with lobby RTT recommendations. Preserve idle-based
Runtime download timeouts and directory recovery. New React service boundaries
must be extracted/reconciled against main, not copied wholesale from the backup.

Existing app.mts still owns important orchestration. Importing its bootstrap into
React would create two owners, so the experimental entry never executes app.js.
Main's native history/dialog helpers are behavioral references only; do not layer
their listeners onto the Router entry. Runtime gets one stable host outside modal
routes, with origin/source/epoch checks, retained generations and save-failure
protection before any game launch is exposed.

## Local verification

For exact external artifact prerequisites and the remaining real-game/phone
checks, use [the local Stage B acceptance guide](UI_MAIN_LOCAL_ACCEPTANCE.md).

```sh
npm ci --ignore-scripts
npm run check:ui
npm run preview:ui
```

Open http://127.0.0.1:4173/ in an isolated test browser profile. UI output lives
in `.cache/build/ui-main/client`. Only current main public assets are copied;
no Service Worker registration, game bytes, credentials or user saves are added.
Missing JS/WASM stays 404. Optional `--assets-root` is an explicit external
private artifact mount, not a permission to publish its contents.

CI records Chromium/Firefox/WebKit and mobile-viewport navigation and screenshots.
These are component evidence only. Physical phone model/browser remain unknown;
mobile viewport is not phone acceptance. The current cloud browser execution
restrictions are not retried or bypassed; real-game verification needs a permitted
browser environment. No production Service Worker or old user storage is changed.

The first help sample uses a parent-owned eager shell with `?panel=help`; no new route-module import is needed when opening it. Heavy feature contents will load inside that committed shell. This changes the mechanism rather than emulating the prior private subscriber.

## B service checkpoint

The root retains one dormant iframe across navigation and overlays. It uses
main's HostedKeyboard owner and imports the Runtime service only after mount.
The service receives an explicit verified-generation/configuration plan; the bounded TH06 Prepare → Start control is tied to the matching prepared epoch. Acquisition and explicit save/close guards own its lifecycle.
It separates ready/configure/launch/first-frame, checks source/origin/game/epoch,
retains generation leases, preserves a frame after save failure, merges partial
runtime-info and bounds health display updates to one 250ms timer. Tests inject
ports and clocks: they do not run retail games or prove playable content.

The settings form shares canonical storage/migration owners and one store across
product views. SP/MP sharing follows current main, while the canonical shared
touch sub-options stay global. Unknown Host metadata hides optional features
without erasing saved intent. Language/music controls need actual metadata; live
Runtime application, full touch layout/editor, room restrictions and cross-tab
updates are not yet implemented here.

A build-only resolver maps existing Node contract facades to their authored
browser contracts. It rejects Node modules and the legacy app/lobby bootstrap in
the client graph and emits a checked ownership manifest. This does not add a
second contract or Router implementation.

The first main-based source checkpoint passed 16 browser cases across four
projects. Screenshot review found a missing compact masthead override and a
capture race before covers/fonts settled; checkpoint `0be8e7b` corrected these
and passed 20 browser cases, with its mobile-viewport screenshot inspected. Those results do not establish source-baseline pixel parity or phone
performance.

The bounded TH06 acquisition seam can inspect actual published metadata without
installing, and can prepare a verified canonical Japanese/music-none base through
existing Package APIs. It never starts a game automatically. Missing publication
metadata/code/data/fonts remain explicit blockers; no launch is available from
this source-only checkout. Its synthetic tests do not prove actual availability.

## Public navigation and preparation validation

The root mounts one Runtime close guard using public `useBlocker`. Its public
synchronous predicate invalidates obsolete navigation intents before delayed
save completions can proceed; no private Router state or subscription is used.
Toolbar exit and route departure share the same save/retry/stay/discard path.
Abnormal native exit during sync preserves the loss warning instead of reporting
a successful save. Known-detached frames release hooks/leases without messaging
or navigating the removed document.

Help is one root-owned query panel, including when the game was prepared from a
background task and started over the library. The plain TS preparation job is
root-lived: closing a view does not cancel it. Cancellation is an explicit
“cancel preparation and download” action; completed preparation never auto-starts
a game. Start requires the exact still-prepared epoch. This diagnostic profile
is Japanese, music-none, keyboard and does not apply the general settings form.

The library shell retains horizontal rail selection/position in memory across
view remounts, including bounded viewport/catalog changes. This is view state,
not a new history or persistent storage owner.

Browser close-guard tests use a separate `.cache/ui-main-harness` and port 4175,
with an explicitly fake service and empty iframe. The fixture is not part of the
UI deployment output. Node service tests and Playwright specs have separate
runners. Original gameplay, save durability against real Runtime, full language/
music/touch/room integration, phone performance and offline cutover remain open.


## Browser coverage boundary

Tailwind 4 documents Chrome 111+, Safari 16.4+, and Firefox 128+ as its core
support line. Main already explicitly requires Chromium 126+; no equivalent
verified minimum Safari/iOS or Firefox support matrix was found. Vite 8's default
build target also includes Safari/iOS 16.4. This branch therefore does **not**
claim preservation of unspecified older Safari/Firefox coverage. Lowering
Tailwind alone would not establish that: JS/CSS build targets, individual CSS
features, and actual target devices need coordinated validation before release.
The user's phone model/browser version remains unknown.

Sources: [Tailwind compatibility](https://tailwindcss.com/docs/compatibility),
[Tailwind upgrade requirements](https://tailwindcss.com/docs/upgrade-guide#browser-requirements),
[Vite build target](https://vite.dev/config/build-options#build-target).

## Reversible dialog work

The sample Help and Runtime close confirmation share one controlled
Radix/Motion shell. The shell remains mounted across route changes; Router or the
close guard owns its `open` value. One stable portal reverses interrupted motion
without cloning content. Exiting content becomes inert and leaves the accessible
tree; delayed focus restoration is guarded against a reopened/newer surface or
an already selected focus destination. Reduced-motion preference changes are
observed even while a dialog is open. A separate synthetic fixture covers this
mechanism; this does not establish phone animation performance.


### Open B lifecycle finding

The source-only review found a joint-session-history risk in the Runtime frame
lifecycle: assigning/removing iframe `src` after its initial document can add
child history entries that a top-level Router blocker does not observe. The
synthetic close-control fixture now keeps its empty marker document unchanged;
that prevents fixture contamination but does not fix or validate the production
service. The service now uses explicit `Location.replace` for verified same-origin Runtime
entries and `about:blank`; there is no `src` fallback. Failed cleanup retains the
session/lease and reports `closeError` separately from `saveError`.
`saveUnavailable` identifies terminal loss even when an epoch remains only for
cleanup, so UI cannot offer an impossible save retry. A separate browser fixture
uses the actual service with an explicitly synthetic same-origin protocol peer,
injected in-memory resources, and real joint-history checks. Its outcome must be
verified in CI; it does not prove original-game or durable-save behavior.
Real-game Back/close acceptance remains open.

Reference: [iframe navigation](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#navigate-an-iframe-or-frame),
[replacement navigation](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-replace).


## Verified source checkpoint

At `643b04a`, both core CI and the experimental UI workflow passed; the UI log
records **184 browser cases passed** across Chromium, Firefox, WebKit and the
mobile viewport. This includes public Router close guards, reversible dialog
measurements, and the real Runtime service's replacement-navigation lifecycle
against an explicitly synthetic protocol peer. Original-game saves/gameplay,
actual phone responsiveness and full migration/offline acceptance are still not
covered by those results. Independent fault injection remains necessary for
preparation-time and cleanup-failure cases beyond the normal browser flows.
