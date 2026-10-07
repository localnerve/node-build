/**
 * node-build — stream tests (src/stream.js).
 *
 * Covers src, dest, through (including the empty-glob warning and the output
 * guard), and the wrapFile/unwrapFile byte-stream bridge.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { src, dest, through, wrapFile, unwrapFile, File } from '../src/index.js';
import { setupFixture, cleanupFixture } from './helpers/fixture.js';

let tmp;

// A sink that consumes and discards object chunks; used to fully drain a bare
// readable (e.g. src()) so its generator runs to completion. Returns a fresh
// Writable each call because pipeline() ends the destination after it finishes.
function discardSink() {
  return new Writable({ objectMode: true, write(_chunk, _enc, cb) { cb(); } });
}

before(async () => { tmp = await setupFixture(); });
after(cleanupFixture);

test('src() wraps read failures with context', async () => {
  const realReadFile = fsSync.promises.readFile.bind(fsSync.promises);
  fsSync.promises.readFile = () => Promise.reject(Object.assign(new Error('simulated EIO'), { code: 'EIO' }));
  try {
    await fsp.writeFile(path.join(tmp, 'secret.txt'), 'x');
    const drain = async () => {
      const seen = [];
      for await (const file of src('secret.txt', { cwd: tmp })) seen.push(file);
      return seen;
    };
    await assert.rejects(drain(), /failed to read/);
  } finally {
    fsSync.promises.readFile = realReadFile;
    await fsp.rm(path.join(tmp, 'secret.txt'), { force: true });
  }
});

test('src() yields one File per match with derived base', async () => {
  const files = [];
  for await (const file of src('src/**/*.{txt,css}', { cwd: tmp })) files.push(file);
  assert.equal(files.length, 2);
  for (const f of files) {
    assert.ok(Buffer.isBuffer(f.contents));
    assert.ok(path.isAbsolute(f.path));
    assert.equal(f.base, path.join(tmp, 'src'));
  }
  const names = files.map((f) => f.relative).sort();
  assert.deepEqual(names, ['a.txt', path.join('css', 'b.css')]);
});

test('src(): encoding option and opts.base/from', async () => {
  const files = [];
  for await (const f of src('src/*.txt', { cwd: tmp, encoding: 'utf8' })) files.push(f);
  assert.equal(files[0].contents, 'alpha');

  // Explicit base override.
  const f2 = [];
  for await (const f of src('src/**/*.css', { cwd: tmp, base: 'src/css' })) f2.push(f);
  assert.equal(f2[0].base, path.resolve(tmp, 'src', 'css'));
});

test('dest() writes files preserving relative layout', async () => {
  const outDir = path.join(tmp, 'out1');
  await pipeline(src('src/**/*.{txt,css,js}', { cwd: tmp }), dest(outDir));
  assert.equal(await fsp.readFile(path.join(outDir, 'a.txt'), 'utf8'), 'alpha');
  assert.equal(await fsp.readFile(path.join(outDir, path.join('css', 'b.css')), 'utf8'), 'body{}');
  assert.equal(await fsp.readFile(path.join(outDir, path.join('js', 'c.js')), 'utf8'), 'console.log(1)');
});

test('dest(): streamed contents are piped; errors propagate', async () => {
  const outDir = path.join(tmp, 'out-stream');
  const streamFile = new File({ cwd: tmp, path: path.join(tmp, 'streamed.bin') });
  streamFile.contents = Readable.from([Buffer.from('chunk1'), Buffer.from('chunk2')]);
  await pipeline(Readable.from([streamFile]), dest(outDir));
  assert.equal(await fsp.readFile(path.join(outDir, 'streamed.bin'), 'utf8'), 'chunk1chunk2');

  // A file whose base does not prefix its path falls back to the basename.
  const anon = new File({ cwd: tmp, path: path.join(tmp, 'zz-anon.txt'), base: '/unrelated' });
  anon.contents = Buffer.from('anon');
  await pipeline(Readable.from([anon]), dest(path.join(tmp, 'out-anon')));
  assert.equal(await fsp.readFile(path.join(tmp, 'out-anon', 'zz-anon.txt'), 'utf8'), 'anon');

  // Write failure (parent path is a file) rejects the pipeline.
  const blocker = new File({ cwd: tmp, path: path.join(tmp, 'x', 'blocker'), base: path.join(tmp, 'x') });
  blocker.contents = Buffer.from('i am a file');
  await pipeline(Readable.from([blocker]), dest(path.join(tmp, 'out-bad')));
  const colliding = new File({ cwd: tmp, path: path.join(tmp, 'x', 'blocker', 'inner.txt'), base: path.join(tmp, 'x') });
  colliding.contents = Buffer.from('nope');
  await assert.rejects(pipeline(Readable.from([colliding]), dest(path.join(tmp, 'out-bad'))));
});

