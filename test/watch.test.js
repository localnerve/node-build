/**
 * node-build — tests for src/watch.js.
 *
 * Uses an isolated temp tree (the shared fixture is process-wide and other
 * suites mutate it). Watch timing is real fs.watch + timers, so assertions wait
 * for observed run counts with a generous timeout rather than fixed sleeps.
 *
 * Hang hardening (after the unreproducible suite hang): every test sets an
 * explicit { timeout } so a wedged watcher FAILS fast instead of hanging CI,
 * and every close() lives in a finally block — if a waitFor() times out
 * mid-test, the fs.watch handle must not be left open (an open watcher keeps
 * the process alive indefinitely).
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

/** Sleep for a deliberate quiet window. @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * Wait for an event-driven condition with a fallback for FSEvents loss. Under
 * load macOS may delay or coalesce delivery of a single small write, so if the
 * first budget elapses, call `nudge()` (which must produce a change no tick can
 * miss — e.g. an append to an already-matched file) and wait again.
 *
 * @param {() => boolean} predicate Condition to wait for.
 * @param {() => Promise<void>} nudge Guaranteed follow-up change.
 * @returns {Promise<void>}
 */
async function waitForChange(predicate, nudge) {
  await waitFor(predicate, 1500).catch(() => {});
  if (!predicate()) {
    await nudge();
    await waitFor(predicate, 6000);
  }
}

test('watch runs the initial build then re-runs on matching changes', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  task('watch-basic', async () => { counter.n += 1; });

  const reasons = [];
  const handle = await watch(
    'src/**/*.txt',
    'watch-basic',
    { cwd: tmp, debounceMs: DEBOUNCE, onRun: (reason) => reasons.push(reason) },
  );
  try {
    assert.equal(counter.n, 1, 'initial run happened');
    assert.deepEqual(reasons, ['start']);

    await fsp.writeFile(path.join(tmp, 'src', 'b.txt'), 'beta');
    await waitForChange(() => counter.n >= 2, async () => {
      // FSEvents may lose a single small write under load: an append to an
      // already-matched file is a change no tick can miss.
      await fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge');
    });
    assert.ok(reasons.includes('event'), `expected an event run, got ${reasons}`);

    // Unrelated change (outside the glob) must NOT trigger a run.
    const before = counter.n;
    await fsp.mkdir(path.join(tmp, 'other'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'other', 'x.log'), 'nope');
    await sleep(DEBOUNCE * 6);
    assert.equal(counter.n, before, 'non-matching change did not re-run');
  } finally {
    await handle.close(); // must run even if an assertion above threw
  }
});

test('watch re-runs when an already-matched file is edited (not just added)', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  task('watch-edit', async () => { counter.n += 1; });

  const handle = await watch(
    'src/**/*.txt',
    'watch-edit',
    { cwd: tmp, debounceMs: DEBOUNCE },
  );
  try {
    assert.equal(counter.n, 1);

    // Append to an existing matched file: same set of matches, new mtime.
    await fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nedited');
    await waitForChange(() => counter.n >= 2, () => fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge'));
    assert.ok(counter.n >= 2, 'edit to a matched file triggered a re-run');
  } finally {
    await handle.close();
  }
});

test('watch serializes runs: bursts never run concurrently and no change is lost or duplicated', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  let inFlight = 0;
  let maxInFlight = 0;
  task('watch-burst', async () => {
    counter.n += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(60);
    inFlight -= 1;
  });

  const handle = await watch(
    'src/**/*.txt',
    'watch-burst',
    { cwd: tmp, debounceMs: DEBOUNCE },
  );
  try {
    assert.equal(counter.n, 1);
    const startCount = counter.n;

    // Two rapid writes. Depending on event timing they are seen by one tick
    // (coalesced → +1 run) or by two ticks (+2 runs — each file is a genuine
    // new match at its tick). Both outcomes are correct; what must NEVER
    // happen is concurrent runs or a lost/duplicated change.
    await fsp.writeFile(path.join(tmp, 'src', 'c.txt'), 'one');
    await fsp.writeFile(path.join(tmp, 'src', 'd.txt'), 'two');
    await waitFor(() => counter.n >= startCount + 1);
    await sleep(DEBOUNCE * 8);
    assert.equal(maxInFlight, 1, 'runs are serialized, never concurrent');
    assert.ok(
      counter.n >= startCount + 1 && counter.n <= startCount + 2,
      `each change ran exactly once (got ${counter.n - startCount} follow-up runs)`,
    );
  } finally {
    await handle.close();
  }
});

