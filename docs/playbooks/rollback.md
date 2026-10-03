# Rollback Optimization Playbook

Status: active

## Purpose

This playbook is the reusable optimization record for deterministic rollback netcode in the Eagler Touhou workspace. It is not a protocol primer and it is not permission to weaken gameplay correctness. Its job is to answer a narrower question:

> How do we make full rollback cheap enough for Web/mobile while preserving fixed-step gameplay, exact corrections, Replay determinism and immediate control feel?

The primary evidence comes from TH07MP because that project produced the deepest rollback profiling and the strongest browser/mobile-oriented validation. TH06/other titles may reuse the method, but title-specific state ownership must be re-proven before copying implementation details.

This document intentionally preserves **successful changes, unsuccessful experiments, invalid measurements, misleading partial wins and production tradeoffs**. A rollback optimization history is only useful if future work can see what not to repeat.

## Applicability and authority

- Read `multiplayer.md` first when the task is about product architecture, protocol, transport, spectator or Launcher room behavior.
- Read this file first when the task is specifically about rollback cost, prediction cost, snapshot/restore cost, resimulation, input-delay tradeoffs, rollback-induced stalls or rollback performance on mobile.
- Read `performance-rendering.md` alongside it for browser main-thread, renderer, WebGL, audio-pump or profiling questions.
- Read `replay-determinism.md` whenever an optimization touches input ownership, fixed-step scheduling, Replay data, RNG/ECL ordering or state coverage.

The fixed invariants below outrank any benchmark result.

<!-- knowledge-id: K-RB-001 -->
## Non-negotiable invariants

Rollback optimization must not obtain speed by changing the game being simulated.

- Simulation remains fixed 60 Hz unless the original title explicitly defines otherwise.
- One physical/logical input sample is captured once. Retransmit, prediction, retry and resimulation reuse captured logical input and never resample DOM/touch/controller state.
- Bullet/enemy counts, collision, graze, deathbomb, ECL, RNG, score, timers and authored state transitions are not reduced or skipped to improve frame time.
- Canonical checks are not weakened to hide divergence. When a hash differs, identify the first divergent owner/state.
- Bomb/action edges are not predicted unless the title's semantics explicitly prove prediction safe. TH07 kept Bomb unpredicted.
- Rollback/presentation are separate. A draw-only local prediction that moves the sprite without moving collision state is not an acceptable substitute for rollback.
- Snapshot optimization must restore the exact logical bytes/state required by the simulation. Approximate equality is not a rollback correctness rule.
- Confirmation semantics remain authoritative. Optimizations may reduce work around confirmed history but cannot redefine what is confirmed.
- Buffered or no-rollback endpoint modes are product policies, not proof that rollback is unnecessary.

If a change cannot be described while keeping these invariants intact, it is not a rollback optimization; it is a gameplay/netcode design change and requires separate acceptance.

## Core mental model: split rollback cost before optimizing

Do not treat "rollback is slow" as one cost. TH07 work repeatedly showed that different symptoms came from different layers.

Separate at least these components:

1. **forward simulation cost** — ordinary fixed-tick gameplay;
2. **snapshot capture cost** — bytes examined/copied and allocation/indexing work while moving forward;
3. **restore cost** — copying historical first-write values back into live state;
4. **resimulation multiplicity** — how many logical frames are replayed after one correction;
5. **prediction mismatch rate** — how frequently remote input differs from prediction;
6. **input scheduling delay** — local frames intentionally buffered before simulation;
7. **catch-up/event-loop cost** — how much historical work runs before yielding back to browser input/network/audio;
8. **transport blackout** — missing input because bytes did not arrive, not because rollback took too long;
9. **presentation/render cost** — high-refresh draw/submission, which must be measured separately from logical throughput;
10. **instrumentation cost** — tracing/readbacks/profiling can itself create stalls.

Always measure more than average FPS. Useful rollback reports include:

- logical frames/s;
- Present interval p95/p99/max and count >50 ms;
- rollback operation count;
- resimulated logical-frame count;
- snapshot ticks and bytes;
- restore copied/skipped bytes;
- heap/arena growth/allocation counts;
- maximum reconciliation wall time;
- confirmed-frame progress and receive age;
- actual transport impairment applied;
- canonical checkpoint hashes;
- input-to-render decomposition when responsiveness is under investigation.

PASS means the requested run completed and correctness gates passed. PASS alone does not mean the presentation was smooth.

## Investigation chronology and reusable lessons

The sections below follow the order in which TH07 rollback performance was actually understood. This ordering matters: later conclusions often exist because an earlier apparently-good idea failed.

## Phase 0 — dense full-copy snapshots were already a dead end

Before the 2026-09-16/17 optimization work, TH07 had already replaced the older dense world-copy rollback direction with sparse first-write ownership. Historical rebase accounting records roughly **16 MiB-class full copies** for the old snapshot path; other summaries rounded the full-world cost closer to ~19 MB depending on representation/accounting. The exact number is less important than the architectural conclusion: duplicating the whole world every tick was not a viable Web/mobile rollback strategy.

The sparse journal retained deterministic manager/player/RNG/input/Stage state while keeping draw-only presentation clocks outside logical rollback ownership.

**Lesson:** first eliminate obviously dense state duplication. Later optimizations in this playbook assume first-write/sparse ownership already exists.

<!-- knowledge-id: K-RB-002 -->
## Phase 1 — make the generic rollback journal stop allocating itself to death

### Initial problem

The earlier journal used container-heavy history/indexing. Rewind/confirmation destroyed capacity that resimulation immediately needed again, creating avoidable allocation churn. The first useful improvement was not prediction; it was fixing storage lifetime.

### Adopted journal direction

`RollbackJournal` was changed from deque/map-style history to:

- a bounded slot ring;
- reusable uninitialized byte arenas;
- contiguous block metadata;
- an index-based AVL structure for overlap/search;
- retained capacity across rewind/confirmation where immediate replay would reuse it.

The design still enforces duplicate-first-write, overlap, address-overflow and capacity rules.

Two small allocation cleanups happened in the same performance pass and are worth remembering even though they were not the main win:

- the frame-advantage/trimmed-mean path stopped allocating a temporary vector per received input packet while preserving the 64-sample policy;
- spectator diagnostics stopped encoding/transmitting absent spectator work and reused a tiny diagnostic object instead of allocating it repeatedly.

### Important failed sub-experiment: recursive AVL insertion

An earlier recursive implementation looked cleaner but made normal forward work about 8–14% slower. It was rejected. The adopted iterative insertion reuses overlap-search state and stops rebalancing once subtree height is unchanged.

**Lesson:** benchmark the forward path as well as rollback. A structure that improves rewind but taxes every ordinary frame can be a net loss.

### Controlled WASM microbenchmark result

Same compiler, synthetic 1,536 blocks x 2,048 bytes, 160 measured iterations, pre-warmed history:

| Workload | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Forward, address order | 0.360687 ms | 0.323014 ms | 10.4% |
| Forward, scattered | 0.448058 ms | 0.385896 ms | 13.9% |
| Six-tick rollback | 4.074920 ms | 3.087361 ms | 24.2% |
| Discard/recapture | 0.544655 ms | 0.393672 ms | 27.7% |

Warmed candidate allocation count was zero in that benchmark. The old six-tick workload accumulated 1,476,962 allocations over 160 iterations.

### What this did not prove

The journal microbenchmark did not prove whole-game mobile smoothness. A controlled browser A/B later showed mixed results because storage is only one term in the full cost model.

## Phase 2 — browser event-loop ownership matters

### Bounded catch-up

Rollback/catch-up can monopolize the browser even when each individual tick is valid. `FrameBudget` added a wall-time boundary for **starting additional catch-up ticks** while retaining the existing tick-count bound. One due tick is always allowed; remaining accumulator debt stays for a later callback.

This is not preemption of an atomic rollback. A single expensive reconciliation can still run longer than the budget.

### Remove synchronous Web frame-end sleep

During rollback profiling, TH07 still had a native-style `SDL_DelayNS` at the end of an Emscripten requestAnimationFrame callback under some settings. This blocked browser input/network/audio work for no logical benefit.

The Web path was changed to return immediately after Present. rAF, the nonblocking presentation cap and the fixed-step accumulator own pacing. Native pacing remains separate.

This became a single-player Web improvement too: it is not rollback-specific once discovered.

### Focus-loss lifecycle repair

Mobile/browser focus changes exposed another main-thread/lifecycle problem. `SDL_EVENT_WINDOW_FOCUS_LOST` on Web is not reliable evidence that the page entered background; touch/canvas focus can change transiently. The Web path now cancels touch state without freezing the app. Real background events retain lifecycle ownership.

