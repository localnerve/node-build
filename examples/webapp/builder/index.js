/**
 * The webapp build factory — the piece a standalone multi-webapp builder
 * would extract and reuse.
 * 
 * createBuild(settings, siteData) returns a zero-arg (or single task-name
 * arg) async function that runs the entire pipeline:
 * 
 *   prepare  — clean() the dist directory (idempotent; safe on first run)
 *      │
 *      ├── styles   (stream:  src → through(sass) → through(postcss) → write)
 *      ├── scripts  (async:   rollup bundle + env injection)     ── parallel
 *      └── assets   (async:   robots/llms/security/sitemap/hbs pages)
 *      │
 *   revision — fingerprint + ref-rewrite + manifest-merge (pure through())
 * 
 * The factory registers nothing globally and closes only over its two
 * arguments, so many builds can coexist in one process.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { series, parallel, clean } from 'node-build';
import { createStylesStage } from './styles.js';
import { createScriptsStage } from './scripts.js';
import { createAssetsStage } from './assets.js';
import { createRevisionStage } from './revision.js';

/**
 * Site data passed to the factory (same shape assets.js documents).
 *
 * @typedef {Object} SiteData
 * @property {string} name Human-readable site name.
 * @property {string} url Canonical absolute URL of the deployed site.
 * @property {string} description One-paragraph site summary.
 * @property {Array<{ path: string, title: string }>} pages Deployed pages.
 */

/**
 * Create a full webapp build for one site.
 *
 * @param {import('./settings.js').WebappSettings} settings Resolved build settings
 *   (see createSettings) — every path the pipeline needs.
 * @param {SiteData} siteData Site data driving the async asset/template stages.
 * @returns {() => Promise<void>} The build function: runs prepare, then styles
 *   + scripts + assets in parallel, then revision. Accepts an optional task
 *   name argument (ignored — the full pipeline always runs), so it can be used
 *   directly as a build file's default export with the node-build CLI.
 */
export function createBuild (settings, siteData) {
  return async function build () {
    await series(
      // prepare: wipe dist/ so revision never sees stale fingerprints.
      /** @returns {Promise<void>} */ (async () => {
        await clean(settings.dist, { cwd: settings.root });
      }),
      // The three producers are independent — run them concurrently. Safe to
      // pass the bare parallel(...) schedule as an item: series() and
      // parallel() return LAZY schedules that start only when first awaited,
      // so nothing here runs until series reaches this slot (after clean).
      parallel(
        createStylesStage(settings),
        createScriptsStage(settings),
        createAssetsStage(settings, siteData),
      ),
      // revision needs every asset + page on disk first.
      createRevisionStage(settings),
    );
  };
}
