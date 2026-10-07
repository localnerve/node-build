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

export class File {
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

  get path() {
    return this._path;
  }
  set path(value) {
    value = value == null ? null : (path.isAbsolute(value) ? value : path.resolve(this._cwd, value));
    this._path = value;
    if (value != null && this._history[0] !== value) this._history.unshift(value);
  }

  get base() {
    return this._base;
  }
  set base(value) {
    this._base = value == null ? null : (path.isAbsolute(value) ? value : path.resolve(this._cwd, value));
  }

  /** Path relative to the base directory. */
  get relative() {
    if (this._path == null) return '';
    if (this._base && this._path.startsWith(this._base)) {
      const rel = path.relative(this._base, this._path);
      if (rel && !path.isAbsolute(rel)) return rel;
    }
    return path.basename(this._path);
  }

  get contents() {
    return this._contents;
  }
  set contents(value) {
    this._contents = value == null ? null : value;
  }

  get stat() {
    return this._stat;
  }
  set stat(value) {
    this._stat = value;
  }

  get history() {
    return this._history;
  }

  isBuffer() {
    return Buffer.isBuffer(this._contents);
  }
  isNull() {
    return this._contents == null;
  }
  isStream() {
    return (
      this._contents != null &&
      typeof this._contents.pipe === 'function'
    );
  }
  isSymbolicLink() {
    return Boolean(this._stat && typeof this._stat.isSymbolicLink === 'function' && this._stat.isSymbolicLink());
  }

  /**
   * Produce a copy. Buffer/string contents are copied by value; stream contents
   * cannot be re-read, so the same (single-use) reference is shared — mirroring
   * Vinyl's documented behavior for streamed files.
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