test('through() supports mutation, drop, and multi-output', async () => {
  const outDir = path.join(tmp, 'out2');
  await pipeline(
    src('src/*.txt', { cwd: tmp }),
    through((file) => {
      file.contents = file.contents.toString().toUpperCase(); // mutate in place
      return file;
    }),
    dest(outDir),
  );
  assert.equal(await fsp.readFile(path.join(outDir, 'a.txt'), 'utf8'), 'ALPHA');

  // Drop files by returning null.
  const outDir2 = path.join(tmp, 'out3');
  await pipeline(
    src('src/**/*.{txt,css}', { cwd: tmp }),
    through((file) => (file.relative.endsWith('.txt') ? file : null)),
    dest(outDir2),
  );
  await assert.rejects(fsp.access(path.join(outDir2, path.join('css', 'b.css'))));
  assert.ok(await fsp.stat(path.join(outDir2, 'a.txt')));
});

test('through(): async fn, array output and error propagation', async () => {
  const outDir2 = path.join(tmp, 'out-through2');
  await pipeline(
    src('src/*.txt', { cwd: tmp }),
    through(async (file) => { file.contents = Buffer.from('async-mutated'); return [file]; }),
    dest(outDir2),
  );
  assert.equal(await fsp.readFile(path.join(outDir2, 'a.txt'), 'utf8'), 'async-mutated');

  // undefined result drops the file (same as null).
  const outDir3 = path.join(tmp, 'out-through3');
  await pipeline(
    src('src/*.txt', { cwd: tmp }),
    through(() => undefined),
    dest(outDir3),
  );
  await assert.rejects(fsp.stat(path.join(outDir3, 'a.txt')));

  const errStream = () => src('src/*.txt', { cwd: tmp }).pipe(through(() => { throw new Error('transform blew up'); }));
  await assert.rejects(pipeline(errStream(), dest(path.join(tmp, 'out-through-err'))), /transform blew up/);
});

test('through() rejects non-File output with an actionable error', async () => {
  // Returning a plain object without .path should fail fast.
  await assert.rejects(
    pipeline(src('src/*.txt', { cwd: tmp }), through((file) => ({ contents: file.contents })), dest(path.join(tmp, 'out-guard'))),
    /expected a File/,
  );
  // Returning a string (not a File) also fails.
  await assert.rejects(
    pipeline(src('src/*.txt', { cwd: tmp }), through(() => 'oops'), dest(path.join(tmp, 'out-guard2'))),
    /expected a File/,
  );
});

test('src() warns when a positive pattern matches no files', async () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => { warnings.push(String(msg)); };
  try {
    // Drain the readable through a discard sink so the generator runs and emits
    // its warning — without needing a named for-await binding.
    await pipeline(src('no-such/**/*.html', { cwd: tmp }), discardSink());
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /matched no files/);
  } finally {
    console.warn = realWarn;
  }
});

test('src() does not warn for negation-only patterns', async () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => { warnings.push(String(msg)); };
  try {
    await pipeline(src(['!nope/**'], { cwd: tmp }), discardSink());
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = realWarn;
  }
});

test('wrapFile/unwrapFile bridge raw byte streams to gulp-style plugins', async () => {
  // A "gulp plugin": an object-mode transform over file-like objects.
  const plugin = new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    transform(fileObj, _enc, done) {
      const str = fileObj.contents.toString('utf8');
      fileObj.contents = Buffer.from(str + ' [hashed]');
      this.push(fileObj);
      done();
    },
  });

  const srcFile = path.join(tmp, 'raw.txt');
  await fsp.writeFile(srcFile, 'plain bytes');
  const outPath = path.join(tmp, 'bridged-out.txt');

  await pipeline(
    fsSync.createReadStream(srcFile),
    wrapFile(srcFile),
    plugin,
    unwrapFile(),
    fsSync.createWriteStream(outPath),
  );

  assert.equal(await fsp.readFile(outPath, 'utf8'), 'plain bytes [hashed]');
});
