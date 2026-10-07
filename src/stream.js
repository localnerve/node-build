/**
 * node-build — streaming core.
 * 
 * src() yields File objects matching glob patterns; dest() writes them to disk;
 * through(fn) provides an object-mode Transform for native build steps. The
 * runner stays free of vinyl, using whatever file class resolves for the project.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable, Transform } from 'node:stream';
import { globFiles, deriveBase } from './glob.js';
import { resolveFileClassSync } from './vinyl.js';

/**
 * Options for {@link src}.
 *
 * @typedef {Object} SrcOptions
 * @property {string} [cwd] Directory patterns resolve against (default process.cwd()).
 * @property {string} [base] Override the derived gulp-style base directory.
 * @property {BufferEncoding} [encoding] If set, contents are read as strings of this encoding; otherwise Buffers.
 * @property {string} [from] Path used to resolve the project's file class (default cwd).
 */

/**
 * Build a File instance using the project's resolved file class.
 *
 * @param {string} fromPath A path inside the consuming project.
 * @returns {import('./file.js').File} An empty File of the resolved class.
 */
function makeFile(fromPath) {
  const { Vinyl } = resolveFileClassSync(fromPath);
  // Vinyl is a class (constructible); cast since the typedef models it callably.
  return /** @type {any} */ (new (/** @type {any} */ (Vinyl))());
}

/**
 * Async generator yielding a File per matched glob result, reading contents
 * from disk. Warns when positive patterns match nothing.
 *
 * @param {string[]} patterns Concrete (non-negated-aware) pattern list.
 * @param {SrcOptions} opts Options as passed to src().
 * @param {string} cwd Resolved base directory.
 */
async function* fileGenerator(patterns, opts, cwd) {
  const files = await globFiles(patterns, { cwd });
  // Surface a likely typo early: a positive pattern that matches nothing would
  // otherwise produce a "successful" no-op stream that is hard to debug.
  const hasPositivePattern = patterns.some((p) => !String(p).startsWith('!'));
  if (!files.length && hasPositivePattern) {
    console.warn(`node-build: src() matched no files for pattern(s): ${patterns.join(', ')}`);
  }
  const base = opts.base ? path.resolve(cwd, opts.base) : deriveBase(patterns[0], cwd);

  for (const file of files) {
    let contents;
    try {
      contents = opts.encoding
        ? await fs.promises.readFile(file, opts.encoding)
        : await fs.promises.readFile(file);
    } catch (cause) {
      const err = /** @type {Error} */ (cause);
      throw new Error(`node-build: failed to read ${file}: ${err.message}`, { cause });
    }
    const f = makeFile(opts.from ?? cwd);
    f.path = file;
    f.base = base;
    f.contents = contents;
    yield f;
  }
}

/**
 * Create a readable stream of File objects for the given glob pattern(s).
 *
 * Backed by Readable.from(asyncGenerator) so backpressure is respected and each
 * file is read exactly once.
 *
 * @param {string|string[]} patterns Glob pattern(s), negation via `!`.
 * @param {SrcOptions} [opts] See {@link SrcOptions}.
 * @returns {Readable} Object-mode readable of File objects.
 */
export function src(patterns, opts = {}) {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  return Readable.from(fileGenerator(patternList, opts, cwd), { objectMode: true });
}

/**
 * Create a writable stream that writes File objects to disk under `destDir`.
 * Each file is written to `path.join(destDir, file.relative)`, creating parent
 * directories as needed. Buffer and string contents are supported; streamed
 * contents are piped through.
 *
 * @param {string} destDir Destination directory (absolute or cwd-relative).
 * @param {{ cwd?: string }} [opts]
 * @returns {Writable} Object-mode writable of File objects.
 */
