# The CLI

node-build ships a small command-line runner so you can execute your build from
a terminal (or CI) without writing any glue code. This page explains how to
invoke it, how it finds and runs your build file, and — importantly — how to
receive **your own** command-line arguments inside a task.

## Usage

```sh
node /path/to/node-build/bin/node-build.mjs [taskName] [--config <file>]
```

| Argument            | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `taskName`          | Run this one registered task (positional, optional).           |
| `--config`, `-c`    | Explicit path to your build module.                            |
| `--help`, `-h`      | Print usage and exit.                                          |

If you publish the package or add it to your `package.json` `bin`, you can just
type `node-build` instead of the full path.

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
   most flexible pattern (used by [`../build.mjs`](../build.mjs)):

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

## Receiving your own CLI arguments

The CLI only understands its *own* flags (`--config`, `--help`) and the task
name. **Any other flag is left alone** — it never consumes unknown `--options`.
That means your build file can read arbitrary arguments straight from
`process.argv`, which is how you add feature-specific switches to a task:

```sh
node-build manifest --minify --target staging
#                    └──────────┬──────────────┘  (your flags, passed through)
```

A small parser turns `--name value` pairs into an object. The repository's own
[`build.mjs`](../build.mjs) includes one you can lift:

```js
/**
 * getTaskArguments parses command line arguments, --name value, to an object.
 *   node-build mytask --a 123 --b "my string" --c
 *   produces: { a: "123", b: "my string", c: true }
 * @param {String[]} argList - argument list (pass process.argv)
 * @returns {Object} the arguments as an object
 */
function getTaskArguments(argList) {
  const arg = {};
  let a, opt, thisOpt, curOpt;
  for (a = 0; a < argList.length; a++) {
    thisOpt = argList[a].trim();
    opt = thisOpt.replace(/^-+/, '');

    if (opt === thisOpt) {
      // argument value
      if (curOpt) arg[curOpt] = opt;
      curOpt = null;
    } else {
      // argument name
      curOpt = opt;
      arg[curOpt] = true;
    }
  }
  return arg;
}

const args = getTaskArguments(process.argv);
```

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

## Examples

```sh
# Run the default task (default export function, or seriesDefault)
node ./bin/node-build.mjs

# Run one specific registered task
node ./bin/node-build.mjs html

# Point at an explicit build file
node ./bin/node-build.mjs --config ./scripts/build.mjs css

# Pass your own flags straight through to the build module
node ./bin/node-build.mjs manifest --minify --target staging

# See help
node ./bin/node-build.mjs --help
```

The repository's [`build.mjs`](../build.mjs) is a complete working example: run
`npm run build:example` from the node-build root to watch it copy and transform
the files in `examples/src/` into `examples/dist/`.
