/**
 * Tests for the CI regression gate (evaluateGate).
 *
 * Runs directly via Node's native TS type-stripping: `node --test src/lib/*.test.ts`.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, medianOf } from './gate.ts';

test('medianOf returns 0 for an empty list', () => {
  assert.equal(medianOf([]), 0);
});

test('medianOf is the middle value for odd counts (input order irrelevant)', () => {
  assert.equal(medianOf([30, 10, 20]), 20);
});

test('medianOf averages the two middle values for even counts', () => {
  assert.equal(medianOf([10, 20, 30, 40]), 25);
});

test('medianOf ignores non-finite and non-positive values', () => {
  assert.equal(medianOf([Number.NaN, 10, -5, Number.POSITIVE_INFINITY, 20]), 15);
  assert.equal(medianOf([Number.NaN, 0, -1]), 0);
});

test('medianOf does not mutate its input', () => {
  const input = [30, 10, 20];
  medianOf(input);
  assert.deepEqual(input, [30, 10, 20]);
});

test('evaluateGate passes when the run is faster than the baseline', () => {
  const res = evaluateGate(250, 300, 15);
  assert.equal(res.regressed, false);
  assert.equal(res.changePct, -16.7); // improvement reported as negative
});

test('evaluateGate passes for a small slowdown within the threshold', () => {
  const res = evaluateGate(310, 300, 15);
  assert.equal(res.regressed, false);
  assert.equal(res.changePct, 3.3);
});

test('evaluateGate passes when the slowdown is exactly AT the threshold', () => {
  // 300 * 1.15 = 345 — strictly-beyond rule: at the threshold still passes.
  const res = evaluateGate(345, 300, 15);
  assert.equal(res.changePct, 15);
  assert.equal(res.regressed, false);
});

test('evaluateGate fails when the slowdown is beyond the threshold', () => {
  const res = evaluateGate(346, 300, 15);
  assert.equal(res.changePct, 15.3);
  assert.equal(res.regressed, true);
});

test('evaluateGate honors a custom threshold', () => {
  // +20% change: passes at 25%, fails at 10%.
  const lenient = evaluateGate(360, 300, 25);
  const strict = evaluateGate(360, 300, 10);
  assert.equal(lenient.regressed, false);
  assert.equal(strict.regressed, true);
});

test('evaluateGate treats a zero/missing baseline as not comparable', () => {
  for (const baseline of [0, -5]) {
    const res = evaluateGate(300, baseline, 15);
    assert.equal(res.changePct, 0);
    assert.equal(res.regressed, false);
  }
});

test('evaluateGate treats non-finite inputs as not comparable', () => {
  for (const current of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = evaluateGate(current, 300, 15);
    assert.equal(res.changePct, 0);
    assert.equal(res.regressed, false);
  }
});

test('evaluateGate reports change rounded to 1 decimal', () => {
  // (301.234 - 300) / 300 = +0.4113...% → 0.4
  assert.equal(evaluateGate(301.234, 300, 15).changePct, 0.4);
});
