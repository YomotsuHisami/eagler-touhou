import assert from "node:assert/strict";
import { createRuntimeSessionOwner } from "../.cache/build/browser/assets/launcher/runtime-session.mjs";

const owner = createRuntimeSessionOwner();
const changes = [];
const unsubscribe = owner.subscribe(session => changes.push(session?.id ?? null));
const first = owner.begin({ game: "th06", runtimeVariant: "normal", generationId: "g1", revision: "r1" });
assert.equal(owner.isCurrent(first), true);
owner.clear();
assert.equal(owner.isCurrent(first), false);
const second = owner.begin({ game: "th06", runtimeVariant: "normal", generationId: "g2", revision: "r1" });
assert.notEqual(second.id, first.id);
assert.throws(() => owner.assertCurrent(first), /no longer active/);
assert.equal(owner.assertCurrent(second), second);
unsubscribe();
owner.clear();
assert.deepEqual(changes, [first.id, null, second.id]);
console.log("Runtime session owner: PASS");
