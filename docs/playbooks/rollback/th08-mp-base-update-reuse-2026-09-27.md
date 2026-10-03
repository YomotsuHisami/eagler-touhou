# TH08MP base Update optimization and TH07 reuse — 2026-09-27

This is a dated evidence record behind [the rollback playbook](../rollback.md).
The source candidate was committed as `b063ca2a37e6e886802c9b37016a4a3c320d480e`
and fast-forwarded into `experiment/th08-multiplayer`. It was not deployed by
this investigation. Physical RMX5080 / Android WebView ~150 acceptance remains
open; the user reported severe gameplay stutter with apparently stable TURN
latency around 70–90 ms. TH06/TH07 were the user's stable reference.

## What transferred successfully

Transfer the measurement hierarchy and query the proven operation in TH07,
then prove TH08's state ownership. Similar core behavior makes earlier work
valuable; it does not prove identical layouts, writer timing or bottlenecks.

TH08's layered draw lists, active-VM presentation snapshots and nonblocking Web
callbacks already addressed several older TH07 issues. Those patches were not
useful literal copies. Profiling instead placed 88–91% of native Update in the
Bullet job, with collision/graze a major part of normal-bullet work. Slow
endpoints remained slow with very little resimulation.

The successful retained changes were:

1. **Target-use filtering:** `BulletUpdate::normal` selects a target only when
   extra flag `0x80` consumes it. Test after `initialize_extra`, since the extra
   can activate this tick; preserve the position from before extra execution.
2. **Conservative collision broadphase:** after cancellation and cancel-item
   setup, reject widely separated boxes only in a bounded finite domain, with
   a two-unit rounding guard. Negative/unusual dimensions, exceptional values,
   unordered bounds and near cases retain the original exact calculation.
   A 643,000+ representative-case oracle checks the rejection against it.
3. **Active cancellation-region cache:** TH07 `Player::RebuildBombBoxCache` and
   `CalcBombCollision` enumerate active Bomb regions. TH08 previously scanned
   all 192 region slots for every barrier query, even with no active regions.
   An ascending index list built once per BulletSystem update removes the
   repeated empty scans without changing the exact active-region calculation.

These are MP-only source changes. They improve ordinary forward simulation
inside MP as well as repeated rollback execution; no single-player speedup is
claimed from an unchanged ordinary build.

## Scope and correctness proof for the cache

TH08 creates each pilot's `PlayerCollision::BarrierBatch` after Item update and
synchronization, before Bullet/Laser update. RAII restores the previous pointer
on all exits. Every forward/resim tick rebuilds the list; it does not survive
checkpoint, undo or the next scene job, and is outside `PlayerSimulationState`.

Audit every region writer during that scope. Player/Bomb, Enemy/ECL and Item
jobs finish relevant allocations first. Bullet/laser hit or graze can create
effects/items and change life state, but the audited paths do not allocate
cancellation regions inside this scope. Actual geometry and active flags are
still read live. Native order, damage counters, first hit and item ownership
remain unchanged. A future new writer must revisit this assumption.

The optimization oracle runs old code forward, performs exact undo, then
replays with optimized code and compares world groups/blocks at each tick.
During optimized execution it independently scans region membership on every
cached query. All 20 focused/unfocused Bomb loadout cases plus 40 later-lifetime
probes passed in the experiment build. The isolated candidate also passed eight
shooting/death/Bomb cases and 16 later probes. This is stronger than only
comparing two peers that both run the same new code.

Frontier-only capture, partitioned live-Bullet snapshots and once-only input
send before reconciliation were retained with their own title-specific gates.
In particular, do not send a captured frame again after a corrected stage
boundary, or carry the early-send assumption across a generation change.
The interval snapshot experiment, including Replay/output retention changes,
was deliberately excluded. TH07's span-3 acceptance does not transfer to it.

## Measurement layers and results

### 1. Local base-cost A/B

Two native local worlds in the same renderer, same seed/inputs, no network
driver, snapshots or resimulation. Alternate six-tick blocks, ten warmup and
40 measured blocks; compare canonical state after each block. Workload starts
with 1,000 stationary bullets. CPU throttle 4x is a load condition, not a phone.
The baseline here already has target-use filtering and broadphase enabled.

