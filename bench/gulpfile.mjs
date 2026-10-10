/**
 * The GULP side of the node-build-stream benchmark — a faithful, idiomatic gulp
 * pipeline that does the SAME work as `examples/webapp`'s nbs build, so the two
 * runners are comparable. It reads the webapp's source tree (../examples/webapp/src)
 * and writes to its OWN output dir (`bench/dist-gulp`, gitignored) so it never
 * clobbers the example's real `dist/`.
 *
 * Stage parity with examples/webapp/builder/*:
 *
 *   clean    — rm -rf dist-gulp (nbs: clean())
 *      │
 *      ├── styles   src(site.scss) → sass → postcss+autoprefixer → write css  (stream)
 *      ├── scripts  rollup IIFE bundle + env injection                       (async)  ── parallel
 *      └── assets   robots/llms/security/sitemap/hbs pages                   (async)
 *      │
 *   revision — fingerprint assets + rewrite refs + merge manifest            (stream)
 *
 * The transform logic is ported verbatim from the nbs stages; only the
 * orchestration/streaming primitive differs (gulp src/series/parallel vs
 * node-build-stream). That isolates the framework variable the bench measures.
 *
 * Run with cwd=bench:  `gulp`   (the default task below is the prod-equivalent build,
 * revision on — matching how the harness invokes `nbs --prod`).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { src, series, parallel } from 'gulp';
// Build plugins are imported statically at module scope — NOT dynamically inside
// tasks/transforms. A dynamic `await import()` inside a gulp stream transform hangs
// under gulp's domain-wrapped task runner; loading here resolves them during
// gulpfile evaluation (outside any task domain), exactly when every real gulp project
// pays its plugin-load cost.
import * as sass from 'sass';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import { rollup } from 'rollup';
import Handlebars from 'handlebars';
import { SitemapStream } from 'sitemap';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ---------------------------------------------------------------------------
// Paths — resolved from this file so the build is cwd-independent.
// ---------------------------------------------------------------------------
const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBAPP_DIR = path.resolve(BENCH_DIR, '..', 'examples', 'webapp');

const SRC_CLIENT = path.join(WEBAPP_DIR, 'src', 'client');
const SRC_STYLES = path.join(WEBAPP_DIR, 'src', 'styles');
const SRC_TEMPLATES = path.join(WEBAPP_DIR, 'src', 'templates');
const DATA_FILE = path.join(WEBAPP_DIR, 'src', 'data', 'site.json');

// This benchmark task is the production-equivalent build (fingerprinting on),
// mirroring `nbs --prod`.
const PROD = true;
const DIST = path.join(BENCH_DIR, 'dist-gulp');
const ASSETS = path.join(DIST, 'assets');
const JS_ENTRY = 'main.js';
const SASS_ENTRY = 'site.scss';

// Site data is loaded once at gulpfile-eval time (during gulp's startup window),
// matching how the nbs build.mjs reads it before running the pipeline.
const siteData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

/** Fixed hash length used in fingerprinted filenames (matches nbs revision.js). */
const HASH_LEN = 10;

/**
 * Short SHA-256 hex digest of a buffer/string.
 *
 * @param {Buffer|string} buf The bytes to hash.
 * @returns {string} A 10-hex-char content hash.
 */
function contentHash (buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, HASH_LEN);
}

/**
 * Replace every occurrence of each reference token in a string.
 *
 * @param {string} text The source text.
 * @param {Record<string, string>} refs Token → replacement map.
 * @returns {string} The rewritten text.
 */
function replaceAllTokens (text, refs) {
  let out = text;
  for (const [token, replacement] of Object.entries(refs)) {
    if (out.includes(token)) out = out.split(token).join(replacement);
  }
  return out;
}

/**
 * Wrap an async per-file function into an object-mode Transform stream so it can
 * be used with gulp's `.pipe()` — the gulp-side equivalent of nbs `through()`.
 * Returning null/undefined from fn drops that file from the stream.
 *
 * @template T
 * @param {(file: T) => (T | null | undefined) | Promise<T | null | undefined>} fn Per-file transform.
 * @returns {Transform} An object-mode Transform stream.
 */
function through (fn) {
  return new Transform({
    objectMode: true,
    highWaterMark: 16,
    /**
     * @param {unknown} file A Vinyl file chunk.
     * @param {string} _enc Encoding (unused).
     * @param {(err?: Error) => void} done Signal completion for this chunk.
     */
    transform (file, _enc, done) {
      Promise.resolve(fn(file))
        .then((out) => {
          if (out !== null && out !== undefined) this.push(out);
          done();
        })
        .catch(done);
    },
  });
}