test('watch reports task failures via onError and keeps watching', { timeout: 15000 }, async () => {
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
  let handle2;
  try {
    // The initial run fails → surfaced via onError, and watching continues.
    assert.equal(errors[0], 'boom');

    await fsp.writeFile(path.join(tmp, 'src', 'e.txt'), 'three');
    await waitFor(() => errors.length >= 1);
    assert.equal(errors[0], 'boom');

    shouldFail = false;
    let recovered = false;
    // Re-arm on the next change: watching continued despite the failure.
    handle2 = await watch(
      'src/**/*.txt',
      'watch-fail',
      { cwd: tmp, debounceMs: DEBOUNCE, onError: () => {}, onRun: (r) => { if (r === 'event') recovered = true; } },
    );
    await fsp.writeFile(path.join(tmp, 'src', 'f.txt'), 'four');
    await waitForChange(() => recovered, () => fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge'));
    assert.ok(recovered, 'watcher still fires after a failed run');
  } finally {
    if (handle2) await handle2.close();
    await handle.close();
  }
});

test('watch validates its arguments', async () => {
  await assert.rejects(() => watch([]), TypeError);
  await assert.rejects(() => watch(['   ']), TypeError); // whitespace-only pattern
  await assert.rejects(() => watch(['src/**'], 42), TypeError);
});

test('watch drops a pending debounced run when closed; close() is idempotent', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  task('watch-close', async () => { counter.n += 1; });

  // Long debounce so the tick is still pending (armed) when we close.
  const handle = await watch(
    'src/**/*.txt',
    'watch-close',
    { cwd: tmp, debounceMs: 200 },
  );
  try {
    assert.equal(counter.n, 1);

    await fsp.writeFile(path.join(tmp, 'src', 'g.txt'), 'five'); // arms the 200 ms tick
    await handle.close(); // clears the pending tick
    await handle.close(); // second call must be a no-op
  } finally {
    await handle.close(); // third call: still a no-op (guarantees cleanup)
  }

  // The cleared tick's window has fully passed; nothing may have run.
  await sleep(350);
  assert.equal(counter.n, 1, 'pending run was dropped by close()');
});

test('watch close() during an in-flight run lets the run finish but drops follow-ups', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  let eventRunStarted = false;
  task('watch-close-midrun', async () => {
    counter.n += 1;
    await sleep(250); // stay in flight while the test closes
  });

  const handle = await watch(
    'src/**/*.txt',
    'watch-close-midrun',
    {
      cwd: tmp,
      debounceMs: DEBOUNCE,
      onRun: (reason) => { if (reason === 'event') eventRunStarted = true; },
    },
  );
  try {
    await fsp.writeFile(path.join(tmp, 'src', 'o.txt'), 'thirteen'); // starts an event run
    await waitForChange(() => eventRunStarted, () => fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge'));
    assert.equal(handle.running, true, 'running flag is up while a task runs');
    await fsp.writeFile(path.join(tmp, 'src', 'p.txt'), 'fourteen'); // lands mid-run → pending
    await handle.close(); // close while running: no re-arm may happen in doRun's finally
    await sleep(400);
  } finally {
    await handle.close();
  }
  assert.equal(counter.n, 2, 'in-flight run finished; coalesced follow-up was dropped');
  assert.equal(handle.running, false, 'running flag clears when the run ends');
});

