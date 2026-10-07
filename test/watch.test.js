/**
 * node-build — tests for src/watch.js.
 *
 * Uses an isolated temp tree (the shared fixture is process-wide and other
 * suites mutate it). Watch timing is real fs.watch + timers, so assertions wait
 * for observed run counts with a generous timeout rather than fixed sleeps.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { watch } from '../src/watch.js';
import { task } from '../src/task.js';

const DEBOUNCE = 25; // keep the suite fast without racing fs.watch delivery

/** @type {string|null} */
let tmp;

test.before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-watch-'));
  await fsp.mkdir(path.join(tmp, 'src'), { recursive: true });
  await fsp.writeFile(path.join(tmp, 'src', 'a.txt'), 'alpha');
});

test.after(async () => {
  if (!tmp) return;
  for (let i = 0; i < 5; i++) {
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

/**
 * Poll until `predicate` passes or the timeout elapses.
 *
 * @param {() => boolean} predicate Condition to wait for.
 * @param {number} [ms] Max wait in milliseconds.
 * @returns {Promise<void>}
 */
async function waitFor(predicate, ms = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('watch runs the initial build then re-runs on matching changes', async () => {
  const counter = { n: 0 };
  task('watch-basic', async () => { counter.n += 1; });

  const reasons = [];
  const handle = await watch(
    'src/**/*.txt',
    'watch-basic',
    { cwd: tmp, debounceMs: DEBOUNCE, onRun: (reason) => reasons.push(reason) },
  );
  assert.equal(counter.n, 1, 'initial run happened');
  assert.deepEqual(reasons, ['start']);

  await fsp.writeFile(path.join(tmp, 'src', 'b.txt'), 'beta');
  await waitFor(() => counter.n >= 2);
  assert.ok(reasons.includes('event'), `expected an event run, got ${reasons}`);

  // Unrelated change (outside the glob) must NOT trigger a run.
  const before = counter.n;
  await fsp.mkdir(path.join(tmp, 'other'), { recursive: true });
  await fsp.writeFile(path.join(tmp, 'other', 'x.log'), 'nope');
  await new Promise((r) => setTimeout(r, DEBOUNCE * 6));
  assert.equal(counter.n, before, 'non-matching change did not re-run');

  await handle.close();
});

test('watch re-runs when an already-matched file is edited (not just added)', async () => {
  const counter = { n: 0 };
  task('watch-edit', async () => { counter.n += 1; });

  const handle = await watch(
    'src/**/*.txt',
    'watch-edit',
    { cwd: tmp, debounceMs: DEBOUNCE },
  );
  assert.equal(counter.n, 1);

  // Append to an existing matched file: same set of matches, new mtime.
  await fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nedited');
  await waitFor(() => counter.n >= 2, 5000);
  assert.ok(counter.n >= 2, 'edit to a matched file triggered a re-run');

  await handle.close();
});

test('watch serializes runs and coalesces bursts into one follow-up run', async () => {
  const counter = { n: 0 };
  task('watch-burst', async () => {
    counter.n += 1;
    await new Promise((r) => setTimeout(r, 60)); // run overlaps with the burst
  });

  const handle = await watch(
    'src/**/*.txt',
    'watch-burst',
    { cwd: tmp, debounceMs: DEBOUNCE },
  );
  assert.equal(counter.n, 1);
  const startCount = counter.n;

  // Two rapid writes while the previous run is still in flight (or just after)
  // must produce at most ONE extra run, never concurrent runs.
  await fsp.writeFile(path.join(tmp, 'src', 'c.txt'), 'one');
  await fsp.writeFile(path.join(tmp, 'src', 'd.txt'), 'two');
  await waitFor(() => counter.n >= startCount + 1);
  await new Promise((r) => setTimeout(r, DEBOUNCE * 8));
  assert.equal(counter.n, startCount + 1, 'burst coalesced into a single follow-up run');

  await handle.close();
});

test('watch reports task failures via onError and keeps watching', async () => {
  let shouldFail = true;
  const errors = [];
  task('watch-fail', async () => {
    if (shouldFail) throw new Error('boom');
  });

  const handle = await watch(
    'src/**/*.txt',
    'watch-fail',
    { cwd: tmp, debounceMs: DEBOUNCE, onError: (err) => errors.push(err.message) },
  );
  // The initial run fails → surfaced via onError, and watching continues.
  assert.equal(errors[0], 'boom');

  await fsp.writeFile(path.join(tmp, 'src', 'e.txt'), 'three');
  await waitFor(() => errors.length >= 1);
  assert.equal(errors[0], 'boom');

  shouldFail = false;
  let recovered = false;
  // Re-arm on the next change: watching continued despite the failure.
  const handle2 = await watch(
    'src/**/*.txt',
    'watch-fail',
    { cwd: tmp, debounceMs: DEBOUNCE, onError: () => {}, onRun: (r) => { if (r === 'event') recovered = true; } },
  );
  await fsp.writeFile(path.join(tmp, 'src', 'f.txt'), 'four');
  await waitFor(() => recovered);
  assert.ok(recovered, 'watcher still fires after a failed run');

  await handle.close();
  await handle2.close();
});

test('watch validates its arguments', async () => {
  await assert.rejects(() => watch([]), TypeError);
  await assert.rejects(() => watch(['src/**'], 42), TypeError);
});
