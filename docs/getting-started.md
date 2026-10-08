# Getting Started

If you have never used Gulp, don't worry — this page assumes zero prior
knowledge and explains everything from scratch. By the end you will have a
working build that copies and transforms files in your project.

## What is a "build runner"?

A **build runner** is a small program you write that automates repetitive file
work: copying source files into an output folder, minifying code, rewriting
strings inside HTML, generating manifests, and so on. You define named steps
("tasks"), then run one or more of them from the command line.

**Gulp** is the most famous build runner in JavaScript. Its defining idea is
that your tasks are *streams*: a file flows into your program, passes through a
chain of transforms (each transform is a "plugin"), and flows out to disk —
one file at a time, memory-friendly, like water through a pipe.

**node-build** re-implements exactly that core behavior with zero dependencies
— only Node.js built-in modules (`node:fs`, `node:path`, `node:stream`). If you
already have Gulp plugins (which are just stream transforms), they keep
working; if you don't, node-build is all you need.

> **Requirements:** Node.js **>= 24**. Nothing else to install.

## The mental model

A node-build program has three ingredients:

1. **Tasks** — named functions that do one job (see [Tasks](./tasks.md)).
2. **Streams** — `src()` reads files, `through()` transforms them in memory,
   `dest()` writes them out (see [Streams](./streams.md)).
3. **A way to run tasks** — either the bundled CLI or plain JavaScript
   (see [CLI](./cli.md)).

The canonical shape of a build file:

```js
import { task, series, src, dest, through } from 'node-build';

task('html', () =>
  src('src/**/*.html')                       // read files as File objects
    .pipe(through((file) => {                // transform each one in memory
      file.contents = file.contents.toString().replace(/TODO:/g, 'NOTE:');
      return file;
    }))
    .pipe(dest('dist')),                     // write to dist/ preserving layout
);

export default series('html');               // what runs when no task is named
```

`src()` produces a stream of **File** objects (a tiny object with `path`,
`base`, `relative`, and `contents`). `.pipe(through(...))` transforms each file.
`.pipe(dest(...))` writes each file to disk under the output directory, keeping
its relative folder structure.

## Install / use

node-build is a library you import from your own project's build file. Point
your package at it:

```jsonc
// your project's package.json
{ "dependencies": { "node-build": "file:/path/to/node-build" } }
```

(Or install the published package normally.) There are no transitive
dependencies to install — that is the whole point.

## First build with the CLI

Create a `build.mjs` in your project root (the [CLI](./cli.md) auto-detects it)
containing the snippet above, then run:

```sh
node /path/to/node-build/bin/nbs          # runs the default task
node /path/to/node-build/bin/nbs html     # runs a specific task
node /path/to/node-build/bin/nbs --help   # show usage
```

You should see `✓ build complete (build.mjs)` and a `dist/` folder with your
transformed files.

## First build from code (API)

You can skip the CLI entirely and drive tasks from any script:

```js
import { task, series } from 'node-build';

task('hello', async () => console.log('hi'));

await series('hello');   // or: await import('./build.mjs').then(m => m.default());
```

Because everything returns Promises, node-build fits naturally into test
suites, CI scripts, and other Node programs. See [Tasks](./tasks.md) for the
full API.

## Where to next?

| You want to…                          | Read                                   |
| ------------------------------------- | -------------------------------------- |
| Understand tasks & scheduling         | [Tasks](./tasks.md)                    |
| Move files in and out of your build   | [Streams](./streams.md)                |
| Inspect or create file objects        | [The File object](./file.md)           |
| Learn the glob syntax behind `src()`  | [Globbing](./glob.md)                  |
| Use your existing Gulp plugins        | [Gulp plugin interop](./gulp-plugins.md) |
| Drive builds from the command line    | [CLI](./cli.md)                        |

A complete, runnable build lives in [`../examples/build.mjs`](../examples/build.mjs) with inputs
in [`examples/src/`](../examples/src/) — try `npm run build:example` from the
node-build repository root.
