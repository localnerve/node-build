#!/usr/bin/env node
// glob-report — list the files a glob pattern would match, without building.
//
// Usage: node examples/glob-report.mjs 'examples/basic/src/**/*.{html,css}'
//
// Demonstrates the raw globFiles()/deriveBase() exports (see docs/glob.md).
//
// Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
// Licensed under the MIT license.
import { globFiles, deriveBase } from 'node-build';
import path from 'node:path';
import process from 'node:process';

const pattern = process.argv[2] ?? 'examples/basic/src/**/*';
const cwd = process.cwd();
const base = deriveBase(pattern, cwd);

console.log(`pattern: ${pattern}`);
console.log(`base:    ${path.relative(cwd, base) || '.'}`);
console.log('---');

for (const file of await globFiles(pattern, { cwd })) {
  console.log(path.relative(base, file));
}
