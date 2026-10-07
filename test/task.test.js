/**
 * node-build — task & scheduler tests (src/task.js).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { task, series, parallel, run, listTasks, getTask, src, dest } from '../src/index.js';
import { setupFixture, cleanupFixture } from './helpers/fixture.js';

let tmp;

before(async () => { tmp = await setupFixture(); });
after(cleanupFixture);

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
  await series(Readable.from([1, 2, 3]));

  await assert.rejects(series(42), /Invalid task argument/);
});

test('parallel: named tasks, nested arrays, promises and invalid args', async () => {
  task('p-a', async () => 'pa');
  const results = await parallel([['p-a'], () => 'pf', Promise.resolve('pp'), null]);
  assert.deepEqual(results, ['pa', 'pf', 'pp']);

  // A bare readable passed directly is drained to completion.
  await parallel(Readable.from([1, 2, 3]));

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