/**
 * A consuming object-mode Writable sink. The write-transforms already persist
 * their output to disk as a side effect and pass the file through; ending each
 * pipeline in a sink means gulp can await a real `finish` on the returned stream
 * (a Transform that pushes nothing never emits `end`).
 *
 * @returns {Writable} An object-mode Writable that discards everything.
 */
function sink () {
  return new Writable({
    objectMode: true,
    write (_chunk, _enc, done) { done(); },
  });
}

/**
 * Await a (non-thenable) Node stream's completion — resolves on `finish`/`end`,
 * rejects on `error`. Needed inside async tasks because `await someStream` does NOT
 * wait for a stream to finish (streams aren't thenables); without this the next
 * revision pass would start before the previous one's transforms have written out.
 *
 * @param {import('node:stream').Stream} stream The stream to await.
 * @returns {Promise<void>} Resolves once the stream has finished.
 */
function streamDone (stream) {
  return new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('end', resolve);
    stream.once('error', reject);
  });
}

// ---------------------------------------------------------------------------
// clean — wipe dist-gulp so revision never sees stale fingerprints.
// ---------------------------------------------------------------------------
/**
 * Remove the whole dist-gulp directory (idempotent; safe on first run).
 *
 * @returns {Promise<void>} Resolves once the directory is gone.
 */
