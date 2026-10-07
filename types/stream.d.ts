import { Readable, Writable, Transform } from 'node:stream';
export type SrcOptions = {
    /**
     * Directory patterns resolve against (default process.cwd()).
     */
    cwd?: string;
    /**
     * Override the derived gulp-style base directory.
     */
    base?: string;
    /**
     * If set, contents are read as strings of this encoding; otherwise Buffers.
     */
    encoding?: BufferEncoding;
    /**
     * Path used to resolve the project's file class (default cwd).
     */
    from?: string;
};
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
export declare function src(patterns: string | string[], opts?: SrcOptions): Readable;
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
export declare function dest(destDir: string, opts?: {
    cwd?: string;
}): Writable;
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
export declare function through(fn: (file: import('./file.js').File) => any): Transform;
/**
 * Wrap raw buffer/string chunks into file-like objects ({ path, contents }) so
 * an object-mode gulp plugin can consume a plain byte stream.
 *
 * @param {string} filePath Label path to attach to each wrapped object.
 * @returns {Transform} readableObjectMode transform.
 */
export declare function wrapFile(filePath: string): Transform;
/**
 * Unwrap file-like objects back to their raw `contents` (Buffer/string) so the
 * output of an object-mode gulp plugin can be written as a plain byte stream.
 *
 * @returns {Transform} writableObjectMode transform.
 */
export declare function unwrapFile(): Transform;
