import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable, Transform } from 'node:stream';
import { globFiles, deriveBase } from './glob.js';
import { resolveFileClassSync } from './vinyl.js';

/**
 * Streaming core for node-build.
 *
 * - src()  -> a Readable (object mode) that yields File objects for each file
 *             matching the glob pattern(s). base is derived gulp-style.
 * - dest() -> a Writable (object mode) that writes each File to disk, preserving
 *             its relative path under the destination directory.
 * - through(fn) -> an object-mode Transform for writing native build steps.
 *
 * The runner stays free of vinyl: it uses whatever file class resolves for the
 * project (real vinyl if present, otherwise the built-in shim).
 */

/** Build a File instance using the project's resolved file class. */
function makeFile(fromPath) {
  const { Vinyl } = resolveFileClassSync(fromPath);
  return new Vinyl();
}

async function* fileGenerator(patterns, opts, cwd) {
  const files = await globFiles(patterns, { cwd });
  const base = opts.base ? path.resolve(cwd, opts.base) : deriveBase(patterns[0], cwd);

  for (const file of files) {
    let contents;
    try {
      contents = opts.encoding
        ? await fs.promises.readFile(file, opts.encoding)
        : await fs.promises.readFile(file);
    } catch (err) {
      throw new Error(`node-build: failed to read ${file}: ${err.message}`);
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
 * @param {{ cwd?: string, base?: string, encoding?: BufferEncoding }} [opts]
 *   - cwd: directory patterns resolve against (default process.cwd()).
 *   - base: override the derived gulp-style base directory.
 *   - encoding: if set, file contents are read as strings of this encoding;
 *     otherwise contents are Buffers (matches gulp's default).
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
          await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(target);
            ws.on('error', reject);
            ws.on('finish', resolve);
            file.contents.pipe(ws);
          });
        } else {
          await fs.promises.writeFile(target, file.contents ?? Buffer.alloc(0));
        }
        // Reflect the final location back on mutable File objects.
        if ('path' in file && typeof file.path === 'string') file.path = target;
        callback();
      } catch (err) {
        callback(err);
      }
    },
  });
}

/**
 * Create an object-mode Transform from a user function, for native build steps.
 *
 * The function receives each File and may:
 *   - return a new File to push downstream, or
 *   - mutate the incoming File in place and return nothing (it is re-pushed), or
 *   - return null/undefined to drop the file, or
 *   - return an array of Files to emit multiple outputs.
 * Async functions are supported.
 *
 * @param {(file: any) => any} fn Per-file transform function.
 * @returns {Transform} Object-mode transform.
 */
export function through(fn) {
  return new Transform({
    objectMode: true,
    async transform(file, _enc, callback) {
      try {
        const result = await fn(file);
        if (result == null) return callback();
        if (Array.isArray(result)) for (const f of result) this.push(f);
        else this.push(result);
        callback();
      } catch (err) {
        callback(err);
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
    transform(fileObj, _enc, done) {
      this.push(fileObj.contents);
      done();
    },
  });
}
