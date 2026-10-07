/**
 * node-build example build file.
 * 
 * Demonstrates native transform tasks, async non-stream tasks, and
 * series + parallel composition. Run with:  node ./bin/node-build.mjs
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { task, series, parallel, src, dest, through } from 'node-build';
import path from 'node:path';
import process from 'node:process';

/**
 * getTaskArguments parses command line arguments, --name value, to an object
 *   `node-build mytask --a 123 --b "my string" --c`
 *   produces:
 *     {
 *       "a": "123",
 *       "b": "my string",
 *       "c": true
 *     }
 * @param {String[]} argList - List of arguments, process.argv
 * @returns {Object} The command line arguments as an object
 */
function getTaskArguments (argList) {
  const arg = {};
  let a, opt, thisOpt, curOpt;
  for (a = 0; a < argList.length; a++) {
    thisOpt = argList[a].trim();
    opt = thisOpt.replace(/^-+/, '');

    if (opt === thisOpt) {
      // argument value
      if (curOpt) arg[curOpt] = opt;
      curOpt = null;
    }
    else {
      // argument name
      curOpt = opt;
      arg[curOpt] = true;
    }
  }
  return arg;  
}

const args = getTaskArguments(process.argv);
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
task('manifest', async function makeManifest() {
  const fs = await import('node:fs');
  const entries = ['html', 'css'];
  await fs.promises.writeFile(
    path.join(cwd, 'examples/dist/manifest.json'),
    JSON.stringify({ builtAt: new Date().toISOString(), tasks: entries, args }, null, 2),
  );
});

// Compose the above. Accepts optional CLI arguments (parsed from process.argv).
export function build (buildArgs = {}) {
  return parallel('html', 'css').then(() => series('manifest'));
}

export default build;