### General lesson

If a rollback stall is measured in seconds, do not immediately conclude that resimulation itself ran for seconds. Inspect:

- JS event arrival age;
- relay/socket byte counters;
- bufferedAmount/pending writes;
- confirmed-frame progress;
- heartbeat/timer progress;
- maximum measured reconcile time.

TH07 had multi-second gaps where game calc/draw were only a few milliseconds and relay heartbeats continued, proving the long pause existed before relay receipt rather than inside rollback computation.

The strongest control removed the game entirely: `websocket-loopback-health.py` ran blank same-origin pages against a minimal echo server. Both pages kept sending while receives stopped for about 1.65 s in one run, and another direct-mode run ended with hundreds of unanswered messages. Because this reproduced without WASM, rendering or rollback, that blackout class could not honestly be blamed on expensive reconciliation.

## Phase 3 — input buffering and prediction experiments

The first major product-level attempt traded responsiveness for fewer corrections.

### Fixed local input delay

Input captured at physical/logical time F was scheduled for F+D while simulation consumed frame F. A 3-frame delay is ~50 ms at 60 Hz; later mobile profiles used 6 frames (~100 ms).

The buffer reduces lateness probability but adds real local latency to movement and action buttons. No visual trick hides that delay.

### Important ownership bug discovered by adding delay

The physical touch producer originally exposed a pending accumulated delta through a peek-style API. Delaying the consuming Player made the same physical displacement capturable more than once, and an old delayed logical frame could clear newer physical movement.

The fix changed ownership:

- `Touch::TakePlayerDelta` transfers each fresh displacement exactly once;
- `DirectTouchBegin` marks a new gesture and resets stale remainder;
- `DirectTouchDelta` carries fresh displacement;
- synchronized simulation owns speed-limited unapplied remainder;
- rollback snapshots and canonical hash include remainder state;
- missing input predicts zero **new** displacement while preserving already-received remainder;
- release/mode switch/new gesture/Player-chain lifecycle resets the remainder correctly.

This was a correctness repair uncovered by buffering. Do not generalize that buffering itself caused all earlier stutter.

### Matched physical-intent model

Using the same periodic 24-unit drag with a 4-unit/tick speed cap:

| Representation / delay | Rollbacks | Replayed frames |
| --- | ---: | ---: |
| Legacy pending snapshot / 0 | 722 | 3,366 |
| Legacy pending snapshot / 3 | 361 | 1,320 |
| Fresh delta + remainder / 0 | 246 | 990 |
| Fresh delta + remainder / 3 | 124 | 373 |
| Fresh delta + remainder / 4 | 124 | 249 |

The representation change mattered more than merely increasing delay. It reduced mismatch-driven replay without changing touch precision.

### Stable legacy touch prediction

An experimental predictor repeated a legacy delta briefly only after consecutive identical finite deltas. Bomb remained unpredicted. It helped a steady synthetic trace but not variable/batched touch, and it could overshoot a sudden stop by one extra delta.

**Outcome:** not enabled by default.

### Delay sweeps and misleading partial wins

Browser sweeps showed that fewer resimulated frames do not automatically mean smoother gameplay.

One validated variable-touch series at 50 +/- 10 ms one-way impairment produced:

| Delay | Total resimulated frames | Logic FPS P1/P2 | Largest visible gap |
| --- | ---: | --- | ---: |
| 0 | 7,169 | 59.62 / 60.08 | 50 ms |
| 3 | 4,049 | 38.17 / 38.47 | 7,433 ms |
| 4 | 3,026 | 59.93 / 60.08 | 50 ms |

The 3-frame run reduced replay work but was a terrible user experience. Its largest measured reconciliation was only ~20 ms, which helped prove the 7.4 s pause was not one giant rollback.

### Shortening prediction window

Reducing the maximum prediction window lowered some replay counts but could make a slow endpoint wait earlier. A 4x CPU-throttled experiment with a narrower window performed worse and also contained a transport gap.

**Outcome:** do not shorten a prediction ceiling just because resimulation count decreases. The window is a resilience budget as well as a rollback-depth bound.

### Dynamic delay was deliberately not adopted

Increasing/decreasing input delay dynamically can duplicate/drop input unless the representation and transition rules are explicit. One-shot displacement and action edges are not generic button states. TH07 kept per-session delay fixed during this phase.

## Phase 4 — identify snapshot tax with isolation controls

When mobile remained slow, the most important control experiment was not another micro-optimization. It was removing rollback snapshot/resimulation work from one endpoint while keeping the underlying game/render workload.

The slow endpoint returned to ~60 Hz in dense Stage 6/high-bullet conditions when snapshot/rollback/resim were absent. This proved that the base game/render load was not the whole problem and that rollback state ownership was the dominant mobile tax.

This isolation later motivated two different directions:

1. temporary asymmetric rollback ownership;
2. deeper full-rollback snapshot optimization.

## Phase 5 — reduce snapshot work without reducing state coverage

Several storage-side improvements accumulated here.

### Confirmed-prefix / frontier snapshots

Do not create rollback checkpoints for history that can no longer be rewound. During resimulation, confirmed prefix frames also do not need fresh rollback storage.

The `frontier` policy keeps snapshot work at the unconfirmed frontier rather than blindly recording every logical tick.

TH07 retained `always`, `demand` and `frontier` as explicit experimental policies while measuring. `frontier` became the responsive/balanced direction because it removed known-useless confirmed-prefix capture without changing rollback reachability.

### Sparse/contiguous Bullet capture

Per-object snapshot capture has overhead even when memory is contiguous. Bullet snapshot layout was changed to coalesce contiguous live slots/runs where exact state ownership allowed it.

### Bulk Web copy

Many tiny WASM copies can be more expensive than their byte count suggests. TH07 added bounded bulk copy paths using current WASM heap views and `HEAPU8.copyWithin` for known regions, while retaining correctness checks and safe fallback paths.

The harness kept `objects` versus `runs`, `wasm` versus `bulk`, and `sequential` versus `coalesced` as independent controls. This mattered because a bundled profile can look good while one component is neutral or negative; keep the knobs separable until the A/B is understood.

### Coalesced restore

When restoring multiple checkpoints, copying a newer saved region is wasted if an older region restored later fully covers it. Coalesced restore skips only fully shadowed newer copies. Partial overlaps preserve original restore order.

### Stable draw order

Rollback stress made Bullet drawing overhead visible. `StableDrawOrder` replaced the allocation/comparator-heavy `std::stable_sort` path with fixed renderer-owned scratch and cached keys while preserving exact stable ordering.

This is not rollback state, but it became a safe single-player optimization after 6,000 exact comparisons against the old stable sort.

### `UpdateLivePrev`

Each Bullet owns several ANM VMs, but only the normal VM, despawn VM and at most one selected spawn VM can become visible for the current state. Updating every dormant VM's previous presentation fields on every tick was unnecessary.

`UpdateLivePrev` publishes only potentially visible endpoints. Spawn still performs a full initialization of all VMs. Native/WASM tests compared 300,000 visible `AnmVm` states against the old full update.

This is presentation work, not rollback state coverage, and was later safely shared with ordinary play.

### Item Draw-state divergence and presentation purity

One real 3P checkpoint divergence isolated to Item metadata. The hash was not weakened. Investigation found that `ItemManager::OnDraw` changed `isOnscreen`, indicator sprite, alpha and VM fields. Different presentation counts could therefore change canonical state.

The fix moved authored appearance transitions to the fixed simulation tick. Draw now uses temporary interpolated position and restores the authored value.

This was both a rollback determinism fix and a high-refresh/single-player presentation-purity improvement.

### Send fresh input before expensive reconciliation

Once-only physical input that has already been captured should be transmitted before starting expensive historical reconciliation. Otherwise rollback work can make the *next* remote input late and create a feedback loop:

```text
late input -> rollback work -> delay local send -> peer receives later -> more rollback
```

TH07 reordered the driver so fresh captured input leaves early. Retransmission and resimulation still never resample hardware input.

## Phase 6 — mobile-balanced profile: successful smoothness, unacceptable latency

The combined mobile-balanced profile used:

- frontier snapshots;
- live-slot/runs capture;
- bulk copy;
- coalesced restore;
- reduced Bullet presentation work;
- fixed-tick Item appearance;
- early once-only input send;
- mobile presentation cap;
- large local input buffer (eventually 6 frames, ~100 ms).

In frozen Stage 6 Lunatic A/B, the slower endpoint's dense presentation improved from ~39 logic FPS / 135.8 ms p99 legacy settings to ~60 logic FPS / ~22–24 ms p99 in balanced runs, with zero >50 ms dense gaps in those runs.

