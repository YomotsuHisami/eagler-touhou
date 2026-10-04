# Main-based frontend rebuild

## Baseline and scope

Source and visual baseline: `main` at `9899dff447a0f62fd0f2c5396d2f3f80b3b58058`.
Implementation branch: `experiment/ui-main`, created directly from that commit.
`experiment/ui-rebuild` remains a backup; its visual additions and ancestry are
not the baseline. Publication of source checkpoints does not authorize deployment.

Current stage: A baseline audit and an initial B component/navigation sample.
The sample is not a complete launcher: it deliberately has no fake launch button.
Canonical settings are now wired to an injected, shared preference owner. Package orchestration, Runtime gameplay and mobile acceptance are not yet connected/verified. C migration, D publication/offline integration and E
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
The service receives an explicit verified-generation/configuration plan; no UI
launch control is exposed before acquisition and close guards are connected.
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
capture race before covers/fonts settled; both are being corrected and must be
rechecked. Those results do not establish source-baseline pixel parity or phone
performance.

The bounded TH06 acquisition seam can inspect actual published metadata without
installing, and can prepare a verified canonical Japanese/music-none base through
existing Package APIs. It never starts a game automatically. Missing publication
metadata/code/data/fonts remain explicit blockers; no launch is available from
this source-only checkout. Its synthetic tests do not prove actual availability.
