/**
 * node-build — File shim tests (src/file.js).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { File } from '../src/index.js';
import { setupFixture } from './helpers/fixture.js';

let tmp;

before(async () => { tmp = await setupFixture(); });

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
