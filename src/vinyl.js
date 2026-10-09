/**
 * node-build-stream — vinyl file class resolver.
 * 
 * Resolves the best available Vinyl-compatible file class: uses a real `vinyl`
 * package when resolvable from the project for maximum gulp plugin compatibility,
 * otherwise falls back to the built-in zero-dependency shim (src/file.js).
 * Detection is memoised per resolved path.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { File as ShimFile } from './file.js';

/**
 * A Vinyl-compatible file class: constructible with no arguments to produce an
 * empty file object. Both the built-in shim and a real `vinyl` package satisfy
 * this shape; we deliberately keep it structural so any duck-typed class works.
 *
 * @typedef {() => import('./file.js').File} FileClass
 */

/**
 * The result of resolving a file class for a project: the constructor plus
 * where it came from.
 *
 * @typedef {Object} ResolvedFileClass
 * @property {FileClass} Vinyl The file class to use for this project.
 * @property {'vinyl'|'shim'} source Which implementation was resolved.
 */

const cache = new Map();

/**
 * Resolve the best available Vinyl-compatible file class for a project: the
 * real `vinyl` package when resolvable from `fromPath`, otherwise the built-in
 * zero-dependency shim. Results are memoised per resolved base path.
 *
 * @param {string} [fromPath] A path inside the consuming project (a build file
 *   or directory); defaults to the current working directory.
 * @returns {Promise<ResolvedFileClass>} The resolved file class entry.
 */
export async function resolveFileClass(fromPath) {
  const base = path.resolve(fromPath ?? process.cwd());
  if (cache.has(base)) return cache.get(base);

  const result = await tryLoadVinyl(base).catch(() => null);
  const entry = /** @type {ResolvedFileClass} */ (result
    ? { Vinyl: result, source: 'vinyl' }
    : { Vinyl: ShimFile, source: 'shim' });
  cache.set(base, entry);
  return entry;
}

/**
 * Synchronous variant of {@link resolveFileClass} for build files written in
 * CJS-style or sync contexts.
 *
 * @param {string} [fromPath] A path inside the consuming project; defaults to cwd.
 * @returns {ResolvedFileClass} The resolved file class entry.
 */
export function resolveFileClassSync(fromPath) {
  const base = path.resolve(fromPath ?? process.cwd());
  if (cache.has(base)) return cache.get(base);

  let Vinyl;
  try {
    const requireFromBase = createRequire(base.endsWith(path.sep) ? base : path.join(base, 'noop.js'));
    Vinyl = requireFromBase('vinyl');
    if (Vinyl && Vinyl.default) Vinyl = Vinyl.default;
  } catch {
    Vinyl = undefined;
  }

  const entry = /** @type {ResolvedFileClass} */ (Vinyl
    ? { Vinyl, source: 'vinyl' }
    : { Vinyl: ShimFile, source: 'shim' });
  cache.set(base, entry);
  return entry;
}

/**
 * Locate a `vinyl` implementation resolvable from the consuming project.
 *
 * A bare dynamic `import('vinyl')` here would resolve relative to THIS module
 * (node-build-stream has no vinyl dependency), so we instead scope resolution to the
 * user's project with createRequire rooted at `base`. This is async only to keep
 * a single code path; the underlying require is synchronous.
 *
 * @param {string} base An absolute directory or file path inside the project.
 * @returns {Promise<FileClass|null>} The vinyl class, or null when absent/invalid.
 */
async function tryLoadVinyl(base) {
  const requireFromBase = createRequire(base.endsWith(path.sep) ? base : path.join(base, 'noop.js'));
  /** @type {any} */
  let Vinyl = requireFromBase('vinyl');
  if (Vinyl && Vinyl.default) Vinyl = Vinyl.default;
  if (typeof Vinyl !== 'function') return null;
  return /** @type {FileClass} */ (Vinyl);
}

/** Clear the resolution cache, forcing a re-detection. Mainly useful for tests. @returns {void} */
export function clearFileClassCache() {
  cache.clear();
}
