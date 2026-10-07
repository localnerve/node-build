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

## Quick start

Point your project at the package, then run a build file with the bundled CLI:

```jsonc
// your project's package.json
{ "dependencies": { "node-build": "file:/path/to/node-build" } }
```

```sh
node /path/to/node-build/bin/node-build.mjs [taskName] [--config ./build.mjs]
```

Or drive tasks from code — everything returns Promises:

```js
import { task, series } from 'node-build';
task('hello', async () => console.log('hi'));
await series('hello');
```

A complete, runnable build lives in [`build.mjs`](./build.mjs) with inputs in
[`examples/src/`](./examples/) — try `npm run build:example` from this repository.

## Documentation

Each feature of the public API has its own guide in [`docs/`](./docs/), written
for someone who has never used Gulp or this project before. Start with
[Getting started](./docs/getting-started.md).

| Guide | What it covers |
| ----- | -------------- |
| [Getting started](./docs/getting-started.md) | The mental model, install, and a first build (CLI + code). |
| [Tasks, series & parallel](./docs/tasks.md) | `task()`, `series()`, `parallel()`, `run()`, `getTask()`, `listTasks()`, `seriesDefault()`, `runDefault()` — defining and composing work. |
| [Streams: src, dest & through](./docs/streams.md) | `src()`, `dest()`, `clean()`, `through()`, `watch()`, and `pipeline()` — moving files in, transforming them, writing them out, deleting, and re-running on change. |
| [The File object](./docs/file.md) | The `File` class: `path`/`base`/`relative`/`contents`, type checks, `clone()`, `toJSON()`. |
| [Globbing](./docs/glob.md) | Pattern syntax, `base` derivation, and the raw `globFiles()` / `deriveBase()` helpers. |
| [Gulp plugin interop](./docs/gulp-plugins.md) | Reusing existing Gulp plugins, Vinyl auto-detection, and the `wrapFile()`/`unwrapFile()` byte-stream bridge. |
| [The CLI](./docs/cli.md) | Invoking builds from the terminal, build-file discovery, `--watch`, and receiving your own `--flags` in a task. |

### Export reference (quick map)

- **Tasks:** [`task`](./docs/tasks.md), [`series`](./docs/tasks.md),
  [`parallel`](./docs/tasks.md), [`run`](./docs/tasks.md),
  [`runDefault`](./docs/tasks.md), [`getTask`](./docs/tasks.md),
  [`listTasks`](./docs/tasks.md), [`seriesDefault`](./docs/tasks.md)
- **Streams:** [`src`](./docs/streams.md), [`dest`](./docs/streams.md),
  [`through`](./docs/streams.md), [`clean`](./docs/streams.md),
  [`watch`](./docs/streams.md#watch), [`pipeline`](./docs/streams.md),
  [`wrapFile`](./docs/gulp-plugins.md), [`unwrapFile`](./docs/gulp-plugins.md)
- **Files:** [`File`](./docs/file.md), [`resolveFileClass`](./docs/gulp-plugins.md),
  [`resolveFileClassSync`](./docs/gulp-plugins.md)
- **Globbing:** [`globFiles`](./docs/glob.md), [`deriveBase`](./docs/glob.md)
- **CLI & args:** [`parseArgs`](./docs/cli.md)

## Type support

The public API is fully JSDoc-typed and ships generated TypeScript declarations
under [`types/`](./types) (one `.d.ts` per entry point, wired into the
`exports` map). Consumers get full IntelliSense in both JS and TS projects with
no configuration; `import { task, src } from 'node-build'` resolves types
automatically.

```sh
npm run typecheck   # strict checkJs over all of src/ (whole project)
npm run typecheck -- src/file.js   # or just one module (and its imports)
npm run build:types # regenerate types/*.d.ts from the JSDoc source of truth
```

`typescript` is a devDependency only — the runtime stays zero-dependency.

## Test

```sh
npm test        # node --test with coverage (target: >= 95% line coverage)
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

## LICENSE

* MIT - Copyright 2026 Alex Grant, LocalNerve, LLC