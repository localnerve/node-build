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

/** Register a task. Returns the function so it can be chained/returned. */
export function task(name, fn) {
  if (typeof name !== 'string' || !name.length) throw new TypeError('task name must be a non-empty string');
  if (!fn || typeof fn !== 'function') throw new TypeError(`task "${name}" must be a function`);
  tasks.set(name, fn);
  return fn;
}

/** Mark the task to run when none is specified on the CLI. */
export function seriesDefault(name) {
  defaultTaskName = name;
}

export function getTask(name) {
  const t = tasks.get(name);
  if (!t) throw new Error(`Unknown task: "${name}". Registered: ${[...tasks.keys()].join(', ') || '(none)'}`);
  return t;
}

export function listTasks() {
  return [...tasks.keys()];
}

/** True when the value is a stream (has pipe + on, or is an async iterable of chunks). */
function isStream(value) {
  if (!value) return false;
  return typeof value.pipe === 'function' && typeof value.on === 'function';
}

/** Await a task's result, handling stream-returning tasks. */
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

function isReadableSide(s) {
  return streamIsReadable(s) === true;
}
function isWritableSide(s) {
  return typeof s._write === 'function' || typeof s.write === 'function';
}

/**
 * Run the given tasks sequentially. Resolves with an array of results in order,
 * or rejects on the first error. Accepts task names, functions, arrays, and
 * stream-returning values.
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
 * order) when all succeed, or rejects on the first error.
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

/** Convenience: run a single named task or function to completion. */
export async function run(nameOrFn) {
  if (typeof nameOrFn === 'string') return series(getTask(nameOrFn));
  if (typeof nameOrFn === 'function') return series(nameOrFn);
  throw new TypeError('run() expects a task name or function');
}

/** Run the default task (set via seriesDefault), or all registered tasks in order. */
export async function runDefault() {
  if (defaultTaskName) return series(getTask(defaultTaskName));
  return parallel(...listTasks());
}