export function dest(destDir, opts = {}) {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const outDir = path.resolve(cwd, destDir);

  return new Writable({
    objectMode: true,
    async write(file, _enc, callback) {
      try {
        const target = path.join(outDir, file.relative || path.basename(file.path));
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        if (file.isStream()) {
          // Pipe streamed contents to disk.
          const ws = fs.createWriteStream(target);
          try {
            await new Promise((resolve, reject) => {
              ws.on('error', reject);
              ws.on('finish', () => resolve(true));
              file.contents.pipe(ws);
            });
          } finally {
            ws.close();
          }
        } else {
          await fs.promises.writeFile(target, file.contents ?? Buffer.alloc(0));
        }
        // Reflect the final location back on mutable File objects.
        if ('path' in file && typeof file.path === 'string') file.path = target;
        callback();
      } catch (cause) {
        callback(/** @type {Error} */ (cause));
      }
    },
  });
}

/**
 * Validate that a through() transform emitted something downstream can consume:
 * a File-like object (string `path`), or return it unchanged. Anything else is
 * almost certainly a bug, so fail fast with an actionable message instead of
 * surfacing later as an obscure error at dest().
 *
 * @param {any} value The pushed value.
 * @param {string} context Label for the error message (e.g. 'through()').
 * @returns {any} The validated value, unchanged.
 * @throws {TypeError} When the value is not File-like.
 */
function assertFileLike(value, context) {
  if (value != null && typeof value === 'object' && typeof value.path === 'string') return value;
  throw new TypeError(
    `${context} expected a File (an object with a string ".path"), an array of Files, ` +
    `or null/undefined to drop the file. Got: ${describeValue(value)}.`,
  );
}

/** Compact human-readable description of a value for error messages. @param {any} value @returns {string} */
function describeValue(value) {
  if (value == null) return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  const t = typeof value;
  if (t === 'object') return `${t} { ${Object.keys(value).slice(0, 5).join(', ')} }`;
  return t;
}

/**
 * Create an object-mode Transform from a user function, for native build steps.
 *
 * The function receives each File and may:
 *   - return a new File to push downstream, or
 *   - mutate the incoming File in place and return nothing (it is re-pushed), or
 *   - return null/undefined to drop the file, or
 *   - return an array of Files to emit multiple outputs.
 * Async functions are supported. Pushed values must be File-like (string `path`)
 * or through() throws a clear error.
 *
 * @param {(file: import('./file.js').File) => any} fn Per-file transform function.
 * @returns {Transform} Object-mode transform.
 */
export function through(fn) {
  return new Transform({
    objectMode: true,
    async transform(file, _enc, callback) {
      try {
        const result = await fn(file);
        if (result == null) return callback(); // drop the file
        if (Array.isArray(result)) {
          for (const f of result) this.push(assertFileLike(f, 'through()'));
        } else {
          this.push(assertFileLike(result, 'through()'));
        }
        callback();
      } catch (cause) {
        callback(/** @type {Error} */ (cause));
      }
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Raw-buffer <-> file-object bridge helpers (the csp-hashes pattern).         */
/* These let plain Node.js byte streams feed gulp plugins without vinyl.       */
/* -------------------------------------------------------------------------- */

/**
 * Wrap raw buffer/string chunks into file-like objects ({ path, contents }) so
 * an object-mode gulp plugin can consume a plain byte stream.
 *
 * @param {string} filePath Label path to attach to each wrapped object.
 * @returns {Transform} readableObjectMode transform.
 */
export function wrapFile(filePath) {
  return new Transform({
    readableObjectMode: true,
    writableObjectMode: false,
    construct(callback) {
      callback();
    },
    transform(chunk, _enc, done) {
      this.push({ path: filePath, contents: chunk });
      done();
    },
  });
}

/**
 * Unwrap file-like objects back to their raw `contents` (Buffer/string) so the
 * output of an object-mode gulp plugin can be written as a plain byte stream.
 *
 * @returns {Transform} writableObjectMode transform.
 */
export function unwrapFile() {
  return new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    construct(callback) {
      callback();
    },
    /** @param {{ contents?: any }} fileObj A file-like object. */
    transform(fileObj, _enc, done) {
      this.push(fileObj.contents);
      done();
    },
  });
}
