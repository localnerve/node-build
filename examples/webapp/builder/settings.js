/**
 * Build settings for the webapp example.
 * 
 * Resolves every path and option the pipeline needs in one place so the
 * createBuild() factory — and each stage it composes — accepts a single plain
 * object. Mirrors how a real multi-webapp builder would take per-site config.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import path from 'node:path';
import process from 'node:process';

/**
 * Resolved build settings for one webapp.
 *
 * @typedef {Object} WebappSettings
 * @property {string} root Project root; every other path here is absolute under it.
 * @property {boolean} prod True for an optimized production build.
 * @property {string} srcClient Directory holding the client JS entry and its modules.
 * @property {string} srcStyles Directory holding the Sass sources.
 * @property {string} srcTemplates Directory holding the Handlebars page templates.
 * @property {string} dataFile Site data JSON consumed by the async asset/template stages.
 * @property {string} jsEntry Client entry module, relative to srcClient.
 * @property {string} sassEntry Sass entry file, relative to srcStyles.
 * @property {boolean} revision Whether to fingerprint assets and rewrite references.
 * @property {string} dist Output directory; wiped and rebuilt on every run.
 */

/**
 * Build the settings object for a webapp pipeline.
 *
 * @param {{ root?: string, prod?: boolean, revision?: boolean }} [options] Overrides;
 *   `root` defaults to the current working directory (run `nbs` from this
 *   example's folder).
 * @returns {WebappSettings} Resolved settings with absolute paths.
 */
export function createSettings (options = {}) {
  const root = options.root ?? process.cwd();
  return /** @type {WebappSettings} */ ({
    root,
    prod: Boolean(options.prod),
    srcClient: path.join(root, 'src', 'client'),
    srcStyles: path.join(root, 'src', 'styles'),
    srcTemplates: path.join(root, 'src', 'templates'),
    dataFile: path.join(root, 'src', 'data', 'site.json'),
    jsEntry: 'main.js',
    sassEntry: 'site.scss',
    revision: options.revision ?? true,
    dist: path.join(root, 'dist'),
  });
}
