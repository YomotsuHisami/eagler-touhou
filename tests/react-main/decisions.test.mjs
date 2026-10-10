/** Main app.mts3114–3153 decision contract, plain-store adapter coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecisionStore} from '../../app/models/decisions.ts';

test('one pending main decision: a second request cancels without replacing it', async () => {
  const store = createDecisionStore();
  const first = store.askDecision({message: 'original', secondaryText: 'background'});
  const snapshot = store.getSnapshot();
  assert.equal(await store.askDecision({message: 'new'}), 'cancel');
  assert.equal(store.getSnapshot(), snapshot);
  store.resolve('secondary');
  assert.equal(await first, 'secondary');
  assert.equal(store.getSnapshot(), null);
});
test('confirmation resolves true only for the original confirm choice', async () => {
  for (const choice of ['confirm', 'cancel', 'secondary']) {
    const store = createDecisionStore(), result = store.askConfirmation({message: choice});
    store.resolve(choice);
    assert.equal(await result, choice === 'confirm');
  }
});
test('navigation discard uses the same decision surface rather than queuing another prompt', async () => {
  const store = createDecisionStore();
  store.setNavigationDecisionOpen(true);
  assert.equal(await store.askDecision(), 'cancel');
  assert.equal(store.getSnapshot(), null);
  store.setNavigationDecisionOpen(false);
  const result = store.askDecision();
  store.resolve('confirm');
  assert.equal(await result, 'confirm');
});
test('dispose settles the outstanding promise as cancel and notifies once', async () => {
  const store = createDecisionStore(), snapshots = [];
  store.subscribe(() => snapshots.push(store.getSnapshot()));
  const result = store.askDecision();
  store.dispose();
  assert.equal(await result, 'cancel');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1], null);
});

test('disposed decisions reject late async requests without reopening or leaving a pending promise', async () => {
  const store = createDecisionStore(), snapshots = [];
  store.subscribe(() => snapshots.push(store.getSnapshot()));
  const original = store.askDecision({message: 'Original warning'});
  store.dispose();
  assert.equal(await original, 'cancel');
  const late = store.askDecision({message: 'Late async warning', confirmText: 'Use it'});
  assert.equal(store.getSnapshot(), null, 'teardown is terminal for the shared presentation owner');
  assert.equal(await late, 'cancel');
  assert.equal(await store.askConfirmation({message: 'Late destructive action', tone: 'danger'}), false);
  store.resolve('confirm'); store.dispose();
  assert.equal(store.getSnapshot(), null); assert.equal(snapshots.length, 2);
});

test('disposal rejects a reentrant warning requested by its cancellation subscriber', async () => {
  const store = createDecisionStore(); let reentrant;
  store.subscribe(() => {
    if (!store.getSnapshot()) reentrant = store.askDecision({message: 'Cancellation subscriber warning'});
  });
  const original = store.askDecision({message: 'Original warning'});
  store.dispose();
  assert.equal(await original, 'cancel');
  assert.equal(store.getSnapshot(), null, 'a cancellation notification cannot resurrect the surface');
  assert.equal(await reentrant, 'cancel');
});
