# node-build — API reference

Single machine-readable reference for the full public API surface of
`node-build`. Load this one file to see every export, signature, parameter, and
return type. Prose docs live in [tasks.md](./tasks.md), [streams.md](./streams.md),
[file.md](./file.md), [glob.md](./glob.md), and [cli.md](./cli.md).

Package facts: ESM-only · zero runtime dependencies (devDeps only) ·
`engines.node >= 24.0.0` · TypeScript declarations at `types/*.d.ts`
(emitted from JSDoc; do not edit by hand).

## Entry points

| Import | Module | Named exports | Default export |
| --- | --- | --- | --- |
| `node-build` | `src/index.js` | all of the below (plus `pipeline`) | `nodeBuild` object |
| `node-build/task` | `src/task.js` | `task`, `seriesDefault`, `getTask`, `listTasks`, `series`, `parallel`, `run`, `runDefault` | — |
| `node-build/stream` | `src/stream.js` | `src`, `dest`, `through`, `wrapFile`, `unwrapFile` | — |
| `node-build/file` | `src/file.js` | `File` | `File` |
| `node-build/glob` | `src/glob.js` | `globFiles`, `deriveBase` | `globFiles` |
| `node-build/clean` | `src/clean.js` | `clean` | `clean` |
| `node-build/args` | `src/args.js` | `parseArgs` | `parseArgs` |
| `node-build/watch` | `src/watch.js` | `watch` | `watch` |

Note: there is **no** `node-build/vinyl` subpath — `resolveFileClass` /
`resolveFileClassSync` are exported from the main entry only.

### Default export (`import nodeBuild from 'node-build'`)

Plain object mirroring gulp's common surface for quick migration. Keys:
`task`, `series`, `parallel`, `run`, `runDefault`, `src`, `dest`, `through`,
`clean`, `watch`, `parseArgs`, `pipeline`. NOT on the default object (named
imports only): `getTask`, `listTasks`, `seriesDefault`, `wrapFile`, `unwrapFile`,
`File`, `globFiles`, `deriveBase`, `resolveFileClass`, `resolveFileClassSync`.

---

## Task API (from `node-build` or `node-build/task`)

### `task(name, fn)`

```ts
function task(name: string, fn: TaskFn): TaskFn;
type TaskFn = () => any; // sync value | Promise | Node.js stream
```

- **name**: non-empty string; the key used to run the task by name.
- **fn**: task body — sync, async (returns a Promise), or stream-returning
  (e.g. `src(...).pipe(dest(...))`). A returned stream is awaited before the
  task counts as done.
- **returns** `fn` unchanged (for chaining / direct passing to `series`/`parallel`).
- **throws** `TypeError` if `name` is not a non-empty string or `fn` is not a function.
- Registration order is preserved and visible via `listTasks()` / CLI `--list`.

### `seriesDefault(name)`

```ts
function seriesDefault(name: string): void;
```

Marks a registered task as the default for `runDefault()` and for the CLI when
no task name is given. Throws only indirectly (unknown names fail at run time).

### `getTask(name)`

```ts
function getTask(name: string): TaskFn;
```

- **returns** the registered task function.
- **throws** `Error` (`Unknown task: "…". Registered: …`) when not registered.

### `listTasks()`

```ts
function listTasks(): string[];
```

All registered task names, in registration order.

### `series(...items)`

```ts
function series(...items: TaskItem[]): LazySchedule<any[]>;
type TaskItem = string | TaskFn | NodeJS stream | thenable | null | undefined;
type LazySchedule<T> = { then(res?: (v: T) => any, rej?: (e: any) => any): Promise<any> };
```

