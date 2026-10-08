/**
 * node-build — file watching with task re-runs.
 *
 * watch() uses a single recursive `fs.watch` on the watched directory and, when
 * changes match the given glob patterns, re-runs a task (debounced). It is the
 * zero-dependency replacement for gulp-watch / gulp's build.watch().
 *
 * Note: this watches ASSETS read by tasks. If you only need to reload the build
 * file itself when it changes, run your CLI under `node --watch` instead — that
 * re-runs on module-graph (import) changes, which never fire for files merely
 * read inside a task.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs';
import { globFiles } from './glob.js';

/**
 * Options for {@link watch}.
 *
 * @typedef {Object} WatchOptions
 * @property {string} [cwd=process.cwd()] Directory patterns resolve against (and the root of the recursive watcher).
 * @property {number} [debounceMs=100] Milliseconds of quiet after the last event before the task runs. Rapid bursts (saves, copy steps) coalesce into one run.
 * @property {(reason: 'event'|'start') => void} [onRun] Called before each run (the initial one uses reason 'start').
 * @property {(err: Error) => void} [onError] Called when a re-run rejects; watching continues.
 */

/**
 * The handle returned by {@link watch}.
 *
 * @typedef {Object} WatchHandle
 * @property {() => Promise<void>} close Stop the watcher and resolve once it is released. Pending debounced runs are dropped.
 * @property {boolean} running True while a task run is in flight.
 */

/**
 * Watch for file changes matching `globs` and re-run a task on each (debounced)
 * match.
 *
 * Behavior:
 *   - Watches the whole `cwd` recursively with one native `fs.watch`, so any
 *     number of patterns costs a single watcher.
 *   - On events, globs are resolved to the currently-matched files (with their
 *     mtimes) and compared against the previous snapshot; the task runs when a
 *     match is added, removed, or its contents edited. This filters rename
 *     pairs and churn that leaves matches unchanged.
 *   - Runs are serialized: an event during a run coalesces into one follow-up run.
 *   - Task failures do not stop watching; they surface via `onError`.
 *
 * The initial run happens immediately (reason 'start'), so watch() doubles as
 * "build, then keep building".
 *
 * @param {string|string[]} globs Glob pattern(s) that trigger the re-run. Negation supported, same syntax as src().
 * @param {string} [taskName] Registered task to run (default: the seriesDefault() task, else all tasks in parallel).
 * @param {WatchOptions} [opts] Watching options.
 * @returns {Promise<WatchHandle>} Resolves once the watcher is armed and the initial run has finished.
 * @throws {TypeError} If `globs` is empty or `taskName` is not a string.
 */
export async function watch(globs, taskName, opts = {}) {
  const list = (Array.isArray(globs) ? globs : [globs]).map(String);
  if (!list.length || !list.some((g) => g.trim())) throw new TypeError('watch() requires at least one glob pattern');
  if (taskName != null && typeof taskName !== 'string') throw new TypeError('watch() task name must be a string or omitted');

  const cwd = /** @type {string} */ (opts.cwd ?? process.cwd());
  const debounceMs = Math.max(0, opts.debounceMs ?? 100);

  // Imported lazily: watch.js stays usable standalone and the module graph
  // stays acyclic (task.js does not import watch.js). series()/runDefault()
  // return lazy schedules, so calling them here starts nothing early.
  const { series, getTask, runDefault } = await import('./task.js');
  const runTask = typeof taskName === 'string' ? () => series(getTask(taskName)) : () => runDefault();

  let running = false;
  let pending = false;
  let closed = false;
  /** @type {NodeJS.Timeout|null} */
  let timer = null;

  // Matched files with their mtime: an edit to an already-matched file must
  // also trigger a re-run, not just adds/removes of matches.
  const snapshot = async () => {
    const files = await globFiles(list, { cwd });
    /** @type {Map<string, number>} */
    const map = new Map();
    for (const f of files) {
      try {
        const st = await fs.promises.stat(f);
        map.set(f, st.mtimeMs);
      } catch {
        /* vanished mid-scan: skip */
      }
    }
    return map;
  };
  const previous = await snapshot();

  /**
   * Run the watched task once. Coalesced follow-ups are re-armed from `finally`
   * so events arriving mid-run never trigger concurrent runs.
   *
   * @param {'event'|'start'} reason Why this run started.
   */
  async function doRun(reason) {
    if (closed) return;
    running = true;
    try {
      opts.onRun?.(reason);
      await runTask();
    } catch (err) {
      try {
        opts.onError?.(/** @type {Error} */ (err));
      } catch {
        /* user handler threw: swallow so watching continues */
      }
    } finally {
      running = false;
      if (pending && !closed) {
        pending = false;
        timer = setTimeout(() => doRun('event'), debounceMs);
      }
    }
  }

  const watcher = fs.watch(cwd, { recursive: true }, () => {
    if (closed) return;
    if (running) {
      pending = true; // doRun's finally re-arms with the debounce window
      return;
    }
    timer = setTimeout(async () => {
      if (closed) return;
      let current;
      try {
        current = await snapshot();
      } catch {
        return; // transient fs error: skip this tick
      }
      const changed = current.size !== previous.size ||
        [...current.entries()].some(([f, m]) => previous.get(f) !== m);
      if (!changed) return; // matches unchanged (e.g. pure rename churn): ignore
      previous.clear();
      for (const [f, m] of current) previous.set(f, m);
      await doRun('event');
    }, debounceMs);
  });

  // The initial run's own failures are routed to onError like any other run,
  // so a broken build does not prevent watching from arming.
  await doRun('start');

  /** Stop the watcher and resolve once it is released. @returns {Promise<void>} */
  const close = async () => {
    if (closed) return;
    closed = true;
    pending = false;
    if (timer) clearTimeout(timer);
    watcher.close();
  };

  return { close, get running() { return running; } };
}

export default watch;
