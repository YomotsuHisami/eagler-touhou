# Launcher room changes: local review, 2026-09-30

Reviewed against local base `2e90b03`. Existing changes add per-seat package
progress, cancellation/manual import/retry, and host removal of lobby players
and spectators. TH08/TH10 Multiplayer build variants and the dated rollback
investigation were also reviewed as separate scopes. No site or relay deployed.

## Verification

- Strict Launcher build, content consistency, source syntax and App Shell build
  passed in the repository check before its behavior-test failures.
- 100 default Node/Python tests were run individually: 99 passed. The remaining
  `test-adapter-capabilities.mjs` fails the existing shared-orchestration literal
  guard: `app.mts` contains 16 title/product literals. Comparing their ordered
  list with the base commit proves this change adds or changes none of them.
  The guard was retained; the underlying architectural debt remains open.
- `test-runtime-generations.mjs` was run separately. Packaging, immutable
  generations and verification passed after correcting its obsolete six-variant
  expectation to the catalog-declared ordinary/Multiplayer roots. Atomic
  deployment reaches Windows `symlink` EPERM; that final section needs Linux.
- Real localhost WebSocket relay regression passed: normalized progress,
  rejected invalid progress, unseated sender isolation, non-host removal
  rejection, stale/cross-room target rejection, player/spectator removal with
  close code 4010, seat cleanup and readiness invalidation.
- Chromium 149 automation with synthetic 1 MiB package content passed:
  cancellation opens import, readiness is blocked while cancelled, local ZIP
  import returns resource preparation to ready, only host shows removal,
  removed client leaves room and receives the explanation; no page errors.
  This local harness invokes DOM actions and checks state; it is not physical
  pointer/mobile acceptance or actual game/transport gameplay acceptance.
- Publication audit and `git diff --check` passed.

## Validation repairs

Registered the already tracked hosted-key-release test. Updated stale assertions
for the split reduced-motion label, standalone lobby entrypoint, room discovery
defaults, TH08/TH10 Multiplayer capability reports and immutable Runtime roots.
Added progress normalization and real-relay eviction behavior cases. The room
icons and MIT license are now explicitly allowed by the publication audit.

The room feature still needs real-device/pointer visual acceptance and long-run
gameplay testing. These commits preserve local work; they do not certify the
whole local branch for publication. Local evidence and the synthetic harness
are in the workspace `.cache/pr23-audit/` directory and are not source assets.