- Returns a **lazy schedule**: nothing runs until it is first `await`ed (or
  `.then`'d); awaiting it again never re-runs. This is why nested schedules are
  safe as items — `series(clean, parallel(a, b, c))` starts the parallel only
  when series reaches that slot.
- Runs items **sequentially**, stops at the first error (rejects with it).
- Nested arrays are flattened (`args.flat(Infinity)`).
- `null`/`undefined` items are ignored. Strings resolve via `getTask`.
  Functions run directly. Streams are awaited to completion. Thenables
  (Promises, schedules) awaited as-is (their resolved value becomes the result
  entry; a schedule item starts when reached).
- **resolves to** array of per-task results in input order (stream items and
  thenable skips may yield fewer entries — stream completion contributes no
  value unless the task fn returned one).
- **rejects** with `TypeError` for unrecognized item types.

### `parallel(...items)`

```ts
function parallel(...items: TaskItem[]): LazySchedule<any[]>;
```

Same accepted items as `series()`, run **concurrently** via `Promise.allSettled`;
rejects on the first error (others keep running to settle). Results in input
order. Equally lazy — see `series()`.

### `run(nameOrFn)`

```ts
function run(nameOrFn: string | TaskFn): Promise<any[]>;
```

Convenience for a single task: `series(getTask(name))` or `series(fn)`.
**throws** `TypeError` for anything else.

### `runDefault()`

```ts
function runDefault(): Promise<any[]>;
```

Runs the `seriesDefault()` task, or **all registered tasks in parallel** when no
default is set (this is what the CLI does with no task name).

---

## Stream API (from `node-build` or `node-build/stream`)

All object-mode. Files are Vinyl-compatible (see File below).

### `src(patterns, opts?)`

```ts
function src(
  patterns: string | string[],
  opts?: { cwd?: string; base?: string; encoding?: BufferEncoding; from?: string },
): Readable; // objectMode, yields File
```

- **patterns**: glob(s), negation via leading `!`, brace sets `{a,b}`. Resolved
  against `cwd` (default `process.cwd()`).
- **opts.base**: override the derived gulp-style base dir (else `deriveBase`).
- **opts.encoding**: if set, `file.contents` is a string of that encoding; else Buffer.
- **opts.from**: path used to resolve the project's file class (vinyl vs shim).
- Backed by `Readable.from(asyncGenerator)` — backpressure-safe, each file read once.
- **Warns** (`node-build: src() matched no files for pattern(s): …`) when a
  positive pattern matches nothing; negation-only lists do not warn.

### `dest(destDir, opts?)`

```ts
function dest(destDir: string, opts?: { cwd?: string }): Writable; // objectMode, consumes File
```

- Writes each file to `path.join(outDir, file.relative)` (falls back to the
  basename), creating parent dirs. Buffer/string written directly; streamed
  contents piped through.
- Mutates mutable Files: sets `file.path` to the final on-disk location.

### `through(fn)`

```ts
function through(fn: (file: File) => any): Transform; // objectMode both sides
```

Per-file transform for native (non-gulp) build steps. `fn` may be async and may:

- return a new File → pushed downstream;
- mutate the incoming File and return nothing → it is re-pushed;
- return `null`/`undefined` → file dropped;
- return an array of Files → all pushed (one input → many outputs).

**Validates output**: any non-null pushed value must be File-like (object with a
string `.path`) or `through()` throws a clear `TypeError` naming what it got.

### `wrapFile(filePath)` / `unwrapFile()` — raw-buffer ↔ file bridge

```ts
function wrapFile(filePath: string): Transform; // bytes in -> { path, contents } out
function unwrapFile(): Transform;               // { contents } in -> bytes out
```

Let plain Node byte streams feed object-mode gulp plugins (and back) without
vinyl — the csp-hashes bridge pattern. `wrapFile` labels every chunk with the
given `filePath`.

### `pipeline` (re-export from `node:stream/promises`)

```ts
function pipeline(source, ...transforms, destination, opts?): Promise<void>;
```

The recommended way to wire streams in a task: handles backpressure, error
propagation, and cleanup across the chain. Supports `{ signal }`, `{ end }`.

---

## File (from `node-build` or `node-build/file`)

### `class File` — Vinyl-compatible shim

Used automatically when no real `vinyl` package is resolvable in the project;
real vinyl is used transparently when present (see `resolveFileClass`).

```ts
new File(opts?: {
  cwd?: string;            // default process.cwd(); resolves relative paths
  path?: string | null;    // absolute or cwd-relative
  base?: string | null;    // default: parent dir of path
  contents?: Buffer | string | Readable | null; // default null
  stat?: Stats | Dirent | null;
  history?: string[];      // default [path] when path given
});

// Properties (get/set unless noted)
file.path: string | null;        // setter unshifts new values onto history
file.base: string | null;
file.relative: string;           // READ-ONLY: path vs base, basename fallback, '' for null file
file.contents: Buffer | string | Readable | null;
file.stat: Stats | Dirent | null;
file.history: string[];          // READ-ONLY, most recent first

// Methods
file.isBuffer(): boolean;        // contents is a Buffer
file.isNull(): boolean;          // contents == null
file.isStream(): boolean;        // contents has .pipe (single-use stream)
file.isSymbolicLink(): boolean;  // stat says so
file.clone(opts?: { path?: string|null; base?: string|null; contents?: Contents }): File;
file.toJSON(): { path: string|null; base: string|null; relative: string; contents: string|Contents };
```

Notes: buffer/string contents clone by value; stream contents share the same
single-use reference (mirrors Vinyl). `toJSON()` serializes Buffer as UTF-8.

---

## Glob (from `node-build` or `node-build/glob`)

### `globFiles(patterns, opts?)`

```ts
function globFiles(
  patterns: string | string[],
  opts?: { cwd?: string },
): Promise<string[]>; // sorted, de-duplicated ABSOLUTE file paths (files only)
```

- Negation via leading `!`; brace sets `{a,b}` expanded; directories excluded.
- Prefers built-in `fs.glob` (callback form on Node 24.21, entries
  `{name, parentPath}` — normalized internally); falls back to recursive
  `readdir` + regex matcher when unavailable or on error.

### `deriveBase(pattern, cwd?)`

```ts
function deriveBase(pattern: string, cwd?: string): string; // absolute base dir
```

Gulp-style base: the longest static (non-glob) leading portion of a single
pattern. A trailing plain-filename segment is treated as the file, not a dir
(`src/app/*.js` → `…/src/app`). Mirrors vinyl-fs/glob-stream so `File.base` /
`File.relative` match what existing gulp plugins expect.

---

## clean (from `node-build` or `node-build/clean`)

### `clean(patterns, opts?)`

```ts
function clean(
  patterns: string | string[],
  opts?: { cwd?: string },
): Promise<string[]>; // absolute paths actually REMOVED, sorted ([] if nothing matched)
```

Dependency-free gulp-clean equivalent. Accepts glob patterns (same syntax as
`src()`, negation ok) **and** literal paths mixed freely — `clean('dist')` works
because a bare non-glob path is resolved and removed directly (a bare dir name
matches no files via the glob). Directories removed recursively; missing targets
ignored → **idempotent**, safe to call unconditionally at build start.

---

## parseArgs (from `node-build` or `node-build/args`)

### `parseArgs(argList)`

```ts
function parseArgs(argList: string[]): Record<string, string | boolean>;
```

- Token starting with `-` (any dash length): flag **name** → `true`, unless the
  next non-dash token supplies a value (`--target staging` → `target: 'staging'`).
- Leading dashes stripped (`-a`, `--a`, `---a` all → key `a`).
- Non-string / empty entries ignored. **throws** `TypeError` if not an array.

```js
parseArgs(['build', '--minify', '--target', 'staging', '-v'])
// -> { build: true, minify: true, target: 'staging', v: true }
```

---

## watch (from `node-build` or `node-build/watch`)

### `watch(globs, taskName?, opts?)`

```ts
function watch(
  globs: string | string[],
  taskName?: string,   // default: seriesDefault() task, else all tasks in parallel
  opts?: {
    cwd?: string;            // default process.cwd(); root of the recursive watcher
    debounceMs?: number;     // default 100
    onRun?: (reason: 'event' | 'start') => void;
    onError?: (err: Error) => void;
  },
): Promise<{ close: () => Promise<void>; running: boolean }>;
```

- One recursive `fs.watch(cwd)` for any number of patterns. Change detection is
  an mtime snapshot diff of current glob matches → **edits** to matched files
  re-run too, not just adds/removes; rename churn that leaves matches unchanged
  is ignored.
- Runs are serialized with coalescing (events mid-run → one follow-up).
- Initial run happens immediately (`onRun('start')`) — watch() doubles as
  "build, then keep building". Task failures go to `onError`; watching continues.
- **returns** handle: `close()` stops the watcher (drops pending debounced runs),
  `running` is true while a task run is in flight.
- **throws** `TypeError` on empty globs or non-string `taskName`.
- For reloading the *build file itself*, use `node --watch` instead (documented,
  not implemented here).

---

## Vinyl resolution (main entry only)

### `resolveFileClass(fromPath?)` / `resolveFileClassSync(fromPath?)`

```ts
function resolveFileClass(fromPath?: string): Promise<ResolvedFileClass>;
function resolveFileClassSync(fromPath?: string): ResolvedFileClass;
type ResolvedFileClass = { Vinyl: FileClass; source: 'vinyl' | 'shim' };
// FileClass: constructible with no args -> empty File-like object
```

Resolves the best Vinyl-compatible file class for a project: a real `vinyl`
package when resolvable **from the consuming project's path** (scoped via
`createRequire`, not node-build's own deps), else the built-in shim. Memoised per
resolved base path. `fromPath` defaults to `process.cwd()`.

Internal (not part of the public surface, used by tests): `clearFileClassCache()`
in `src/vinyl.js`.

---

## CLI (`nbs`)

The binary is `bin/nbs` (installed as `nbs`). Not an importable API — see
[cli.md](./cli.md) for full docs. Quick reference:

```
nbs [task] [--config <file>] [--watch] [--list] [--help] [unknown flags passed through]
```

- Build file resolution: `--config`/`-c` path first, else the first existing of
  `build.mjs`, `build.js`, `gulpfile.mjs`, `gulpfile.js` in the cwd.
- Dispatch: a **function** default export is called as `defaultExport(task)`
  (the positional task name, possibly `undefined`); otherwise a task name runs
  via `run(task)`, and with no task name `runDefault()` runs.
- Unknown flags are passed through to the build file's `process.argv`
  (use `parseArgs()` there); once an unknown flag appears, later non-dash tokens
  are NOT treated as a task name.
- `--list`/`-l`: prints registered tasks one per line and exits, runs nothing.
- `--watch`: flag (the watched task is the positional `[task]`, else the default).
  Globs come from the build file's default export — an object `{globs:[…]}` or a
  function carrying a `.globs` property; errors clearly when absent. Stops on
  SIGINT/SIGTERM.
