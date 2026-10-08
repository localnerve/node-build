/**
 * Revision stage — the pure-`through()` showcase (no gulp-rev).
 * 
 * Three streaming passes over dist/, all composed with node-build primitives:
 * 
 *   1. Fingerprint — every asset under dist/assets/** gets a SHA-256 content
 *      hash in its filename (`site.css` → `site-a1b2c3d4e5.css`). The transform
 *      unlinks the original and re-points file.path; dest() writes the new name.
 *   2. Rewrite refs — HTML pages (and CSS, for url() tokens) have their
 *      `/assets/...` references rewritten to the fingerprinted names. A CSS
 *      file whose content changes is re-hashed in the same transform so its
 *      manifest entry stays truthful.
 *   3. Merge manifest — the per-run mapping is merged over any pre-existing
 *      dist/assets/manifest.json and emitted as a single-file stream through
 *      dest() (a File with contents, just like everything else).
 * 
 * The prepare stage wipes dist/ before this runs, so stale fingerprints never
 * accumulate; the hash-suffix strip in fingerprint() keeps re-runs idempotent
 * regardless. `.map` files and manifest.json itself pass through untouched.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { src, dest, through, series, File } from 'node-build';

/** Fixed hash length used in fingerprinted filenames. */
const HASH_LEN = 10;

/**
 * A manifest mapping original asset paths (relative to dist/assets) to their
 * fingerprinted names, e.g. `{ "css/site.css": "css/site-a1b2c3d4e5.css" }`.
 *
 * @typedef {Record<string, string>} Manifest
 */

/**
 * Short SHA-256 hex digest of a buffer.
 *
 * @param {Buffer} buf The bytes to hash.
 * @returns {string} A 10-hex-char content hash.
 */
function contentHash (buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, HASH_LEN);
}

/**
 * Load a pre-existing manifest from dist/assets/manifest.json, if any. This is
 * what makes pass 3 a MERGE: entries from earlier runs (or other stages) that
 * this run did not touch are preserved.
 *
 * @param {string} manifestFile Absolute path of the manifest to load.
 * @returns {Promise<Manifest>} The prior manifest, or {} when absent/invalid.
 */
