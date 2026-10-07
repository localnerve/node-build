export type TaskFn = () => any;
export type TaskItem = string | TaskFn | import('node:stream').Stream | Promise<any> | null | undefined;
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
export declare function task(name: string, fn: TaskFn): TaskFn;
/**
 * Mark a registered task as the one to run when no task is specified on the CLI
 * (or when `runDefault()` is called with no default set).
 *
 * @param {string} name The registered task name to treat as the default.
 * @returns {void}
 */
export declare function seriesDefault(name: string): void;
/**
 * Look up a registered task by name.
 *
 * @param {string} name The registered task name.
 * @returns {TaskFn} The registered task function.
 * @throws {Error} If no task with that name is registered (lists the known names).
 */
export declare function getTask(name: string): TaskFn;
/**
 * Return the names of all registered tasks, in registration order.
 *
 * @returns {string[]} The registered task names.
 */
export declare function listTasks(): string[];
/**
 * Run the given tasks sequentially. Resolves with an array of results in order,
 * or rejects on the first error. Accepts task names, functions, arrays, Promises,
 * and streams in any mix (nested arrays are flattened).
 *
 * @param {...TaskItem} args The tasks to run, one after another.
 * @returns {Promise<any[]>} An array of per-task results, in input order.
 * @throws {TypeError} If an item is not a recognized task type.
 */
export declare function series(...args: TaskItem[]): Promise<any[]>;
export type ParallelThunk = () => Promise<unknown>;
/**
 * Run the given tasks concurrently. Resolves with an array of results (in input
 * order) when all succeed, or rejects on the first error. Accepts task names,
 * functions, arrays, Promises, and streams in any mix (nested arrays flattened).
 *
 * @param {...TaskItem} args The tasks to run at the same time.
 * @returns {Promise<any[]>} An array of per-task results, in input order.
 * @throws {TypeError} If an item is not a recognized task type.
 */
export declare function parallel(...args: TaskItem[]): Promise<any[]>;
/**
 * Convenience: run a single named task or function to completion.
 *
 * @param {string|TaskFn} nameOrFn A registered task name or a raw task function.
 * @returns {Promise<any[]>} The result array from running that one task.
 * @throws {TypeError} If the argument is neither a string nor a function.
 */
export declare function run(nameOrFn: string | TaskFn): Promise<any[]>;
/**
 * Run the default task (set via `seriesDefault`), or every registered task in
 * parallel when no default is set.
 *
 * @returns {Promise<any[]>} The result array from the run.
 */
export declare function runDefault(): Promise<any[]>;
