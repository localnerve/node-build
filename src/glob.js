/**
 * node-build-stream — dependency-free glob.
 * 
 * Prefers the built-in `node:fs` glob when available; falls back to
 * `fs.readdir({ recursive: true })` + a small matcher otherwise. Supports
 * arrays of patterns and negation via a leading `!`.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs';
import path from 'node:path';

const hasFsGlob = typeof fs.glob === 'function';

/**
 * Options for glob resolution functions.
 *
 * @typedef {Object} GlobOptions
 * @property {string} [cwd=process.cwd()] Directory patterns are resolved against.
 */

/**
 * The shape of a single `fs.glob` entry, which varies across Node versions:
 * a plain string path, an object with `.path`, or `{name, parentPath}` (Node 24,
 * optionally carrying `isFile()`).
 *
 * @typedef {string|{ path?: string }|{ name: string, parentPath?: string|null, isFile?: () => boolean }} GlobEntry
 */

const GLOB_CHARS = /[?*[\]{}()!+@|\\]/;

/** True when a path segment contains any glob metacharacter. @param {string} segment @returns {boolean} */
function isGlobPart(segment) {
  return GLOB_CHARS.test(segment);
}

/**
 * Derive gulp-style `base`: the longest static (non-glob) leading portion of a
 * pattern, resolved against cwd. Mirrors vinyl-fs / glob-stream behavior so that
 * File.base and File.relative match what existing gulp plugins expect.
 *
 * @param {string} pattern A single glob pattern.
 * @param {string} [cwd=process.cwd()] Directory the pattern is relative to.
 * @returns {string} The absolute base directory (or '/' for absolute patterns with no static segments).
 */
export function deriveBase(pattern, cwd) {
  const norm = String(pattern).replace(/\\/g, '/');
  const isAbs = norm.startsWith('/');
  // Drop empty and '.' segments (leading root of absolute paths, double slashes).
  const segments = norm.split('/').filter((s) => s !== '' && s !== '.');
  let staticDepth = 0;
  for (const seg of segments) {
    if (seg === '**' || isGlobPart(seg)) break;
    staticDepth += 1;
  }
  // If the pattern ends in a plain filename segment (no glob chars), that last
  // segment names the file itself, not a directory — exclude it from base.
  if (staticDepth > 0 && segments.length === staticDepth) {
    const last = segments[segments.length - 1];
    if (last && !isGlobPart(last)) staticDepth -= 1;
  }
  const parts = segments.slice(0, Math.max(staticDepth, 0));
  // Preserve the leading slash for absolute patterns.
  return isAbs ? path.join('/', ...parts) : path.resolve(cwd ?? process.cwd(), ...parts);
}

/**
 * Expand `{a,b}` brace sets into concrete patterns (no other fancy syntax).
 *
 * @param {string} pattern A glob pattern that may contain one level of braces per segment.
 * @returns {string[]} The expanded patterns; `[pattern]` when no braces are present.
 */
function expandBraces(pattern) {
  const m = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!m) return [pattern];
  const [, pre, group, post] = m;
  const out = [];
  for (const opt of group.split(',')) {
    for (const suffix of expandBraces(post)) {
      out.push(pre + opt + suffix);
    }
  }
  return out.length ? out : [pattern];
}

/**
 * Convert a glob pattern into an anchored RegExp (fallback matcher only).
 *
 * @param {string} pattern A single glob pattern (no negation prefix).
 * @param {string} cwd Directory the relative pattern is resolved against.
 * @returns {RegExp} An anchorless-prefix RegExp matching absolute paths.
 */
