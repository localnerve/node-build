# Globbing

`src()` (and the lower-level `globFiles()`) decide **which files** enter your
pipeline using *glob patterns* — shell-style wildcards. This page explains the
syntax node-build supports, how base directories are derived from them, and how
to use the raw helpers directly.

## Pattern syntax

| Pattern   | Meaning                                             | Example match          |
| --------- | --------------------------------------------------- | ---------------------- |
| `*`       | Any characters **within one folder** (no `/`)       | `*.css` → `app.css`    |
| `**`      | Any number of folders, including none               | `src/**/*.js` → deep   |
| `?`       | Exactly one character                               | `file?.txt` → `file1.txt` |
| `{a,b}`   | Brace alternatives (any one of the listed)          | `*.{html,css}`         |
| `!` prefix | **Negation** — exclude matching files               | `!**/js/**`            |

Examples:

```js
src('src/**/*.css');                        // every css under src/
src(['src/*.html', 'src/*.txt']);           // union of two patterns
src('src/**/*.{html,css}', '!**/vendor/**'); // html+css, except vendor/
```

Negation is applied *after* the positive matches: list what you want, then
subtract what you don't. Brace sets are expanded first, so `*.{js,ts}` behaves
exactly like passing two patterns.

> **Scope note:** this covers the common cases (`*`, `**`, `?`, braces,
> negation). It does not implement the full minimatch character-class grammar;
> for exotic needs you can build your own file list with `Readable.from(...)`.

## How `base` is derived (and why plugins care)

Every File has a `base` and a `relative` (see [The File object](./file.md)).
`dest()` writes to `<outdir>/<relative>`, so **`base` is what preserves your
folder structure**. node-build derives `base` from the *static leading portion*
of your pattern — the part before any wildcard appears:

| Pattern              | Derived base            | So a matched file's `relative` is… |
| -------------------- | ----------------------- | ---------------------------------- |
| `src/**/*.css`       | `src/`                  | `app.css`, `css/nested/x.css`      |
| `**/*.txt`           | `(project root)`        | full path from root                |
| `a/b/c.js` (no wild) | `a/b/`                  | `c.js`                             |

This mirrors Gulp's glob-stream behavior, which is why existing plugins that
compute output paths from `file.relative` keep working. If you need exact
control, override it:

```js
src('assets/**/*.{png,jpg}', { base: 'assets' });  // force base to assets/
```

## Using the raw helpers

Both are exported for advanced use (they do not create streams — they just
resolve patterns):

### `globFiles(patterns, opts?)` → `Promise<string[]>`

Returns sorted, de-duplicated **absolute** paths:

```js
import { globFiles } from 'node-build';

const files = await globFiles('src/**/*.{js,ts}', { cwd: process.cwd() });
console.log(files.length);  // how many source files you have
```

`opts.cwd` is the directory patterns resolve against (default: current working
directory). Negation and braces work exactly as in `src()`.

### `deriveBase(pattern, cwd)` → `string`

Computes just the base directory for a single pattern — useful when you build
File objects yourself and want Gulp-compatible `relative` values:

```js
import { deriveBase } from 'node-build';

const base = deriveBase('src/**/*.css', process.cwd());
console.log(base);  // <cwd>/src
```

## A complete example: report what a build would touch

Listing files without transforming them is handy for debugging globs before
wiring up a full pipeline — and you don't need to write the script yourself.
The CLI ships it as a first-class tool (see [CLI — Glob report](./cli.md#glob-report)):

```sh
$ node ./bin/nbs --glob 'examples/basic/src/**/*.{html,css}'
pattern: examples/basic/src/**/*.{html,css}
base:    examples/basic/src
---
index.html
style.css
```

Pass `--glob` multiple times for several patterns, or add `--json` for
machine-readable output. It works in any directory — no build file needed.

If you want to do it yourself (e.g. from a script), the raw helpers are only a
few lines apart:

```js
import { globFiles, deriveBase } from 'node-build';
import path from 'node:path';
import process from 'node:process';

const pattern = 'examples/basic/src/**/*';
const cwd = process.cwd();
const base = deriveBase(pattern, cwd);

for (const file of await globFiles(pattern, { cwd })) {
  console.log(path.relative(base, file));
}
```

Next: [Gulp plugin interop](./gulp-plugins.md) — how to reuse the huge existing
ecosystem of Gulp plugins with node-build.
