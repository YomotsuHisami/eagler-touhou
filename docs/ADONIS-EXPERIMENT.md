# Adonis experiment integration

Date: 2026-10-02. Branch `experiment/adonis`, base `b82c1e2`.
Worktree `D:/workspace/eagler/worktrees/adonis/eagler-touhou`.
No production tree changes, push or deployment.

## What is usable

TH08 and TH09's matching experimental multiplayer Runtimes support `Rollback` (0),
`Adonis without rollback` (1) and `Adonis + Rollback` (2). The host selects mode
and a fixed delay before start. Experimental starting values are 4f / 2f, not
measured RTT/P95 recommendations. Baseline mode and other products keep their
existing policy. Nine frames is available only for an Adonis session.

`start.adonisMode` is checked and published by the relay in the lobby snapshot,
propagated through `netplayAdonisMode` in canonical configure options, and
validated in each title's native HELLO along with D. Players and spectators use the
same host-authoritative mode. P2 cannot start, invalid modes/D are rejected,
and repeated start messages cannot alter an active session's timing.

The selector is shown only for TH08/TH09 multiplayer. Nonzero mode on another
product is explicitly rejected, not silently ignored by an unported Runtime.
The Runtimes must be built from `../th08` or `../th09`, not ordinary/eagler
outputs. TH08's tested build is `th08_web/artifacts/multiplayer`; TH09's
packaged directory is `th09_web/build-eagler-multiplayer`. Do not publish or
substitute it into the main site without a separate explicit instruction.

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
selector has not received a full Launcher visual/accessibility browser audit;
it uses the existing select/style/i18n ownership rather than a separate UI.

To use the relay in TH09's local tests, set
`EAGLER_RELAY_SOURCE=D:/workspace/eagler/worktrees/adonis/eagler-touhou/server/netplay-relay.mjs`.
Do not accidentally test a new Runtime against the old canonical relay and
claim that the new room contract was exercised.

For TH08's corresponding local tests, set
`EAGLER_LAUNCHER_ROOT=D:/workspace/eagler/worktrees/adonis/eagler-touhou`.
Its test server now serves the shell's `directory-keyboard.mjs` dependency;
the earlier missing-module boot timeout never reached gameplay.
