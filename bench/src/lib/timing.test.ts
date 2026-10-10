/**
 * Tests for the timing primitives (computeStats, spawnAndTime, runRepeatedly).
 *
 * Runs directly via Node's native TS type-stripping: `node --test src/lib/*.test.ts`.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { computeStats, roundMs, runRepeatedly, spawnAndTime } from './timing.ts';
import type { TimedSpawn } from './timing.ts';

test('roundMs rounds to 3 decimals', () => {
  assert.equal(roundMs(12.3456789), 12.346);
  assert.equal(roundMs(0), 0);
  assert.equal(roundMs(1.0005), 1.001); // float repr makes this round up — pinned behavior
});

test('computeStats returns zeros for an empty sample set', () => {
  assert.deepEqual(computeStats([]), { min: 0, mean: 0, median: 0, max: 0, samples: [] });
});

test('computeStats handles a single sample', () => {
  const stats = computeStats([42.1234]);
  assert.equal(stats.min, 42.123);
  assert.equal(stats.max, 42.123);
  assert.equal(stats.median, 42.123);
  assert.equal(stats.mean, 42.123);
  assert.deepEqual(stats.samples, [42.123]);
});

test('computeStats median is the middle value for odd counts', () => {
  const stats = computeStats([30, 10, 20]);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 30);
  assert.equal(stats.median, 20);
  assert.equal(stats.mean, 20);
});

test('computeStats median is the mean of the two middle values for even counts', () => {
  const stats = computeStats([10, 20, 30, 40]);
  assert.equal(stats.median, 25);
  assert.equal(stats.mean, 25);
});

test('computeStats does not mutate its input and sorts internally', () => {
  const input = [90, 10, 50];
  const stats = computeStats(input);
  assert.deepEqual(input, [90, 10, 50]); // untouched
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 90);
});

test('spawnAndTime measures a successful command', async () => {
  const result = await spawnAndTime(process.execPath, ['-e', 'setTimeout(() => {}, 50)']);
  assert.equal(result.exitCode, 0);
  assert.ok(result.ms >= 30, `expected >= 30 ms of wall clock, got ${result.ms}`);
});

test('spawnAndTime captures stdout and stderr separately', async () => {
  const result = await spawnAndTime(process.execPath, ['-e', 'console.log("out"); console.error("err")']);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /out/);
  assert.match(result.stderr, /err/);
});

test('spawnAndTime reports a non-zero exit code and its stderr', async () => {
  const result = await spawnAndTime(process.execPath, ['-e', 'console.error("boom"); process.exit(3)']);
  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /boom/);
});

test('spawnAndTime rejects when the executable cannot be started', async () => {
  await assert.rejects(() => spawnAndTime('definitely-not-a-real-binary-xyz', []));
});

/** Build a fake runner that records how many times it was called. */
function fakeRunner (calls: number[], msForCall: (i: number) => number, exitCode = 0): () => Promise<TimedSpawn> {
  return async () => {
    calls.push(calls.length);
    return { ms: msForCall(calls.length - 1), exitCode, stdout: '', stderr: '' };
  };
}

test('runRepeatedly discards warmup and times only the requested runs', async () => {
  const calls: number[] = [];
  // msForCall receives the GLOBAL call index (warmup + timed), so the two warmup
  // runs produce 10/11 and the three timed runs produce 12/13/14.
  const stats = await runRepeatedly(fakeRunner(calls, (i) => 10 + i), { warmup: 2, runs: 3 });
  assert.equal(calls.length, 5); // 2 warmup + 3 timed
  assert.equal(stats.samples.length, 3);
  assert.deepEqual(stats.samples, [12, 13, 14]); // warmup values (10, 11) excluded
});

test('runRepeatedly works with zero warmup', async () => {
  const stats = await runRepeatedly(fakeRunner([], () => 5), { runs: 2 });
  assert.deepEqual(stats.samples, [5, 5]);
  assert.equal(stats.median, 5);
});

test('runRepeatedly throws on a failed warmup run', async () => {
  const runner = fakeRunner([], () => 1, 7);
  await assert.rejects(() => runRepeatedly(runner, { warmup: 1, runs: 2 }), /warmup run 1 failed \(exit 7\)/);
});

test('runRepeatedly throws on a failed timed run with stderr tail', async () => {
  let i = 0;
  const runner = async (): Promise<TimedSpawn> => {
    i += 1;
    return { ms: 1, exitCode: 2, stdout: '', stderr: 'pipeline exploded here' };
  };
  await assert.rejects(() => runRepeatedly(runner, { warmup: 0, runs: 3 }), /run 1 of 3 failed \(exit 2\): pipeline exploded here/);
});

test('runRepeatedly validates the runs count', async () => {
  await assert.rejects(() => runRepeatedly(fakeRunner([], () => 1), { runs: 0 }), TypeError);
  await assert.rejects(() => runRepeatedly(fakeRunner([], () => 1), { runs: 1.5 }), TypeError);
});
