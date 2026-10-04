# Initial document recovery

`app/browser/boot-recovery.js` is authored ES5 and is inlined unchanged by the
Framework root. It runs immediately after the compatibility gate, before module
loading or styles. An intentional compatibility redirect marks the gate so the
watchdog does not race the guide; the guide's explicit one-page retry still has
recovery protection.

The watchdog bounds initial hydration to 12 seconds of active, visible document
time. Page hiding, BFCache suspension and background tabs pause that budget.
Only a committed root App signals ready. Network metadata, local package
maintenance, game preparation, images and fonts are not boot prerequisites.
The timer and global listeners are removed permanently at ready. A successful
late hydration also removes an already visible recovery card.

Before ready, failed same-mount module scripts, the tagged Framework inline
module, errors in generated launcher assets and identifiable same-mount dynamic
import failures can show recovery immediately. Other resource failures and
ordinary rejected requests do not count as boot failure. Opaque failures fall
back to the bounded watchdog. No legacy Launcher or additional history/Runtime
owner is introduced.

The independent root route ErrorBoundary can render even if the app providers
fail. It cancels pending boot recovery, uses `scope=route`, and never resets the
document watchdog. This is a last-resort Framework render/route failure screen,
not the game Runtime's existing recoverable error interface.

Both recovery surfaces use the shared Chinese/English catalog and main visual
tokens. Their actions are explicit reload and copy. Copy uses the clipboard
fallback on ordinary HTTP or denied clipboard access and offers selectable text
if both methods fail. Diagnostics include only fixed scope/category, elapsed
active time and online status (boot), or a bounded HTTP status (route). No raw
error messages, stack traces, URLs, room identifiers, browser identities, saves,
storage contents or uploads are involved. Recovery never clears storage.

## Explicit Reload and WebKit failed preloads

[WebKit issue 270357](https://bugs.webkit.org/show_bug.cgi?id=270357) documents
failed `modulepreload` resources surviving ordinary reload. The current engine's
[resource policy](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/cache/CachedResourceLoader.cpp)
checks a raw-resource type mismatch before its unconditional reuse of preloads.
The cache behavior is upstream evidence; applying that mechanism to this app is
a repair whose browser acceptance still belongs to CI.

Only when the user clicks the initial recovery card's Reload, the document
revalidates at most 64 unique authored modulepreload URLs with raw `fetch`
requests using `cache: reload`, then performs one ordinary reload. URLs must be
direct JavaScript filenames under this app's same-origin generated asset mount;
query strings, fragments, other directories and origins are excluded. Requests
omit credentials and referrers and reject redirects. There are no automatic
requests on failure, retry loops, cache deletion or storage changes.

The entire revalidation wait is capped at two seconds; failures still fall
through to the one ordinary reload. Repeated clicks are ignored, and a late
hydration, replacement recovery owner/card or page departure prevents stale
callbacks from reloading a working or different document. Pending fetches are
aborted when the browser provides AbortController.

## Verification ownership

- `tests/ui-main/boot-recovery.test.mjs`: actual ES5 source with deterministic
  synthetic DOM, clock, document lifecycle and clipboard; route boundary SSR
- `tests/test-browser-compatibility-gate.mjs`: emitted root/nested artifact order,
  unchanged classic sources, build-mount configuration and module ownership
- `tests/ui-main/boot-recovery.spec.ts`: explicit CI browser cases for synthetic
  inspector-aborted/delayed chunks, real-origin no-store HTTP 503 responses,
  late hydration, reload and route render failure. Reload must re-request the
  same failed chunk successfully (HTTP 200) before the library is accepted.
- `tests/browser/boot-recovery-fixture.mjs`: explicit test-only loopback HTTP
  origin serving the unchanged Framework artifact. A per-request header
  selects a temporary module failure without browser interception or shared
  mutable fault state
- `tests/ui-main/boot-recovery-fixture.test.mjs`: deterministic request scoping,
  503 no-store response and unchanged-artifact pass-through policy

The missing-entry case can intentionally reach the 12-second watchdog in
WebKit, which does not always report an import error with a usable URL. The
abort-only cases retain that coverage. Both 10cd54a inspector-abort and e45d1e6
intercepted-503 traces showed the failed URL was not re-requested on reload,
although recovery appeared within its original bound. The latter disproved the
narrower abort/cache-toggle explanation. The current reload cases require real
origin HTTP 503 followed by HTTP 200 for the exact same module-script URL (not
just the repair's raw fetch), a fresh document, and a committed library with
one Runtime. No timeout is extended to hide a failed assertion.

The browser cases are intentionally synthetic and do not establish game/GPU
support or native-runtime acceptance. They require the existing explicit
browser CI lane; writing these cases is not evidence they were executed.
