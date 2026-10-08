/**
 * Styles stage — the STREAM showcase of the webapp example.
 * 
 * Compiles the site's Sass entry to CSS and runs it through PostCSS
 * (autoprefixer) as a pure node-build stream:
 * 
 *   src(site.scss, { encoding: 'utf8' })
 *     .pipe(through(sass compile))
 *     .pipe(through(postcss + autoprefixer))
 *     .pipe(through(write dist/assets/css/site.css))
 * 
 * No gulp-sass / gulp-postcss — each plugin-style step is a small `through()`
 * transform over File objects, which is exactly how Gulp plugins work under
 * the hood. The final transform writes the deterministic output path itself
 * and drops the file (returns null), so this stage needs no dest().
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { src, through } from 'node-build';

/**
 * Build the styles stage task.
 *
 * @param {import('./settings.js').WebappSettings} settings Resolved build settings.
 * @returns {() => import('node:stream').Stream} A zero-arg task function that
 *   returns the compiled-CSS pipeline (awaited by series()/parallel()).
 */
export function createStylesStage (settings) {
  const outDir = path.join(settings.dist, 'assets', 'css');
  const outFile = path.join(outDir, path.basename(settings.sassEntry).replace(/\.scss$/, '') + '.css');

  return function stylesStage () {
    return src(path.join(settings.srcStyles, `${settings.sassEntry}`), { encoding: 'utf8', cwd: settings.root })
      .pipe(through(sassCompile(settings)))
      .pipe(through(postcssProcess()))
      .pipe(through(writeOut(outFile)));
  };
}

/**
 * Per-file transform: compile SCSS source to CSS.
 *
 * @param {import('./settings.js').WebappSettings} settings Build settings (used for the entry name in errors).
 * @returns {(file: import('node-build/file').File) => import('node-build/file').File} The through() callback.
 */
function sassCompile (settings) {
  // `sass` is a recipe dependency of this EXAMPLE, not of node-build — import
  // it lazily so the rest of the pipeline never pays for it.
  return async function compileSass (file) {
    const sass = await import('sass');
    if (typeof file.contents !== 'string') {
      throw new Error(`styles stage: expected string contents for ${settings.sassEntry}, got ${typeof file.contents}`);
    }
    const result = sass.compileString(file.contents, { syntax: 'scss', sourceMap: false });
    file.contents = result.css;
    return file;
  };
}

/**
 * Per-file transform: run compiled CSS through PostCSS with autoprefixer.
 *
 * @returns {(file: import('node-build/file').File) => import('node-build/file').File} The through() callback.
 */
function postcssProcess () {
  return async function runPostcss (file) {
    const postcss = await import('postcss');
    const autoprefixer = await import('autoprefixer');
    if (typeof file.contents !== 'string') {
      throw new Error('styles stage: expected a CSS string from the sass transform');
    }
    const processor = postcss.default([autoprefixer.default()]);
    const result = await processor.process(file.contents, { from: undefined });
    file.contents = result.css;
    return file;
  };
}

/**
 * Per-file transform: write the final CSS to its deterministic output path and
 * drop the file from the stream (nothing downstream needs it).
 *
 * @param {string} outFile Absolute path of the compiled stylesheet.
 * @returns {(file: import('node-build/file').File) => null} The through() callback.
 */
function writeOut (outFile) {
  return async function writeCss (file) {
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, /** @type {string} */ (file.contents));
    return null; // drop — the file has been written to its final location
  };
}