function patternToRegExp(pattern, cwd) {
  // Normalize and anchor against cwd.
  let p = String(pattern).replace(/\\/g, '/');
  if (!p.startsWith('/')) p = path.resolve(cwd).replace(/\\/g, '/') + '/' + p;

  const re = p
    .replace(/[.+^${}()|[\]\\]/g, (ch) => {
      // Leave the sequence markers we translate below alone.
      if (['*', '?'].includes(ch)) return ch;
      return '\\' + ch;
    })
    .replace(/\*\*\//g, '§RECURSIVE§')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/§RECURSIVE§/g, '(?:[^/]+/)*');

  return new RegExp(`^${re}$`);
}

/**
 * Normalize an `fs.glob` entry (across Node versions) to a cwd-relative path.
 *
 * @param {GlobEntry} entry A raw fs.glob result entry.
 * @param {string} cwd The base directory for relative results.
 * @returns {string|null} The cwd-relative path, or null if the entry is unrecognized.
 */
function entryToRel(entry, cwd) {
  // Duck-typed across Node versions; cast for property access.
  const e = /** @type {{ path?: unknown, name?: string, parentPath?: string|null }} */ (entry);
  let abs;
  if (typeof entry === 'string') {
    abs = path.resolve(cwd, entry);
  } else if (e && typeof e.path === 'string') {
    abs = path.isAbsolute(e.path) ? e.path : path.resolve(cwd, e.path);
  } else if (e && e.parentPath != null && e.name != null) {
    abs = path.join(e.parentPath, e.name);
    if (!path.isAbsolute(abs)) abs = path.resolve(cwd, abs);
  } else {
    return null;
  }
  const rel = path.relative(cwd, abs);
  return rel && !rel.startsWith('..') ? rel : null;
}

/**
 * Run `fs.glob` over a pattern list and return cwd-relative file paths (files
 * only, de-duplicated). Plain-string entries are stat-verified.
 *
 * @param {string[]} patterns Concrete (brace-expanded) patterns, no negation.
 * @param {string} cwd The base directory for the glob.
 * @returns {Promise<string[]>} Cwd-relative file paths.
 */
async function runFsGlob(patterns, cwd) {
  if (!patterns.length) return [];
  const files = await new Promise((resolve, reject) => {
    fs.glob(patterns, { cwd, withFileTypes: true }, (err, list) => {
      if (err) reject(err);
      else resolve(list);
    });
  });

  const rels = [];
  for (const entry of files) {
    // Object entries expose isFile(); plain strings must be verified.
    if (entry && typeof entry === 'object' && typeof entry.isFile === 'function') {
      if (!entry.isFile()) continue;
    } else {
      const full = path.resolve(cwd, entry);
      let st;
      try {
        st = await fs.promises.stat(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
    }
    const rel = entryToRel(entry, cwd);
    if (rel) rels.push(rel);
  }
  return [...new Set(rels)];
}

/**
 * Fallback matcher: recursive `readdir` + anchored regex matching. Used when
 * `fs.glob` is unavailable or throws.
 *
 * @param {string[]} positive Concrete positive patterns.
 * @param {string[]} negative Concrete negation patterns (without the `!`).
 * @param {string} cwd Directory to scan; ENOENT yields an empty result.
 * @returns {Promise<string[]>} Cwd-relative file paths.
 */
async function globFallback(positive, negative, cwd) {
  const negRe = negative.map((p) => patternToRegExp(p, cwd));
  const posRe = positive.map((p) => patternToRegExp(p, cwd));

  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = await fs.promises.readdir(cwd, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (/** @type {any} */ (err).code === 'ENOENT') return [];
    throw err;
  }

  const out = new Set();
  for (const raw of entries) {
    if (!raw.isFile()) continue;
    // Node's recursive readdir reports either `entry.path` (absolute on some
    // versions, relative on others) or just `entry.name` + `entry.parentPath`.
    const entry = /** @type {{ name: string, parentPath?: string|null, path?: string }} */ (raw);
    let abs = typeof entry.path === 'string' && entry.path.length
      ? entry.path
      : path.join(entry.parentPath ?? '', entry.name);
    if (!path.isAbsolute(abs)) abs = path.resolve(cwd, abs);
    const full = abs.replace(/\\/g, '/');
    if (negRe.some((re) => re.test(full))) continue;
    if (posRe.some((re) => re.test(full))) out.add(path.relative(cwd, abs));
  }
  return [...out];
}

/**
 * Resolve a list of glob patterns (with negation) to absolute file paths.
 *
 * Prefers the built-in `fs.glob` (files only); falls back to recursive readdir
 * + regex matching when unavailable or on error. Brace sets `{a,b}` are expanded.
 *
 * @param {string|string[]} patterns Glob pattern(s). Negate with a leading `!`.
 * @param {GlobOptions} [opts] Resolution options.
 * @returns {Promise<string[]>} Sorted, de-duplicated absolute file paths.
 */
export async function globFiles(patterns, opts = {}) {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map(String);

  // Expand braces across all patterns first.
  /** @type {string[]} */
  const positive = [];
  /** @type {string[]} */
  const negative = [];
  for (const raw of list) {
    const target = raw.startsWith('!') ? negative : positive;
    for (const expanded of expandBraces(raw.replace(/^!/, ''))) {
      target.push(expanded);
    }
  }

  let rels;
  if (hasFsGlob && positive.length) {
    try {
      const negSet = new Set(await runFsGlob(negative, cwd));
      rels = (await runFsGlob(positive, cwd)).filter((rel) => !negSet.has(rel));
    } catch {
      rels = await globFallback(positive, negative, cwd);
    }
  } else {
    rels = await globFallback(positive, negative, cwd);
  }

  return [...new Set(rels.map((r) => path.resolve(cwd, r)))].sort();
}

export default globFiles;
