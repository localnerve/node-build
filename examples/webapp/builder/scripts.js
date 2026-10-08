/**
 * Scripts stage — the ASYNC (non-stream) showcase of the webapp example.
 * 
 * Bundles the client entry with Rollup into a single browser file and injects
 * build-time environment values: every `process.env.<KEY>` reference in the
 * emitted chunk is replaced with the literal JSON value from `env` before the
 * file is written, so the shipped bundle contains no runtime env lookup.
 * 
 * This stage returns a Promise (not a stream) — one of the two task shapes
 * node-build supports, shown here deliberately for contrast with styles.js.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * A Rollup plugin that replaces `process.env.<KEY>` tokens with literal JSON
 * values taken from an env map (a minimal, dependency-free stand-in for
 * @rollup/plugin-replace). Keys absent from the map are left untouched. The
 * `this.parse(code)` map keeps dev sourcemaps accurate after replacement.
 *
 * @param {Record<string, string|number|boolean>} env The build-time environment values.
 * @returns {{ name: string, transform: (code: string) => ({ code: string, map: unknown } | null) }} A Rollup plugin object.
 */
function envInject (env) {
  return {
    name: 'env-inject',
    /**
     * Replace env tokens in each module before bundling.
     *
     * @param {string} code Module source.
     * @this {{ parse: (code: string) => unknown }} Rollup plugin context.
     * @returns {{ code: string, map: unknown } | null} Replacement result, or null when nothing changed.
     */
    transform (code) {
      let out = code;
      for (const [key, value] of Object.entries(env)) {
        const token = `process.env.${key}`;
        if (out.includes(token)) {
          out = out.split(token).join(JSON.stringify(value));
        }
      }
      return out === code ? null : { code: out, map: this.parse(out) };
    },
  };
}

/**
 * Build the scripts stage task.
 *
 * @param {import('./settings.js').WebappSettings} settings Resolved build settings.
 * @param {Record<string, string|number|boolean>} [env] Environment values to inject;
 *   defaults to `{ NODE_ENV: 'production' | 'development' }` from `settings.prod`.
 * @returns {() => Promise<void>} A zero-arg async task function (no stream).
 */
export function createScriptsStage (settings, env) {
  const outFile = path.join(settings.dist, 'assets', 'js', `${settings.jsEntry.replace(/\.js$/, '')}.js`);
  const resolvedEnv = /** @type {Record<string, string|number|boolean>} */ (
    env ?? { NODE_ENV: settings.prod ? 'production' : 'development' }
  );

  return async function scriptsStage () {
    // `rollup` is a recipe dependency of this EXAMPLE, not of node-build.
    const { rollup } = await import('rollup');
    const bundle = await rollup({
      input: path.join(settings.srcClient, settings.jsEntry),
      plugins: [envInject(resolvedEnv)],
    });
    // Rollup does not minify natively — terser is a recipe dep the example
    // could add; this example keeps its bundle readable and relies on env
    // injection + iife output for the production shape.
    const { output } = await bundle.generate({
      format: 'iife',
      name: 'webapp',
      sourcemap: !settings.prod,
    });
    const chunk = /** @type {{ code: string }} */ (output[0]);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, chunk.code);
    if (chunk.map) {
      await fs.writeFile(`${outFile}.map`, JSON.stringify(chunk.map));
    }
    await bundle.close();
  };
}
