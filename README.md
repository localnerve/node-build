# node-build

A **no-dependency**, Node.js 24+ streaming build runner that replaces Gulp's core
while staying compatible with the large ecosystem of existing Gulp plugins.

It is built entirely on `node:` built-ins — zero runtime dependencies. The only
thing it *optionally* reaches for at run time is your project's own `vinyl`
package (if present), to maximize plugin compatibility.

```js
import { task, series, parallel, src, dest, through } from 'node-build';

task('html', () =>
  src('src/**/*.html')
    .pipe(through((file) => { /* mutate file.contents, return file */ }))
    .pipe(dest('dist')),
);

export default series('html');
```

## Why / how it works

Gulp's "plugins" are simply **object-mode `Transform` streams that operate on
Vinyl file objects**. The runner (`gulp.src`/`gulp.dest`) is only the I/O and
task-scheduling layer around those transforms. So instead of re-implementing
plugins, node-build re-implements just three small pieces using Node built-ins:

| Gulp piece        | node-build equivalent                                  | Backed by                |
| ----------------- | ------------------------------------------------------ | ------------------------ |
| `glob-stream`     | `src()` (object-mode readable of File objects)         | `node:fs.glob` / `readdir` |
| `vinyl`           | built-in `File` shim, or your project's real `vinyl`    | zero-dep class            |
| `undertaker`      | `task()` + `series()`/`parallel()` (Promise-based)     | Promises                  |

Everything is piped with `node:stream/promises`.`pipeline`, which handles
backpressure, error propagation, and cleanup across the whole chain.

## Requirements

- Node.js **>= 24** (developed against v24.21.0 LTS). On older interpreters the
  glob layer falls back to `fs.readdir({ recursive: true })` automatically.

## Install / use

This is a library you import from your own project's build file, plus an optional
CLI. There are no dependencies to install. To consume it as a package, either
publish it or point at the local path:

```jsonc
// your project's package.json
{ "dependencies": { "node-build": "file:/path/to/node-build" } }
```

Or run the bundled CLI against a build file:

```sh
node /path/to/node-build/bin/node-build.mjs [taskName] [--config ./build.mjs]
```

## API

### `src(patterns, opts?)` → `Readable`
Globs files and yields one **File** object per match (object-mode readable).
Backed by an async generator so backpressure is respected and each file is read
once.

- `patterns`: string or array of glob patterns. Negate with a leading `!`.
  Braces (`{a,b}`) are supported.
- `opts.cwd`: directory patterns resolve against (default `process.cwd()`).
- `opts.base`: override the derived gulp-style base directory.
- `opts.encoding`: if set, contents are read as strings of that encoding;
  otherwise Buffers (matches Gulp's default).

The **base** is derived from the static leading portion of the pattern
(e.g. `src/**/*.css` → base `src/`), so `file.relative` and `file.base` match
what existing plugins expect.

### `dest(dir, opts?)` → `Writable`
Writes each File to `path.join(dir, file.relative)`, creating parent directories.
Supports Buffer/string contents and piped streamed contents.

### `through(fn)` → `Transform`
Build native steps without writing a Transform class. `fn(file)` may:
- mutate `file` in place and return it (or nothing),
- return a new File to push downstream,
- return `null`/`undefined` to drop the file,
- return an array of Files for multiple outputs.
Async functions are supported.

### `task(name, fn)` / `series(...)` / `parallel(...)`
- `task(name, fn)` registers a task. `fn` may be sync, async, or **return a
  stream** (a bare Readable, a Writable such as `dest()`, or a full piped chain) —
  the task resolves when that stream completes.
- `series(...tasks)` runs sequentially, stopping at the first error.
- `parallel(...tasks)` runs concurrently, resolving when all succeed.
Both accept task names, functions, and nested arrays, and return a Promise.

### Gulp-plugin interop helpers
- `wrapFile(filePath)` → object-mode transform that turns raw byte chunks into
  `{ path, contents }` file-like objects.
- `unwrapFile()` → the inverse; turns file-like objects back to raw contents.

These are the "no Vinyl required" bridge (the same pattern used by
`@localnerve/csp-hashes`) for feeding plain Node byte streams into object-mode
Gulp plugins, and vice versa.

### Other exports
- `File` — the built-in Vinyl-compatible file class.
- `pipeline` — re-export of `node:stream/promises`.`pipeline`.
- `globFiles(patterns, opts)`, `deriveBase(pattern, cwd)` — lower-level glob utils.
- `getTask(name)`, `listTasks()`, `run(task)`, `runDefault()`, `seriesDefault(name)`.

## Using existing Gulp plugins

Most Gulp plugins are object-mode transforms that only rely on the Vinyl surface
(`file.path`, `file.base`, `file.relative`, `file.contents`, and the like). Those
work **unchanged**:

```js
import { task, src, dest } from 'node-build';
import someGulpPlugin from 'some-gulp-plugin'; // any object-mode transform

task('css', () => src('src/**/*.css').pipe(someGulpPlugin(opts)).pipe(dest('dist')));
```

**Vinyl auto-detection.** node-build ships a zero-dependency `File` shim by
default. At run time it tries to resolve a real `vinyl` package from *your*
project; if one exists, it uses that instead so plugins that do
`instanceof Vinyl` or import vinyl internals also work — without node-build itself
declaring a dependency on it. You can force the shim by simply not installing
`vinyl`.

## Example

See `build.mjs` + `examples/`:

```sh
node ./bin/node-build.mjs          # runs parallel('html','css') then 'manifest'
node ./bin/node-build.mjs html     # run a single task
```

## Test

```sh
npm test        # node --test (11 tests, incl. a gulp-plugin-style interop test)
```

## Design notes & limitations

- **Object-mode only.** Like Gulp, the file pipeline is object-mode (one File per
  chunk). Byte-level streaming is available for I/O edges via `wrapFile`/
  `unwrapFile` and plain `pipeline`.
- **Glob scope.** Supports `*`, `**`, `?`, braces, and negation. It does not
  implement the full minimatch character-class grammar; unusual patterns fall back
  to a small built-in matcher. For exotic needs, pass explicit file lists by
  building your own `Readable.from(...)`.
- **`base` derivation** mirrors glob-stream's static-prefix rule for common
  patterns; override with `src(patterns, { base })` when you need exact control.
