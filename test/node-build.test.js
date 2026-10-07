/**
 * node-build — test suite.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  File,
  src,
  dest,
  through,
  wrapFile,
  unwrapFile,
  task,
  series,
  parallel,
  run,
  listTasks,
  getTask,
  globFiles,
  deriveBase,
  resolveFileClass,
  resolveFileClassSync,
} from '../src/index.js';
import { clearFileClassCache } from '../src/vinyl.js';

let tmp;

before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-test-'));
  // Build a small tree:
  //   tmp/src/a.txt
  //   tmp/src/css/b.css
  //   tmp/src/js/c.js
  //   tmp/skip/me.txt
  await fsp.mkdir(path.join(tmp, 'src', 'css'), { recursive: true });
  await fsp.mkdir(path.join(tmp, 'src', 'js'), { recursive: true });
  await fsp.mkdir(path.join(tmp, 'skip'), { recursive: true });
  await fsp.writeFile(path.join(tmp, 'src', 'a.txt'), 'alpha');
  await fsp.writeFile(path.join(tmp, 'src', 'css', 'b.css'), 'body{}');
  await fsp.writeFile(path.join(tmp, 'src', 'js', 'c.js'), 'console.log(1)');
  await fsp.writeFile(path.join(tmp, 'skip', 'me.txt'), 'nope');
});

after(async () => {
  // Retry to ride out any in-flight handle closing during teardown.
  for (let i = 0; i < 5; i++) {
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

test('deriveBase computes the static leading portion (gulp-style)', () => {
  assert.equal(deriveBase('src/**/*.css', '/x'), path.resolve('/x', 'src'));
  assert.equal(deriveBase('**/*.txt', '/x'), path.resolve('/x'));
  assert.equal(deriveBase('a/b/c.js', '/x'), path.resolve('/x', 'a', 'b'));
});

test('globFiles matches braces, recursion, and negation', async () => {
  const res = await globFiles(['src/**/*.{txt,css,js}', '!**/js/**'], { cwd: tmp });
  assert.deepEqual(
    res.map((p) => path.relative(tmp, p)),
    [path.join('src', 'a.txt'), path.join('src', 'css', 'b.css')],
  );
});

test('deriveBase handles absolute patterns and plain filenames', () => {
  assert.equal(deriveBase('/abs/dir/*.txt', '/x'), path.join('/', 'abs', 'dir'));
  assert.equal(deriveBase('plain.txt', '/x'), path.resolve('/x'));
});

test('globFiles falls back to the built-in matcher when fs.glob throws', async () => {
  // The source accesses fs.glob via property lookup at call time, so patching
  // the shared fs object is enough to force the fallback path.
  const realGlob = fsSync.glob;
  fsSync.glob = () => { throw new Error('boom'); };
  try {
    const res = await globFiles(['src/**/*.{txt,css}', '!**/css/**'], { cwd: tmp });
    assert.deepEqual(
      res.map((p) => path.relative(tmp, p)),
      [path.join('src', 'a.txt')],
    );
    // Missing cwd in fallback mode resolves to [] instead of throwing.
    const missing = await globFiles(['**/*.txt'], { cwd: path.join(tmp, 'no-such-dir') });
    assert.deepEqual(missing, []);
  } finally {
    fsSync.glob = realGlob;
  }
});

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

