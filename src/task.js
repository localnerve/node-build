/**
 * node-build-stream — task registry and scheduler.
 * 
 * A "task" is a function (or an array of tasks). It may be sync, async, or
 * stream-returning. series() runs tasks sequentially; parallel() runs them
 * concurrently. Both return LAZY schedules: awaitable objects that start only
 * when first awaited, so composed calls can be nested safely as items without
 * any extra wrapping.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { isReadable as streamIsReadable } from 'node:stream';
import { finished as streamFinished } from 'node:stream/promises';

const tasks = new Map();
/** @type {string|null} */
let defaultTaskName = null;

/**
 * A task body. May be synchronous, async (returning a Promise), or
 * stream-returning (returning a Node.js stream such as `src().pipe(dest())`).
 *
 * @callback TaskFn
 * @returns {any} A value, a Promise, or a Node.js stream.
 */

/**
 * Something that can be passed to series()/parallel(): a registered task name,
 * a raw task function, a Node.js stream, a Promise, or null/undefined (ignored).
 *
 * @typedef {string|TaskFn|import('node:stream').Stream|Promise<any>|null|undefined} TaskItem
 */

/**
 * Register a named task in the registry. Returns the function unchanged so it can
 * be chained, reused, or passed directly to series()/parallel().
 *
 * @param {string} name A non-empty string used to run the task by name.
 * @param {TaskFn} fn The task body (sync, async, or stream-returning).
 * @returns {TaskFn} The same `fn`, for chaining or direct use.
 * @throws {TypeError} If `name` is not a non-empty string or `fn` is not a function.
 */
export function task(name, fn) {
  if (typeof name !== 'string' || !name.length) throw new TypeError('task name must be a non-empty string');
  if (!fn || typeof fn !== 'function') throw new TypeError(`task "${name}" must be a function`);
  tasks.set(name, fn);
  return fn;
}

/**
 * Mark a registered task as the one to run when no task is specified on the CLI
 * (or when `runDefault()` is called with no default set).
 *
 * @param {string} name The registered task name to treat as the default.
 * @returns {void}
 */
export function seriesDefault(name) {
  defaultTaskName = name;
}

/**
 * Look up a registered task by name.
 *
 * @param {string} name The registered task name.
 * @returns {TaskFn} The registered task function.
 * @throws {Error} If no task with that name is registered (lists the known names).
 */
export function getTask(name) {
  const t = tasks.get(name);
  if (!t) throw new Error(`Unknown task: "${name}". Registered: ${[...tasks.keys()].join(', ') || '(none)'}`);
  return t;
}

/**
 * Return the names of all registered tasks, in registration order.
 *
 * @returns {string[]} The registered task names.
 */
export function listTasks() {
  return [...tasks.keys()];
}

/**
 * True when the value looks like a Node.js stream (exposes both `pipe` and `on`).
 *
 * @param {any} value The value to test.
 * @returns {boolean} Whether `value` is treated as a stream.
 */
function isStream(value) {
  if (!value) return false;
  return typeof value.pipe === 'function' && typeof value.on === 'function';
}

/**
 * Invoke a task function and, if it returns a stream, wait for that stream to
 * finish. Returns the task's (stream or non-stream) result.
 *
 * @param {TaskFn} fn The task body to run.
 * @returns {Promise<any>} The task result once any returned stream is done.
 */
async function runTask(fn) {
  const result = await fn();
  if (isStream(result)) await finishStream(result);
  return result;
}

/**
 * Resolve when a returned stream is "done".
 *
 * - A bare Readable (e.g. src() with no downstream consumer) is drained to 'end'
 *   so it actually completes and releases its handles.
 * - A Writable or Duplex (e.g. dest(), or a full src().pipe(transform).pipe(dest()))
 *   is awaited via stream.finished(); for these we only wait on the writable side
 *   because the readable side of a chained pipeline is already being consumed by
 *   the pipe itself.
 *
 * @param {import('node:stream').Stream} stream The stream to await.
 * @returns {Promise<void>} Resolves when the stream has finished and released handles.
 */
async function finishStream(stream) {
  if (isReadableSide(stream)) {
    if (isWritableSide(stream)) {
      await streamFinished(/** @type {any} */ (stream), { readable: false });
    } else {
      // eslint-disable-next-line no-unused-vars
      for await (const _chunk of /** @type {any} */ (stream)) { /* drain to 'end' */ }
    }
  } else {
    await streamFinished(/** @type {any} */ (stream));
  }
}

/** @param {any} s @returns {boolean} True if `s` has a readable side. */
function isReadableSide(s) {
  return streamIsReadable(s) === true;
}
/** @param {any} s @returns {boolean} True if `s` has a writable side. */
function isWritableSide(s) {
  return typeof s._write === 'function' || typeof s.write === 'function';
}

/**
 * A lazily-started task schedule: the thenable returned by series()/parallel().
 * Nothing runs until it is first awaited (or its `.then` is called); afterwards
 * every await observes the same single execution and result.
 *
 * @template T
 * @typedef {object} LazySchedule
 * @property {(onfulfilled?: (value: T) => any, onrejected?: (reason: any) => any) => Promise<any>} then
 */

