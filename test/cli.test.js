/**
 * Integration tests for bin/nbs.mjs (the CLI) — it is spawned as a child process
 * against throwaway build files, so the real entry point (arg parsing,
 * build-file discovery, task dispatch, watch mode, error handling) is
 * exercised end to end.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/nbs.mjs', import.meta.url));
// The CLI resolves its registry via this same file URL, so importing it here
// shares one task registry with the spawned process's own imports.
const INDEX = new URL('../src/index.js', import.meta.url).href;

let root;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nbs-cli-'));
});

after(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** @returns {Promise<string>} A fresh, empty working directory per test case. */
async function freshDir() {
  return fs.mkdtemp(path.join(root, 'case-'));
}

/**
 * Spawn the CLI with the given argv in a cwd, capturing output as it arrives.
 *
 * @param {string[]} argv CLI arguments.
 * @param {string} cwd Working directory for the child.
 * @returns {{ child: import('node:child_process').ChildProcess, state: { stdout: string, stderr: string }, done: Promise<{ code: number|null, stdout: string, stderr: string }> }}
 */
function spawnCli(argv, cwd) {
  const child = spawn(process.execPath, [BIN, ...argv], { cwd });
  const state = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { state.stdout += chunk; });
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  const done = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout: state.stdout, stderr: state.stderr }));
  });
  return { child, state, done };
}

/** Poll until predicate() is truthy or time out. */
async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for CLI output');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Write a build file and run the CLI, asserting exit 0. Returns stdout. */
async function runCli(cwd, source, argv = []) {
  await fs.writeFile(path.join(cwd, 'build.mjs'), source, 'utf8');
  const { code, stdout, stderr } = await (await spawnCli(argv, cwd)).done;
  if (code !== 0) throw new Error(`cli exited ${code}: ${stdout}\n${stderr}`);
  return stdout;
}

/** Write a build file and run the CLI, asserting a non-zero exit. */
async function runCliExpectFail(cwd, source, argv = []) {
  await fs.writeFile(path.join(cwd, 'build.mjs'), source, 'utf8');
  const { code, stdout, stderr } = await (await spawnCli(argv, cwd)).done;
  assert.notEqual(code, 0, `expected non-zero exit, got ${code}: ${stdout}`);
  return { stdout, stderr };
}

test('CLI --list prints registered tasks in order and runs nothing', async () => {
  const cwd = await freshDir();
  const marker = path.join(cwd, 'ran.txt');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `import { task } from '${INDEX}';`,
    `task('alpha', () => { writeFileSync(${JSON.stringify(marker)}, 'ran'); });`,
    'task(\'beta\', () => {});',
  ].join('\n') + '\n';
  const out = await runCli(cwd, source, ['--list']);
  assert.deepEqual(out.trim().split('\n'), ['alpha', 'beta']);
  assert.ok(!out.includes('build complete'), '--list must not run the build');
  await assert.rejects(fs.access(marker), 'a task must not have run');
});

test('CLI -l works and reports an empty registry', async () => {
  const cwd = await freshDir();
  const out = await runCli(cwd, `import '${INDEX}';\n`, ['-l']);
  assert.equal(out.trim(), 'No tasks registered.');
});

test('CLI --help and -h print usage without needing a build file', async () => {
  const cwd = await freshDir(); // deliberately empty — no build file at all
  for (const flag of ['--help', '-h']) {
    const { code, stdout } = await (await spawnCli([flag], cwd)).done;
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
    assert.match(stdout, /--list/);
    assert.match(stdout, /--watch/);
    assert.match(stdout, /--glob/);
    assert.match(stdout, /--json/);
  }
});

test('CLI exits non-zero when no build file can be found', async () => {
  const cwd = await freshDir(); // deliberately empty
  const { code, stderr } = await (await spawnCli([], cwd)).done;
  assert.notEqual(code, 0);
  assert.match(stderr, /No build file found/);
});

test('CLI exits non-zero for a missing --config target', async () => {
  const cwd = await freshDir();
  const { code, stderr } = await (await spawnCli(['--config', './does-not-exist.mjs'], cwd)).done;
  assert.notEqual(code, 0);
  assert.match(stderr, /Config file not found/);
});

