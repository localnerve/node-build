export type GlobOptions = {
    /**
     * Directory patterns are resolved against.
     */
    cwd?: string;
};
export type GlobEntry = string | {
    path?: string;
} | {
    name: string;
    parentPath?: string | null;
    isFile?: () => boolean;
};
/**
 * Derive gulp-style `base`: the longest static (non-glob) leading portion of a
 * pattern, resolved against cwd. Mirrors vinyl-fs / glob-stream behavior so that
 * File.base and File.relative match what existing gulp plugins expect.
 *
 * @param {string} pattern A single glob pattern.
 * @param {string} [cwd=process.cwd()] Directory the pattern is relative to.
 * @returns {string} The absolute base directory (or '/' for absolute patterns with no static segments).
 */
export declare function deriveBase(pattern: string, cwd?: string): string;
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
export declare function globFiles(patterns: string | string[], opts?: GlobOptions): Promise<string[]>;
export default globFiles;
