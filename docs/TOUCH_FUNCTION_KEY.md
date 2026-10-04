# Reserved mobile C function key

Launcher reserves the ordinary `KeyC` / `c` / keyCode 67 channel. A title opts
in through `functionKeyGames` in `touch-function-key.mts`. Only TH11 is enabled
initially; this does not claim support for future titles such as TH16.

Default behavior is one sampled short pulse per press, not a toggle and not
repeated pulses on a long hold. The input owner also reserves an explicit hold
mode for future mechanics. It uses the existing hosted-key transport: no new
per-title network command, Bomb alias or special Launcher gameplay callback.

The C control has its own editable portrait/landscape placement, scale and
priority. Older version-6 layouts may omit it without losing saved positions.
Unsupported games and spectators hide the control. Pointer cancellation,
background, keyboard-clear and touch disable release its input. Unrelated
pointers must not release another pointer's control. iOS uses touch events.

## TH11 Runtime contract

- KeyC maps to ordinary held bit 4; `GameInput` generates its pressed edge and
  existing Replay records it along with the other logical keys.
- Marisa B accepts that edge in the existing five-formation switch branch,
  alongside the original Shot/Focus combo. Bomb restrictions remain unchanged.
- Reimu A accepts the edge only at the original horizontal boundary, then
  invokes the original warp state machine's second-tap state. Enemy-manager,
  enemy presence, Bomb gates, sounds, option rebuild, warp duration and crossing
  position remain owned by that state machine. The dedicated shortcut can be
  used while the mobile Shot/Focus buttons are on. Original double-tap remains.
- Other shot types do not gain either ability.

No direct position assignment, gameplay logic in Launcher, automated second
direction press, or simulated Bomb is used to implement the action.

## Verification and compatibility

`tests/test-touch-function-key.mjs` verifies pulse timing, pointer ownership,
capture release and cancellation in the default repository gate.
`tests/test-touch-layout-model.mjs` covers saved-layout compatibility;
`tests/test-hosted-key-release.mjs` covers keyboard lifecycle cancellation.
Run `npm run check` for these gates and the strict Launcher build.

Runtime gameplay, Replay reproduction and physical Android/iPad behavior need
separate Runtime/browser/device verification; Launcher unit gates do not
establish those results. Existing Replay input stores the new bit, but old
runtimes cannot reproduce newly recorded C shortcuts and must be updated
alongside Launcher. No resource/language ZIP update is required.