test('CLI positional task name runs that task via run()', async () => {
  const cwd = await freshDir();
  const marker = path.join(cwd, 'greet.txt');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `import { task } from '${INDEX}';`,
    `task('greet', () => { writeFileSync(${JSON.stringify(marker)}, 'hi'); });`,
    'task(\'never\', () => {});',
  ].join('\n') + '\n';
  const out = await runCli(cwd, source, ['greet']);
  assert.match(out, /build complete \(build\.mjs\)/);
  await fs.access(marker); // the named task ran
});

test('CLI with no task name runs every registered task in parallel', async () => {
  const cwd = await freshDir();
  const a = path.join(cwd, 'a.txt');
  const b = path.join(cwd, 'b.txt');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `import { task } from '${INDEX}';`,
    `task('one', () => { writeFileSync(${JSON.stringify(a)}, '1'); });`,
    `task('two', () => { writeFileSync(${JSON.stringify(b)}, '2'); });`,
  ].join('\n') + '\n';
  await runCli(cwd, source); // no task name → runDefault()
  await fs.access(a);
  await fs.access(b);
});

test('CLI calls a function default export with the requested task name', async () => {
  const cwd = await freshDir();
  const marker = path.join(cwd, 'called-with.txt');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `export default (taskName) => { writeFileSync(${JSON.stringify(marker)}, String(taskName)); };`,
  ].join('\n') + '\n';
  await runCli(cwd, source, ['foo']);
  assert.equal(await fs.readFile(marker, 'utf8'), 'foo');
});

test('CLI -c points at an explicit build file by custom name', async () => {
  const cwd = await freshDir();
  const marker = path.join(cwd, 'custom.txt');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `import { task } from '${INDEX}';`,
    `task('only', () => { writeFileSync(${JSON.stringify(marker)}, 'x'); });`,
  ].join('\n') + '\n';
  await fs.writeFile(path.join(cwd, 'my-build.mjs'), source, 'utf8'); // not a default candidate name
  const out = await runCli(cwd, source, ['-c', './my-build.mjs', 'only']);
  assert.match(out, /build complete \(my-build\.mjs\)/);
  await fs.access(marker);
});

test('CLI falls back to gulpfile.mjs when no build.mjs exists', async () => {
  const cwd = await freshDir();
  const marker = path.join(cwd, 'gulp.txt');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `import { task } from '${INDEX}';`,
    `task('g', () => { writeFileSync(${JSON.stringify(marker)}, 'g'); });`,
  ].join('\n') + '\n';
  await fs.writeFile(path.join(cwd, 'gulpfile.mjs'), source, 'utf8'); // no build.mjs on purpose
  const { code, stdout } = await (await spawnCli(['g'], cwd)).done;
  assert.equal(code, 0, stdout);
  assert.match(stdout, /build complete \(gulpfile\.mjs\)/);
  await fs.access(marker);
});

test('CLI passes unknown flags through to the build module untouched', async () => {
  const cwd = await freshDir();
  const marker = path.join(cwd, 'flagged.txt');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `import { task } from '${INDEX}';`,
    `task('greet', () => { writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ')); });`,
  ].join('\n') + '\n';
  await runCli(cwd, source, ['greet', '--minify', '--target', 'staging']);
  assert.equal(await fs.readFile(marker, 'utf8'), 'greet --minify --target staging');
});

test('CLI exits non-zero and prints the error when a task fails', async () => {
  const cwd = await freshDir();
  const source = [
    `import { task } from '${INDEX}';`,
    'task(\'boom\', async () => { throw new Error(\'kapow\'); });',
  ].join('\n') + '\n';
  const { stderr } = await runCliExpectFail(cwd, source, ['boom']);
  assert.match(stderr, /build failed/);
  assert.match(stderr, /kapow/);
});