This was a major performance success but a product failure for control feel. Real-device feedback rejected ~100 ms local latency.

**Lesson:** a netcode configuration can be technically smooth and still be unacceptable. Responsiveness is an independent acceptance axis.

The temporary 60 Hz presentation cap was also a real part of this exploration. A persistent ~900-bullet, 2x-slow-peer fixture ran near 60 logical FPS with the cap versus roughly 49 in an earlier otherwise comparable uncapped run. A harder curved/multi-sprite workload still managed only ~44–46 logic FPS at 2x slowdown, proving the cap was not a universal cure. After the zero-delay rollback path proved smooth on a real phone, the product returned to high-refresh presentation by default and kept 60 Hz as an explicit player option.

### O3/LTO experiment

`TH_WEB_SPEED_OPT` enabled O3/LTO without fast-math. The candidate preserved checkpoints but did not demonstrate a gain over O2; one comparison had a worse presentation p99. The project returned to O2.

**Outcome:** keep optimization-level experiments evidence-driven. "Higher optimization level" is not itself a result.

## Phase 7 — asymmetric delay and rollback ownership

### Asymmetric local delay sweep

Tests explored low mobile delay with larger desktop delay. Short runs showed that 3–4 desktop frames could absorb more late mobile corrections while the phone stayed responsive. Four desktop frames was the best of that specific sweep.

### Endpoint rollback ownership

The strongest mixed-device diagnostic/policy was:

- one mobile endpoint: ~1 frame local delay, exact buffered mode, no rollback snapshots/resim;
- desktop endpoint(s): ~4 frames local delay, full rollback, absorb late mobile corrections.

2P and 3P Stage 6 tests at 50 +/- 10 ms actual RTC input impairment reached ~60 Hz on the slowed phone endpoint with zero snapshot/resim work and matched canonical checkpoints.

This proved rollback cost could be moved off a constrained device while preserving a shared deterministic timeline.

### Why it was not the final preferred policy

Human testing found the desktop's ~67 ms local delay clearly bad. The approach solved phone performance by moving the responsiveness cost to another player.

It remains useful as a **diagnostic/control experiment**, not as a product mode. The shared Launcher no longer exposes a buffered/stability timing selector: TH06/TH07 production multiplayer uses the zero-added-delay, full-rollback path. Keep the generic core delay primitive for testing or a future evidence-backed design, but do not recreate the TH07 asymmetric policy as compatibility surface.

Rooms with multiple mobile endpoints were not validated under the single-mobile ownership policy and must not inherit that conclusion.

## Phase 8 — zero-added-delay goal and full rollback on every endpoint

The user requirement changed the optimization target:

> Netcode should add zero scheduled input frames on every endpoint. Any unavoidable wait should come only from the fixed 60 Hz tick boundary and physical/browser/display latency.

This forced optimization of rollback itself rather than hiding cost behind buffering.

### Important baseline correction

Before adding the final live Bullet backend, the existing frontier/runs/bulk/coalesced full-rollback code already handled a 1.5x-slow endpoint at Stage 6/zero input delay near 60 Hz. Under 4x CPU slowdown it still showed tail stalls. This baseline prevented falsely attributing all improvement to later code.

## Phase 9 — specialized live-part Bullet rollback journal

### Why a generic journal was still expensive

Bullet is a fixed pool of 1024 objects with known substructure. Paying generic address-search/index cost for every hot Bullet part is unnecessary when slot/part identity is stable.

### Partitioned fixed-pool journal

`PartitionedPoolJournal<T, Count, Parts>` records first writes by fixed slot and part. Lookup becomes direct slot/part indexing rather than generic address-tree lookup.

For Bullet, the object was partitioned into complete regions rather than hand-picked semantic fields:

- normal ANM VM;
- fast spawn VM;
- normal spawn VM;
- slow spawn VM;
- despawn/donut VM;
- remaining Bullet tail.

Complete VM/tail bytes include matrices, padding and pointer bytes. The optimization changes **when** bytes are captured, not what a captured part means.

### Live-part capture rule

At a checkpoint:

- active Bullet: save normal VM + despawn VM + gameplay tail;
- if currently spawning: also save the selected spawn VM;
- dormant spawn VMs remain live and are not recopied until a writer will change them;
- slot reuse, spawn initialization and destructive `memset` paths touch all parts before mutation.

Restore uses the oldest saved first-write value required for the target history. A part first written only in a later checkpoint is still restored correctly when rewinding past it.

### V1 result: fewer bytes, not enough CPU win

The first live-part version reduced peak Bullet snapshot footprint from roughly 5.2 MB to ~3.1 MB in the tested run, but capture CPU did not improve enough. This was a critical reminder that fewer bytes do not automatically mean fewer expensive operations.

### V2 result: batch gather/scatter

V2 first builds merged copy regions, grows capacity before copying, then executes one batched gather/scatter callback with `HEAPU8.copyWithin` on Web. Native keeps a memcpy fallback.

Under a 4x slowed endpoint, zero-delay Stage 6 improved from a baseline dense p99 ~47 ms / max ~102.6 ms / 6 >50 ms intervals to a live-v2 run around p99 38.7 ms / max 49.4 ms / zero >50 ms in that run, with canonical agreement.

Do not compare non-frozen runs as if they had identical physical input timing; use them as directional evidence unless the fixture is frozen.

## Phase 10 — exact-byte oracles before trusting sparse state elision

Sparse rollback optimizations are dangerous because a hash can miss an omitted future read or a test may never trigger a dormant path.

TH07 added increasingly strong oracles:

- randomized fixed-pool journal restore against dense byte copies;
- Bullet complete-byte restore comparisons;
- slot clear/reuse cases;
- cold/dormant part writes;
- real Stage 6 Bomb cycles;
- live backend on one peer against old journal backend on another;
- canonical checkpoint agreement across peers.

Real Stage 6 Bomb audits performed over one thousand complete Bullet-byte restore comparisons (1072 in one run; 1066 in a later dormant-elision audit) while retaining canonical agreement.

**Rule:** before enabling a state-elision optimization by default, prove exact restore with a stronger oracle than the optimized representation itself.

## Phase 11 — compact Bullet snapshot experiment failed

An attempted compact representation reduced memory by roughly one quarter in one experiment, but gather/pack overhead was slower and one canonical run diverged around frame 1500.

It was rejected.

**Lesson:** shrinking snapshot size is not enough. Packing/unpacking CPU, object traversal and hidden state coverage can cost more than the bytes saved.

## Phase 12 — dormant Bullet elision: correctness passed, default still off

A later experiment elided more dormant Bullet VM work and passed exact-byte Bomb audits plus canonical checks. It remained disabled by default because correctness alone did not establish a performance win large enough to justify more complexity.

**Lesson:** "safe" and "worth enabling" are separate gates.

## Phase 13 — experiments that did not pay off

Keep this list visible so future agents do not rediscover the same dead ends.

### Touch quantization / brief delta hold

Reduced some mismatch counts but did not improve tail latency enough and changes the represented physical input. Rejected as a default optimization.

### Causal-equivalence / absorb without rollback

The idea: if a late DirectTouch correction would produce the same authoritative movement after speed/boundary rules, absorb it without rewind. The implementation was deliberately conservative and mathematically safe, but useful accepted cases were nearly zero.

Rejected as an important optimization because real late touch deltas usually do change the historical trajectory.

### Initial frame lag

Adding startup lag by itself did not beat the better asymmetric-delay/ownership strategies and does not solve ongoing jitter.

### Longer checkpoint spans

Spans such as 4/6/8 reduce snapshot frequency but increase how far a correction may have to rewind and resimulate. Longer spans generally lost on tail smoothness. The final responsive profile favored a 3-logical-tick checkpoint span after testing 1/2/3 and longer variants.

Checkpoint span is **undo-storage spacing**, not local input delay.

The checkpoint implementation keeps one first-write journal open across the interval. If a correction targets the second/third logical frame inside that interval, restore goes to the interval start and resimulation advances from the actual restored frame. It is therefore incorrect to describe a 2- or 3-tick checkpoint as "skipping snapshots" or as 2/3 frames of input buffering.

### Incremental/sliced reconciliation

TH07 implemented machinery to yield reconciliation in slices and avoid drawing temporary historical states. It was useful infrastructure and diagnostic evidence, but it was not the main reason the final zero-delay candidate became smooth. It also adds state-machine complexity.

Do not assume "slice rollback" is automatically better than making capture/restore/resim cheaper first.

