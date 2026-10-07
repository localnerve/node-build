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
export declare function clean(patterns: string | string[], opts?: {
    cwd?: string;
}): Promise<string[]>;
export default clean;
