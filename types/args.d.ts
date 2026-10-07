/**
 * node-build — command line argument parsing for build files.
 *
 * A small, dependency-free parser that turns `--name value` / `--flag` pairs into
 * a plain object so build files can branch on user-supplied switches without
 * hand-rolling argv logic (previously this lived as a snippet in the example).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
/**
 * Parse command line arguments of the form `--name value` into an object.
 *
 * Rules:
 *   - A token starting with `-` or `--` is a **name**; it maps to `true` unless a
 *     following non-dash token supplies a value (which then replaces the `true`).
 *   - A token that does not start with `-` is treated as the **value** of the
 *     most recent name, if any.
 *   - The leading dashes are stripped from names (`-a`, `--a`, and `---a` all
 *     become `a`), so both short and long flag styles work.
 *
 * Example:
 *   parseArgs(['build', '--minify', '--target', 'staging', '-v'])
 *   // -> { build: true, minify: true, target: 'staging', v: true }
 *
 * @param {string[]} argList Argument list (pass `process.argv` or a slice of it).
 * @returns {Record<string, string|boolean>} The parsed arguments as an object.
 */
export declare function parseArgs(argList: string[]): Record<string, string | boolean>;
export default parseArgs;
