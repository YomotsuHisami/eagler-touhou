# TH08 / TH09 / TH10 keyboard ownership follow-up

Requested scope: repair the analogous gaps identified after Issue #21's
TH06/TH07 fix. The user explicitly declined further tests and had requested
integration into the working trees. This follow-up has source review only;
build, package, generator parity check, automated tests, browser and device
acceptance are **not run**. Earlier TH06/TH07 PASS results do not cover this work.

## Code evidence and change

- TH09 managed Runtime synthesized ShiftLeft for an unidentified, location-zero
  release after ShiftRight DOWN. Directly clearing scan 42 left scan 54 hosted.
- TH08/TH09/TH10 sampled hosted OR SDL keyboard state. Their clear functions
  cleared hosted flags without resetting SDL. Actual stale SDL state on a
  particular device remains a hypothesis; the source permits that reassertion.
- Common `browser/directory-keyboard.mjs` now uses the existing common physical
  owner algorithm. Native and Launcher sources have separate owner maps and
  publish their union. UP uses the raw identity evidence and releases the stored
  DOWN code. Known modifier sides stay independent; an unidentified release
  with no side retires the whole matching family. On such an ambiguous device
  this may release a second modifier that is physically still held; a fresh
  DOWN restores it. Orphan UP and repeat cannot rearm cancelled owners.
- Full code/key/legacy decoding covers letters, digits, punctuation, function
  keys, modifiers, navigation and Numpad, preserving title KeyConfig input.
- Updated C++ hosts detect `Module.resetBrowserKeyboard` and consume the hosted
  state supplied by this DOM owner. SDL keyboard sampling remains the fallback
  for older shells. SDL event draining, touch, physical gamepads and the existing
  keyboard-like Gamepad D-pad path remain separate.
- Lifecycle clear invokes the browser hook, clears hosted flags and SDL state,
  and clears TH08/TH10 sampled snapshots. Shell blur, visibility, pagehide,
  context loss and stop use this clear. C++ game open/close and TH09 existing
  pause/network/restart clears share it. Keyboard and keyboard-clear commands
  execute their synchronous input bodies at receipt rather than waiting behind
  resource or filesystem operations. This also preserves clear-then-fresh-DOWN
  ordering while preventing delayed queued input from crossing cancellation.
- TH09 refuses spectator keyboard input in the managed shell and C++ key
  export; spectator end clears local state. Confirmed-frame/network algorithms
  and remote input are unchanged. The standalone TH09 shell also uses the
  shared owner while preserving touch-button source merging and dialog guards.
- TH08/TH10 practice hotkeys use the same owner and clear hook; other keyboard
  keys still reach C++. This also avoids consuming practice hotkeys while
  practice is disabled.
- No unconditional stage reset was introduced: legitimately held movement or
  focus across stages is preserved. Release reconciliation fixes the underlying
  physical ownership rather than masking it at a stage boundary.

## Source distribution

The self-contained `sdl-runtime/directory-keyboard.mjs` in each title is
generated from common `keyboard-owners.mjs` plus `directory-keyboard.mjs` by
`tools/sync-directory-keyboard.mjs`. Generation was performed as a source edit;
its `--check` gate was not run. No common submodule pin was changed.

TH08/TH10 `portable/package-eagler.mjs`, TH09 `build-eagler.mjs` (ordinary and
multiplayer variants) and Launcher `product-catalog.mts` all declare the module.
New WASM and closed Runtime directories still need a future build before these
changes can take effect in a served/published Runtime. No generated Runtime,
retail resource, private artifact, publication or deployment is part of this
change.

## Worktree identities

| Repository | Canonical branch and base | Upstream tracking commit at start | Topic |
| --- | --- | --- | --- |
| common | main `29a00f547d9ebeb6763025fa756ab0702ef0e08c` | not used | `worktrees/common-directory-keyboard` |
| TH08 | eagler `03138ee78c4d54ee945d7f9b5e8f39afe5abd455` | origin/main `fa94b0d43b525cef99c43eebb7e53dbb8f9fb588` | `worktrees/th08-directory-keyboard` |
| TH09 | eagler `1a62b11a480cef659a925d06fc1c3441776eceb2` | origin/main `5ea04507537350bea9410ba28594903af374d221` | `worktrees/th09-directory-keyboard` |
| TH10 | eagler `bf2f5fe73ce40add4e00a747c41cba4359e7f1d3` | origin/main `e8a939e11d989122eaf83f50cb2849a166a54392` | `worktrees/th10-directory-keyboard` |
| Launcher | main `33aeab9326aa82cafe80add39d89237aa7b64daf` | not used | `worktrees/launcher-directory-keyboard` |

All topics use `fix/directory-keyboard-ownership` in their respective repository.
The changed owners are browser physical keys, title hosted-key sampling,
keyboard cancellation and Runtime source inventory. Complete topic diffs were
read before integration. Canonical TH08 presentation-lab changes, its existing
common submodule modification and untracked multiplayer build are preserved;
common's existing transport work and untracked recovery test are preserved.

Integration status is recorded by the topic and merge commits. Post-integration
build/validation gates remain **not run**, honoring the user's instruction.
