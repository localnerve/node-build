import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Transform } from 'node:stream';
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
} from '../src/index.js';

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