async function loadManifest (manifestFile) {
  try {
    const raw = await fsp.readFile(manifestFile, 'utf8');
    return /** @type {Manifest} */ (JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Build the revision stage task.
 *
 * @param {import('./settings.js').WebappSettings} settings Resolved build settings.
 * @returns {() => Promise<void>} A zero-arg async task function (no stream).
 */
export function createRevisionStage (settings) {
  const assetsDir = path.join(settings.dist, 'assets');

  return async function revisionStage () {
    if (!settings.revision) return; // dev builds keep plain names

    const manifestFile = path.join(assetsDir, 'manifest.json');
    const manifest = await loadManifest(manifestFile);

    // Pass 1 — fingerprint every asset (Buffer contents; no text assumption).
    await series(
      src(`${assetsDir}/**/*`, { cwd: settings.root })
        .pipe(through(fingerprint(assetsDir, manifest)))
        .pipe(dest(assetsDir, { cwd: settings.root })),
    );

    // Pass 2 — rewrite references. CSS first (it may re-hash), then pages.
    const refs = /** @type {Record<string, string>} */ ({});
    for (const [from, to] of Object.entries(manifest)) {
      refs[`/${from}`] = `/${to}`; // site-rooted token → fingerprinted token
    }
    await series(
      src(`${assetsDir}/**/*.css`, { cwd: settings.root, encoding: 'utf8' })
        .pipe(through(rewriteAndRehash(refs, assetsDir, manifest)))
        .pipe(dest(assetsDir, { cwd: settings.root })),
    );
    await series(
      src(`${settings.dist}/*.html`, { cwd: settings.root, encoding: 'utf8' })
        .pipe(through(rewriteRefs(refs)))
        .pipe(dest(settings.dist, { cwd: settings.root })),
    );

    // Pass 3 — emit the merged manifest as a one-file stream through dest().
    const mf = new File({ path: manifestFile });
    mf.contents = `${JSON.stringify(manifest, null, 2)}\n`;
    await series(Readable.from([mf]).pipe(dest(assetsDir, { cwd: settings.root })));
  };
}

/**
 * Per-file transform (pass 1): hash the file's content, unlink the original,
 * and re-point file.path to `<stem>-<hash><ext>` in the same directory. dest()
 * then writes the fingerprinted name. Skips sourcemaps and the manifest itself.
 *
 * @param {string} assetsDir Absolute path of dist/assets (manifest keys are relative to it).
 * @param {Manifest} manifest Accumulator for this run's original→fingerprinted map.
 * @returns {(file: import('node-build/file').File) => import('node-build/file').File|null} The through() callback.
 */
function fingerprint (assetsDir, manifest) {
  return async function fp (/** @type {import('node-build/file').File} */ file) {
    if (path.extname(file.path) === '.map' || path.basename(file.path) === 'manifest.json') {
      return file; // leave as-is; dest() rewrites it in place
    }
    const hash = contentHash(/** @type {Buffer} */ (file.contents));
    const dir = path.dirname(file.path);
    // Strip any prior -<hash> suffix so re-fingerprinting the same content is a no-op rename.
    const stem = path.basename(file.path).replace(/\.[^.]+$/, '').replace(/-[0-9a-f]{10}$/, '');
    const ext = path.extname(file.path);
    const newPath = path.join(dir, `${stem}-${hash}${ext}`);
    manifest[path.relative(assetsDir, file.path)] = path.relative(assetsDir, newPath);
    await fsp.unlink(file.path).catch(() => {});
    file.path = newPath;
    return file;
  };
}

/**
 * Per-file transform (pass 2, CSS): rewrite `/assets/...` tokens to their
 * fingerprinted forms. When the content actually changes, re-hash and rename
 * the file in the same pass so its manifest entry stays accurate.
 *
 * @param {Record<string, string>} refs Site-rooted reference token → replacement token.
 * @param {string} assetsDir Absolute path of dist/assets (for relative manifest keys).
 * @param {Manifest} manifest The shared manifest map, updated when a file re-hashes.
 * @returns {(file: import('node-build/file').File) => import('node-build/file').File} The through() callback.
 */
function rewriteAndRehash (refs, assetsDir, manifest) {
  return async function rewriteCss (/** @type {import('node-build/file').File} */ file) {
    const original = /** @type {string} */ (file.contents);
    const rewritten = replaceAllTokens(original, refs);
    if (rewritten === original) return file; // no refs — name stays valid

    file.contents = rewritten;
    const hash = contentHash(Buffer.from(rewritten));
    const dir = path.dirname(file.path);
    const stem = path.basename(file.path).replace(/\.[^.]+$/, '').replace(/-[0-9a-f]{10}$/, '');
    const ext = path.extname(file.path);
    const newPath = path.join(dir, `${stem}-${hash}${ext}`);
    // Re-point this file's manifest entry (its pre-pass-1 original key).
    for (const [from, to] of Object.entries(manifest)) {
      if (path.resolve(assetsDir, to) === file.path) manifest[from] = path.relative(assetsDir, newPath);
    }
    await fsp.unlink(file.path).catch(() => {});
    file.path = newPath;
    return file;
  };
}

/**
 * Per-file transform (pass 2, HTML): rewrite `/assets/...` tokens to their
 * fingerprinted forms.
 *
 * @param {Record<string, string>} refs Site-rooted reference token → replacement token.
 * @returns {(file: import('node-build/file').File) => import('node-build/file').File} The through() callback.
 */
function rewriteRefs (refs) {
  return function rewriteHtml (/** @type {import('node-build/file').File} */ file) {
    file.contents = replaceAllTokens(/** @type {string} */ (file.contents), refs);
    return file;
  };
}

/**
 * Replace every occurrence of each reference token in a string.
 *
 * @param {string} text The source text.
 * @param {Record<string, string>} refs Token → replacement map.
 * @returns {string} The rewritten text.
 */
function replaceAllTokens (text, refs) {
  let out = text;
  for (const [token, replacement] of Object.entries(refs)) {
    if (out.includes(token)) out = out.split(token).join(replacement);
  }
  return out;
}
