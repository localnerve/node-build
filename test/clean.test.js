/**
 * node-build — clean() tests (src/clean.js).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { clean } from '../src/index.js';

test('clean() removes files and directories by glob and is idempotent', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-clean-'));
  try {
    const outDir = path.join(tmp, 'to-clean');
    await fsp.mkdir(path.join(outDir, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(outDir, 'a.txt'), 'x');
    await fsp.writeFile(path.join(outDir, 'nested', 'b.txt'), 'y');

    const removed = await clean('to-clean/**/*.{txt}', { cwd: tmp });
    assert.equal(removed.length, 2);
    for (const p of removed) assert.ok(path.isAbsolute(p));
    await assert.rejects(fsp.stat(path.join(outDir, 'a.txt')));
    await assert.rejects(fsp.stat(path.join(outDir, 'nested', 'b.txt')));

    // Second run matches nothing and removes nothing.
    const again = await clean('to-clean/**/*.{txt}', { cwd: tmp });
    assert.deepEqual(again, []);

    // Removing a directory itself (not just its contents) works too.
    const removedDir = await clean('to-clean', { cwd: tmp });
    assert.equal(removedDir.length, 1);
    await assert.rejects(fsp.stat(outDir));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('clean() honors negation and ignores missing targets', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-clean-'));
  try {
    const outDir = path.join(tmp, 'to-clean2');
    await fsp.mkdir(path.join(outDir, 'js'), { recursive: true });
    await fsp.writeFile(path.join(outDir, 'keep.txt'), 'k');
    await fsp.writeFile(path.join(outDir, 'js', 'drop.js'), 'd');

    const removed = await clean(['to-clean2/**/*.{txt,js}', '!**/keep.txt'], { cwd: tmp });
    assert.equal(removed.length, 1);
    assert.ok(removed[0].endsWith('drop.js'));
    assert.ok(await fsp.stat(path.join(outDir, 'keep.txt')));

    // A pattern that matches nothing resolves to an empty list (no throw).
    const none = await clean('does-not-exist/**/*', { cwd: tmp });
    assert.deepEqual(none, []);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('clean() removes literal file and directory paths mixed with globs, sorted and deduped', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-clean-'));
  try {
    const mix = path.join(tmp, 'mix');
    await fsp.mkdir(path.join(mix, 'nested'), { recursive: true });
    await fsp.writeFile(path.join(mix, 'a.txt'), 'x');
    await fsp.writeFile(path.join(mix, 'nested', 'b.css'), 'y');
    await fsp.writeFile(path.join(tmp, 'plain.txt'), 'z');

    // Three kinds of input at once: a bare directory (literal branch — globs
    // match no files for it), a literal file name (a plain glob match), and a
    // glob covering the dir's contents (overlaps the dir target).
    const removed = await clean(['mix', 'plain.txt', 'mix/**/*'], { cwd: tmp });
    assert.deepEqual(removed, [
      mix,
      path.join(mix, 'a.txt'),
      path.join(mix, 'nested', 'b.css'),
      path.join(tmp, 'plain.txt'),
    ]);
    await assert.rejects(fsp.stat(mix));
    await assert.rejects(fsp.stat(path.join(tmp, 'plain.txt')));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('clean() ignores missing literal paths (file or directory)', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-clean-'));
  try {
    // Neither target exists and neither is a glob: the stat catch swallows both.
    const removed = await clean(['no-such-dir', 'no-such-file.txt'], { cwd: tmp });
    assert.deepEqual(removed, []);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('clean() accepts absolute literal paths and falls back to process.cwd()', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-clean-'));
  try {
    const outDir = path.join(tmp, 'adist');
    await fsp.mkdir(outDir);
    await fsp.writeFile(path.join(outDir, 'f.txt'), 'x');
    await fsp.writeFile(path.join(tmp, 'def.txt'), 'y');

    // Absolute literal path: resolved directly, no opts.cwd needed.
    const removed = await clean(outDir);
    assert.deepEqual(removed, [outDir]);

    // Relative literal with no opts at all: resolves against process.cwd().
    // (On macOS, chdir() makes process.cwd() report the physical /private/var
    // path rather than the /var symlink, so assert on identity, not spelling.)
    const original = process.cwd();
    try {
      process.chdir(tmp);
      const removed2 = await clean('def.txt');
      assert.equal(removed2.length, 1);
      assert.ok(path.isAbsolute(removed2[0]));
      assert.equal(path.basename(removed2[0]), 'def.txt');
      await assert.rejects(fsp.stat(path.join(tmp, 'def.txt'))); // it is gone
    } finally {
      process.chdir(original);
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('clean() wraps removal failures in a descriptive error', async (t) => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'node-build-clean-'));
  try {
    const victim = path.join(tmp, 'victim.txt');
    await fsp.writeFile(victim, 'x');

    const cause = Object.assign(new Error('simulated busy'), { code: 'EBUSY' });
    t.mock.method(fsp, 'rm', () => Promise.reject(cause));
    await assert.rejects(clean(victim, { cwd: tmp }), (err) => {
      assert.match(err.message, /node-build: clean\(\) failed to remove .*victim\.txt/);
      assert.equal(err.cause, cause);
      return true;
    });
    t.mock.restoreAll(); // let the cleanup below use the real fs again
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
