export type WatchOptions = {
    /**
     * Directory patterns resolve against (and the root of the recursive watcher).
     */
    cwd?: string;
    /**
     * Milliseconds of quiet after the last event before the task runs. Rapid bursts (saves, copy steps) coalesce into one run.
     */
    debounceMs?: number;
    /**
     * Called before each run (the initial one uses reason 'start').
     */
    onRun?: (reason: 'event' | 'start') => void;
    /**
     * Called when a re-run rejects; watching continues.
     */
    onError?: (err: Error) => void;
};
export type WatchHandle = {
    /**
     * Stop the watcher and resolve once it is released. Pending debounced runs are dropped.
     */
    close: () => Promise<void>;
    /**
     * True while a task run is in flight.
     */
    running: boolean;
};
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
export declare function watch(globs: string | string[], taskName?: string, opts?: WatchOptions): Promise<WatchHandle>;
export default watch;
