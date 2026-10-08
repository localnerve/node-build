# Tasks, series & parallel

You have already met Gulp (or you are about to): a build is just a set of named
steps that you can run in an order. In node-build those steps are **tasks**,
and the ordering tools are `series()` and `parallel()`. This page explains how
to define tasks, what kinds of functions they may be, and how to compose them.

## Registering a task with `task(name, fn)`

```js
import { task } from 'node-build';

task('clean', async () => {
  console.log('removing dist/');
});
```

- `name` must be a **non-empty string** — it is what you use later to run the
  task from the CLI or by name.
- `fn` must be a **function**. It may be:
  - **synchronous** — returns nothing or a plain value;
  - **async** — returns a Promise (the usual case);
  - **stream-returning** — returns a Node.js stream such as
    `src(...).pipe(dest(...))` (see [Streams](./streams.md)). When this happens,
    the task is considered *done* only when that stream finishes writing.

`task()` returns `fn` itself, so you can chain or reuse it:

```js
const copyCss = task('css', () => src('src/*.css').pipe(dest('dist')));
// later:
await series(copyCss);  // passing the function directly works too
```

## Running tasks

### `series(...items)` — one after another

Runs each item in order and **stops at the first error**:

```js
import { series } from 'node-build';

await series('clean', 'build', 'manifest');
// clean runs, then build, then manifest. If build throws, manifest never runs.
```

### `parallel(...items)` — all at once

Runs every item **concurrently** and resolves when all succeed; it rejects on
the first error:

```js
import { parallel } from 'node-build';

await parallel('copyHtml', 'copyCss');  // both start immediately
```

Use `parallel` for independent work (copying HTML and CSS are unrelated), and
`series` when one step depends on another (you cannot write a manifest before
the files exist).

### What can you pass?

Both accept, in any mix:

- **task names** — strings of registered tasks;
- **functions** — plain task functions that were not registered;
- **nested arrays** — for readable composition: `series(['a', 'b'], 'c')`;
- **Promises** — awaited and their resolved value is collected;
- **streams** — drained to completion (rare; usually you return streams from a
  task function instead);
- **`null`/`undefined`** — ignored.

Anything else raises a `TypeError`. Both return an array of results in input
order.

### Composing: the usual pattern

```js
import { task, series, parallel } from 'node-build';

task('html', () => src('src/*.html').pipe(dest('dist')));
task('css',  () => src('src/*.css').pipe(dest('dist')));
task('manifest', async () => { /* write manifest.json */ });

// A "build" that copies things in parallel, then writes the manifest:
export default () => parallel('html', 'css').then(() => series('manifest'));
```

## Handy extras

| Export                | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `run(nameOrFn)`       | Run a single named task (or function) to completion.                    |
| `getTask(name)`       | Look up a registered task by name; throws if unknown.                   |
| `listTasks()`         | Return the names of all registered tasks, in registration order.        |
| `seriesDefault(name)` | Mark one task as **the** default when nothing is specified on the CLI.  |
| `runDefault()`        | Run the `seriesDefault` task, or every registered task in parallel.     |

### Choosing a default task

If someone runs your CLI without naming a task (see [CLI](./cli.md)), node-build
runs whatever you marked with `seriesDefault`:

```js
import { seriesDefault } from 'node-build';

seriesDefault('build');   // `node-build` with no args now runs task "build"
```

Without a default, all registered tasks run in parallel.

## Full example: a multi-task build

```js
// build.mjs
import { task, series, parallel, seriesDefault, src, dest } from 'node-build';

task('clean', async () => { /* delete dist/ */ });
task('html',  () => src('src/*.html').pipe(dest('dist')));
task('css',   () => src('src/*.css').pipe(dest('dist')));
task('manifest', async () => { /* write manifest.json */ });

const build = parallel('html', 'css').then(() => series('manifest'));

seriesDefault('build');        // `node-build`  -> html+css, then manifest

export default (taskName) => taskName ? series(taskName) : build();
```

This is the shape of a real project: independent copies in parallel, dependent
steps in series, and a declared default.

## Common pitfalls

- **Forgetting to return your stream.** If a task function does
  `src(...).pipe(dest(...))` but does not `return` it, the task finishes
  immediately and files may not be written. Always return the stream (or make
  the function async and `await` it).
- **Name typos.** `getTask`/the CLI throw `Unknown task: "x". Registered: ...`
  listing what actually exists — a good safety net while you learn names.
- **Mixing up series vs parallel for dependent steps.** A manifest written in
  `parallel` with the copies that feed it is a race condition; keep it in
  `series`.
- **Passing a bare `parallel(...)` promise into `series()`.** Every item
  expression is evaluated *when you build the call* — before `series()` runs
  anything — so an argument like `series(clean, parallel(a, b, c))` starts
  `a`, `b` and `c` **immediately**, racing the earlier steps (files can be
  written while `clean` is still deleting). Items are thunks: wrap any
  composed call in a zero-arg function so it is *called* only when series
  reaches that slot:

  ```js
  // Broken — parallel() runs during argument evaluation, before clean():
  await series(cleanStage, parallel(styles, scripts, assets));

  // Correct — the thunk defers the call until series reaches step two:
  await series(cleanStage, () => parallel(styles, scripts, assets), revision);
  ```

  The same trap applies to any eager expression as an item (a `.then()` chain,
  a direct `fetch(...)`); if it starts work on its own, wrap it in `() => …`.

Next: [Streams](./streams.md) — how files actually move through your build.
