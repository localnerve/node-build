# Using existing Gulp plugins

If you are coming from Gulp, the most valuable fact about node-build-stream is this:
**your existing Gulp plugins keep working.** This page explains why that is
true, where the edges are, and how to bridge plain byte streams into (and out
of) the object-mode world when needed.

## Why plugins just work

A "Gulp plugin" is not some special runtime object. It is simply a
**transform stream in object mode that operates on File objects**:

```js
// What virtually every Gulp plugin looks like under the hood:
function myPlugin(options) {
  return new Transform({
    objectMode: true,
    transform(file, _enc, done) {
      // file is a Vinyl/File object with .path, .base, .relative, .contents
      doSomethingTo(file.contents);
      this.push(file);   // pass it downstream
      done();
    },
  });
}
```

Gulp's own contribution is only the I/O layer (`src`/`dest`) and task
scheduling. node-build-stream re-implements exactly that layer, so any plugin that
follows the above pattern — which is essentially all of them — can be dropped
into a node-build-stream pipeline unchanged:

```js
import { task, src, dest } from 'node-build-stream';
import imagemin from 'gulp-imagemin';       // an existing Gulp plugin
import cssmin from 'gulp-cssmin';           // another one

task('images', () => src('src/**/*.png').pipe(imagemin()).pipe(dest('dist')));
task('css',    () => src('src/**/*.css').pipe(cssmin()).pipe(dest('dist')));
```

No adapters, no wrappers. `.pipe()` is plain Node; the plugin sees File objects
and pushes them on.

## The Vinyl auto-detection detail

Gulp plugins receive **Vinyl** file objects (from the `vinyl` package). Some
naive plugins might check `instanceof Vinyl` or import vinyl internals. To stay
compatible with *all* of them while keeping node-build-stream itself dependency-free:

1. node-build-stream ships a **zero-dependency File shim** that implements the same
   duck-typed surface (`path`, `base`, `relative`, `contents`, `isBuffer()`,
   …).
2. At run time it tries to resolve a real `vinyl` package **from your project**.
   If one exists, node-build-stream uses *that* class for every File it creates, so
   even `instanceof Vinyl` checks pass.
3. If no `vinyl` is installed, the shim is used — which covers the vast
   majority of plugins that only read properties.

You never configure this. Install `vinyl` in your project if a particular
plugin misbehaves; otherwise node-build-stream is fully self-contained. (The resolver
is exposed as `resolveFileClass()` / `resolveFileClassSync()` for advanced use.)

## Bridging raw byte streams: `wrapFile` / `unwrapFile`

Occasionally you have a **plain byte stream** (e.g. reading a file with the
normal `fs` API, or talking to an HTTP response) and want to feed it through an
object-mode Gulp plugin — or the reverse. Two small bridge transforms handle
that:

- `wrapFile(filePath)` — turns raw chunks into `{ path, contents }` file-like
  objects so an object-mode plugin can consume a byte stream;
- `unwrapFile()` — the inverse, turning file-like objects back into their raw
  `contents` for writing as bytes.

```js
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { wrapFile, unwrapFile } from 'node-build-stream';
import someGulpPlugin from 'some-gulp-plugin'; // object-mode transform

await pipeline(
  fs.createReadStream('input.bin'),   // plain byte stream in
  wrapFile('input.bin'),              // → file-like objects
  someGulpPlugin(),                   // your Gulp plugin works normally
  unwrapFile(),                       // → raw contents again
  fs.createWriteStream('output.bin'), // plain byte stream out
);
```

This is the same pattern used by `@localnerve/csp-hashes` and friends: it lets
the object-mode world and the byte-stream world interoperate without forcing
Vinyl onto code that does not want it.

## Migration checklist (Gulp → node-build-stream)

1. Rename/replace imports: `import gulp from 'gulp'` →
   `import { src, dest } from 'node-build-stream'`.
2. `gulp.series(...)` / `gulp.parallel(...)` → `series(...)` / `parallel(...)`.
3. `gulp.task(name, fn)` → `task(name, fn)`.
4. Keep every plugin line exactly as it was — they are just `.pipe()`d
   transforms.
5. Point the CLI at your build file (see [CLI](./cli.md)); node-build-stream even
   auto-detects an existing `gulpfile.mjs` so migration can be one command.

That is usually the entire migration. If a plugin misbehaves, first try adding
`vinyl` to your project's dependencies; if that does not fix it, the plugin is
reaching into Gulp internals beyond the standard stream/File contract and needs
a thin wrapper.

Next: [CLI](./cli.md) — running all of this from the command line.
