/**
 * Tests for the CI regression gate primitives (speedupPct, medianOf, medianOfPct, evaluateGate).
 *
 * The gate is machine-independent: it compares nbs-vs-gulp speedup percentage rather than raw
 * wall-clock ms, so a slow CI runner (which inflates both medians equally) never trips it.
 * Only a genuine relative regression (nbs getting slower vs gulp) moves the metric.
 *
 * Runs directly via Node's native TS type-stripping: `node --test src/lib/*.test.ts`.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, medianOf, medianOfPct, speedupPct } from './gate.ts';

// ─── speedupPct ──────────────────────────────────────────────────────────────

test('speedupPct: nbs 20% faster than gulp', () => {
  // (400 - 320) / 400 = 20%
  assert.equal(speedupPct(320, 400), 20);
});

test('speedupPct: negative when nbs is slower than gulp', () => {
  // (400 - 500) / 400 = -25%
  assert.equal(speedupPct(500, 400), -25);
});

test('speedupPct: zero when medians are equal', () => {
  assert.equal(speedupPct(350, 350), 0);
});

test('speedupPct: returns 0 for non-positive gulp ms (guard)', () => {
  assert.equal(speedupPct(100, 0), 0);
  assert.equal(speedupPct(100, -5), 0);
});

test('speedupPct: rounds to 1 decimal', () => {
  // (403.2 - 319.0) / 403.2 = 20.883...% → 20.9
  assert.equal(speedupPct(319.0, 403.2), 20.9);
});

// ─── medianOf (positive-only, for ms-like values) ────────────────────────────

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

// ─── medianOfPct (signed, for percentage values) ─────────────────────────────

test('medianOfPct returns null for an empty list', () => {
  assert.equal(medianOfPct([]), null);
});

test('medianOfPct handles negative and zero values', () => {
  assert.equal(medianOfPct([-10, 0, 10]), 0);
  assert.equal(medianOfPct([-5, -3, -1]), -3);
});

test('medianOfPct averages two middle values for even counts', () => {
  assert.equal(medianOfPct([18, 20, 22, 24]), 21);
});

test('medianOfPct ignores non-finite values but keeps signed ones', () => {
  assert.equal(medianOfPct([Number.NaN, -5, 10, Number.POSITIVE_INFINITY, 20]), 10);
});

test('medianOfPct does not mutate its input', () => {
  const input = [30, -10, 20];
  medianOfPct(input);
  assert.deepEqual(input, [30, -10, 20]);
});

// ─── evaluateGate (speedup-drop semantics) ───────────────────────────────────

test('evaluateGate passes when speedup improved vs baseline', () => {
  // Current 25% faster, baseline was 20% → drop is negative (improvement).
  const res = evaluateGate(25, 20, 15);
  assert.equal(res.regressed, false);
  assert.equal(res.dropPct, -5);
});

test('evaluateGate passes for a small speedup drop within threshold', () => {
  // Current 19.2%, baseline 20.8% → drop 1.6pp < 15pp threshold.
  const res = evaluateGate(19.2, 20.8, 15);
  assert.equal(res.regressed, false);
  assert.equal(res.dropPct, 1.6);
});

test('evaluateGate passes when drop is exactly AT the threshold', () => {
  // Drop of exactly 15pp → strictly-beyond rule: at threshold still passes.
  const res = evaluateGate(5, 20, 15);
  assert.equal(res.dropPct, 15);
  assert.equal(res.regressed, false);
});

test('evaluateGate fails when speedup drop exceeds the threshold', () => {
  // Current 4.9%, baseline 20% → drop 15.1pp > 15pp threshold.
  const res = evaluateGate(4.9, 20, 15);
  assert.equal(res.dropPct, 15.1);
  assert.equal(res.regressed, true);
});

test('evaluateGate fails on a massive regression (nbs now slower than gulp)', () => {
  // Current -10% (nbs slower), baseline +20% → drop 30pp > 15pp.
  const res = evaluateGate(-10, 20, 15);
  assert.equal(res.dropPct, 30);
  assert.equal(res.regressed, true);
});

test('evaluateGate honors a custom threshold', () => {
  // Drop of 20pp: passes at 25pp, fails at 10pp.
  const lenient = evaluateGate(0, 20, 25);
  const strict = evaluateGate(0, 20, 10);
  assert.equal(lenient.regressed, false);
  assert.equal(strict.regressed, true);
});

test('evaluateGate treats non-finite inputs as not comparable', () => {
  for (const current of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = evaluateGate(current, 20, 15);
    assert.equal(res.dropPct, 0);
    assert.equal(res.regressed, false);
  }
});

test('evaluateGate reports drop rounded to 1 decimal', () => {
  // Baseline 20.853%, current 19.2% → drop 1.653pp → 1.7 (rounded)
  const res = evaluateGate(19.2, 20.853, 15);
  assert.equal(res.dropPct, 1.7);
});

// ─── Cross-machine invariance (the key property) ─────────────────────────────

test('gate is machine-independent: same ratio on fast and slow hardware', () => {
  // Laptop: nbs=320ms, gulp=400ms → speedup 20%
  const laptopPct = speedupPct(320, 400);
  // GHA runner (37.5% slower): nbs=440ms, gulp=550ms → speedup still 20%
  const ghaPct = speedupPct(440, 550);
  assert.equal(laptopPct, 20);
  assert.equal(ghaPct, 20);

  // Gate passes on GHA when baseline was seeded on laptop (same speedup).
  const res = evaluateGate(ghaPct, laptopPct, 15);
  assert.equal(res.regressed, false);
});