test('File shim exposes gulp-compatible surface', () => {
  const f = new File({ cwd: tmp, path: path.join('src', 'a.txt'), base: path.join(tmp, 'src') });
  assert.equal(f.path, path.join(tmp, 'src', 'a.txt'));
  assert.equal(f.base, path.join(tmp, 'src'));
  assert.equal(f.relative, 'a.txt');
  f.contents = Buffer.from('hi');
  assert.ok(f.isBuffer());
  assert.ok(!f.isNull());
  assert.ok(!f.isStream());
  const c = f.clone();
  assert.notEqual(c, f);
  assert.equal(c.path, f.path);
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

test('dest() writes files preserving relative layout', async () => {
  const outDir = path.join(tmp, 'out1');
  await pipeline(src('src/**/*.{txt,css,js}', { cwd: tmp }), dest(outDir));
  assert.equal(await fsp.readFile(path.join(outDir, 'a.txt'), 'utf8'), 'alpha');
  assert.equal(await fsp.readFile(path.join(outDir, path.join('css', 'b.css')), 'utf8'), 'body{}');
  assert.equal(await fsp.readFile(path.join(outDir, path.join('js', 'c.js')), 'utf8'), 'console.log(1)');
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

test('series runs tasks in order and stops on error', async () => {
  const order = [];
  task('t1', async () => { order.push('t1'); });
  task('t2', async () => { order.push('t2'); });
  await series('t1', 't2');
  assert.deepEqual(order, ['t1', 't2']);

  task('boom', async () => { throw new Error('exploded'); });
  task('after-boom', async () => { order.push('after'); });
  await assert.rejects(series('boom', 'after-boom'), /exploded/);
  assert.ok(!order.includes('after'));
});

test('parallel runs tasks concurrently and aggregates results', async () => {
  const t0 = Date.now();
  const r = await parallel(
    () => new Promise((res) => setTimeout(() => res(1), 30)),
    () => new Promise((res) => setTimeout(() => res(2), 30)),
    () => new Promise((res) => setTimeout(() => res(3), 30)),
  );
  assert.deepEqual(r, [1, 2, 3]);
  // All three slept ~30ms; concurrency means total is well under 90ms.
  assert.ok(Date.now() - t0 < 85, `took too long: ${Date.now() - t0}ms`);
});

test('tasks returning streams complete when the stream ends', async () => {
  const outDir = path.join(tmp, 'out-task');
  task('streamy', () => src('src/*.txt', { cwd: tmp }).pipe(dest(outDir)));
  await run('streamy');
  assert.ok(await fsp.stat(path.join(outDir, 'a.txt')));
});

test('getTask/listTasks reflect registrations', () => {
  task('listed', async () => {});
  assert.ok(listTasks().includes('listed'));
  assert.equal(typeof getTask('listed'), 'function');
  assert.throws(() => getTask('does-not-exist'), /Unknown task/);
});

test('File: stat, history, symlink, toJSON, clone options', () => {
  const f = new File({ cwd: tmp });
  assert.equal(f.path, null);
  assert.equal(f.base, null);
  assert.equal(f.relative, '');
  assert.deepEqual(f.history, []);
  assert.ok(f.isNull());
  assert.ok(!f.isBuffer());
  assert.ok(!f.isStream());

  f.stat = { isSymbolicLink: () => true };
  assert.ok(f.isSymbolicLink());
  f.stat = null;
  assert.ok(!f.isSymbolicLink());

  const g = new File({ cwd: tmp, path: 'src/a.txt' });
  assert.deepEqual(g.history, [path.join(tmp, 'src', 'a.txt')]);
  g.path = 'other/b.txt';
  assert.equal(g.history[0], path.join(tmp, 'other', 'b.txt'));

  const sFile = new File({ cwd: tmp, path: 'x.txt', contents: Readable.from(['hi']) });
  assert.ok(sFile.isStream());

  g.contents = Buffer.from('abc');
  const j = g.toJSON();
  assert.equal(j.contents, 'abc');
  assert.equal(j.relative, 'b.txt');

  const cloned = g.clone({ path: 'cloned/c.txt', contents: null });
  assert.equal(cloned.path, path.join(tmp, 'cloned', 'c.txt'));
  assert.ok(cloned.isNull());
  assert.deepEqual(cloned.history, [...g.history]);

  // relative falls back to basename when base is not a prefix.
  const h = new File({ cwd: tmp, path: path.join(tmp, 'deep', 'file.txt'), base: '/elsewhere' });
  assert.equal(h.relative, 'file.txt');
});

test('task() validates its arguments', () => {
  assert.throws(() => task('', async () => {}), TypeError);
  assert.throws(() => task(42, async () => {}), TypeError);
  assert.throws(() => task('bad-name', null), /must be a function/);
});

test('series: nested arrays, functions, promises, streams and invalid args', async () => {
  const order = [];
  task('s-a', async () => { order.push('a'); return 'A'; });
  const fn = async () => { order.push('fn'); return 'FN'; };

  const results = await series([['s-a'], fn, Promise.resolve('P'), null]);
  assert.deepEqual(order.filter((x) => x !== 'fn' && x !== 'a'), []);
  assert.deepEqual(results, ['A', 'FN', 'P']);

  // A bare readable passed directly is drained to completion.
  const bare = Readable.from([1, 2, 3]);
  await series(bare);

  await assert.rejects(series(42), /Invalid task argument/);
});

test('parallel: named tasks, nested arrays, promises and invalid args', async () => {
  task('p-a', async () => 'pa');
  const results = await parallel([['p-a'], () => 'pf', Promise.resolve('pp'), null]);
  assert.deepEqual(results, ['pa', 'pf', 'pp']);

  // A bare readable passed directly is drained to completion.
  const bare = Readable.from([1, 2, 3]);
  await parallel(bare);

  task('p-bad', async () => { throw new Error('parallel boom'); });
  await assert.rejects(parallel(['p-bad']), /parallel boom/);
  await assert.rejects(parallel(42), /Invalid task argument/);
});

test('run() accepts a name or function and rejects other types', async () => {
  const results = await run(async () => 'ran');
  assert.deepEqual(results, ['ran']);
  task('run-named', async () => 'named');
  assert.deepEqual(await run('run-named'), ['named']);
  await assert.rejects(run(42), /expects a task name or function/);
});

test('a task returning a bare readable is drained to end', async () => {
  let ended = false;
  const r = Readable.from([1]);
  r.on('end', () => { ended = true; });
  await run(() => r);
  assert.ok(ended);
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

  task('through-err', () => src('src/*.txt', { cwd: tmp }).pipe(through(() => { throw new Error('transform blew up'); })));
  await assert.rejects(run('through-err'), /transform blew up/);
});

test('resolveFileClass(Sync) falls back to the shim when vinyl is absent', async () => {
  clearFileClassCache();
  const asyncEntry = await resolveFileClass(tmp);
  assert.equal(asyncEntry.source, 'shim');
  assert.equal(typeof asyncEntry.Vinyl, 'function');

  const syncEntry = resolveFileClassSync(tmp);
  assert.equal(syncEntry.source, 'shim');
  clearFileClassCache();
});

test('resolveFileClass(Sync) prefers a real vinyl package when present', async () => {
  // Install a fake `vinyl` package next to the tmp project so createRequire
  // (used by the resolver) can find it.
  const pkgDir = path.join(tmp, 'node_modules', 'vinyl');
  await fsp.mkdir(pkgDir, { recursive: true });
  await fsp.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'vinyl', version: '0.0.0-fake', main: 'index.js' }));
  await fsp.writeFile(path.join(pkgDir, 'index.js'), 'module.exports = require("node:util").inherits ? globalThis.__FakeVinyl : null;\n');
  globalThis.__FakeVinyl = class FakeVinyl { constructor() { this.path = null; } };
  try {
    clearFileClassCache();
    const syncEntry = resolveFileClassSync(tmp);
    assert.equal(syncEntry.source, 'vinyl');
    assert.equal(syncEntry.Vinyl.name, 'FakeVinyl');

    const asyncEntry = await resolveFileClass(tmp);
    assert.equal(asyncEntry.source, 'vinyl');
  } finally {
    delete globalThis.__FakeVinyl;
    await fsp.rm(path.join(tmp, 'node_modules'), { recursive: true, force: true });
    clearFileClassCache();
  }
});

test('a task returning a duplex stream is awaited on its writable side', async () => {
  const { Duplex } = await import('node:stream');
  let writeDone = false;
  const dup = new Duplex({
    read() { /* never ends readable side */ },
    write(_chunk, _enc, cb) { writeDone = true; cb(); },
  });
  // Feed one chunk so the writable side gets a flush, then end.
  dup.write('x');
  dup.end();
  await run(() => dup);
  assert.ok(writeDone);
});