| Players | Previous Update | Cached Update | Reduction | Previous / cached Update+Draw |
| --- | ---: | ---: | ---: | ---: |
| 2 | 6.397 ms | 2.404 ms | 62.4% | 9.640 / 5.535 ms |
| 3 | 8.959 ms | 2.924 ms | 67.4% | 12.592 / 6.380 ms |

Compare each pair internally. Different-run absolute times do not establish
player-count scaling, and reductions from successive experiments cannot be
added. Exact-input-only network mode waits for the peer and is not this test.

### 2. Frozen RTC/native-rAF stress

Separate Chromium processes; slow peer CPU4x; 38.5 +/- 5 ms one-way
application-send impairment, including repair packets; 900 ticks, measured
from240; starting field of1,000 bullets; cap60. Delivery timers can overrun, so
this is not verified stable77ms wire RTT. ABBA order and frozen assets prevent
build drift and expose host/order variation.

| Order | Cache | Slow-peer logic FPS | Present p99 | Gaps >50 ms |
| --- | --- | ---: | ---: | ---: |
| 1 | off | 51.75 | 50.5 ms | 7 |
| 2 | on | 59.51 | 28.1 ms | 0 |
| 3 | on | 59.53 | 30.4 ms | 0 |
| 4 | off | 48.62 | 53.2 ms | 10 |

All runs passed endpoint and cross-policy canonical checks. Peak live bullets
were1,007, but the field cleared naturally before the end: not sustained1,000
bullets for the whole run. Scripted wall-clock native drag passed at58.99FPS,
p99=31.5ms and max41.4ms on the slow peer. That is not a physical touchscreen.

**Do not hide the uncapped stress result:** the same candidate's diagnostic
default-presentation run measured55.14FPS. No production cap was introduced.

### 3. Formal WASM with authored scenes

Formal WASM, no native fixture/profiling exports, no injected bullets, default
uncapped presentation, authored Lunatic,2,400 ticks, the same impaired RTC and
slow-peer CPU4x. This still uses a standalone test host with music disabled.
The managed-shell/storage test is a separate correctness gate; it does not
certify their combined long-run performance with audio enabled.

| Segment | P1 / P2 logic FPS | P1 / P2 maximum Present gap |
| --- | ---: | ---: |
| Game, frames240–2374 | 59.30 / 59.29 | 36.4 / 32.4 ms |
| GameResults, frames2375–2400 | 14.24 / 15.38 | included in whole run |
| Whole measured run | 57.20 / 57.25 | 185.7 / 195.3 ms |

Neither endpoint had a gameplay Present gap over50ms. Explicit scene/loading
fields identified retirement into GameResults; loading and confirmation waits
remain visible and unresolved. Preserve whole-run tails alongside segmented
metrics. Do not silently trim a bad end segment or label Results waits as
Bullet calculation. Unavailable production profiling counters are `null`, not
zero-cost claims.

### 4. Device acceptance remains separate

Still needed: RMX5080 with real remote/TURN traffic, audio on, sustained dense
play, death/Bomb, transitions and thermal steady state. None of the tests above
certifies this phone or all stages. Gameplay gains justify a candidate; they
do not justify claiming uniformly smooth production behavior.

## Rejected attempts and test repairs worth retaining

- Roster-order caching, approximate distance ordering, and a later exact
  distance helper did not provide useful repeatable gains; removed despite
  passing their correctness checks. The exact helper's numeric-mode hoist
  passed bitwise comparisons but did not improve the two-player benchmark.
- Before the active-region cache, target/broadphase changes reduced base cost
  but whole-session runs still varied around44–53FPS. Preserve both ABBA pairs;
  the favorable first pair alone would have overstated readiness.
- A death-trace harness exceeded the prediction window while assuming every
  test iteration advances a frame; that run was not a game regression or a
  PASS. A later assertion used the old15-field trace header after expansion to
  30 fields. Derive offsets from the schema, assert its length and retain the
  failed reports rather than weakening canonical equality.
