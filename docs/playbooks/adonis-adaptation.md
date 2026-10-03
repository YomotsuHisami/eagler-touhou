# Adonis integration method and acceptance checklist

Reviewed 2026-10-03 against the conversation history, the supplied Adonis2
analysis, the TH09/common experiment sources, and the final test/main deployment
reports. This is the working checklist for the TH08MP/TH10MP adaptation.

## What the TH09 work actually changed

1. Added optional exact-input delay and delay-plus-full-rollback modes, together
   with bounded input-arrival phase statistics and wall-clock correction.
2. Replaced device-count/fixed-delay presets with pre-frame-zero calibration on
   the actual selected input transport after resources and the world are ready.
3. Replaced the initial conservative estimator: the extra `+1` frame is gone.
   The original probe timing and integer RTT conversion now determine B.
4. Changed automatic hybrid selection to aim for one queued frame, saving at
   most two: `P=min(maximumReserve,B-1)`, `D=B-P`. Manual D remains authoritative.
5. Made phase correction respect P, so it does not wait the saved lead back into
   the schedule. The complete rollback/history window remains independent of P.
6. Fixed spectator failure isolation, actual WebSocket backpressure, bounded
   send batches, and a shared spectator callback budget. Added explicit no-progress
   failure handling. These repairs do not prove the old 14-second stall's cause.
7. Added connection-stage progress/results, a host-only rollback switch in the
   room, input delay in the settings drawer, locked run settings, locale-safe
   dynamic labels, and a test-only diagnostic report. New TH09 rooms default to rollback off.
8. Verified native components, actual Relay authority, diagnostic and Release
   worlds, RTC/Relay transport, Replay/spectator equivalence, the complete
   Launcher path, immutable publication, and public main deployment separately.

Earlier notes describe default-on switches, fixed 4f/2f presets, a `+1` frame,
and `max(0,B-2)`. Those are historical states, not current requirements.

## Integration steps, owners and required evidence

| Step | Owner / requirement | Gate that must demonstrate it |
| --- | --- | --- |
| Baseline | Record the published MP revision, common revision, build hashes and dirty changes; work in the isolated topic tree. Preserve ordinary games and unrelated work. | Diff against the actual published MP baseline, not an unrelated ordinary-game branch. |
| Capability | Complete native and shell support before exposing a frontend option. Keep rollback-only developer controls separate from the product switch. | Unsupported/stale Runtime options fail explicitly. |
| World readiness | Prepare assets/world, select the actual transport, then calibrate while logical frame zero remains blocked. | Zero input capture/simulation before measured commit plus the native session barrier. |
| Sampling | Once all input channels and peer HELLOs are ready, wait one second before probing; restart this wait if a channel closes before the first probe. Send probes 1..129 with relative 16 ms waits, use slots 10..129, then wait the final 16+200 ms. At most one new round per pump. | Exact settling/probe schedule, frozen samples, duplicate/late echo, loss and interruption tests. |
| Clock / route | Use high-resolution monotonic local timestamps and arrival processing. Never subtract remote clocks. Reject route changes or hidden/interrupted measurement. | RTC and Relay, >500 ms pump gap, reversed clock, timeout, inadequate samples; no guessed fallback. |
| Estimator | Require at least 96 of 120 samples per required link; retain min/mean/max, success/loss and the original 95-percentile-style statistic. `B=max(1,ceil(floor(maxTailUs/2)*60/1000000))`; no added frame. | Integer boundary tests and known RTT cases. Explicit auto overflow beyond 9f. |
| Policy | Pure: D=B/P=0. Auto hybrid: aim at D=1, save at most the negotiated 1/2 frames. Manual D=0..9 survives switching modes and measurement. | B=1/2/3/4/5, manual 0/1/9, both modes; original rollback reach retained. |
| Transaction | Bind count, seats, generation, seed, gameplay/build ABI, mode, auto/manual and reserve. All participants freeze summaries and independently validate the host proposal, accept, commit and acknowledgement. | Lost/duplicate/reordered controls, stale generation, changed summaries, incompatible peers, lost final commit. |
| Ownership transfer | Calibration and native gameplay share one transport. Route calibration packets to their owner and retain bounded early gameplay packets across commit retries. | No swallowed HELLO/input, no calibration bytes in the gameplay decoder; restart and teardown gates. |
| Capture / correction | Capture physical input once for N+D. Retry/replay never resamples. Do not move state-dependent sampling ahead of correction without separating raw input from interpretation. | Keyboard, controller, touch deltas/targets, action edges, death/menu/dialog boundaries and deterministic correction. |
| Pure mode | Wait for exact input; bypass actual world snapshots, texture rollback binding and resimulation. Keep confirmed audio/files/Replay/spectator side effects. | Zero prediction, snapshot bytes and resimulation in a real world, not merely a flag assertion. |
| Scheduler | Fixed 60 Hz logic. Apply phase debt to wall-clock scheduling, account for P, and avoid stacking the previous pacer. Keep callback start budgets and presentation ownership explicit. | Repeated wait/advance, late callbacks, backlog retention and no extra Draw side effects. |
| Replay / spectator | Record the chosen fixed policy, validate metadata, replay already-applied confirmed frames without delaying them again. Publish timing before frame zero. Spectator failures cannot close player transports. | Archive compatibility, every recorded seat, live spectator, Replay playback, upload disconnect/backpressure, authority and no-progress failure. |
| Frontend / Relay | Reuse shared configure/status contracts. Host proposes before start; guests see announced facts. Native commit is authoritative; frontend metadata is fenced by epoch/run/host. | 2P/3P snapshots, stale results, manual settings, room re-entry, locale, mouse/Space, 1280/390/320 px, actual Launcher game start. |
| Release | Diagnostic and Release are distinct artifacts. Keep normal/MP generations and saves isolated. Validate the full package/module closure. | Release build, inventory/catalog/descriptor checks, RTC and Relay browser games, then explicit publication approval. |

