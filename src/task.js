/**
 * node-build — task registry and scheduler.
 * 
 * A "task" is a function (or an array of tasks). It may be sync, async, or
 * stream-returning. series() runs tasks sequentially; parallel() runs them
 * concurrently. Both return Promises for modern usage.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { isReadable as streamIsReadable } from 'node:stream';
import { finished as streamFinished } from 'node:stream/promises';

const tasks = new Map();
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

/** Await a task's result, handling stream-returning tasks. */
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
      await streamFinished(stream, { readable: false });
    } else {
      // eslint-disable-next-line no-unused-vars
      for await (const _chunk of stream) { /* drain to 'end' */ }
    }
  } else {
    await streamFinished(stream);
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
 * Run the given tasks sequentially. Resolves with an array of results in order,
 * or rejects on the first error. Accepts task names, functions, arrays, Promises,
 * and streams in any mix (nested arrays are flattened).
 *
 * @param {...TaskItem} args The tasks to run, one after another.
 * @returns {Promise<any[]>} An array of per-task results, in input order.
 * @throws {TypeError} If an item is not a recognized task type.
 */
export async function series(...args) {
  const list = args.flat(Infinity);
  const results = [];
  for (const item of list) {
    if (typeof item === 'string') {
      results.push(await runTask(getTask(item)));
    } else if (typeof item === 'function') {
      results.push(await runTask(item));
    } else if (isStream(item)) {
      await finishStream(item);
    } else if (item && typeof item.then === 'function') {
      results.push(await item);
    } else if (item != null) {
      throw new TypeError(`Invalid task argument: ${typeof item}`);
    }
  }
  return results;
}

/**
 * Run the given tasks concurrently. Resolves with an array of results (in input
 * order) when all succeed, or rejects on the first error. Accepts task names,
 * functions, arrays, Promises, and streams in any mix (nested arrays flattened).
 *
 * @param {...TaskItem} args The tasks to run at the same time.
 * @returns {Promise<any[]>} An array of per-task results, in input order.
 * @throws {TypeError} If an item is not a recognized task type.
 */
export async function parallel(...args) {
  const list = args.flat(Infinity);
  const thunks = list.map((item) => {
    if (typeof item === 'string') return () => runTask(getTask(item));
    if (typeof item === 'function') return () => runTask(item);
    if (isStream(item)) return async () => finishStream(item);
    if (item && typeof item.then === 'function') return () => item;
    if (item == null) return null;
    throw new TypeError(`Invalid task argument: ${typeof item}`);
  });

  const settled = await Promise.allSettled(thunks.filter(Boolean).map((t) => t()));
  for (const s of settled) {
    if (s.status === 'rejected') throw s.reason;
  }
  return settled.map((s) => s.value);
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
