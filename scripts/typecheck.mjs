/**
 * node-build — per-file typecheck helper.
 *
 * tsgo (tsc@7) refuses to mix `-p` with file arguments on the command line, so
 * checking a single module requires a temporary tsconfig that pins `files`.
 * This script generates one in os.tmpdir(), runs tsc, and cleans up.
 *
 * Usage:
 *   node scripts/typecheck.mjs <file-or-dir> [...]
 *
 * With no arguments it type-checks the whole project (tsconfig.check.json).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Temp config must live under the workspace: tsgo resolves `files` and
// `extends`-inherited relative paths against the config's own directory.
const tmpDir = path.join(root, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const args = process.argv.slice(2);

if (!args.length) {
  execFileSync('npx', ['tsc', '-p', path.join(root, 'tsconfig.check.json')], { stdio: 'inherit' });
  process.exit(0);
}

// Validate targets exist and normalize to workspace-relative paths.
const files = args.map((a) => {
  const abs = path.resolve(root, a);
  if (!fs.existsSync(abs)) {
    console.error(`typecheck: no such file or directory: ${a}`);
    process.exit(2);
  }
  return path.relative(root, abs).split(path.sep).join('/');
});

const tmpConfig = path.join(tmpDir, `typecheck-${process.pid}.json`);
// tsgo resolves `files` (and any relative `extends`) against the config's own
// directory, so prefix workspace-relative paths to reach up from tmp/.
fs.writeFileSync(tmpConfig, JSON.stringify({
  extends: '../tsconfig.check.json',
  files: files.map((f) => `..${path.sep}${f}`),
}, null, 2));

try {
  execFileSync('npx', ['tsc', '-p', tmpConfig], { stdio: 'inherit', cwd: root });
} finally {
  fs.rmSync(tmpConfig, { force: true });
}