### Draw-only local player prediction

Not adopted. A visually predicted local sprite with authoritative collision at the old location can create "I visibly dodged but died" behavior. Local responsiveness must come from timely authoritative logical input, not a fake presentation-only player position.

### No-rollback phone as universal architecture

The asymmetric ownership mode was an excellent diagnostic and fallback, but it did not satisfy the final responsiveness goal for every participant.

## Phase 14 — reliable input repair for fast-lane loss

After compute was optimized, occasional long stalls still appeared. Instrumentation showed some stalls were caused by the unreliable/fast input lane failing to advance while rollback itself remained cheap.

The adopted repair is bounded and secondary:

- normal input continues on the low-latency unreliable channel;
- ACK/frontier progress is tracked;
- when progress stalls, a limited duplicate of recent input is sent on the reliable control lane;
- frequency and bufferedAmount are budgeted;
- repair packets receive the same artificial delay in tests so the repair path is not given a fake zero-latency advantage;
- duplicate repair never resamples physical input.

Fault injection proved that this helps when the input lane fails but the control lane still works. It does **not** solve total network outages.

### General lesson

Rollback and transport resilience must be profiled separately. A game can have cheap rollback and still freeze because the prediction window is exhausted waiting for bytes that never arrived.

## Phase 15 — immediate same-origin input delivery

The Launcher-to-Runtime `postMessage` queue added a browser task boundary before the runtime could capture input. TH07 introduced an optional same-origin synchronous input bridge for zero-delay/full-rollback LAN sessions.

Supported events include direct touch, touch controls/action edges, cancel and keyboard. Both immediate and queued paths share the same runtime validators and physical-input consumers. The bridge does not advance simulation, predict a separate player sprite or bypass the fixed-tick capture owner.

The bridge returns true only after one consumption; false means untouched and may fall back to postMessage. Throws/unknown outcomes are never retried because movement/Bomb edges are not idempotent.

This improved responsiveness instrumentation but remains scoped to the netplay mode where its changed browser scheduling was explicitly accepted. It was **not automatically enabled for ordinary single-player**, because doing so could move a physical event from tick N+1 to tick N even though the gameplay algorithm is unchanged.

## Phase 16 — zero-delay final candidate

The final validated responsive policy converged on:

```text
local input scheduling:     0 frames
rollback policy:            full on every endpoint
simulation:                 fixed 60 Hz
snapshot policy:            frontier
snapshot layout:            runs/live fixed-pool parts
snapshot copy:              bulk batched copy
snapshot restore:           coalesced
checkpoint span:            3 logical ticks
Bullet snapshot backend:    live
input repair:               bounded reliable duplicate repair
local input transport:      same-origin immediate bridge where eligible
presentation:               high-refresh allowed; 60 Hz lock is player preference
```

Representative frozen Stage 6 Lunatic evidence with peak 1024 bullets, continuous wall-clock touch and actual RTC input sends delayed 50 +/- 10 ms one way:

- 3 endpoints, all CPU-throttled 2x, 3600 logical frames: all ~59.99 logic Hz; dense Present p99 roughly 30–32 ms; zero >50 ms Present intervals in the full run; all canonical samples agreed.
- one endpoint throttled 4x: ~59.83 logic Hz, dense p99 ~38.3 ms; a few >50 ms whole-run intervals remained, maximum ~70.7 ms; canonical samples still agreed.

Synthetic input-to-render medians around ~14 ms and p99 around ~27–28 ms in the 3P run end at render submission. They exclude touch hardware, compositor and display scanout and must not be called physical input latency.

Human/device testing later confirmed the zero-buffer mobile feel and high-bullet smoothness were good enough to publish the responsive mode. That device acceptance is separate from the browser/CPU-throttle evidence above.

## Single-player improvements discovered by rollback profiling

Rollback stress acts like an amplifier for ordinary inefficiencies. A cost that is small once per frame becomes large when multiplied across many Bullets and resimulated frames. Before sharing a rollback-era optimization with ordinary play, prove it does not alter logical semantics.

TH07 ultimately identified six shared improvements from the rollback investigation/review:

1. **Web rAF no longer performs synchronous `SDL_DelayNS`** — browser event-loop/input/audio responsiveness; fixed-step logic unchanged.
2. **Bullet `StableDrawOrder`** — exact stable ordering with fixed renderer scratch; 6,000 comparisons against old `std::stable_sort`.
3. **Bullet `UpdateLivePrev`** — skips dormant presentation previous-field writes; 300,000 observable-state comparisons against full `UpdatePrev`.
4. **Item presentation purity** — authored appearance moves to fixed Update; Draw only temporarily interpolates and restores position; 40,000 legacy-appearance comparisons plus source purity audit.
5. **Web focus-loss lifecycle repair** — transient canvas/iframe focus no longer freezes ordinary mobile play; touch state is cancelled while true background lifecycle remains separate.
6. **IDBFS restore suppresses autoPersist during population** — avoids writing a partially restored in-memory tree back over persistent storage and removes restore-triggered write churn.

Do not misattribute older renderer work to this rollback investigation. Web VBO/orphaning and other GLES batching optimizations largely predate the 2026-09-16/17 rollback work; rollback profiling validated their importance but did not invent them.

The same-origin immediate input bridge is intentionally not included in the ordinary-play list because its scheduling can change which fixed tick receives a physical event.

<!-- knowledge-id: K-RB-004 -->
## TH08 reuse: optimize ordinary Update before changing netplay policy

The 2026-09-27 TH08MP investigation directly reused TH07's methods and active
Bomb-region cache. The accepted source is TH08 commit `b063ca2`, integrated
into `experiment/th08-multiplayer`. This is **measured TH08 candidate evidence**,
not physical-phone or production-deployment acceptance. Full conditions,
commands, rejected attempts and evidence locations are in the
[TH08 reuse record](rollback/th08-mp-base-update-reuse-2026-09-27.md).

### Diagnose the ordinary simulation as well as rollback

TH07's no-snapshot control showed dominant rollback tax in its measured
workload. TH08 instead remained slow with little resimulation: fixture timing
placed about 88–91% of Update in the Bullet job. Do not transfer the *bottleneck
conclusion* between titles; transfer the controls and then measure again.

Use local worlds with identical inputs, **no network driver, no snapshots and
no resimulation**, alternating old/new execution in one renderer. Compare
canonical state after each block and measure Update separately from
Update+Draw. Exact-input-only network mode is lockstep: its FPS includes waiting
for the peer and is not this base-capacity control. Once a hotspot is known,
query the TH06/TH07 code anchors for the corresponding operation; shared core
behavior is useful evidence even when a literal implementation cannot be copied.

### Reuse active-region enumeration with explicit lifetime ownership

TH07 `Player::RebuildBombBoxCache` / `CalcBombCollision` provided the useful
pattern. TH08 was scanning all **192 cancellation-region slots per pilot per
barrier query**, including when no Bomb region was active. A scoped ascending
list of active indices removes those repeated empty scans. TH08 rebuilds it
after Item update and synchronization, immediately before Bullet/Laser update,
on **every forward and resimulated tick**; it expires before subsequent scene
jobs. The list is derived state, not persistent snapshot state.

Reuse this pattern only after auditing writers inside the entire scope. Keep
native slot order, live shape reads, exact geometry arithmetic, active checks,
hit counters, first-hit behavior and item ownership. An old/new gameplay oracle
must also compare active membership during the optimized scope. Two endpoints
running the same new code alone cannot prove equivalence to the old behavior.

TH08 also retained target selection only when the aiming extra actually uses
it, preserving its pre-extra position and activation timing; and a conservative
far-box rejection **after cancellation**, with exact fallback near boundaries
or unusual values. These title-specific optimizations were MP-only; they are
not evidence that the ordinary TH08 build received the same speedup.

The cache reduced ordinary Update from **6.40 to 2.40 ms (2P)** and **8.96 to
2.92 ms (3P)** in within-run controls with 1,000 starting bullets and 4x CPU
throttling. The baseline already included the target/broadphase improvements;
do not add percentages from separate runs or call CPU throttling a phone model.

### Close the measurement loop without hiding remaining stalls

Frozen real-RTC/native-rAF ABBA runs improved slow-peer logic from 51.75/48.62
to 59.51/59.53 FPS with a 60 Hz presentation cap. **Uncapped diagnostic stress
still measured 55.14 FPS.** The separate formal-WASM authored Lunatic run, with
default uncapped rendering and no native profiling exports, measured about
59.3 FPS during gameplay but only 14–15 FPS in GameResults; whole-run performance
was about 57.2 FPS. Do not silently discard transitions or promote the capped
stress number into a default-setting claim. Scripted RTC send impairment,
music-off standalone hosting and missing RMX5080 acceptance remain limitations.

