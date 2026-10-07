export type Contents = Buffer | string | import('node:stream').Readable | null;
export type FileOptions = {
    /**
     * Working directory used to resolve relative paths.
     */
    cwd?: string;
    /**
     * Absolute (or cwd-relative) file path. Null for a "null" file.
     */
    path?: string | null;
    /**
     * Base directory; defaults to the file's parent dir when unset.
     */
    base?: string | null;
    /**
     * File contents (buffer, string, stream, or null).
     */
    contents?: Contents;
    /**
     * Stat info for the file.
     */
    stat?: import('node:fs').Stats | import('node:fs').Dirent | null;
    /**
     * Previous paths; defaults to `[path]` when a path is given.
     */
    history?: string[];
};
export type CloneOptions = {
    /**
     * Override the cloned file's path.
     */
    path?: string | null;
    /**
     * Override the cloned file's base directory.
     */
    base?: string | null;
    /**
     * Override the cloned file's contents.
     */
    contents?: Contents;
};
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
export declare class File {
    /** Working directory used to resolve relative paths. @private @type {string} */
    private _cwd;
    /** Absolute path, or null. @private @type {string|null} */
    private _path;
    /** Absolute base directory, or null. @private @type {string|null} */
    private _base;
    /** File contents. @private @type {Contents} */
    private _contents;
    /** Stat info, or null. @private @type {import('node:fs').Stats|import('node:fs').Dirent|null} */
    private _stat;
    /** Previous paths, most recent first. @private @type {string[]} */
    private _history;
    /**
     * @param {FileOptions} [opts] Constructor options (see {@link FileOptions}).
     */
    constructor(opts?: FileOptions);
    /** Absolute file path, or null for a "null" file. @type {string|null} */
    get path(): string | null;
    /**
     * Set the absolute path (relative values are resolved against cwd). New
     * values are unshifted onto `history`.
     *
     * @param {string|null} value The new path.
     */
    set path(value: string | null);
    /** Absolute base directory, or null. @type {string|null} */
    get base(): string | null;
    /**
     * Set the base directory (relative values are resolved against cwd).
     *
     * @param {string|null} value The new base directory.
     */
    set base(value: string | null);
    /**
     * Path relative to the base directory; falls back to the basename when the
     * path is outside the base, and '' for a null file.
     *
     * @type {string}
     */
    get relative(): string;
    /** File contents: buffer, string, readable stream, or null. @type {Contents} */
    get contents(): Contents;
    /**
     * Set the file contents.
     *
     * @param {Contents} value Contents to store (null clears).
     */
    set contents(value: Contents);
    /** Stat info for the file, or null. @type {import('node:fs').Stats|import('node:fs').Dirent|null} */
    get stat(): import('node:fs').Stats | import('node:fs').Dirent | null;
    /**
     * Set the stat info.
     *
     * @param {import('node:fs').Stats|import('node:fs').Dirent|null} value Stat info to store.
     */
    set stat(value: import('node:fs').Stats | import('node:fs').Dirent | null);
    /** Previous paths, most recent first. @type {string[]} */
    get history(): string[];
    /** True when the contents are a Buffer. @returns {boolean} */
    isBuffer(): boolean;
    /** True when the file has no contents (null). @returns {boolean} */
    isNull(): boolean;
    /** True when the contents are a readable stream. @returns {boolean} */
    isStream(): boolean;
    /** True when stat info reports the file as a symbolic link. @returns {boolean} */
    isSymbolicLink(): boolean;
    /**
     * Produce a copy. Buffer/string contents are copied by value; stream contents
     * cannot be re-read, so the same (single-use) reference is shared — mirroring
     * Vinyl's documented behavior for streamed files.
     *
     * @param {CloneOptions} [opts] Overrides for path/base/contents.
     * @returns {File} A new File sharing cwd and stat with the original.
     */
    clone(opts?: CloneOptions): File;
    /**
     * JSON representation. Buffer contents are serialized as UTF-8 strings; all
     * other content types pass through unchanged.
     *
     * @returns {{ path: string|null, base: string|null, relative: string, contents: string|Contents }}
     */
    toJSON(): {
        path: string | null;
        base: string | null;
        relative: string;
        contents: string | Contents;
    };
}
export default File;
