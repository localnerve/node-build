/**
 * node-build-stream — shared test fixtures.
 *
 * Provides a lazily-created temp tree used by several per-module suites. The
 * layout is stable so tests can rely on exact match counts:
 *   tmp/src/a.txt, tmp/src/css/b.css, tmp/src/js/c.js, tmp/skip/me.txt
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tmp;
let ready;

/**
 * Ensure the shared temp fixture tree exists and return its root path. Safe to
 * call repeatedly — it creates the tree only once per process.
 *
 * @returns {Promise<string>} The absolute path to the temp fixture root.
 */
export async function setupFixture() {
  if (!ready) {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nbs-test-'));
    await fsp.mkdir(path.join(tmp, 'src', 'css'), { recursive: true });
    await fsp.mkdir(path.join(tmp, 'src', 'js'), { recursive: true });
    await fsp.mkdir(path.join(tmp, 'skip'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'src', 'a.txt'), 'alpha');
    await fsp.writeFile(path.join(tmp, 'src', 'css', 'b.css'), 'body{}');
    await fsp.writeFile(path.join(tmp, 'src', 'js', 'c.js'), 'console.log(1)');
    await fsp.writeFile(path.join(tmp, 'skip', 'me.txt'), 'nope');
    ready = true;
  }
  return tmp;
}

/**
 * Remove the shared temp fixture tree. Retries to ride out any in-flight handle
 * closing during teardown (a late write can otherwise hit ENOTEMPTY).
 *
 * @returns {Promise<void>} Resolves once the tree is removed (or after retries).
 */
export async function cleanupFixture() {
  if (!tmp) return;
  for (let i = 0; i < 5; i++) {
    try {
      await fsp.rm(tmp, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}
