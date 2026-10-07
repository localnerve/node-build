/**
 * node-build — Vinyl-compatible file shim.
 * 
 * A minimal, dependency-free file object that is duck-type compatible with the
 * subset of the Vinyl API that gulp plugins actually rely on. When a real `vinyl`
 * package is present in the consuming project, node-build transparently uses
 * that instead (see vinyl.js) for maximum plugin compatibility.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import path from 'node:path';

/**
 * File contents as understood by the Vinyl-compatible surface: a Buffer, a
 * string, a readable byte stream (single-use), or null for "no contents".
 *
 * @typedef {Buffer|string|import('node:stream').Readable|null} Contents
 */

/**
 * Options accepted by the `File` constructor. Relative `path`/`base` values are
 * resolved against `cwd`.
 *
 * @typedef {Object} FileOptions
 * @property {string} [cwd=process.cwd()] Working directory used to resolve relative paths.
 * @property {string|null} [path] Absolute (or cwd-relative) file path. Null for a "null" file.
 * @property {string|null} [base] Base directory; defaults to the file's parent dir when unset.
 * @property {Contents} [contents=null] File contents (buffer, string, stream, or null).
 * @property {import('node:fs').Stats|import('node:fs').Dirent|null} [stat=null] Stat info for the file.
 * @property {string[]} [history] Previous paths; defaults to `[path]` when a path is given.
 */

/**
 * Options accepted by `File.prototype.clone()`. Unset properties are copied
 * from the original file.
 *
 * @typedef {Object} CloneOptions
 * @property {string|null} [path] Override the cloned file's path.
 * @property {string|null} [base] Override the cloned file's base directory.
 * @property {Contents} [contents] Override the cloned file's contents.
 */

/**
 * A minimal, dependency-free Vinyl-compatible file object. Duck-type compatible
 * with the subset of the Vinyl API that gulp plugins rely on: `path`, `base`,
 * `relative`, `contents` (buffer/string/stream/null), `stat`, `history`,
 * `clone()`, and the `is*()` predicates.
 */
export class File {
  /** Working directory used to resolve relative paths. @private @type {string} */
  _cwd;
  /** Absolute path, or null. @private @type {string|null} */
  _path;
  /** Absolute base directory, or null. @private @type {string|null} */
  _base;
  /** File contents. @private @type {Contents} */
  _contents;
  /** Stat info, or null. @private @type {import('node:fs').Stats|import('node:fs').Dirent|null} */
  _stat;
  /** Previous paths, most recent first. @private @type {string[]} */
  _history;

  /**
   * @param {FileOptions} [opts] Constructor options (see {@link FileOptions}).
   */
  constructor(opts = {}) {
    this._cwd = opts.cwd ?? process.cwd();

    // Absolute path. Accepts relative (resolved against cwd) or absolute.
    let p = opts.path;
    if (p != null && !path.isAbsolute(p)) p = path.resolve(this._cwd, p);
    this._path = p ?? null;

    // Base directory (absolute). Defaults to the file's parent dir when unset so
    // that .relative falls back to the basename. src() overrides this with the
    // static prefix of the glob pattern to mirror gulp's base semantics.
    let b = opts.base;
    if (b != null && !path.isAbsolute(b)) b = path.resolve(this._cwd, b);
    this._base = b ?? (p ? path.dirname(p) : null);

    this._contents = opts.contents ?? null;
    this._stat = opts.stat ?? null;
    this._history = Array.isArray(opts.history)
      ? [...opts.history]
      : p != null ? [p] : [];
  }

  /** Absolute file path, or null for a "null" file. @type {string|null} */
  get path() {
    return this._path;
  }
  /**
   * Set the absolute path (relative values are resolved against cwd). New
   * values are unshifted onto `history`.
   *
   * @param {string|null} value The new path.
   */
  set path(value) {
    value = value == null ? null : (path.isAbsolute(value) ? value : path.resolve(this._cwd, value));
    this._path = value;
    if (value != null && this._history[0] !== value) this._history.unshift(value);
  }

  /** Absolute base directory, or null. @type {string|null} */
  get base() {
    return this._base;
  }
  /**
   * Set the base directory (relative values are resolved against cwd).
   *
   * @param {string|null} value The new base directory.
   */
  set base(value) {
    this._base = value == null ? null : (path.isAbsolute(value) ? value : path.resolve(this._cwd, value));
  }

  /**
   * Path relative to the base directory; falls back to the basename when the
   * path is outside the base, and '' for a null file.
   *
   * @type {string}
   */
  get relative() {
    if (this._path == null) return '';
    if (this._base && this._path.startsWith(this._base)) {
      const rel = path.relative(this._base, this._path);
      if (rel && !path.isAbsolute(rel)) return rel;
    }
    return path.basename(this._path);
  }

  /** File contents: buffer, string, readable stream, or null. @type {Contents} */
  get contents() {
    return this._contents;
  }
  /**
   * Set the file contents.
   *
   * @param {Contents} value Contents to store (null clears).
   */
  set contents(value) {
    this._contents = value == null ? null : value;
  }

  /** Stat info for the file, or null. @type {import('node:fs').Stats|import('node:fs').Dirent|null} */
  get stat() {
    return this._stat;
  }
  /**
   * Set the stat info.
   *
   * @param {import('node:fs').Stats|import('node:fs').Dirent|null} value Stat info to store.
   */
  set stat(value) {
    this._stat = value;
  }

  /** Previous paths, most recent first. @type {string[]} */
  get history() {
    return this._history;
  }

  /** True when the contents are a Buffer. @returns {boolean} */
  isBuffer() {
    return Buffer.isBuffer(this._contents);
  }

  /** True when the file has no contents (null). @returns {boolean} */
  isNull() {
    return this._contents == null;
  }

  /** True when the contents are a readable stream. @returns {boolean} */
  isStream() {
    const c = /** @type {{ pipe?: unknown }} */ (this._contents);
    return c != null && typeof c.pipe === 'function';
  }

  /** True when stat info reports the file as a symbolic link. @returns {boolean} */
  isSymbolicLink() {
    return Boolean(this._stat && typeof this._stat.isSymbolicLink === 'function' && this._stat.isSymbolicLink());
  }

  /**
   * Produce a copy. Buffer/string contents are copied by value; stream contents
   * cannot be re-read, so the same (single-use) reference is shared — mirroring
   * Vinyl's documented behavior for streamed files.
   *
   * @param {CloneOptions} [opts] Overrides for path/base/contents.
   * @returns {File} A new File sharing cwd and stat with the original.
   */
  clone(opts = {}) {
    const next = new File({
      cwd: this._cwd,
      path: opts.path ?? this._path,
      base: opts.base ?? this._base,
      contents: opts.contents !== undefined ? opts.contents : this._contents,
      stat: this._stat,
      history: [...this._history],
    });
    return next;
  }

  /**
   * JSON representation. Buffer contents are serialized as UTF-8 strings; all
   * other content types pass through unchanged.
   *
   * @returns {{ path: string|null, base: string|null, relative: string, contents: string|Contents }}
   */
  toJSON() {
    return {
      path: this._path,
      base: this._base,
      relative: this.relative,
      contents: Buffer.isBuffer(this._contents) ? this._contents.toString('utf8') : this._contents,
    };
  }
}

export default File;