async function clean () {
  await fsp.rm(DIST, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// styles — stream: src(site.scss) → sass → postcss+autoprefixer → write css.
// ---------------------------------------------------------------------------
/**
 * Build the styles task (a vinyl stream). Emits dist-gulp/assets/css/site.css.
 *
 * @returns {import('node:stream').Readable} The compiled-CSS pipeline.
 */
function styles () {
  const outFile = path.join(ASSETS, 'css', SASS_ENTRY.replace(/\.scss$/, '') + '.css');
  return src(path.join(SRC_STYLES, SASS_ENTRY))
    .pipe(through(sassCompile()))
    .pipe(through(postcssRun()))
    .pipe(through(writeOut(outFile)))
    .pipe(sink());
}

/**
 * Vinyl transform: compile SCSS source (string) to CSS.
 *
 * @returns {(file: import('vinyl').File) => Promise<import('vinyl').File>} The through callback.
 */
function sassCompile () {
  return function compileSass (file) {
    if (file.contents == null) throw new Error(`styles: no contents for ${SASS_ENTRY}`);
    const source = typeof file.contents === 'string' ? file.contents : /** @type {Buffer} */ (file.contents).toString('utf8');
    const result = sass.compileString(source, { syntax: 'scss', sourceMap: false });
    file.contents = Buffer.from(result.css); // vinyl contents must be a Buffer, not a string
    return file;
  };
}

/**
 * Vinyl transform: run compiled CSS through PostCSS with autoprefixer.
 *
 * @returns {(file: import('vinyl').File) => Promise<import('vinyl').File>} The through callback.
 */
function postcssRun () {
  return async function runPostcss (file) {
    if (file.contents == null) throw new Error('styles: no contents from the sass transform');
    const cssIn = typeof file.contents === 'string' ? file.contents : /** @type {Buffer} */ (file.contents).toString('utf8');
    const processor = postcss([autoprefixer()]);
    const result = await processor.process(cssIn, { from: undefined });
    file.contents = Buffer.from(result.css); // vinyl contents must be a Buffer, not a string
    return file;
  };
}

/**
 * Vinyl transform: write the final CSS to its deterministic output path and drop
 * the file (nothing downstream needs it) — mirrors nbs styles.js `writeOut`.
 *
 * @param {string} outFile Absolute path of the compiled stylesheet.
 * @returns {(file: import('vinyl').File) => Promise<import('vinyl').File>} The through callback.
 */
function writeOut (outFile) {
  return async function writeCss (file) {
    await fsp.mkdir(path.dirname(outFile), { recursive: true });
    await fsp.writeFile(outFile, file.contents);
    return file; // written to disk; pass through so the pipeline can complete
  };
}

// ---------------------------------------------------------------------------
// scripts — async: rollup IIFE bundle + build-time env injection.
// ---------------------------------------------------------------------------
/**
 * A Rollup plugin that replaces `process.env.<KEY>` tokens with literal JSON
 * values from an env map (ported verbatim from webapp builder/scripts.js).
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
 * Build the scripts task. Bundles src/client/main.js to dist-gulp/assets/js/main.js.
 *
 * @returns {Promise<void>} Resolves once the bundle is written.
 */
async function scripts () {
  const outFile = path.join(ASSETS, 'js', JS_ENTRY.replace(/\.js$/, '') + '.js');
  const env = /** @type {Record<string, string|number|boolean>} */ ({ NODE_ENV: PROD ? 'production' : 'development' });
  const bundle = await rollup({
    input: path.join(SRC_CLIENT, JS_ENTRY),
    plugins: [envInject(env)],
  });
  const { output } = await bundle.generate({ format: 'iife', name: 'webapp', sourcemap: !PROD });
  /** @type {{ code: string, map?: unknown }} */
  const chunk = output[0];
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, chunk.code);
  if (chunk.map) {
    await fsp.writeFile(`${outFile}.map`, JSON.stringify(chunk.map));
  }
  await bundle.close();
}

// ---------------------------------------------------------------------------
// assets — async: robots/llms/security/sitemap + rendered hbs pages.
// ---------------------------------------------------------------------------
/**
 * Build the assets task. Writes every site-data-derived file under dist-gulp/.
 *
 * @returns {Promise<void>} Resolves once all asset files are written.
 */
async function assets () {
  const base = siteData.url.replace(/\/$/, '');
  const wellKnownDir = path.join(DIST, '.well-known');
  await fsp.mkdir(wellKnownDir, { recursive: true });

  const robots = ['User-agent: *', 'Allow: /', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
  await fsp.writeFile(path.join(DIST, 'robots.txt'), robots);

  const llms = [
    `# ${siteData.name}`, '', siteData.description, '', '## Pages', '',
    ...siteData.pages.map((p) => `- [${p.title}](${base}${p.path})`), '',
  ].join('\n');
  await fsp.writeFile(path.join(DIST, 'llms.txt'), llms);

  const security = [
    '# https://security.txt',
    `Contact: mailto:security@${new URL(siteData.url).hostname}`,
    'Preferred-Languages: en', '',
  ].join('\n');
  await fsp.writeFile(path.join(wellKnownDir, 'security.txt'), security);

  await writeSitemap();
  await renderPages();
}

/**
 * Write dist-gulp/sitemap.xml from the site data's page list.
 *
 * @returns {Promise<void>} Resolves once the sitemap file is complete.
 */
async function writeSitemap () {
  const hostname = new URL(siteData.url).origin;
  const outFile = path.join(DIST, 'sitemap.xml');
  const sitemap = new SitemapStream({ hostname });
  for (const page of siteData.pages) {
    sitemap.write({ url: page.path, changefreq: 'weekly', priority: page.path === '/' ? 1.0 : 0.8 });
  }
  sitemap.end();
  await pipeline(sitemap, fs.createWriteStream(outFile));
}

/**
 * Render every src/templates/*.hbs to a dist-gulp/<page>.html via handlebars.
 *
 * @returns {Promise<void>} Resolves once all pages are written.
 */
async function renderPages () {
  const templates = await fsp.readdir(SRC_TEMPLATES);
  for (const name of templates) {
    if (!name.endsWith('.hbs')) continue;
    const source = await fsp.readFile(path.join(SRC_TEMPLATES, name), 'utf8');
    const html = Handlebars.compile(source)(siteData);
    await fsp.writeFile(path.join(DIST, name.replace(/\.hbs$/, '.html')), html);
  }
}

// ---------------------------------------------------------------------------
// revision — stream: fingerprint assets + rewrite refs + merge manifest.
// ---------------------------------------------------------------------------
/**
 * Load a pre-existing manifest from dist-gulp/assets/manifest.json, if any, so
 * pass 3 is a MERGE (matches nbs revision.js).
 *
 * @param {string} manifestFile Absolute path of the manifest to load.
 * @returns {Promise<Record<string, string>>} The prior manifest, or {} when absent/invalid.
 */
async function loadManifest (manifestFile) {
  try {
    const raw = await fsp.readFile(manifestFile, 'utf8');
    return /** @type {Record<string, string>} */ (JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Build the revision task — three streaming passes over dist-gulp. No-ops for a
 * dev build (revision off); here PROD is always true.
 *
 * @returns {Promise<void>} Resolves once fingerprinting, ref rewrite and manifest are done.
 */
async function revision () {
  if (!PROD) return;

  const manifestFile = path.join(ASSETS, 'manifest.json');
  /** @type {Record<string, string>} */
  const manifest = await loadManifest(manifestFile);

  // Pass 1 — fingerprint every asset (Buffer contents; no text assumption). The
  // transform writes the new file, unlinks the original, and passes through to sink.
  await streamDone(src(`${ASSETS}/**/*`).pipe(through(fingerprintWrite(ASSETS, manifest))).pipe(sink()));

  // Build site-rooted ref tokens: "/<manifestKey>" → "/<fingerprintedKey>". The
  // nbs pipeline relies on "/"+"css/site.css" being a substring of the full
  // "/assets/css/site.css" reference — replicate that exactly.
  /** @type {Record<string, string>} */
  const refs = {};
  for (const [from, to] of Object.entries(manifest)) {
    refs[`/${from}`] = `/${to}`;
  }

  // Pass 2a — rewrite /assets/... tokens in CSS (re-hash + rename if changed).
  await streamDone(src(`${ASSETS}/**/*.css`).pipe(through(cssRewrite(refs, ASSETS, manifest))).pipe(sink()));
  // Pass 2b — rewrite /assets/... tokens in the HTML pages.
  await streamDone(src(`${DIST}/*.html`).pipe(through(htmlRewrite(refs))).pipe(sink()));

  // Pass 3 — emit the merged manifest.
  await fsp.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Vinyl transform (pass 1): hash content, write `<stem>-<hash><ext>`, unlink the
 * original, and drop the file. Skips sourcemaps and the manifest itself (left
 * on disk untouched).
 *
 * @param {string} assetsDir Absolute dist-gulp/assets (manifest keys are relative to it).
 * @param {Record<string, string>} manifest Accumulator for this run's map.
 * @returns {(file: import('vinyl').File) => Promise<import('vinyl').File>} The through callback.
 */
function fingerprintWrite (assetsDir, manifest) {
  return async function fp (file) {
    if (file.contents == null) return file; // directory / empty entry — leave as-is
    if (path.extname(file.path) === '.map' || path.basename(file.path) === 'manifest.json') {
      return file; // leave on disk as-is
    }
    const hash = contentHash(/** @type {Buffer} */ (file.contents));
    const dir = path.dirname(file.path);
    const stem = path.basename(file.path).replace(/\.[^.]+$/, '').replace(/-[0-9a-f]{10}$/, '');
    const ext = path.extname(file.path);
    const newPath = path.join(dir, `${stem}-${hash}${ext}`);
    manifest[path.relative(assetsDir, file.path)] = path.relative(assetsDir, newPath);
    await fsp.writeFile(newPath, file.contents);
    if (newPath !== file.path) await fsp.unlink(file.path).catch(() => {});
    return file; // written to its fingerprinted name; pass through to the sink
  };
}

/**
 * Vinyl transform (pass 2a, CSS): rewrite `/assets/...` tokens. When content
 * changes, re-hash + rename in the same pass and update the manifest entry.
 *
 * @param {Record<string, string>} refs Site-rooted token → replacement map.
 * @param {string} assetsDir Absolute dist-gulp/assets.
 * @param {Record<string, string>} manifest The shared manifest, updated on re-hash.
 * @returns {(file: import('vinyl').File) => Promise<import('vinyl').File>} The through callback.
 */
function cssRewrite (refs, assetsDir, manifest) {
  return async function rewriteCss (file) {
    const original = typeof file.contents === 'string' ? file.contents : /** @type {Buffer} */ (file.contents).toString('utf8');
    const rewritten = replaceAllTokens(original, refs);
    if (rewritten === original) return file; // no refs — name stays valid

    const hash = contentHash(Buffer.from(rewritten));
    const dir = path.dirname(file.path);
    const stem = path.basename(file.path).replace(/\.[^.]+$/, '').replace(/-[0-9a-f]{10}$/, '');
    const ext = path.extname(file.path);
    const newPath = path.join(dir, `${stem}-${hash}${ext}`);
    for (const [from, to] of Object.entries(manifest)) {
      if (path.resolve(assetsDir, to) === file.path) manifest[from] = path.relative(assetsDir, newPath);
    }
    await fsp.writeFile(newPath, rewritten);
    await fsp.unlink(file.path).catch(() => {});
    return file;
  };
}

/**
 * Vinyl transform (pass 2b, HTML): rewrite `/assets/...` tokens and write back to
 * the same path (name unchanged, content changed).
 *
 * @param {Record<string, string>} refs Site-rooted token → replacement map.
 * @returns {(file: import('vinyl').File) => Promise<import('vinyl').File>} The through callback.
 */
function htmlRewrite (refs) {
  return async function rewriteHtml (file) {
    const text = typeof file.contents === 'string' ? file.contents : /** @type {Buffer} */ (file.contents).toString('utf8');
    const rewritten = replaceAllTokens(text, refs);
    await fsp.writeFile(file.path, rewritten);
    return file;
  };
}

// ---------------------------------------------------------------------------
// Default task — the full prod-equivalent pipeline. `gulp` runs this.
// ---------------------------------------------------------------------------
export default series(
  clean,
  parallel(styles, scripts, assets),
  revision,
);
