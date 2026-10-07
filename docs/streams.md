# Streams: src, dest & through

This is the heart of node-build (and of Gulp). A build is a **pipeline**: files
flow in from disk, pass through one or more transforms, and flow out to disk.
Three functions do all the heavy lifting:

```js
src(patterns)  ──▶  through(fn)  ──▶  dest(dir)
 (read files)      (transform each)   (write files)
```

You connect them with the standard Node `.pipe()` method, exactly like Gulp.

## `src(patterns, opts?)` — read files in

`src()` globs your project and returns a **readable stream of File objects** —
one object per matched file, each carrying its contents (see
[The File object](./file.md) for the anatomy).

```js
import { src } from 'node-build';

const stream = src('src/**/*.css');   // matches every css under src/
for await (const file of stream) {
  console.log(file.relative, file.contents.length);  // "css/app.css 1234"
}
```

Options (`opts`):

| Option          | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `cwd`           | Directory patterns resolve against (default: current working directory). |
| `base`          | Override the derived "base" folder used to compute `file.relative`.     |
| `encoding`      | If set, contents arrive as **strings** of that encoding; otherwise as **Buffers** (the default, matching Gulp). |

Patterns accept everything described in [Globbing](./glob.md): `*`, `**`, `?`,
braces `{a,b}`, and negation with a leading `!`. Pass an array for multiple
patterns.

### Why "base" matters

Gulp plugins compute output paths from `file.relative` (the path *inside* the
matched folder). node-build derives that base from the static part of your
pattern: `src/**/*.css` → base is `src/`, so a file's relative path is
`app.css`. If you need exact control, pass `{ base: 'some/dir' }`.

## `dest(dir, opts?)` — write files out

`dest()` returns a **writable stream**. For each File it writes to
`path.join(dir, file.relative)`, creating parent directories as needed. It
handles Buffer contents, string contents, and even files whose contents are
themselves streams (it pipes them through).

```js
import { src, dest } from 'node-build';

src('src/**/*.{html,css}').pipe(dest('dist'));
// dist/ now mirrors the folder layout under your matched base.
```

After writing, node-build updates `file.path` to the final on-disk location, so
downstream transforms can see where a file landed.

## `through(fn)` — transform files in memory

`through()` is how you write **your own** build step without any plugin and
without subclassing anything. It returns a transform stream that calls `fn(file)`
for each File. What you do with the result decides what happens:

| `fn` returns…      | Effect                                          |
| ------------------ | ----------------------------------------------- |
| the (mutated) file | The same file continues downstream, modified.   |
| a **new** File     | The new file is pushed downstream instead.      |
| `null`/`undefined` | The file is **dropped** from the pipeline.      |
| an **array** of Files | Each one is pushed (one input → many outputs). |

Async functions are supported, so you can `await` real work per file:

```js
import { src, dest, through } from 'node-build';

src('src/**/*.html')
  .pipe(through(async (file) => {
    // Rewrite a marker in each HTML file.
    const html = file.contents.toString('utf8');
    file.contents = Buffer.from(html.replace(/TODO:/g, 'NOTE:'));
    return file;                     // mutate-in-place style
  }))
  .pipe(dest('dist'));
```

Dropping files (e.g. only keep HTML):

```js
src('src/**/*.{html,css}')
  .pipe(through((file) => file.relative.endsWith('.html') ? file : null))
  .pipe(dest('dist'));
```

Fan-out (one source → many outputs):

```js
src('src/template.txt')
  .pipe(through((file) => [
    file.clone({ path: 'out/a.txt', base: 'out' }),   // relative: a.txt
    file.clone({ path: 'out/b.txt', base: 'out' }),   // relative: b.txt
  ]))
  .pipe(dest('dist'));                       // writes dist/a.txt and dist/b.txt
```

## Connecting the pieces: `pipeline()`

node-build re-exports `pipeline` from `node:stream/promises`. Use it whenever
you want to **await** a whole chain (which is what your task functions should
return) — it propagates errors and cleans up resources properly:

```js
import { src, dest, through, pipeline } from 'node-build';

const build = () => pipeline(
  src('src/**/*.css', { cwd }),
  through((file) => { file.contents = Buffer.from(file.contents.toString() + '\n'); return file; }),
  dest('dist'),
);

await build();   // resolves when every file is written; rejects on any error
```

> Inside a `task()` you can simply `return src(...).pipe(transform).pipe(dest(...))`
> — node-build detects the returned stream and awaits it for you. `pipeline()`
> is what you use outside tasks, or when you want explicit error handling.

## The full picture in one task

```js
import { task, src, dest, through } from 'node-build';

task('html', () =>
  src('src/**/*.html')                       // 1. read matching files
    .pipe(through((file) => {                // 2. transform each file
      file.contents = file.contents.toString().replace(/TODO:/g, 'NOTE:');
      return file;
    }))
    .pipe(dest('dist')),                     // 3. write to dist/
);
```

That single line is a complete, memory-friendly build step: it streams files one
at a time (never loading the whole tree into memory), transforms each in place,
and writes the results while preserving your folder structure.

Next: [The File object](./file.md) — the thing flowing through all of this.
