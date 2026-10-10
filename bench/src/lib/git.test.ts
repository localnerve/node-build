/**
 * Tests for gitInfo(). Skips itself gracefully when run outside a git work tree.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gitInfo } from './git.ts';

test('gitInfo returns a short SHA and a boolean dirty flag inside this repo', () => {
  const info = gitInfo();
  if (info === null) { test.skip('not running inside a git work tree'); return; }
  assert.match(info.commit, /^[0-9a-f]{7,40}$/);
  assert.equal(typeof info.dirty, 'boolean');
});

test('gitInfo returns null when cwd is not a usable git work tree', () => {
  // A non-existent directory makes every git invocation fail → null contract.
  assert.equal(gitInfo('/definitely/not/a/real/path'), null);
});