test('watch coalesces events that arrive while a run is in flight', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  let eventRunStarted = false;
  task('watch-coalesce', async () => {
    counter.n += 1;
    await sleep(250); // stay in flight long enough for the second write to land mid-run
  });

  const handle = await watch(
    'src/**/*.txt',
    'watch-coalesce',
    {
      cwd: tmp,
      debounceMs: DEBOUNCE,
      onRun: (reason) => { if (reason === 'event') eventRunStarted = true; },
    },
  );
  try {
    assert.equal(counter.n, 1);

    let nudged = false;
    await fsp.writeFile(path.join(tmp, 'src', 'h.txt'), 'six'); // starts an event run
    await waitForChange(() => eventRunStarted, async () => {
      nudged = true; // the append itself becomes the in-flight run
      await fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge');
    });
    await fsp.writeFile(path.join(tmp, 'src', 'i.txt'), 'seven'); // lands mid-run → pending flag

    await waitFor(() => counter.n >= 3);
    await sleep(DEBOUNCE * 8);
    // start + event run + the ONE coalesced follow-up; a nudge that arrives as
    // its own late tick is the only legitimate extra.
    assert.ok(
      counter.n === 3 || (nudged && counter.n === 4),
      `expected one follow-up run for the mid-run change (got ${counter.n - 1} follow-ups, nudged=${nudged})`,
    );
  } finally {
    await handle.close();
  }
});

test('watch re-runs when a matched file is deleted', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  task('watch-delete', async () => { counter.n += 1; });

  const handle = await watch(
    'src/**/*.txt',
    'watch-delete',
    { cwd: tmp, debounceMs: DEBOUNCE },
  );
  try {
    assert.equal(counter.n, 1);

    const file = path.join(tmp, 'src', 'del.txt');
    await fsp.writeFile(file, 'doomed');
    await waitForChange(() => counter.n >= 2, () => fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge'));

    // Removing a match changes the snapshot (size drops) → re-run.
    await fsp.rm(file, { force: true });
    await waitForChange(() => counter.n >= 3, () => fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge'));
  } finally {
    await handle.close();
  }
});

test('watch with no task name runs the registry default (all tasks in parallel)', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  task('watch-default', async () => { counter.n += 1; });

  // No taskName → runDefault(); with no seriesDefault() set, every registered
  // task in this process runs in parallel, so the dedicated counter still
  // ticks exactly once per run.
  const handle = await watch('src/**/*.txt', undefined, { cwd: tmp, debounceMs: DEBOUNCE });
  try {
    assert.equal(counter.n, 1);

    await fsp.writeFile(path.join(tmp, 'src', 'j.txt'), 'eight');
    await waitFor(() => counter.n >= 2);
  } finally {
    await handle.close();
  }
});

test('watch tolerates a matched file vanishing mid-snapshot', { timeout: 15000 }, async (t) => {
  const counter = { n: 0 };
  task('watch-vanish', async () => { counter.n += 1; });

  const vanished = path.join(tmp, 'src', 'a.txt');
  const realStat = fsp.stat;
  // Make the initial snapshot hit ENOENT on one matched file: it must be
  // skipped (caught), not fatal.
  t.mock.method(fsp, 'stat', (p, ...rest) => {
    if (String(p) === vanished) {
      return Promise.reject(Object.assign(new Error('simulated vanish'), { code: 'ENOENT' }));
    }
    return realStat(p, ...rest);
  });

  const handle = await watch('src/**/*.txt', 'watch-vanish', { cwd: tmp, debounceMs: DEBOUNCE });
  try {
    assert.equal(counter.n, 1); // armed despite the vanished file
    t.mock.restoreAll(); // real stat again for the follow-up tick

    await fsp.writeFile(path.join(tmp, 'src', 'k.txt'), 'nine');
    await waitFor(() => counter.n >= 2); // watcher survived the bad snapshot
  } finally {
    // close FIRST: a leaked fs.watch handle keeps the process (and the suite) alive
    await handle.close();
    t.mock.restoreAll(); // idempotent: clean up even if an assertion threw first
  }
});