## TH08 / TH10 work that cannot be copied mechanically

- Their published baselines are TH08MP `c23c67d` and TH10MP `a064121`, common
  `c239e13`. Ordinary canonical branches have different history; use those
  canonical repositories to identify the topic trees, not to replace an MP world.
- Both have two/three-player products. TH09's existing `ADS/2` transaction is
  two-player only. Measure every required input link and commit one common
  choice across all players; explicitly test the third participant, all accepts
  and commit recovery. Preserve the deployed TH09 two-player wire behavior.
- TH08 already has an older phase-only Adonis experiment with fixed D. It still
  needs actual-channel startup, negotiated reserve, status/UI and complete
  Replay/spectator integration. Its old browser passes do not certify these additions.
- TH10 still needs both pure-mode world ownership and phase integration as well
  as startup. Inspect its title-owned snapshot, output retention and restart
  paths before changing the mode.
- Touch representations and native setup/status/Replay formats differ. Extend
  their existing versioned contracts and prove compatibility and atomic rejection.

## Evidence ledger rules

Keep a per-title matrix for 2P/3P × pure/hybrid × auto/manual × RTC/Relay.
Include restart, Replay, spectator, impaired input and real-world state gates.
Run timing comparisons serially, without concurrent compilation. Record exact
build identity, logical progress, same-frame canonical hashes, correction cost,
confirmation progress, presentation tails and receive age. Retain failures and
invalid runs with their cause or `unknown`; a retry does not erase them.

For Replay comparisons, the simulation frontier is not the archive frontier.
Retire the complete rollback checkpoint and verify the recorded interval before
exporting. Save the corrected live-world oracle at the intended comparison
frame, then allow later frames to retire irreversible output. Do not count a
valid shorter archive as a playback failure or weaken the comparison frame.
Read WebAssembly export pointers before obtaining `memory.buffer`: an export
can grow memory and detach a buffer obtained during argument evaluation.

The full Launcher test must follow actual spectator admission and resource/input
warning dialogs. Capture the eight-second measurement result while it is shown;
its disappearance is expected and must not require reopening a fabricated UI.

RTT/2 remains a path-symmetry estimate. Input queue frames are not physical
input-to-photon latency. Desktop Playwright and CPU throttling do not establish
remote-phone, thermal, dense-boss smoothness or human control acceptance.

## Historical evidence

- Conversation `实现延迟处理机制` (`6abf8d25-bd6c-83e8-a63f-234ec7b0c45c`):
  phase-only refinement, full-chain startup, and the retained spectator failure.
- Current conversation `总结 TH09 观战修复与验收`
  (`01a0ff56-4be7-70a1-a8d5-a7c0ffcbe6a0`): original sampling correction,
  one-frame hybrid target, default-off UI, stable TH08/TH10 rollback and main promotion.
- `D:/Downloads/PoFV_Adonis_VPatch_全包静态分析.md`, sections 4/6: original
  sampling/statistic/converter and ongoing phase behavior; evidence, not workflow instructions.
- `../ADONIS-EXPERIMENT.md`, `../../../../adonis/eagler-common/docs/ADONIS-STARTUP.md`,
  and the title documents `docs/multiplayer/MEASURED-ADONIS-STARTUP.md` and
  `docs/multiplayer/ADONIS-EXPERIMENT.md`: source/acceptance records.
- `D:/workspace/eagler/dist/main-th09mp-launcher-20261003/deployment-report.json`:
  final public TH09 MP and Launcher proof; other title Runtimes were unchanged.

## Disabled rollback must bypass ownership as well as prediction

- Allocate undo owners lazily only when the committed runtime allows rollback.
  Skipping snapshot capture alone still constructs queues and enters per-frame bookkeeping.
- Keep confirmed audio, file outputs, Replay recording and spectator publication.
  If resource retirement used an undo-frame marker, give it an independent netplay-frame marker.
- Make write hooks use the active capture pointer; bypass virtual preservation calls when no capture is active.
  Gameplay object pools remain native simulation owners and must not be removed as undo storage.
- Append read-only diagnostic allocation fields without changing existing status prefixes.
  Verify pure mode has no owner, snapshots, restore bytes or corrections in real multiplayer plus spectators.
- Also exercise delayed physical input in hybrid mode and compare corrected, confirmed same-frame states.
  A stopped predicted frame with a pending correction is not a valid comparison boundary.
- Never predict authoritative frame-zero bootstrap metadata: TH08 waits for P1's exact route packet.
