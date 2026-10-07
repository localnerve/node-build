/**
 * node-build — dependency-free glob.
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

const GLOB_CHARS = /[?*[\]{}()!+@|\\]/;

function isGlobPart(segment) {
  return GLOB_CHARS.test(segment);
}

/**
 * Derive gulp-style `base`: the longest static (non-glob) leading portion of a
 * pattern, resolved against cwd. Mirrors vinyl-fs / glob-stream behavior so that
 * File.base and File.relative match what existing gulp plugins expect.
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
  return isAbs ? path.join('/', ...parts) : path.resolve(cwd, ...parts);
}

/** Expand `{a,b}` brace sets into concrete patterns (no other fancy syntax). */
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

/** Convert a glob pattern into an anchored RegExp (fallback matcher only). */
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

/** Normalize an fs.glob entry (across Node versions) to a cwd-relative path. */
function entryToRel(entry, cwd) {
  let abs;
  if (typeof entry === 'string') {
    abs = path.resolve(cwd, entry);
  } else if (entry && typeof entry.path === 'string') {
    abs = path.isAbsolute(entry.path) ? entry.path : path.resolve(cwd, entry.path);
  } else if (entry && entry.parentPath != null && entry.name != null) {
    abs = path.join(entry.parentPath, entry.name);
    if (!path.isAbsolute(abs)) abs = path.resolve(cwd, abs);
  } else {
    return null;
  }
  const rel = path.relative(cwd, abs);
  return rel && !rel.startsWith('..') ? rel : null;
}

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

/** Fallback: recursive readdir + anchored regex matching. Yields relative paths. */
async function globFallback(positive, negative, cwd) {
  const negRe = negative.map((p) => patternToRegExp(p, cwd));
  const posRe = positive.map((p) => patternToRegExp(p, cwd));

  let entries;
  try {
    entries = await fs.promises.readdir(cwd, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }

  const out = new Set();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Node's recursive readdir reports either `entry.path` (absolute on some
    // versions, relative on others) or just `entry.name` + `entry.parentPath`.
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
 * @param {string|string[]} patterns Glob pattern(s). Negate with a leading `!`.
 * @param {{ cwd?: string }} [opts]
 * @returns {Promise<string[]>} Sorted, de-duplicated absolute file paths.
 */
export async function globFiles(patterns, opts = {}) {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map(String);

  // Expand braces across all patterns first.
  const positive = [];
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