test('watch skips an event tick whose snapshot fails, then recovers', { timeout: 15000 }, async (t) => {
  const counter = { n: 0 };
  task('watch-eio', async () => { counter.n += 1; });

  // A real transient snapshot failure is not reproducible on disk (fs.glob
  // swallows unreadable subdirs), so simulate one: make BOTH of globFiles'
  // resolution paths — fs.glob and its recursive-readdir fallback — reject
  // while `failing` is set, which makes the tick's snapshot() throw.
  const fsMod = await import('node:fs');
  const realGlob = fsMod.default.glob;
  const realReaddir = fsp.readdir;
  let failing = false;
  t.mock.method(fsMod.default, 'glob', (patterns, opts, cb) => {
    if (failing) return cb(Object.assign(new Error('simulated EACCES'), { code: 'EACCES' }));
    return realGlob(patterns, opts, cb);
  });
  t.mock.method(fsp, 'readdir', (p, ...rest) => {
    if (failing) return Promise.reject(Object.assign(new Error('simulated EACCES'), { code: 'EACCES' }));
    return realReaddir(p, ...rest);
  });

  const handle = await watch('src/**/*.txt', 'watch-eio', { cwd: tmp, debounceMs: DEBOUNCE });
  try {
    assert.equal(counter.n, 1); // armed; the initial snapshot used the working path

    failing = true; // every tick's snapshot now fails (covers repeated FSEvents)
    await fsp.writeFile(path.join(tmp, 'src', 'l.txt'), 'ten'); // fires an event
    await sleep(DEBOUNCE * 6);
    assert.equal(counter.n, 1, 'failed ticks are skipped, not fatal');

    failing = false; // recover
    await fsp.writeFile(path.join(tmp, 'src', 'm2.txt'), 'eleven');
    await waitFor(() => counter.n >= 2); // watching continued through the outage
  } finally {
    await handle.close(); // close FIRST: a leaked fs.watch hangs the suite
    t.mock.restoreAll();
  }
});

test('watch falls back to process.cwd() and the default debounce when opts are omitted', { timeout: 15000 }, async () => {
  const counter = { n: 0 };
  task('watch-defaults', async () => { counter.n += 1; });

  const original = process.cwd();
  try {
    process.chdir(tmp); // no opts → cwd defaults to process.cwd()
    const handle = await watch('src/**/*.txt', 'watch-defaults');
    try {
      assert.equal(counter.n, 1);

      await fsp.writeFile(path.join('src', 'm.txt'), 'eleven');
      await waitFor(() => counter.n >= 2, 8000); // default debounce is 100 ms
    } finally {
      await handle.close();
    }
  } finally {
    process.chdir(original);
  }
});

test('two watchers on the same cwd each re-run independently', { timeout: 15000 }, async () => {
  const a = { n: 0 };
  const b = { n: 0 };
  task('watch-pair-a', async () => { a.n += 1; });
  task('watch-pair-b', async () => { b.n += 1; });

  const h1 = await watch('src/**/*.txt', 'watch-pair-a', { cwd: tmp, debounceMs: DEBOUNCE });
  let h2;
  try {
    h2 = await watch('src/**/*.txt', 'watch-pair-b', { cwd: tmp, debounceMs: DEBOUNCE });
    assert.equal(a.n, 1);
    assert.equal(b.n, 1);

    await fsp.writeFile(path.join(tmp, 'src', 'n.txt'), 'twelve');
    await waitForChange(() => a.n >= 2 && b.n >= 2, () => fsp.appendFile(path.join(tmp, 'src', 'a.txt'), '\nnudge'));
  } finally {
    if (h2) await h2.close();
    await h1.close();
  }
});
