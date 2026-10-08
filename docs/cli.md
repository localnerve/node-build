# The CLI

node-build ships a small command-line runner so you can execute your build from
a terminal (or CI) without writing any glue code. This page explains how to
invoke it, how it finds and runs your build file, and — importantly — how to
receive **your own** command-line arguments inside a task.

## Usage

```sh
node /path/to/node-build/bin/nbs [taskName] [--config <file>] [--watch] [--list]
node /path/to/node-build/bin/nbs --glob <pattern>... [--json]
```

| Argument            | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `taskName`          | Run this one registered task (positional, optional).           |
| `--config`, `-c`    | Explicit path to your build module.                            |
| `--watch`           | Build, then re-run on asset changes (see [Watching](#watching)). |
| `--list`, `-l`      | Print the names of all registered tasks and exit — runs nothing. |
| `--glob <pattern>`  | List what a glob pattern matches, without building — repeatable, needs no build file (see [Glob report](#glob-report)). |
| `--json`            | Machine-readable output for `--glob`.                          |
| `--help`, `-h`      | Print usage and exit.                                          |

The package ships a `bin` entry, so once it is installed (or linked) in your
project you can invoke it as `nbs` instead of the full path.

## How it finds your build file

With no `--config`, the CLI looks in your current directory, in this order:

```
build.mjs  →  build.js  →  gulpfile.mjs  →  gulpfile.js
```

The first one that exists is used. The `gulpfile.*` fallback means an existing
Gulp project can often be run **unchanged** just by pointing the CLI at it — a
nice migration on-ramp (see [Gulp plugin interop](./gulp-plugins.md)).

## How it runs your tasks

The CLI imports your build file so its `task(...)` registrations run, then:

1. If your file **exports a default function**, that function is called with the
   requested task name — giving you full control over composition. This is the
   most flexible pattern (used by [`../examples/basic/build.mjs`](../examples/basic/build.mjs)):

   ```js
   // build.mjs
   import { task, series, parallel } from 'node-build';

   task('html', () => /* … */);
   task('css',  () => /* … */);

   export default (taskName) =>
     taskName ? series(taskName) : parallel('html', 'css');
   ```

2. Otherwise, if you passed a **task name**, it runs just that task.
3. Otherwise it runs the **default**: your `seriesDefault(...)` task if set, else
   every registered task in parallel (see [Tasks](./tasks.md)).

On success it prints `✓ build complete (<file>)`; on failure it prints the error
and exits with a non-zero code — exactly what CI needs.

## Listing tasks

`--list` (or `-l`) imports your build file so its `task(...)` registrations run,
then prints every registered task name — one per line, in registration order —
and exits **without running anything**:

```sh
$ node ./bin/nbs --list
html
css
manifest
```

This is the same registry behind the exported [`listTasks()`](./tasks.md), so
what you see here is exactly what the CLI (and your build file) can run. If no
tasks are registered it prints `No tasks registered.` and still exits 0.

## Glob report

`--glob <pattern>` lists the files a pattern would match, **without building** —
a quick way to sanity-check globs before wiring them into a pipeline (it is the
same [`globFiles()` / `deriveBase()`](./glob.md) machinery your streams use). It
is handled *before* build-file discovery, so it works in any directory, even
one with no build file at all:

```sh
$ node ./bin/nbs --glob 'examples/basic/src/**/*.{html,css}'
pattern: examples/basic/src/**/*.{html,css}
base:    examples/basic/src
---
index.html
style.css
```

- Pass the flag multiple times to report on several patterns in one run.
- Matches print relative to the pattern's base directory (the longest static
  leading portion — see [`deriveBase()`](./glob.md)).
- A pattern that matches nothing is not an error: it prints `(no matches)` and
  the CLI still exits 0.
- Add `--json` for machine/agent consumption — one object per pattern:

  ```sh
  $ node ./bin/nbs --glob 'src/**' --json
  [
    { "pattern": "src/**", "base": "src", "matches": ["index.html", "style.css"] }
  ]
  ```

## Receiving your own CLI arguments

The CLI only understands its *own* flags (`--config`, `--watch`, `--list`,
`--help`) and the task name. **Any other flag is left alone** — it never
consumes unknown `--options`. That means your build file can read arbitrary
arguments straight from `process.argv`, which is how you add feature-specific
switches to a task:

```sh
node-build manifest --minify --target staging
#                    └──────────┬──────────────┘  (your flags, passed through)
```

node-build ships a small parser you can import — **`parseArgs()`** (exported from
`node-build` or `node-build/args`). It turns `--name value` pairs and bare `--flags`
into an object, so your build file doesn't need to hand-roll argv logic:

```js
import { parseArgs } from 'node-build';

const args = parseArgs(process.argv);
// node-build mytask --a 123 --b "my string" --c
//   -> { a: "123", b: "my string", c: true }
```

How `parseArgs` decides what is a name and what is a value:

- Any token starting with `-` is a **flag name** (mapped to `true` by default);
  the leading dashes of any length are stripped, so `-a`, `--a`, and `---a`
  all become `a`.
- A following non-dash token is the **value** of the most recent flag name
  (replacing its `true`).
- A leading non-dash token with no preceding flag is ignored, and non-string
  entries are skipped.

Now any task can branch on those flags:

```js
import { task } from 'node-build';

task('manifest', async () => {
  if (args.minify) { /* minified manifest */ }
  console.log('target:', args.target ?? '(none)');
});
```

Because the CLI passes unknown flags through untouched, this works with *any*
build file and needs no special node-build API — it is just `process.argv`
parsing you already know from Node.

## Watching

`--watch` runs your build once, then keeps watching for **asset** changes and
re-runs the selected task (debounced) whenever a watched file is added,
removed, or edited. This is the zero-dependency stand-in for `gulp-watch`.

```sh
node ./bin/nbs [taskName] --watch
```

To tell node-build *what* to watch, your build file's **default export**
declares the globs:

```js
// build.mjs
import { task, series } from 'node-build';

task('css', () => /* src().pipe(dest()) … */);
seriesDefault('css');

// Globs watched when you pass --watch. Negation works, same syntax as src().
export default { globs: ['src/css/**', '!src/css/vendor/**'] };
```

On each matching change the CLI prints `change detected — running…` and re-runs.
Press `Ctrl+C` to stop; the watcher is closed cleanly.

### What `--watch` watches (and what it doesn't)

- It uses a single recursive `fs.watch` on your working directory, so any number
  of globs costs one native watcher. Changes are matched against your globs and
  debounced, so a burst of saves becomes one re-run.
- It watches **files read by your tasks** (your assets). If you only need to
  reload the *build file itself* when you edit it, use Node's built-in
  `node --watch ./bin/nbs …` instead — that re-runs on **import-graph**
  changes. node-build deliberately does not wrap `--watch`, because a build file
  that merely *reads* assets inside a task never registers those files in the
  module graph, so `node --watch` would not fire for them.

You can also drive watching from code with the exported **[`watch()`](./streams.md#watch)**
function — same engine, more control (custom task selection, `onRun`/`onError`
callbacks, explicit `{ close() }`).

## Examples

```sh
# Run the default task (default export function, or seriesDefault)
node ./bin/nbs

# Run one specific registered task
node ./bin/nbs html

# Point at an explicit build file
node ./bin/nbs --config ./scripts/build.mjs css

# Pass your own flags straight through to the build module
node ./bin/nbs manifest --minify --target staging

# List registered tasks (runs nothing)
node ./bin/nbs --list

# See help
node ./bin/nbs --help
```

The repository's [`examples/basic/build.mjs`](../examples/basic/build.mjs) is a complete
working example: run `npm run build:example` from the node-build root to watch
it copy and transform the files in `examples/basic/src/` into `examples/basic/dist/`.
