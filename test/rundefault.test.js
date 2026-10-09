/**
 * node-build-stream — runDefault() isolation tests.
 * 
 * Kept in its own file so the task registry starts empty (runDefault without a
 * seriesDefault runs every registered task).
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { task, runDefault, seriesDefault } from '../src/index.js';

test('runDefault() runs the seriesDefault task when set', async () => {
  const order = [];
  task('rd-default', async () => { order.push('default'); });
  task('rd-other', async () => { order.push('other'); });
  seriesDefault('rd-default');
  await runDefault();
  assert.deepEqual(order, ['default']);
});

test('runDefault() runs all registered tasks in parallel when no default is set', async () => {
  seriesDefault(null);
  const order = [];
  task('rd-all-1', async () => { order.push(1); });
  task('rd-all-2', async () => { order.push(2); });
  await runDefault();
  assert.equal(order.length, 2);
});
