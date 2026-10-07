/**
 * node-build — vinyl file class resolver.
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

const cache = new Map();

export async function resolveFileClass(fromPath) {
  const base = path.resolve(fromPath ?? process.cwd());
  if (cache.has(base)) return cache.get(base);

  const result = await tryLoadVinyl(base).catch(() => null);
  const entry = result
    ? { Vinyl: result, source: 'vinyl' }
    : { Vinyl: ShimFile, source: 'shim' };
  cache.set(base, entry);
  return entry;
}

/** Synchronous variant for build files written in CJS-style or sync contexts. */
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

  const entry = Vinyl
    ? { Vinyl, source: 'vinyl' }
    : { Vinyl: ShimFile, source: 'shim' };
  cache.set(base, entry);
  return entry;
}

/**
 * Locate a `vinyl` implementation resolvable from the consuming project.
 *
 * A bare dynamic `import('vinyl')` here would resolve relative to THIS module
 * (node-build has no vinyl dependency), so we instead scope resolution to the
 * user's project with createRequire rooted at `base`. This is async only to keep
 * a single code path; the underlying require is synchronous.
 */
async function tryLoadVinyl(base) {
  const requireFromBase = createRequire(base.endsWith(path.sep) ? base : path.join(base, 'noop.js'));
  let Vinyl = requireFromBase('vinyl');
  if (Vinyl && Vinyl.default) Vinyl = Vinyl.default;
  if (typeof Vinyl !== 'function') return null;
  return Vinyl;
}

/** Force a re-detection (mainly useful for tests). */
export function clearFileClassCache() {
  cache.clear();
}
