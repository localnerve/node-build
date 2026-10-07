# The File object

Everything that flows through a node-build pipeline is a **File** — a small
object representing one file on disk *plus* its contents. This page explains
its shape, why it exists, and how to create your own.

## Why a File object at all?

You could imagine streaming raw bytes, but then transforms would have no way to
know *which* file they are processing or where to put the result. The File
object solves that: it pairs **identity** (where the file came from) with
**contents** (the actual data). This is the same design Gulp uses via its
`vinyl` package, which is what makes existing Gulp plugins work here unchanged
(see [Gulp plugin interop](./gulp-plugins.md)).

## Anatomy

```js
import { File } from 'node-build';

const f = new File({
  cwd: process.cwd(),                 // used to resolve relative inputs
  path: 'src/app.css',                // the file's location (absolute after)
  base: 'src',                        // the "root" for computing relative
  contents: Buffer.from('body {}'),   // the data: Buffer, string, or a stream
});

f.path;        // '/abs/path/to/src/app.css'  — where it is
f.base;        // '/abs/path/to/src'          — the matched root folder
f.relative;    // 'app.css'                   — path inside base (what dest/ uses)
f.contents;    // <Buffer 62 6f 64 79 ...>     — the actual bytes
```

The key relationship: **`relative` = the part of `path` that lives under
`base`**. `dest()` writes to `<outdir>/<relative>`, which is what preserves your
folder layout automatically.

## The API

| Member            | Kind       | Description                                                        |
| ----------------- | ---------- | ------------------------------------------------------------------ |
| `path`            | get/set    | Absolute file path. Setting it prepends the new value to `history`. |
| `base`            | get/set    | Absolute base directory used to compute `relative`.                |
| `relative`        | get        | Path of the file relative to `base`; falls back to the basename.   |
| `contents`        | get/set    | `Buffer`, string, a stream, or `null` (a "vinyl" placeholder).     |
| `stat`            | get/set    | Optional filesystem stat object (e.g. for symlink detection).      |
| `history`         | get        | Array of paths this file has been under, newest first.             |
| `isBuffer()`      | method     | `true` when contents is a Buffer.                                  |
| `isNull()`        | method     | `true` when contents is missing (metadata-only file).              |
| `isStream()`      | method     | `true` when contents is itself a stream.                           |
| `isSymbolicLink()`| method     | `true` when `stat` says the path is a symlink.                     |
| `clone(opts?)`    | method     | A copy; pass `{ path, base, contents }` to override fields.        |
| `toJSON()`        | method     | Plain-object snapshot (contents as a string) for logging/debugging.|

### Choosing contents

- **Buffer** — the default from `src()`. Best for binary-safe transforms.
- **string** — set via `src(patterns, { encoding: 'utf8' })` when you only deal
  with text; then `file.contents` is a string and string methods work directly.
- **stream** — for very large files you can keep contents as a stream; `dest()`
  will pipe it to disk. (A streamed file can only be read once, like in Gulp.)

## Making your own File

You rarely need to construct one by hand — `src()` does it for you. But in tests
and advanced transforms you might:

```js
import { File } from 'node-build';

const f = new File({ path: '/tmp/out/readme.md', base: '/tmp/out' });
f.contents = Buffer.from('# Hello\n');
console.log(f.relative);   // 'readme.md'
```

Relative `path`/`base` inputs are resolved against `cwd` (defaulting to the
current working directory), so you can write portable code.

### Cloning for fan-out

`clone()` is how one input becomes many outputs in a `through()` transform:

```js
import { src, dest, through } from 'node-build';

src('src/template.txt')
  .pipe(through((file) => [
    file.clone({ path: 'out/a.txt', base: 'out' }),
    file.clone({ path: 'out/b.txt', base: 'out' }),
  ]))
  .pipe(dest('dist'));
```

Because `clone()` copies Buffer contents by value, the two outputs are
independent — mutating one does not affect the other.

## The shim vs real vinyl

node-build ships a **zero-dependency** `File` implementation (this class). If
your project already has the real `vinyl` package installed, node-build
transparently uses *that* instead, so plugins that do `instanceof Vinyl` also
work. You never have to choose — see [Gulp plugin interop](./gulp-plugins.md)
for how this resolution works.

Next: [Globbing](./glob.md) — how `src()` decides which files become Files.