test('CLI --watch without globs on the default export fails clearly', async () => {
  const cwd = await freshDir();
  const { stderr } = await runCliExpectFail(cwd, `import '${INDEX}';\n`, ['--watch']);
  assert.match(stderr, /must export \{ globs/);
});

test('CLI --watch builds, re-runs on change, and stops cleanly on SIGINT', async () => {
  const cwd = await freshDir();
  const assets = path.join(cwd, 'assets');
  await fs.mkdir(assets);
  const source = [
    `import { task, seriesDefault } from '${INDEX}';`,
    'task(\'tick\', () => {});',
    'seriesDefault(\'tick\');',
    'export default { globs: [\'assets/**\'] };',
  ].join('\n') + '\n';
  await fs.writeFile(path.join(cwd, 'build.mjs'), source, 'utf8');

  const { child, state, done } = spawnCli(['--watch'], cwd);
  await waitFor(() => state.stdout.includes('watching'));
  assert.match(state.stdout, /build — running/); // initial run happened

  await fs.writeFile(path.join(assets, 'a.txt'), 'hi', 'utf8');
  await waitFor(() => state.stdout.includes('change detected'));

  child.kill('SIGINT');
  const { code } = await done;
  assert.equal(code, 0);
  assert.match(state.stdout, /watcher stopped/);
});

test('CLI --glob reports matches without any build file present', async () => {
  const cwd = await freshDir(); // deliberately empty — no build file at all
  await fs.mkdir(path.join(cwd, 'src'));
  await fs.writeFile(path.join(cwd, 'src', 'index.html'), '<html></html>');
  await fs.mkdir(path.join(cwd, 'src', 'css'));
  await fs.writeFile(path.join(cwd, 'src', 'css', 'site.css'), 'a{}');
  const { code, stdout } = await (await spawnCli(['--glob', 'src/**'], cwd)).done;
  assert.equal(code, 0);
  assert.match(stdout, /pattern: src\/\*\*/);
  assert.match(stdout, /base:\s+src/);
  assert.match(stdout, /^index\.html$/m);
  assert.match(stdout, /^css\/site\.css$/m); // matches are relative to the base
  assert.ok(!stdout.includes('build complete'), '--glob must not run a build');
});

test('CLI --glob with no matches exits 0 and says so', async () => {
  const cwd = await freshDir(); // empty dir: bare ** also exercises base == cwd → "."
  const { code, stdout } = await (await spawnCli(['--glob', '**'], cwd)).done;
  assert.equal(code, 0);
  assert.match(stdout, /base:\s+\./);
  assert.match(stdout, /\(no matches\)/);
});

test('CLI --glob accepts repeatable patterns and never runs the build', async () => {
  const cwd = await freshDir();
  const marker = path.join(cwd, 'ran.txt');
  await fs.mkdir(path.join(cwd, 'src'));
  await fs.writeFile(path.join(cwd, 'src', 'a.html'), '');
  await fs.writeFile(path.join(cwd, 'src', 'b.css'), '');
  const source = [
    'import { writeFileSync } from \'node:fs\';',
    `import { task } from '${INDEX}';`,
    `task('all', () => { writeFileSync(${JSON.stringify(marker)}, 'ran'); });`,
  ].join('\n') + '\n';
  await fs.writeFile(path.join(cwd, 'build.mjs'), source, 'utf8'); // present but must stay untouched
  const { code, stdout } = await (await spawnCli(['--glob', 'src/*.html', '--glob', 'src/*.css'], cwd)).done;
  assert.equal(code, 0);
  assert.match(stdout, /pattern: src\/\*\.html/);
  assert.match(stdout, /pattern: src\/\*\.css/);
  assert.match(stdout, /^a\.html$/m);
  assert.match(stdout, /^b\.css$/m);
  await assert.rejects(fs.access(marker), 'the build must not have run');
});

test('CLI --glob --json emits parseable machine-readable output', async () => {
  const cwd = await freshDir();
  await fs.mkdir(path.join(cwd, 'src'));
  await fs.writeFile(path.join(cwd, 'src', 'a.html'), '');
  await fs.writeFile(path.join(cwd, 'src', 'b.css'), '');
  const { code, stdout } = await (await spawnCli(['--glob', 'src/*.{html,css}', '--json'], cwd)).done;
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.deepEqual(report, [
    { pattern: 'src/*.{html,css}', base: 'src', matches: ['a.html', 'b.css'] },
  ]);
});