Keep four evidence layers distinct: base-cost A/B, dense diagnostic RTC stress,
formal-WASM authored scenes, and real-device/audio-on acceptance. Record scene,
loading and logical progress alongside presentation counters so retirement and
confirmation waiting can be distinguished from slow Bullet simulation.

TH08 reused frontier-only capture, partitioned live-Bullet snapshots and early
once-only send with title-owned correctness gates. Its interval/checkpoint-span
experiment was **excluded** from `b063ca2`; TH07's adopted span-3 policy is not a
TH08 default. Exact-distance arithmetic refactoring and roster-order caching
were also removed when correctness passed but useful performance gains did not.

## Performance experiment toolkit

The TH07 rollback work did not rely on one benchmark. It built a layered set of test instruments so that simulation cost, snapshot cost, network delivery, input responsiveness and presentation could be isolated instead of being guessed from one FPS counter.

This section is part of the playbook because the **experiment design itself is reusable**. Future rollback work should prefer extending these patterns over inventing ad-hoc one-off measurements.

### `tests/run-netplay-performance-tests.py` — deterministic unit/model gate

Use this before browser performance work. It compiles/runs focused native and WASM test cases, including SAFE_HEAP/assertion lanes where appropriate.

Representative coverage accumulated across the TH07 investigation:

- generic rollback journal exact restore;
- coalesced restore;
- snapshot policy/frontier models;
- sparse/run capture;
- fixed-pool/partitioned journal;
- live Bullet snapshot restore;
- DirectTouch once-only ownership and synchronized remainder;
- delay/prediction/loss/reorder core behavior;
- input-repair budget;
- Bullet live-prev presentation equivalence;
- Item presentation equivalence;
- stable Bullet draw ordering.

**Use:** reject a candidate here before spending time on browser/device profiling. A browser run that happens to agree at three hashes is weaker than a randomized exact-state model test for storage correctness.

### `tests/benchmark-rollback-journal.py` — controlled microbenchmark

Purpose: answer narrow questions such as:

- did this journal data structure reduce forward cost?
- did rewind/recapture allocation churn improve?
- did a new index help rollback while harming ordinary capture?

Important design choices:

- compile old/new with the same toolchain/flags;
- alternate comparison order across repeats;
- pre-warm bounded history before measuring;
- report forward and rollback workloads separately;
- count allocations/growth as well as time;
- never extrapolate the result directly to phone FPS.

The recursive-AVL regression was caught because the benchmark included the forward path instead of measuring only rollback.

### `tests/build-netplay-journal-baseline.py` — exact old-code A/B without destructive checkout

This tool builds a historical journal baseline from exact Git blobs into a distinct artifact. It does **not** reset/checkout the active worktree.

That is important in dirty research trees: performance A/B should not destroy unrelated work or accidentally compare against a partially reverted source tree.

Use an exact baseline artifact when testing a low-level storage change against the old implementation while retaining the rest of the candidate unchanged.

### `tests/netplay-performance-browser.py` — main end-to-end laboratory

This became the central rollback performance harness. It can vary one layer at a time while asserting that the requested configuration actually reached Runtime.

Important controls include:

- 2P / 3P;
- selected slow endpoint or `--all-slow`;
- browser CPU slowdown factor;
- real RTC vs relay transport;
- application-send one-way delay + jitter;
- `--require-rollback` when correction must be exercised;
- prediction-window size;
- local input delay;
- snapshot policy: `always` / `demand` / `frontier`;
- snapshot layout: `objects` / `runs`;
- copy backend: `wasm` / `bulk`;
- restore backend: `sequential` / `coalesced`;
- checkpoint span 1..8;
- Bullet snapshot backend: `journal` / `compact` / `live`;
- different Bullet backends on strong vs constrained endpoint for oracle-style A/B;
- no-rollback / one-endpoint-no-rollback / production buffered mode;
- keep snapshots while disabling rollback, to isolate **snapshot-only tax**;
- fixed synthetic dense Bullets;
- curved/multi-sprite real Bullet command workload;
- real Stage 1..6 ECL/STD workload with difficulty control;
- continuous Launcher direct-touch bridge input;
- wall-clock-driven gestures;
- physical browser touch events;
- input-latency decomposition;
- same-origin immediate input bridge;
- Bomb cycle;
- exact live-Bullet byte audit;
- reliable input repair;
- relay diagnostics;
- optional CPU sampling profile.

The harness rejects runs when the Runtime did not actually apply the requested configuration. This matters: an early delay experiment produced invalid data because the Shell whitelist silently dropped the new option. The test was later changed to assert resolved delay/policy/backend values explicitly.

### Control-group decomposition using the browser harness

The strongest way to find rollback tax is to keep the same game/render workload and selectively remove rollback layers.

Useful control matrix:

| Mode | Snapshot capture | Prediction/rollback | What it isolates |
| --- | --- | --- | --- |
| ordinary full rollback | yes | yes | product behavior |
| `--no-rollback` | no | no | base game/render/transport cost |
| `--no-rollback --keep-rollback-snapshots` | yes | no | snapshot-only fixed tax |
| one slow endpoint buffered/no rollback | no on slow endpoint | no on slow endpoint | endpoint rollback ownership cost |
| alternate Bullet backend on only one peer | candidate vs reference | yes | state backend A/B with cross-peer canonical oracle |

This matrix was critical. It proved that the constrained endpoint could run the same dense game/render load near 60 Hz when snapshot/resimulation work was removed, which justified deeper rollback optimization rather than lowering Bullet count or simulation rate.

### Real-stage workload beats synthetic density alone

Synthetic 900-Bullet fixtures are useful because they are stable and controllable. They are not sufficient.

The real-stage lane enters actual TH07 Stage ECL/STD and can use an invulnerable probe so deaths do not conveniently clear the Bullet workload. Stage 6 Lunatic became the main stress scene and reached peak 1024 active Bullets plus real Items/enemies/animation.

Use both:

- synthetic density for repeatable component A/B;
- real stage for integration cost and lifecycle realism.

Do not claim a synthetic stationary-Bullet win automatically applies to curved, multi-sprite or real ECL workloads. TH07 explicitly found a harder curved workload significantly slower than the simple dense fixture under the same CPU stress.

### `tests/measure-netplay-smoothness.py` — immutable experiment freezer and paired runner

This wrapper exists to stop a very common performance-analysis mistake: comparing different moving builds and calling the delta an optimization result.

It freezes into an isolated directory:

- `th07.html/js/wasm/data`;
- CMake cache/build identity;
- performance browser harness;
- browser host fixture;
- RTC impairment tool;
- input-latency probe;
- audio probe;
- shared font;
- optional OGG resources;
- relay script hash/provenance.

Every frozen input receives a SHA-256 identity. The script re-hashes before accepting measurements and rejects the run if the build or relay changed during the experiment.

Paired-run rules:

- run experiments **serially**, not concurrently with another compile/CPU benchmark;
- alternate policy order across repeats to reduce warm-cache/order bias;
- retain one raw JSON and log per run;
- keep failed/timeout runs instead of silently rerunning until green;
- kill the child browser process tree on timeout so orphaned Chromium/GPU processes do not contaminate later samples;
- emit a bounded summary but preserve detailed traces in the raw report.

`--freeze-only` is useful when the next stage is a long manual matrix and you want to guarantee every run uses the same runtime/fixture bytes.

### `eagler-common/testkit/rtc-input-impairment.cjs` — controlled RTC application-send impairment

This tool monkey-patches the test realm's `RTCDataChannel.send` before channel creation. It is deliberately labeled:

> application send delay, **not wire latency**.

It can apply:

- one-way delay;
- seeded jitter;
- periodic drop;
- finite blackout window;
- queue byte/capacity limits;
- delay to both fast input and reliable repair/control input.

It records:

- matched/scheduled/sent/dropped counts;
- queued/peak queued bytes;
- planned delay;
- actually delivered delay;
- timer overrun;
- blackout drops;
- control-input matches.

A test must prove `matched > 0` / `sent > 0` before claiming RTC impairment. Relay delay does not affect a direct RTC input DataChannel.

The actual delivered delay matters because a busy browser main thread can make a nominal 50 ms timer fire much later. Report requested and delivered delay separately.

### Fault injection: test the failure you think the repair handles

Reliable input repair was not validated by ordinary jitter alone. The RTC impairment tool can deliberately stop/drop the fast input lane for a bounded interval while leaving the reliable control lane available.

This establishes a narrow claim:

