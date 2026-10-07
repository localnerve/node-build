import { task, series, parallel, src, dest, through } from 'node-build';
import path from 'node:path';
import process from 'node:process';

/**
 * Example node-build build file. Run with:  node ./bin/node-build.mjs
 *
 * Demonstrates:
 *   - a native transform task (src -> through -> dest)
 *   - an async non-stream task
 *   - series + parallel composition
 */

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
    JSON.stringify({ builtAt: new Date().toISOString(), tasks: entries }, null, 2),
  );
});

// Compose the above.
export function build() {
  return parallel('html', 'css').then(() => series('manifest'));
}

export default build;