/**
 * Wrap an async runner in a lazily-started schedule. The returned object is a
 * minimal thenable: `await` treats it exactly like a Promise (the native
 * await protocol calls `.then`), and the work starts on first observation —
 * not when series()/parallel() was called. This is what makes composed
 * schedules safe as items: `series(clean, parallel(a, b, c))` does NOT start
 * `a`/`b`/`c` while evaluating the outer arguments.
 *
 * @template T
 * @param {() => Promise<T>} runner Runs the schedule; may throw synchronously
 *   (surfaced as a rejection, never as a throw).
 * @returns {LazySchedule<T>} The lazy schedule.
 */
function makeSchedule(runner) {
  /** @type {Promise<T>|null} */
  let started = null;
  const start = () => (started ??= Promise.resolve().then(runner));
  return {
    then(onfulfilled, onrejected) {
      return start().then(onfulfilled, onrejected);
    },
  };
}

/**
 * Build a schedule that runs the given tasks sequentially. Resolves with an
 * array of results in order, or rejects on the first error. Accepts task names,
 * functions, arrays, Promises (awaited), other schedules (started when reached),
 * and streams in any mix (nested arrays are flattened).
 *
 * The schedule is LAZY: nothing runs until it is awaited (or `.then`'d). Awaiting
 * the same schedule twice never re-runs its tasks.
 *
 * @param {...TaskItem} args The tasks to run, one after another.
 * @returns {LazySchedule<any[]>} The lazy schedule; await it to run.
 */
export function series(...args) {
  return makeSchedule(async () => {
    const list = /** @type {TaskItem[]} */ (args.flat(Infinity));
    const results = [];
    for (const item of list) {
      if (typeof item === 'string') {
        results.push(await runTask(getTask(item)));
      } else if (typeof item === 'function') {
        results.push(await runTask(item));
      } else if (isStream(item)) {
        await finishStream(
          /** @type {import('node:stream').Stream} */ (item),
        );
      } else if (item && typeof /** @type {any} */ (item).then === 'function') {
        results.push(await item);
      } else if (item != null) {
        throw new TypeError(`Invalid task argument: ${typeof item}`);
      }
    }
    return results;
  });
}

/**
 * A zero-argument thunk that runs one task item to completion.
 *
 * @callback ParallelThunk
 * @returns {Promise<unknown>}
 */

/**
 * Build a thunk for one recognized task item; null items yield null (they are
 * skipped by parallel()).
 *
 * @param {TaskItem} item A single flattened task argument.
 * @returns {ParallelThunk|null} The thunk, or null for ignorable items.
 * @throws {TypeError} If the item is not a recognized task type.
 */
function toThunk(item) {
  if (typeof item === 'string') return () => runTask(getTask(item));
  if (typeof item === 'function') return () => runTask(item);
  if (isStream(item)) {
    const stream = /** @type {import('node:stream').Stream} */ (item);
    return async () => finishStream(stream);
  }
  if (item && typeof /** @type {any} */ (item).then === 'function') {
    // Raw thenable: awaited as-is, matching series() behavior exactly.
    return /** @type {ParallelThunk} */ (() => item);
  }
  if (item == null) return null;
  throw new TypeError(`Invalid task argument: ${typeof item}`);
}

/**
 * True when the value is a non-null thunk (used to skip ignored items).
 *
 * @param {ParallelThunk|null} t The candidate thunk.
 * @returns {t is ParallelThunk} Whether `t` should be run.
 */
function isThunk(t) {
  return t != null;
}

/**
 * Build a schedule that runs the given tasks concurrently. Resolves with an
 * array of results (in input order) when all succeed, or rejects on the first
 * error. Accepts task names, functions, arrays, Promises (awaited), other
 * schedules (started when reached), and streams in any mix (nested arrays
 * flattened).
 *
 * The schedule is LAZY: nothing runs until it is awaited (or `.then`'d). This
 * is what makes `series(clean, parallel(a, b, c), revision)` safe without any
 * extra wrapping — the parallel schedule only starts when series reaches it.
 * Awaiting the same schedule twice never re-runs its tasks.
 *
 * @param {...TaskItem} args The tasks to run at the same time.
 * @returns {LazySchedule<any[]>} The lazy schedule; await it to run.
 */
export function parallel(...args) {
  return makeSchedule(async () => {
    /** @type {TaskItem[]} */
    const list = args.flat(Infinity);
    const thunks = list.map(toThunk);

    const settled = await Promise.allSettled(thunks.filter(isThunk).map((t) => t()));
    for (const s of settled) {
      if (s.status === 'rejected') throw /** @type {any} */ (s.reason);
    }

    /** @type {unknown[]} */
    const results = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value);
    }
    return results;
  });
}

/**
 * Convenience: run a single named task or function to completion.
 *
 * @param {string|TaskFn} nameOrFn A registered task name or a raw task function.
 * @returns {Promise<any[]>} The result array from running that one task.
 * @throws {TypeError} If the argument is neither a string nor a function.
 */
export async function run(nameOrFn) {
  if (typeof nameOrFn === 'string') return series(getTask(nameOrFn));
  if (typeof nameOrFn === 'function') return series(nameOrFn);
  throw new TypeError('run() expects a task name or function');
}

/**
 * Run the default task (set via `seriesDefault`), or every registered task in
 * parallel when no default is set.
 *
 * @returns {Promise<any[]>} The result array from the run.
 */
export async function runDefault() {
  if (defaultTaskName) return series(getTask(defaultTaskName));
  return parallel(...listTasks());
}
