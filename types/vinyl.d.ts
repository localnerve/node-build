export type FileClass = () => import('./file.js').File;
export type ResolvedFileClass = {
    /**
     * The file class to use for this project.
     */
    Vinyl: FileClass;
    /**
     * Which implementation was resolved.
     */
    source: 'vinyl' | 'shim';
};
/**
 * Resolve the best available Vinyl-compatible file class for a project: the
 * real `vinyl` package when resolvable from `fromPath`, otherwise the built-in
 * zero-dependency shim. Results are memoised per resolved base path.
 *
 * @param {string} [fromPath] A path inside the consuming project (a build file
 *   or directory); defaults to the current working directory.
 * @returns {Promise<ResolvedFileClass>} The resolved file class entry.
 */
export declare function resolveFileClass(fromPath?: string): Promise<ResolvedFileClass>;
/**
 * Synchronous variant of {@link resolveFileClass} for build files written in
 * CJS-style or sync contexts.
 *
 * @param {string} [fromPath] A path inside the consuming project; defaults to cwd.
 * @returns {ResolvedFileClass} The resolved file class entry.
 */
export declare function resolveFileClassSync(fromPath?: string): ResolvedFileClass;
/** Clear the resolution cache, forcing a re-detection. Mainly useful for tests. @returns {void} */
export declare function clearFileClassCache(): void;
