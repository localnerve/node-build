/**
 * node-build — clean / delete files and directories by glob pattern.
 *
 * A dependency-free `gulp-clean` equivalent: resolve a set of glob patterns
 * (negation supported, same syntax as src()) and remove the matches from disk.
 * Directories are removed recursively; missing targets are ignored so clean() is
 * always safe to run (idempotent).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs';
import path from 'node:path';
import { globFiles } from './glob.js';

// Characters that mark a pattern as a glob (anything else is a literal path).
const GLOB_CHARS = /[?*[\]{}()!+@|\\]/;

/** True when the string contains any glob metacharacter. */
function hasGlobChars(pattern) {
  return GLOB_CHARS.test(pattern);
}

/**
 * Remove files and/or directories matching the given pattern(s).
 *
 * Accepts two kinds of input, mixed freely:
 *   - **glob patterns** — same syntax as src() (including negation with `!`),
 *     which match individual files; and
 *   - **literal paths** — a plain directory or file name (no glob characters)
 *     that is removed directly. This is the common `clean('dist')` case, since a
 *     bare directory name matches no files on its own.
 *
 * Directories are removed recursively. Non-existent targets are ignored, so
 * clean() can be called unconditionally at the start of a build (idempotent).
 *
 * @param {string|string[]} patterns Glob pattern(s) and/or literal path(s) to delete. Negate globs with `!`.
 * @param {{ cwd?: string }} [opts]
 *   - cwd: directory patterns resolve against (default process.cwd()).
 * @returns {Promise<string[]>} The absolute paths that were actually removed,
 *   sorted (empty array when nothing matched).
 */
export async function clean(patterns, opts = {}) {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map(String);

  // Files matched by any glob/literal pattern.
  const fileMatches = await globFiles(list, { cwd });

  // Directories named by a literal (non-glob) path. A bare directory matches no
  // files via globFiles, so resolve it explicitly. Negation patterns are skipped.
  const dirTargets = [];
  for (const raw of list) {
    if (raw.startsWith('!') || hasGlobChars(raw)) continue;
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    try {
      const stat = await fs.promises.stat(abs);
      if (stat.isDirectory()) dirTargets.push(abs);
    } catch {
      /* missing target: ignored */
    }
  }

  const targets = [...new Set([...fileMatches, ...dirTargets])].sort();
  const removed = [];
  for (const target of targets) {
    try {
      // recursive: true handles both files and directories; force guards races.
      await fs.promises.rm(target, { recursive: true, force: true });
      removed.push(target);
    } catch (err) {
      throw new Error(`node-build: clean() failed to remove ${target}: ${err.message}`, { cause: err });
    }
  }
  return removed;
}

export default clean;