- if fast input delivery is impaired but control remains healthy, bounded reliable duplicates can restore progress;
- if the entire network path is dead, the repair cannot help.

Fault injection should target the exact layer a proposed resilience mechanism claims to repair.

### `tests/netplay-input-latency-probe.cjs` — responsiveness decomposition

This diagnostic timestamps a synthetic input event through:

```text
event issued
-> Runtime received
-> logical capture
-> scheduled forward simulation
-> first Present containing the state
```

It reports delivery, sampling, scheduling and presentation portions separately and avoids double-counting a frame when rollback resimulates it.

Use it to compare **netcode-added scheduling delay** and browser delivery paths. Do not call the result input-to-photon latency: touch hardware sampling, OS dispatch, compositor and screen scanout are outside the probe.

### Wall-clock gesture driver

The harness originally advanced synthetic drag trajectory from the simulation frame. That is dangerous for performance testing:

```text
game slows down
-> simulation frame increments slower
-> test input changes slower
-> mismatch workload gets easier
-> benchmark partially hides the slowdown
```

`--wall-clock-drag` advances the gesture by elapsed real time instead. The workload therefore remains independent of simulation progress.

For rollback/input experiments, prefer wall-clock stimuli whenever the intended physical action should continue even if the game stalls.

### `--bridge-drag` versus physical touch events

These cover different integration layers:

- bridge drag exercises the real Launcher-to-Runtime direct-touch protocol continuously and is efficient for long performance runs;
- physical browser/CDP touch exercises the actual Touch/Controller/Player input pipeline and caught ownership bugs that fabricated `FrameInput` tests could not.

Use the bridge for repeatable load; use physical touch as an integration gate before claiming the touch model itself is correct.

### Exact-byte restore audit

`--live-bullet-audit` keeps an intentionally expensive full Bullet-pool byte reference alongside the optimized live-part journal and compares after real restores.

This diagnostic must stay out of performance claims because the oracle adds work. Its purpose is to prove correctness in Bomb/clear/reuse paths before disabling the oracle for speed measurement.

### Bomb-cycle fixture

Rollback state bugs often hide in destructive lifecycle paths that a smooth movement benchmark never triggers. The Bomb-cycle option drives real Bomb input during the dense/Stage workload and checks that every player actually entered Bomb state.

Combine Bomb cycle with the byte oracle when validating snapshot elision/partition changes.

### Audio-on performance probe

Audio starvation can resemble a game freeze or can be caused by the same main-thread monopolization as network/input starvation.

The audio-on frozen fixture includes OGG resources and a probe that records advancing AudioContext/output activity. Use it to ensure a rollback optimization did not obtain smooth graphics by starving audio work.

Advancing audio time/output blocks are not acoustic-quality or speaker-device acceptance.

### `tests/websocket-loopback-health.py` — remove the game from the suspected network problem

This tool runs blank same-origin browser pages against a minimal echo server. No game, WASM, rendering or rollback participates.

It was built after multi-second receive blackouts appeared in TH07 runs. Reproducing a blackout here proved that this class of pause did not require expensive rollback computation.

The probe records send gaps, receive age and pending messages. If a run ends with unanswered messages, completed-reply p99 alone is right-censored and must not be reported as a successful low-latency result.

### Replay and spectator gates are part of performance acceptance

Performance changes can preserve short canonical checkpoints while breaking lifecycle reconstruction.

After structural rollback changes, run:

- 2P and 3P rollback Replay record/save/menu-playback with exact input comparison;
- spectator confirmed-history/read-only smoke;
- stage-transition/restart/Result paths when the changed state owner participates.

Replay/spectator are not "extra features" for rollback validation: they exercise history ownership, capture format and confirmation semantics that ordinary live play may not expose.

### Browser/channel identity matters

TH07 encountered runs that failed or behaved differently in bundled Chromium while the Edge channel used for performance completed correctly. Record browser channel/version and renderer identity in the raw report.

Do not replace a failed Chromium run with a passing Edge run and then claim generic "browser PASS". The accepted scope is the browser that was actually measured.

### Recommended experiment hierarchy

Use increasingly expensive evidence in this order:

```text
source invariant / model test
        ↓
native + WASM exact behavior test
        ↓
microbenchmark of one hot primitive
        ↓
browser synthetic workload
        ↓
browser real-stage workload
        ↓
fault injection / lifecycle Replay / spectator
        ↓
frozen paired A/B
        ↓
real device + human control-feel acceptance
```

Do not skip directly from a microbenchmark to a production conclusion.

### Designing a valid A/B

For a strong performance comparison:

1. freeze exact binaries and fixtures;
2. change one independent variable when possible;
3. keep browser channel, viewport/resolution, renderer, game stage/difficulty and player count fixed;
4. drive input from wall clock or a predeclared deterministic trace;
5. verify the requested config values from inside Runtime;
6. verify impairment actually matched the intended lane;
7. assert canonical state agreement;
8. report logic progress and presentation tails together;
9. keep raw failures and invalid runs;
10. repeat and alternate order when noise is material.

If a profile changes several options at once, describe the result as a **profile/package comparison**, not proof that every included option individually helped.

### How to invalidate your own result

Discard or explicitly label a performance run invalid when:

- the requested option never reached Runtime;
- the build/relay changed during the run;
- the test failed before gameplay (font/resource/startup failure);
- no impairment packet matched despite claiming impaired RTC;
- canonical state diverged unless the run's purpose is diagnosing that divergence;
- the workload disappeared because the probe player died;
- a bounded sample array overflowed and you call it whole-run distribution;
- the browser process timed out but orphaned children remain and contaminate later runs;
- a supposed network fix ends with large pending/right-censored messages;
- a CPU benchmark/compile was running concurrently;
- the candidate and baseline use different game/input workloads without stating that limitation.

### What to preserve in raw reports

The TH07 harness deliberately retained enough evidence for later reinterpretation:

- runtime/build identity;
- browser version/GPU renderer;
- resolved netplay configuration;
- raw Present/driver/draw timing distributions or bounded samples;
- dense-phase counters;
- rollback/resim/snapshot/restore counters;
- input impairment stats;
- input latency breakdown;
- canonical hashes;
- long-frame/stall records;
- console tails and relay log tail on failure;
- exact error/status instead of silently replacing the run.

This proved valuable repeatedly: several later conclusions were possible only because an earlier "bad" run still retained enough transport and timing evidence to show the stall was not an atomic rollback.

## Measurement discipline

<!-- knowledge-id: K-RB-003 -->
### Freeze the candidate before comparing

Use immutable runtime/harness/data/font identities for paired runs. Do not compare a moving build directory against an older report and attribute the entire delta to one change.

`measure-netplay-smoothness.py --freeze-only` exists specifically to freeze the runtime and fixture identities used in later runs.

### Use wall-clock input stimuli

If a synthetic drag advances according to simulation frame count, a slow simulation automatically slows the input workload and can hide the very performance problem being measured. Wall-clock drag makes physical intent independent of game progress.

### Separate logic Hz from presentation

Near-60 logical throughput does not mean smooth presentation. Count Present intervals and tails. Conversely, a high rAF callback count does not mean unique game draws.

### Separate input latency components

The TH07 diagnostic decomposes:

```text
test event issued
  -> Runtime delivery
  -> physical/logical capture
  -> scheduled logical simulation
  -> first Present containing that state
```

This is still not input-to-photon; hardware scan, compositor and display are outside the browser fixture.

### CPU throttling is not a phone model

Browser CPU slowdown is a stress tool. Report the throttle factor, browser, renderer and platform. Never rename "4x throttled Edge" as a particular Snapdragon/Dimensity class.

### Network impairment must be applied where claimed

Relay delay, sender-side RTC send delay, browser event-loop delay and public RTT are different. Verify the actual impaired lane and record measured timings.

### Preserve invalid and failed runs

Examples from TH07 that must remain visible:

- options silently dropped by an old Shell whitelist: invalid A/B;
- startup/font failures before gameplay: not performance samples;
- WebGL/context/browser launch failures: infrastructure/runtime failures, not green netcode results;
- checkpoint divergence later followed by a passing rerun: divergence remains unresolved until root cause is found;
- right-censored network blackouts with messages still pending: do not quote only completed-reply p99.

## Recommended optimization order

When a new rollback implementation is too slow, use this order unless evidence points elsewhere:

