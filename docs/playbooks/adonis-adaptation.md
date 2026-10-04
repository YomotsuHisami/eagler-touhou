# Measured multiplayer startup playbook

Status: active

## Purpose and scope

Guide timing for products declaring `inputTiming.measuredStartup` in the
Product Catalog. Read [Multiplayer](multiplayer.md) for transport and room
ownership, and [Replay Determinism](replay-determinism.md) for input/replay changes.
This profile covers TH08MP/TH09MP/TH10MP; TH06MP/TH07MP keep their existing policy.
TH09 is two-player. TH08/TH10 also require three-player evidence.

## Ownership and normal sequence

The host chooses automatic/manual delay and pure/hybrid mode before starting.
Launcher passes the request through the versioned Runtime configure boundary.
Resources, world preparation, actual-input-channel measurement and the native
commit belong to the Runtime/shared netplay layer. Launcher/Relay results are
immutable display metadata, not gameplay authority.

Block logical frame zero until native participants commit one common policy and
pass their session barrier. Measure every required link, including P2–P3 in 3P.
Use high-resolution local monotonic timestamps; never subtract remote clocks.
After channels and peer HELLOs are ready, settle for one second. Restart settling
if a channel closes before the first probe. Send rounds 1–129 with relative 16 ms
waits, at most one new round per pump. Use rounds 10–129, then wait 16+200 ms.
Each required link needs at least 96/120 valid samples. Freeze the tail statistic,
min/mean/max and sample/loss counts. Reject interrupted/hidden measurement,
changed routes, reversed clocks, excessive pump gaps and inadequate samples.
Do not silently substitute guessed timing.

Bind negotiation to participants, seats, generation, seed, build/ABI, mode and
requested policy. Test proposal/accept/commit/ack recovery and stale controls.
Preserve bounded early native packets when calibration hands over the transport.

## Timing policy

```text
B = max(1, ceil(floor(max_required_RTT_us / 2) * 60 / 1000000))
automatic pure:   P = 0, D = B
automatic hybrid: P = min(configuredReserve, B - 1), D = B - P
```

Configured reserve is 1 or 2. There is no extra `+1` frame. Manual D survives
mode switches. The catalog owns its UI limit; Runtime validates its supported
range. Automatic overflow fails explicitly. Freeze the choice for the run;
live RTT cannot rewrite D. P is allowed prediction lead, not a reduced rollback
history. Phase correction adjusts wall-clock scheduling while accounting for P.
Preserve authoritative 60 Hz simulation and presentation ownership.

## Invariants and pitfalls

- Capture physical input once for N+D. Retry/resimulation never resample it.
  Separate raw input from state-dependent touch/menu interpretation.
- Pure mode bypasses undo allocation, capture, restore and correction. Preserve
  confirmed audio/files, Replay/spectator publication and native game object pools.
  Give resource retirement an independent frame owner when undo storage is absent.
- Never predict authoritative frame-zero bootstrap data; wait for P1's exact input.
- Publish timing before spectator frame zero. Replay/spectator confirmed input
  must not receive D a second time. Spectator failures cannot close player transports.
  Bound upload batches, backlog and callback work separately.
- Read a WASM export pointer before obtaining `memory.buffer`; exports can grow
  memory. Compare corrected live state at the intended frame, then retire the
  complete rollback checkpoint before exporting irreversible Replay output.

## Code anchors

- `src/contracts/product-catalog.mts`: support and manual limits.
- `src/contracts/runtime-protocol.mts`: configure boundary.
- `src/contracts/netplay-timing.mts`: display validation and reserve formula.
- `src/launcher/multiplayer-runtime-options.mts`, `multiplayer-lobby-snapshot.mts`,
  `app.mts`: propagation, host authority and current-run results.
- `src/launcher/netplay-calibration-connection.mts`: temporary measurement UI.
- `server/netplay-relay.mjs`, `spectator-frame.mjs`: results and spectator policy.
- `eagler-common/browser/adonis-calibration.mjs`: shared status adapter.
- Matching title repositories: native setup/ABI, barrier, scheduler, rollback,
  Replay and spectator owners.

## Verification

Start with timing boundaries, runtime options, snapshots, Relay authority and
spectator termination. Then test real worlds across applicable
2P/3P × pure/hybrid × auto/manual × RTC/Relay cases. Include restart, delayed
physical input, corrected same-frame states, every recorded seat and live
spectator admission. Prove pure mode has no undo owner or corrections.

UI fixtures cover permissions, fixed controls, locale, keyboard and narrow layout.
Actual Launcher tests follow real warning/admission flows and capture the temporary
measurement result while displayed. Verify matching Release artifacts and the
package/module closure separately. Keep build hashes, paths, screenshots and
failed attempts in validation artifacts outside distributed source. Preserve
failed/unknown results. Component, browser, Release, public-network and physical
device evidence are distinct; RTT/2 is a symmetry estimate, not input-to-photon latency.
