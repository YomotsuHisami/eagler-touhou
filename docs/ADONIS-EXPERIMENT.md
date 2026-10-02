# Adonis experiment integration

Date: 2026-10-02. Branch `experiment/adonis`, base `b82c1e2`.
Worktree `D:/workspace/eagler/worktrees/adonis/eagler-touhou`.
No production tree changes, push or deployment.

## What is usable

TH08 and TH09's matching experimental multiplayer Runtimes support `Rollback` (0),
`Adonis without rollback` (1) and `Adonis + Rollback` (2). The host selects mode
and a fixed delay before start. TH08's experimental starting values are 4f / 2f, not
measured RTT/P95 recommendations. Baseline mode and other products keep their
existing policy. Nine frames is available only for an Adonis session.

`start.adonisMode` is checked and published by the relay in the lobby snapshot,
propagated through `netplayAdonisMode` in canonical configure options, and
validated in each title's native HELLO along with D. Players and spectators use the
same host-authoritative mode. P2 cannot start, invalid modes/D are rejected,
and repeated start messages cannot alter an active session's timing.

Timing controls are shown only for TH08/TH09 multiplayer. Nonzero mode on another
product is explicitly rejected, not silently ignored by an unported Runtime.
The Runtimes must be built from `../th08` or `../th09`, not ordinary/eagler
outputs. TH08's tested build is `th08_web/artifacts/multiplayer`; TH09's
packaged directory is `th09_web/build-eagler-multiplayer`. Do not publish or
substitute it into the main site without a separate explicit instruction.

## TH09-first refinement: rollback switch

The user narrowed further work to TH09 before more title adaptation. TH06/07/10
remain disabled; the existing TH08 implementation and selector are left alone.
In TH09, the separate three-mode row is replaced by an **Enable rollback**
switch immediately left of the input-delay capsule, on the same row.

The switch defaults on in a new room. On selects mode 2 (full rollback with
Adonis phase timing); off selects mode 1 (exact-input delay without snapshots or
resimulation). Mode 0 stays available to developer comparison tools, not as a
second user-facing TH09 timing dropdown. A manually selected D is never changed
by the switch. On/Auto retains the existing network/device delay recommendation
rather than silently adding a new 2-frame queue. Off/Auto uses the explicitly
labeled 4-frame experimental starting value. Both modes accept manual D=0..9.

Only the host can change the proposal before start; actual mode/D still travel
through the existing authoritative start/snapshot/configure/HELLO path. Because
the room does not broadcast draft timing, other clients see the existing
"Set by host" capsule while in the lobby, not a guessed switch state. Once
starting, the switch reflects the announced policy and is locked for everyone.

`test-th09-rollback-control-browser.py` exercises the real built Launcher with a
loopback relay and fixture host metadata. It checks default-on, mouse/Space
activation, preservation of manual D=9, host-only controls, no misleading guest
preview, room re-entry, placement at 1280/960/390/320 px and English at 320 px.
The button has a 44 px hit area and visible keyboard focus. The full test passes
in `artifacts/adonis-refine-ui-05`; screenshots and the JSON report are retained.
Fixture metadata does not include a playable game: these are UI/protocol gates,
not proof of a game launch, phone performance or public deployment.

```powershell
$env:EAGLER_WORKSPACE_ROOT='D:/workspace/eagler'
npm run build:launcher
python tests/test-th09-rollback-control-browser.py --output artifacts/NEW-UNIQUE-UI-RUN
```

The test owns and closes its local HTTP/relay processes. The first attempt used
an obsolete card/create-button navigation route; another failed because the
externally managed development server expired. Both attempts are retained and
were repaired in the harness, not hidden by relaxing layout or input checks.

## Repository map

All trees are under `D:/workspace/eagler/worktrees/adonis`, each on
`experiment/adonis`. Base commits:

| Directory | Base | Status |
| --- | --- | --- |
| th06 | b3df2df | Partial unvalidated driver/shell/scheduler edits; NOT exposed |
| th07 | 77af369 | Partial unvalidated initialization edits; NOT exposed |
| th08 | c23c67d | Both modes, component/Replay gates, WASM and 2P/3P browser gates |
| th09 | 5b9305c | Both experimental modes implemented and tested |
| th10 | a064121 | Correct MP base; title implementation pending |
| eagler-common | c239e13 | Policy, phase statistics and 29-test gate; commit 5669eff |
| eagler-touhou | b82c1e2 | TH08/TH09 experimental selection / authoritative protocol |

Read `../th09/docs/multiplayer/ADONIS-EXPERIMENT.md`, its bounded
`adonis-evidence.json` and the continuation series reports, plus
`../th08/docs/multiplayer/ADONIS-EXPERIMENT.md`, before continuing.
TH09 retains failed and long-stall evidence; a later pass does not erase it.
Native component tests are not a
substitute for an individual title's deterministic world and browser proof.
The raw Adonis/VPatch binaries were neither executed nor redistributed.

## Verification

Offline npm dependencies and `npm run build:launcher` succeeded (54 TS files).
`node node_modules/typescript/bin/tsc -p tsconfig.launcher.json --noEmit` passed.
The following behavioral tests passed:

```powershell
node tests/test-multiplayer-runtime-options.mjs
node tests/test-multiplayer-lobby-snapshot.mjs
node tests/test-multiplayer-input-timing.mjs
node tests/test-runtime-protocol-model.mjs
node tests/test-netplay-relay-product-policy.mjs
```

These cover option propagation, unsupported-title rejection, invalid values,
host-only start and immutable running timing. TH09 browser transport tests
and TH08's final 3P pure/2P hybrid host tests also ran against this experimental
relay with host-admitted mode/D, not a baseline room with independently
overridden runtime fields. The newly exposed
TH08 selector has not received a full Launcher visual/accessibility browser
audit. The TH09 switch's narrower browser evidence is documented above.

During this refinement, a combined rerun of `test-netplay-relay-product-policy`
once hit its unchanged 5-second generic relay-only route timeout. An isolated
repeat passed (`artifacts/adonis-relay-policy-retry.log`). There was no relay
implementation or timeout change in this UI patch, and the first failure is not
claimed fixed or discarded. TH09's separate actual RTC and instrumented relay
game tests also passed, with their scope recorded in `../th09/docs/multiplayer/TH09-REFINEMENT.md`.

To use the relay in TH09's local tests, set
`EAGLER_RELAY_SOURCE=D:/workspace/eagler/worktrees/adonis/eagler-touhou/server/netplay-relay.mjs`.
Do not accidentally test a new Runtime against the old canonical relay and
claim that the new room contract was exercised.

For TH08's corresponding local tests, set
`EAGLER_LAUNCHER_ROOT=D:/workspace/eagler/worktrees/adonis/eagler-touhou`.
Its test server now serves the shell's `directory-keyboard.mjs` dependency;
the earlier missing-module boot timeout never reached gameplay.