- The formal host first failed before boot because the local server omitted
  `/runtime/manifest.json`. Reuse the canonical manifest generator and actual
  WASM identity; do not bypass admission to make the test work.
- Native complete-Bullet-byte tests covered five writer scenarios but did not
  force reuse of the exact same previous slot. Name this coverage limit.

## Source, tools and reproducible evidence

TH08 commit `b063ca2` contains the accepted source and tools. Workspace locations
at the time of recording: `worktrees/th08-multiplayer` for the MP branch and
`worktrees/th08-mp-release-20260927` for the tested isolated candidate. The MP
working tree additionally retains16 dirty interval-experiment files; test the
committed source in a clean checkout instead of treating those edits as release
code. Do not enter an upstream-tracking worktree to build a Launcher Runtime.

Anchors relative to the TH08 repository:

- `th08_web/cpp/game/{BulletUpdate,PlayerCollision,BulletSystem}.{hpp,cpp}`.
- `th08_web/cpp/multiplayer/{LiveBulletSnapshot,PoolsJournal,RollbackDriver}`.
- `portable/multiplayer/check-update-performance.py`: local old/new base cost.
- `portable/multiplayer/world-journal-fixture.hpp` and
  `check-world-journal.py --optimization-oracle`: exact old/new world proof.
- `portable/multiplayer/measure-smoothness.py` and `performance-hook.mjs`:
  immutable asset freezer, paired real RTC/rAF runs and `--production` lane.
- `portable/multiplayer/check-{runtime-host,network,replay,stage-boundary}.py`:
  managed-shell/native touch/storage,2P/3P RTC/Replay and delayed Stage Clear.
- `docs/mp-release-candidate-2026-09-27.md`: detailed build/provenance and gates.

Use a prepared local fixture server for the base control:

```powershell
python portable/multiplayer/check-update-performance.py --url http://127.0.0.1:8142 --output artifacts/multiplayer-tests/new-base.json --players 2 --cpu-rate 4 --baseline previous
```

The frozen runner owns its local server/relay. Set `TH08_MP_DATA` to the user's
existing retail DATA path; use a fresh output directory for each run:

```powershell
python portable/multiplayer/measure-smoothness.py --output artifacts/multiplayer-tests/new-cache-abba --data "$env:TH08_MP_DATA" --modes frontier-cache-legacy,frontier --rounds 2 --frames 900 --cpu-rate 4 --cap60
python portable/multiplayer/measure-smoothness.py --output artifacts/multiplayer-tests/new-formal --data "$env:TH08_MP_DATA" --production --modes frontier --rounds 1 --frames 2400 --cpu-rate 4 --bullets 0 --difficulty 3
```

Run serially with no concurrent compile or other CPU benchmark. The production
lane rejects injected bullets and policy changes. Verify loader/WASM/source
inventories and compare old/new canonical state before accepting speed numbers.

Formal WASM: `ee8fb394df5bba293c6b61a533680e286e5336b09870bbd77fdc4bdc9c5a1165`.
Fixture WASM: `b03a761dc1a5673bc33baab3373ab85431b92872a4e75e8f227f00e810ca0078`.
Completed gates also include all7 build-isolation tests, formal2P/3P Replay500
frames per run (including restart generation), native touch/Bomb and IDBFS
reload, exact Bullet undo, and three-player delayed Stage Clear. Spectator and
audio-on long-run acceptance were not established by this round.

Local raw evidence under the candidate's `artifacts/multiplayer-tests/`:
`release-cache-rtc-abba-20260927/`, `release-touch-dense-20260927/`,
`release-default-presentation-20260927/`, `release-authored-scenes-20260927/`,
`release-formal-authored-20260927/`, and the `release-{world-actions,host-manifest,
network,replay,stage,live-bullets}-20260927.json` reports. The2P base report
`barrier-cache-base-2p-20260927.json` is in the original MP experiment directory;
the3P report is in the candidate. Original2P fixture retained disabled interval
code; candidate3P removed it. Raw reports/builds are local artifacts, not
guaranteed to exist in a fresh checkout; the source, methods, conditions and
limitations above are the reusable record.