1. **Prove the symptom** with logical progress, presentation tails, confirmed progress and canonical state.
2. **Run a no-network/no-snapshot/no-resim isolation control** where possible to estimate base Update and Draw cost. If base cost is already too high, profile native jobs and reuse applicable TH06/TH07 ordinary-game optimizations before tuning prediction or input delay; an exact-input lockstep FPS is not this control.
3. **Fix allocation/lifetime churn** before clever compression.
4. **Measure capture bytes and capture CPU separately.** Fewer bytes may still be slower.
5. **Reduce unnecessary snapshot ownership** such as confirmed-prefix history.
6. **Exploit fixed-pool identity** for hot object classes instead of generic address structures where exact ownership is provable.
7. **Batch copies** after region discovery; avoid thousands of tiny WASM/JS crossings.
8. **Coalesce restore** only with exact coverage rules.
9. **Reduce mismatch rate** by fixing input representation/ownership before adding more prediction.
10. **Audit event-loop yielding** so catch-up does not starve input/network/audio.
11. **Instrument transport blackouts** before blaming multi-second stalls on rollback.
12. **Try input delay/ownership policies only as explicit product tradeoffs**, never as hidden performance fixes.
13. **Use exact-byte/canonical/Replay/Bomb tests** before enabling state elision.
14. **Only then micro-optimize compile flags or exotic compression.**

## Verification matrix for a rollback optimization

At minimum, cover these dimensions before calling a rollback optimization production-ready:

### Model/unit level

- ring/history wrap;
- duplicate first writes and overlaps;
- checkpoint extension;
- undo across multiple checkpoints;
- discard/confirmation;
- loss/reorder/duplicate input;
- once-only input capture;
- prediction mismatch and correction;
- native + WASM, preferably SAFE_HEAP/assertions for memory work.

### Byte/state correctness

- independent dense/reference restore oracle;
- exact-byte comparison for any sparse/elided hot pool;
- destructive clear/reuse paths;
- dormant/cold state that becomes active later;
- Bomb/death/clear transitions;
- canonical checkpoints between endpoints.

### Lifecycle correctness

- 2P and 3P;
- restart/new session generation;
- pause/resume;
- stage transition;
- Result/ending where relevant;
- Replay record/save/playback exact-input comparison;
- spectator read-only confirmed history;
- ordinary non-MP build remains valid if shared code changed.

### Performance evidence

- dense real-stage workload, not only synthetic Bullets;
- wall-clock input workload;
- browser renderer identity;
- snapshot/restore/resim counters;
- Present p95/p99/max and long-frame count;
- at least one constrained endpoint;
- long enough run to expose warm-up and tail behavior;
- no concurrent compile/CPU benchmark contaminating the run.

### Human/device acceptance

- real phone/desktop combination that matters to the product;
- subjective movement and deathbomb response;
- dense Bullet sequence;
- audio enabled;
- thermal steady-state when relevant;
- high-refresh and optional 60 Hz lock behavior.

## Code anchors in shared/common and TH07 reference implementation

- `eagler-common/include/eagler/netplay/RollbackJournal.hpp` and
  `src/netplay/RollbackJournal.cpp` — generic first-write history, arena
  lifetime and restore/coalescing.
- `eagler-common/include/eagler/netplay/PartitionedPoolJournal.hpp` —
  fixed-pool slot/part undo journal.
- `eagler-common/include/eagler/netplay/SnapshotPolicy.hpp` — generic
  always/demand/frontier snapshot decision model.
- `eagler-common/include/eagler/netplay/SparsePoolCapture.hpp` — generic
  sparse/run capture helper.
- `eagler-common/include/eagler/netplay/InputRepairBudget.hpp` and
  `BrowserPeerTransport::SendRepairTo` — bounded reliable duplicate repair.
- `eagler-common/include/eagler/netplay/FrameAdvantageWindow.hpp` —
  allocation-free per-peer 64-sample trimmed-mean time-sync window.
- `eagler-common/include/eagler/netplay/FrameBudget.hpp` — validated
  8 ms / six-tick browser catch-up start budget. This is not input buffering.
- `eagler-common/include/eagler/netplay/FramePacingPolicy.hpp` — shared
  lead filtering/deadband/±2% pacing formula.
- `eagler-common/include/eagler/netplay/ConfirmedInputWatchdog.hpp` —
  confirmed-frontier liveness state with the production 15-second default.
- `eagler-common/include/eagler/netplay/NetplayCore.hpp` and
  `src/netplay/NetplayCore.cpp` — frame mapping, prediction, confirmation,
  aggregate remote frontier and rollback trigger.
- `eagler-common/include/eagler/netplay/DirectTouchEquivalence.hpp` —
  narrow DirectTouch state-equivalence proof; title adapters still own
  historical world/snapshot patching before equivalent confirmation.
- `th07-eagler/src/netplay/Th07RollbackState.{hpp,cpp}` — title-owned
  game-state snapshot inventory and mutation hooks.
- `th07-eagler/src/netplay/LiveBulletSnapshot.hpp` — Bullet live-part partition/capture rules.
- `th07-eagler/src/netplay/Th07LanStageProbe.cpp` — production/test driver, reconciliation, telemetry and policy resolution.
- `th07-eagler/src/Touch.cpp`, `Player.cpp` and netplay input helpers — once-only direct-touch ownership and synchronized remainder.
- `th07-eagler/src/BulletManager.{hpp,cpp}` — shared Bullet presentation work and rollback mutation hooks.
- `th07-eagler/src/ItemManager.cpp` — fixed-tick appearance/presentation purity.
- `th07-eagler/src/GameWindow.cpp` — fixed-step loop, browser yielding, presentation and reconciliation visibility boundary.
- `th07-eagler/resources/shell.html` — Runtime policy resolution and same-origin input bridge.
- `eagler-touhou/src/launcher/touch-runtime-protocol.mts` — optional immediate input delivery.

`RollbackReplayBudget` is deliberately **not** a current shared production
authority. It belongs to TH07's opt-in incremental/sliced reconciliation
experiment; the Launcher does not enable that path. Do not promote it merely
because `FrameBudget` is shared. Revisit it only if another production
consumer adopts the same replay-slicing policy and its 4 ms / four-frame
defaults remain justified.

### Performance experiment anchors

- `th07-eagler/tests/run-netplay-performance-tests.py` — native/WASM deterministic behavior suite.
- `th07-eagler/tests/benchmark-rollback-journal.py` — same-toolchain journal microbenchmark.
- `th07-eagler/tests/build-netplay-journal-baseline.py` — exact Git-blob historical baseline without worktree checkout.
- `th07-eagler/tests/netplay-performance-browser.py` — main 2P/3P browser rollback/performance laboratory.
- `th07-eagler/tests/netplay-performance-browser-host.html` — browser-side workload driver, bridge drag, Bomb/fault fixtures.
- `th07-eagler/tests/measure-netplay-smoothness.py` — freeze identities and run serial paired experiments.
- `eagler-common/testkit/rtc-input-impairment.cjs` — shared application-send RTC delay/jitter/drop/blackout fault injection; title harnesses supply their DataChannel labels.
- `th07-eagler/tests/netplay-input-latency-probe.cjs` — event-to-Present latency decomposition.
- `th07-eagler/tests/netplay-audio-probe.cjs` — audio progress/output observability during rollback stress.
- `th07-eagler/tests/websocket-loopback-health.py` — blank-page transport blackout control with no game/WASM/rollback.
- `th07-eagler/tests/netplay-replay-browser-smoke.py` — rollback Replay record/save/playback gate.
- `th07-eagler/tests/netplay-spectator-browser-smoke.py` — confirmed-history spectator gate.

## Reproducible evidence and source documents

Detailed raw chronology lives in [the rollback investigation material](rollback/README.md);
this playbook condenses those records into reusable rules without deleting
provenance.

- [Initial performance investigation](rollback/th07-mp-performance-2026-09-16.md) — journal allocation/lifetime, frame budget, browser wait removal, initial browser profiling.
- [Input buffering and prediction investigation](rollback/th07-mp-buffer-prediction-2026-09-16.md) — fixed delay, direct-touch once-only ownership, prediction/window experiments, transport-gap diagnosis.
- [Mobile-balanced investigation](rollback/th07-mp-mobile-balanced-2026-09-17.md) — frontier/runs/bulk/coalesced profile, Item divergence, Stage 6 frozen A/B, O3/LTO rejection, asymmetric rollback ownership.
- [Zero-added-delay investigation](rollback/th07-mp-zero-delay-2026-09-17.md) — zero-buffer target, live Bullet journal V1/V2, exact-byte Bomb audits, reliable input repair, immediate input, cp3 final responsive evidence.
- [Optional same-origin input delivery](rollback/immediate-input-bridge.md) — synchronous same-origin delivery used by the final zero-added-delay LAN path without changing fixed-tick input authority.
- [TH08 base Update and TH07 cache reuse](rollback/th08-mp-base-update-reuse-2026-09-27.md) — ordinary Update isolation, scoped cancellation cache, old/new world oracles, formal-WASM and scene-level measurement; phone acceptance still open.
- `.codex-tmp/` reports named in those documents — raw benchmark/browser evidence. Do not assume they are committed artifacts.
- Git commit `e78d330` / equivalent branch commit `2673968` — first major TH07 rollback performance pass; confirm ancestry in the active worktree before citing a hash in another branch.

