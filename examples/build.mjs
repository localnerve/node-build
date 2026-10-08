/**
 * node-build example build file.
 * 
 * Demonstrates native transform tasks, async non-stream tasks, and
 * series + parallel composition. Run from the repository root with:
 *  node ./bin/nbs --config ./examples/build.mjs
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { task, series, parallel, src, dest, through, parseArgs } from 'node-build';
import path from 'node:path';
import process from 'node:process';

// `node-build mytask --a 123 --b "my string" --c` -> { a: "123", b: "my string", c: true }
const args = parseArgs(process.argv);
const cwd = process.cwd();

// Copy HTML files, uppercasing any "TODO:" markers via a native transform.
task('html', function buildHtml() {
  return src('examples/src/*.html', { cwd })
    .pipe(through((file) => {
      if (Buffer.isBuffer(file.contents)) {
        file.contents = file.contents.toString('utf8').replace(/TODO:/g, 'NOTE:');
      }
      return file;
    }))
    .pipe(dest('examples/dist', { cwd }));
});

// Copy CSS as-is.
task('css', function buildCss() {
  return src('examples/src/*.css', { cwd }).pipe(dest('examples/dist', { cwd }));
});

// A plain (non-stream) async task, e.g. generating a manifest.
let extraArgs = {};
task('manifest', async function makeManifest() {
  const fs = await import('node:fs');
  const entries = ['html', 'css'];
  await fs.promises.writeFile(
    path.join(cwd, 'examples/dist/manifest.json'),
    JSON.stringify({ builtAt: new Date().toISOString(), tasks: entries, args, extraArgs }, null, 2),
  );
});

// Compose the above. Optional extra args can be forwarded to the manifest step
// when invoked programmatically: `await build({ watch: true })`.
function build (buildArgs = {}) {
  extraArgs = buildArgs;
  return parallel('html', 'css').then(() => series('manifest'));
}

// Declares what `node-build --watch` monitors for this build file. A function
// default export may carry a `globs` property (functions are objects), so the
// same export works in both one-shot and watch modes.
build.globs = ['examples/src/**'];

export default build;
