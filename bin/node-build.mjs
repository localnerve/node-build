#!/usr/bin/env node
/**
 * node-build CLI.
 * 
 * Loads a build module (default: ./build.mjs, then ./gulpfile.mjs for easy
 * migration), imports it so its task() registrations are recorded, then runs the
 * requested task (or the default / all tasks) and exits non-zero on failure.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';

const BUILD_FILE_CANDIDATES = ['build.mjs', 'build.js', 'gulpfile.mjs', 'gulpfile.js'];

function parseArgs(argv) {
  const args = { task: null, config: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') args.config = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) args.task = a;
  }
  return args;
}

function printHelp() {
  console.log(`node-build — no-dependency streaming build runner

Usage:
  node-build [taskName] [--config <file>]

Options:
  --config, -c   Path to the build module (default: ./build.mjs or ./gulpfile.mjs)
  --help, -h     Show this help

The build module exports nothing special; it calls task()/series()/parallel() from
'node-build' at import time. The CLI runs the named task, or the default task if
one was registered with seriesDefault(), otherwise all tasks in parallel.`);
}

async function findBuildFile(explicit) {
  const cwd = process.cwd();
  if (explicit) {
    const p = path.resolve(cwd, explicit);
    if (!fs.existsSync(p)) throw new Error(`Config file not found: ${p}`);
    return p;
  }
  for (const name of BUILD_FILE_CANDIDATES) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `No build file found. Looked for: ${BUILD_FILE_CANDIDATES.join(', ')}. ` +
      'Use --config to specify one.'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const buildFile = await findBuildFile(args.config);

  // Import the build module so its task registrations run.
  const mod = await import(pathToFileURL(buildFile).href);

  // The build file may export a function to invoke, or rely on registered tasks.
  if (typeof mod.default === 'function') {
    await mod.default(args.task);
  } else if (args.task) {
    const { run } = await import(pathToFileURL(new URL('../src/index.js', import.meta.url)).href);
    await run(args.task);
  } else {
    const { runDefault } = await import(pathToFileURL(new URL('../src/index.js', import.meta.url)).href);
    await runDefault();
  }

  console.log(`\n✓ build complete (${path.basename(buildFile)})`);
}

main().catch((err) => {
  console.error('\n✗ build failed:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
