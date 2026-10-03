import assert from "node:assert/strict";
import { recommendMultiplayerInputTiming } from "../.cache/build/browser/assets/launcher/multiplayer-input-timing.mjs";

assert.deepEqual(recommendMultiplayerInputTiming(0, 100, 0, 8),
  { inputDelay: 0, targetRollbackFrames: 8, networkFrames: 0, mobileSeats: 0 });
assert.deepEqual(recommendMultiplayerInputTiming(1, 100, 0, 8),
  { inputDelay: 1, targetRollbackFrames: 4, networkFrames: 6, mobileSeats: 1 });
assert.deepEqual(recommendMultiplayerInputTiming(2, 100, 0, 8),
  { inputDelay: 2, targetRollbackFrames: 2, networkFrames: 6, mobileSeats: 2 });
assert.deepEqual(recommendMultiplayerInputTiming(0, 100, 0, 12),
  { inputDelay: 0, targetRollbackFrames: 12, networkFrames: 0, mobileSeats: 0 });
for (const phones of [1, 2]) {
  for (const [rtt, jitter] of [[null, null], [0, 0], [5, 0], [100, 10], [1000, 200]]) {
    for (const limit of [1, 8, 12]) {
      for (const robust of [1, 2, 4]) {
        assert.equal(recommendMultiplayerInputTiming(phones, rtt, jitter, limit, robust).inputDelay, phones);
      }
    }
  }
}
assert.equal(recommendMultiplayerInputTiming(3, 5, 0, 12).inputDelay, 0);
assert.equal(recommendMultiplayerInputTiming(3, 50, 0, 8).inputDelay, 1);
assert.equal(recommendMultiplayerInputTiming(3, 1000, 200, 8).inputDelay, 4);
console.log("Multiplayer input timing recommendation: PASS");