## Experiment ledger

This table is the compact index of the exploration. Keep the status explicit so future work does not accidentally promote a diagnostic or rejected idea into a default.

| Experiment | Status | What it taught us |
| --- | --- | --- |
| Dense full-world per-tick snapshots | superseded | ~16 MiB-class copies are structurally wrong for Web/mobile rollback. |
| Sparse first-write journal | adopted | Record only first writes needed for exact rewind. |
| deque/map journal with churn | superseded | Rewind/confirm destroyed capacity that replay immediately needed again. |
| Ring + reusable arenas + iterative AVL | adopted | Lifetime/allocation fixes improved both forward and rollback microbenchmarks. |
| Recursive AVL insertion | rejected | Cleaner code but forward path regressed ~8–14%. |
| Frame-advantage temporary vector | removed | Tiny per-packet allocations matter under sustained traffic. |
| Catch-up wall-time start budget | adopted | Yield browser work instead of starting unlimited extra historical ticks. |
| Synchronous Web `SDL_DelayNS` | removed | Browser callback must return to input/network/audio event loop. |
| Fixed local input delay 3/4/6 frames | diagnostic/control only | Can reduce corrections, but responsiveness cost is real and non-monotonic; not a current product mode. |
| Stable legacy delta predictor | rejected as default | Helps steady input, not variable touch; can overshoot stop. |
| Fresh DirectTouch delta + synchronized remainder | adopted | Fix producer ownership and reduce mismatch/resimulation without quantizing input. |
| Short prediction ceiling | rejected as default | Fewer replay frames can mean earlier hard waiting and worse experience. |
| Dynamic delay | not adopted | Needs explicit no-drop/no-duplicate transition semantics for one-shot displacement/edges. |
| No-snapshot/no-resim slow-endpoint isolation | diagnostic | Proved dominant rollback tax in the measured TH07 workload; TH08 later required ordinary Update optimization too. |
| Snapshot policy `always` | baseline/control | Useful reference; pays known-useless confirmed-prefix capture. |
| Snapshot policy `demand` | experiment/control | Kept as a comparison point; not final default. |
| Snapshot policy `frontier` | adopted | Avoids confirmed-prefix storage while preserving correction reach. |
| Bullet object capture | baseline/control | Higher per-object overhead. |
| Contiguous run capture | adopted | Fewer capture operations for dense live pools. |
| WASM small-copy backend | baseline/control | Correct but expensive when fragmented. |
| Bulk `copyWithin` backend | adopted | Batches known regions and reduces crossings/copy overhead. |
| Sequential restore | baseline/control | Correct reference path. |
| Coalesced restore | adopted | Skip newer copies only when an older restore fully covers them. |
| Stable Bullet draw order | adopted/shared | Same exact stable order with fixed renderer scratch; later shared with single-player. |
| `UpdateLivePrev` | adopted/shared | Avoid dormant presentation writes; later shared with single-player. |
| Item Draw-owned appearance | fixed | Different presentation counts can become canonical divergence. |
| Early input send before reconcile | adopted | Prevent rollback work from making the next input late. |
| 60 Hz presentation cap | temporary/fallback | Helped some stressed runs, but not a rollback fix; later returned to high-refresh default. |
| O3/LTO | rejected | No demonstrated gain over O2; one measured tail was worse. |
| Asymmetric input delay | diagnostic/control only | Showed strong endpoint can absorb more correction, but moved latency to desktop; the product mode was retired. |
| Mobile buffered/no-rollback + desktop full rollback | diagnostic/control only | Eliminated phone rollback tax, but desktop ~67 ms local delay failed feel target; do not expose it as a compatibility mode. |
| Fixed-pool `PartitionedPoolJournal` | adopted | Slot/part identity avoids generic address indexing in hot Bullet pool. |
| Live Bullet parts V1 | partial win | Fewer bytes (~5.2 -> ~3.1 MB peak in one run) but insufficient CPU gain. |
| Live Bullet parts V2 batched gather/scatter | adopted | Fewer operations + bulk copy improved 4x-slow tail behavior. |
| Exact-byte Bullet restore oracle | adopted gate | Sparse/elided state must prove restoration with stronger reference. |
| Compact Bullet snapshot packing | rejected | Smaller memory, slower pack/gather, and canonical divergence in one run. |
| Dormant Bullet elision | safe experiment, default off | Correctness passed, performance benefit not sufficient to justify default complexity. |
| Touch quantization / brief hold | rejected | Reduced some mismatches but changed representation without enough p99 gain. |
| Causal-equivalence rollback absorb | rejected as useful optimization | Safe acceptance rate was essentially zero for real DirectTouch corrections. |
| Initial frame lag | rejected as main strategy | Does not solve ongoing jitter and lost to better delay/ownership choices. |
| Longer checkpoint spans 4/6/8 | rejected as default | Save less often but rewind farther; worse tail tradeoff. |
| Checkpoint span 3 | adopted TH07 responsive default | Best measured storage/replay tradeoff in TH07's final zero-delay profile; not accepted in TH08's `b063ca2` candidate. |
| Incremental/sliced reconcile | supporting infrastructure | Useful for yielding/diagnosis but not the main final win. |
| Visual-only local player prediction | rejected | Risks visible position diverging from collision authority. |
| Bounded reliable input repair | adopted | Repairs fast-lane loss when control lane still works; not a total-outage fix. |
| Same-origin immediate input bridge | adopted for zero-delay LAN | Removes one browser task hop without changing fixed-tick authority. |
| Blank-page WebSocket loopback | diagnostic | Reproduced receive blackouts without game/WASM/rollback; prevents false blame. |
| Wall-clock input fixture | adopted measurement method | Prevents slow simulation from silently slowing the test stimulus. |
| CPU throttling as phone emulation | explicitly rejected claim | Stress tool only; real-device acceptance remains separate. |
| High-refresh responsive mode | adopted product behavior | 60 Hz logic stays authoritative; presentation cap is a player option, not rollback safety. |
| TH08 scoped active cancellation-region cache | accepted candidate; device acceptance open | Reused TH07 enumeration pattern; avoided per-bullet empty-pool scans with native ordering, scope audit and old/new world comparison. |
| TH08 target-use filtering and conservative collision broadphase | accepted MP candidate | Preserve extra activation timing and cancellation before rejection; near/unusual values keep exact geometry. |
| TH08 roster ordering / exact-distance helper | rejected for insufficient gain | Correctness alone does not justify retaining an optimization; keep the failed measurements. |
| TH08 interval checkpoint adapter | excluded experiment | Preserve separately; TH07 validation does not certify TH08 resource, Replay or output-retention ownership. |
| Formal-WASM and scene-segment performance lane | adopted measurement method | Report unavailable diagnostic counters as unknown, retain whole-run results, and distinguish gameplay from Results/retirement waits. |

## Superseded approaches and explicit non-goals

The following are not the preferred default rollback design:

- dense full-world per-tick snapshots;
- high local input delay hidden as a "performance optimization";
- weakening hashes/canonical checks;
- predicting Bomb/action edges without proof;
- visual-only local player prediction;
- treating fewer rollback operations as equivalent to lower latency;
- compact state packing without exact restore and CPU evidence;
- O3/LTO without measured benefit;
- forcing constrained endpoints into no-rollback mode while silently transferring unacceptable latency to other players;
- shortening prediction horizon solely to reduce replay counts;
- calling a browser CPU throttle a phone benchmark;
- calling synthetic event-to-render timing input-to-photon latency.

## Cross-title scope

- Reuse rollback architecture and measurement methods only where state
  ownership matches; never assume one title's Bullet/Item/player layout.
- Introducing rollback in another title requires title-specific deterministic
  ownership first. This playbook is optimization methodology, not permission to
  copy a state partition mechanically.

## Deliberately omitted claims

This playbook does not claim that one configuration is universally optimal for every title/network/device. It does not claim zero physical input latency; zero scheduled input frames still sit inside a 60 Hz simulation and real browser/device/display latency. It does not claim bounded reliable repair fixes total network outages, nor that one successful Stage 6 run proves all stages, browsers or phones.
