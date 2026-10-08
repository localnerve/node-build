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

Builds a schedule that runs each item in order and **stops at the first error**:

```js
import { series } from 'node-build';

await series('clean', 'build', 'manifest');
// clean runs, then build, then manifest. If build throws, manifest never runs.
```

### `parallel(...items)` — all at once

Builds a schedule that runs every item **concurrently** and resolves when all
succeed; it rejects on the first error:

```js
import { parallel } from 'node-build';

await parallel('copyHtml', 'copyCss');  // both start immediately
```

Use `parallel` for independent work (copying HTML and CSS are unrelated), and
`series` when one step depends on another (you cannot write a manifest before
the files exist).

### Schedules are lazy

`series()` and `parallel()` do not start anything when you call them — they
return a **schedule**, an awaitable object that starts its tasks the first
time it is awaited (or `.then`'d), and never re-runs if awaited again. This
matters for composition: because argument expressions are evaluated before
`series()` runs, a nested schedule is simply *passed along* — it only starts
when the outer schedule reaches it:

```js
// Safe as written: the parallel schedule starts AFTER clean finishes,
// not while series() arguments are being evaluated.
await series(cleanStage, parallel(styles, scripts, assets), revision);
```

Awaiting a schedule twice (or passing it to two places) never re-runs its
tasks — both awaits observe the single execution.

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
- **Other self-starting expressions are NOT lazy.** Schedules (`series`/
  `parallel`) defer their work until awaited, but any *other* expression passed
  as an item runs the moment you evaluate the arguments — a direct
  `fetch(...)`, a `.then()` chain that already kicked off I/O, a plugin call
  doing work. Wrap those in a zero-arg function so they run only when the
  schedule reaches that slot:

  ```js
  // fetch() fires during argument evaluation — before clean() has run.
  await series(cleanStage, fetchRemoteConfig());

  // Correct — the thunk defers the call until series reaches step two.
  await series(cleanStage, () => fetchRemoteConfig(), revision);
  ```

Next: [Streams](./streams.md) — how files actually move through your build.
