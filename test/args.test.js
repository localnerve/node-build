/**
 * node-build — parseArgs() tests (src/args.js).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/index.js';

test('parseArgs() converts --name value pairs and flags to an object', () => {
  // Tokens without a leading dash are values for the most recent flag; a
  // leading orphan (no prior flag) is ignored. Flags map to true by default.
  assert.deepEqual(
    parseArgs(['--minify', '--target', 'staging', '-v']),
    { minify: true, target: 'staging', v: true },
  );
  // Long dashes of any length are stripped from names.
  assert.deepEqual(parseArgs(['--a', '123', '---b', '"my string"', '--c']), {
    a: '123', b: '"my string"', c: true,
  });
});

test('parseArgs() ignores orphan values and non-string entries', () => {
  // A value with no preceding name is ignored; non-string entries are skipped.
  assert.deepEqual(parseArgs(['orphan', null, '--flag']), { flag: true });
});

test('parseArgs() rejects a non-array argument', () => {
  assert.throws(() => parseArgs('not-an-array'), TypeError);
});
