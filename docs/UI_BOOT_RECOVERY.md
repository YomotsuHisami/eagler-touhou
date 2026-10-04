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

## Verification ownership

- `tests/ui-main/boot-recovery.test.mjs`: actual ES5 source with deterministic
  synthetic DOM, clock, document lifecycle and clipboard; route boundary SSR
- `tests/test-browser-compatibility-gate.mjs`: emitted root/nested artifact order,
  unchanged classic sources, build-mount configuration and module ownership
- `tests/ui-main/boot-recovery.spec.ts`: explicit CI browser cases for synthetic
  missing/delayed chunks, late hydration, reload and route render failure

The browser cases are intentionally synthetic and do not establish game/GPU
support or native-runtime acceptance. They require the existing explicit
browser CI lane; writing these cases is not evidence they were executed.
