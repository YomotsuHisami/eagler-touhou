# Mobile Browser Playbook

Status: active

## Purpose

Handle iOS/Safari-WebKit, Android browsers/WebView, focus, fullscreen,
first-frame and lifecycle problems with explicit platform evidence. Keep browser
compatibility work separate from game-semantic and package claims.

## Applicability and authority

- Playwright/WebKit and emulator results are browser/platform evidence only. Real iOS or Android acceptance requires the named real device and the stated manual path.
- Desktop Chromium/Edge acceptance is not mobile acceptance.

<!-- knowledge-id: K-MOBILE-001 -->
## Normal design

The current product carrier is the ordinary same-origin Launcher iframe loading
App-owned Runtime HTML/JS/WASM. Runtime DATA/resources come through the normal
Launcher preparation/Package Store path; do not invent a mobile-only Blob,
page-memory or Service-Worker Runtime filesystem.

`adb reverse` or TCP forwarding is a local Android debugging transport; it
must not be presented as public deployment. Safari, WebView, Via and other
mobile browsers need their own focus/orientation/first-frame evidence.

Treat focus/fullscreen/first-frame as a lifecycle sequence: page visible → user gesture when required → Runtime carrier ready → canvas/surface attached → audio/browser APIs permitted → input focus retained. A game canvas moving is not enough if audio, touch or first-frame state is still blocked.

## Invariants and pitfalls

- Emulator pass does not imply real-device pass.
- First-frame, touch, audio and long-duration results must not be merged into a generic `mobile PASS`.
- Do not use Blob/`about:blank`/nested-carrier tricks to bypass same-origin,
  storage or browser lifecycle constraints.
- BrowserStack/manual credentials are external secrets and must not be stored in the repository.
- Do not let a second browser/CDP client take over a harness-owned browser session.
- Separate local lab ports, public relay routes and production origins in reports.

## Superseded approaches

The earlier `about:blank`, nested carrier, Runtime-bytes, ArrayBuffer-package,
self-contained carrier and SW-URL experiments are historical evidence, not
supported product carriers.

## Code and system anchors

- `docs/ARCHITECTURE.md`: authoritative same-origin Runtime/App Shell/Package
  ownership.
- `app/runtime/RuntimeHost.tsx`, `app/services/runtime.client.ts`,
  `src/launcher/runtime-session.mts` and the React touch/layout owners: one
  retained iframe, session lifecycle and mobile UI.
- `tests/browser/launcher-playwright-webkit.py` and
  `tests/test-browser-capabilities.py`: supporting browser evidence.
- Each target Runtime's shell/platform bridge: title-specific lifecycle, input
  and audio owner.

<!-- knowledge-id: K-MOBILE-002 -->
## Verification

1. Name browser, OS, device/emulator, orientation, build lane and origin.
2. Reproduce first-frame and focus from a fresh page; record user gesture and audio permission state.
3. Test orientation, touch, fullscreen, reload and background/foreground independently.
4. For Android local debug, document the forwarding route and keep it separate from network/production claims.
5. For iOS, use real-device/manual evidence before calling the carrier accepted; retain Playwright as supporting browser evidence.

## Deliberately omitted claims

Browser automation, emulators and one named device do not prove universal
iOS/Android acceptance or long-duration mobile stability.
