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
