/** Sampling-predicate checks only; browser interruption evidence remains in CI. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {isRunningInteriorMotion} from './dialog-motion-observation.ts';

// The genuine in-flight frame captured by b7ad9e3 WebKit before a 650ms rAF gap.
const observed = {
  at: 435, sampledAt: 436, timelineTime: 435, opacity: .122419, y: 10.782257,
  native: {
    id: 1, currentTime: 5, startTime: 430, playState: 'running', pending: false,
    duration: 180, delay: 0, easing: 'cubic-bezier(0.22, 0.8, 0.22, 1)',
    keyframes: [{opacity: 0, offset: null, easing: 'linear'}, {opacity: 1, offset: null, easing: 'linear'}],
  },
};

test('accepts the first observed genuine interior frame without an arbitrary opacity window', () => {
  assert.equal(isRunningInteriorMotion(observed), true);
  for (const [currentTime, opacity] of [[1, .01], [90, .95], [179, .999999]]) {
    assert.equal(isRunningInteriorMotion({...observed, opacity, native: {...observed.native, currentTime}}), true);
  }
});

test('rejects absent, pending, paused, finished, and unstarted native animations', () => {
  assert.equal(isRunningInteriorMotion({...observed, native: null}), false);
  for (const change of [
    {pending: true}, {playState: 'paused'}, {playState: 'finished'}, {playState: 'idle'},
    {startTime: null}, {currentTime: null}, {currentTime: -1}, {currentTime: 0},
    {currentTime: 180}, {currentTime: 655}, {currentTime: NaN},
  ]) {
    assert.equal(isRunningInteriorMotion({...observed, native: {...observed.native, ...change}}), false, JSON.stringify(change));
  }
});

test('rejects endpoint or invalid styles even if the native clock is in flight', () => {
  for (const opacity of [0, 1, -1, 2, NaN]) {
    assert.equal(isRunningInteriorMotion({...observed, opacity}), false);
  }
});
