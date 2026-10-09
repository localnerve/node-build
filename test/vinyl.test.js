/**
 * node-build-stream — vinyl resolver tests (src/vinyl.js).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveFileClass, resolveFileClassSync } from '../src/index.js';
import { clearFileClassCache } from '../src/vinyl.js';

test('resolveFileClass(Sync) falls back to the shim when vinyl is absent', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nbs-vinyl-'));
  try {
    clearFileClassCache();
    const asyncEntry = await resolveFileClass(tmp);
    assert.equal(asyncEntry.source, 'shim');
    assert.equal(typeof asyncEntry.Vinyl, 'function');

    const syncEntry = resolveFileClassSync(tmp);
    assert.equal(syncEntry.source, 'shim');
  } finally {
    clearFileClassCache();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('resolveFileClass(Sync) prefers a real vinyl package when present', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nbs-vinyl-'));
  // Install a fake `vinyl` package next to the project so createRequire
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
    clearFileClassCache();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
