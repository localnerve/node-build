/**
 * Assets stage — the ASYNC (non-stream) showcase, part two.
 * 
 * Generates every file that is derived from site data rather than transformed
 * from an input tree:
 * 
 *   dist/robots.txt               crawl policy + sitemap pointer
 *   dist/llms.txt                 LLM-oriented site description
 *   dist/.well-known/security.txt security contact (RFC 9116 shape)
 *   dist/sitemap.xml              via the `sitemap` package's SitemapStream
 *   dist/<page>.html              every src/templates/*.hbs rendered with the
 *                                 site data via handlebars
 * 
 * Like scripts.js this stage returns a Promise, not a stream — the two shapes
 * node-build tasks can take, shown for contrast with styles.js. Both `sitemap`
 * and `handlebars` are recipe dependencies of this EXAMPLE, not of node-build.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Site data consumed by the asset/template stages (loaded once by createBuild
 * and passed down — a webapp builder takes this as its second argument).
 *
 * @typedef {Object} SiteData
 * @property {string} name Human-readable site name.
 * @property {string} url Canonical absolute URL of the deployed site.
 * @property {string} description One-paragraph site summary.
 * @property {Array<{ path: string, title: string }>} pages Deployed pages;
 *   `path` is the site-relative URL (e.g. "/about.html").
 */

/**
 * Render every Handlebars template in settings.srcTemplates to a page under
 * dist/. A template named `index.hbs` becomes `dist/index.html`, `about.hbs`
 * becomes `dist/about.html`, and so on.
 *
 * @param {import('./settings.js').WebappSettings} settings Resolved build settings.
 * @param {SiteData} siteData The rendered-into data for every template.
 * @returns {Promise<void>} Resolves once all pages are written.
 */
async function renderPages (settings, siteData) {
  // Handlebars is CJS — the API object lands on `default` when ESM-imported.
  const { default: Handlebars } = await import('handlebars');
  const templates = await fsp.readdir(settings.srcTemplates);
  for (const name of templates) {
    if (!name.endsWith('.hbs')) continue;
    const source = await fsp.readFile(path.join(settings.srcTemplates, name), 'utf8');
    const html = Handlebars.compile(source)(siteData);
    const outFile = path.join(settings.dist, name.replace(/\.hbs$/, '.html'));
    await fsp.writeFile(outFile, html);
  }
}

/**
 * Write dist/sitemap.xml from the site data's page list. SitemapStream is a
 * writable XML producer — pipeline it into a file stream (the one place a raw
 * node stream earns its keep inside an async task).
 *
 * @param {import('./settings.js').WebappSettings} settings Resolved build settings.
 * @param {SiteData} siteData Site data whose `pages` become sitemap URLs.
 * @returns {Promise<void>} Resolves once the sitemap file is complete.
 */
async function writeSitemap (settings, siteData) {
  const { SitemapStream } = await import('sitemap');
  // `hostname` is the v9 option name for the base URL against which relative
  // page paths are resolved (it was `domain` in older releases).
  const hostname = new URL(siteData.url).origin;
  const outFile = path.join(settings.dist, 'sitemap.xml');
  const sitemap = new SitemapStream({ hostname });
  for (const page of siteData.pages) {
    sitemap.write({ url: page.path, changefreq: 'weekly', priority: page.path === '/' ? 1.0 : 0.8 });
  }
  sitemap.end();
  await pipeline(sitemap, fs.createWriteStream(outFile));
}

/**
 * Build the assets stage task.
 *
 * @param {import('./settings.js').WebappSettings} settings Resolved build settings.
 * @param {SiteData} siteData Site data driving robots/llms/security/sitemap/pages.
 * @returns {() => Promise<void>} A zero-arg async task function (no stream).
 */
export function createAssetsStage (settings, siteData) {
  return async function assetsStage () {
    const wellKnownDir = path.join(settings.dist, '.well-known');
    await fsp.mkdir(wellKnownDir, { recursive: true });

    const robots = [
      'User-agent: *',
      'Allow: /',
      `Sitemap: ${siteData.url.replace(/\/$/, '')}/sitemap.xml`,
      '',
    ].join('\n');
    await fsp.writeFile(path.join(settings.dist, 'robots.txt'), robots);

    const llms = [
      `# ${siteData.name}`,
      '',
      siteData.description,
      '',
      '## Pages',
      '',
      ...siteData.pages.map((p) => `- [${p.title}](${siteData.url.replace(/\/$/, '')}${p.path})`),
      '',
    ].join('\n');
    await fsp.writeFile(path.join(settings.dist, 'llms.txt'), llms);

    const security = [
      '# https://security.txt',
      `Contact: mailto:security@${new URL(siteData.url).hostname}`,
      'Preferred-Languages: en',
      '',
    ].join('\n');
    await fsp.writeFile(path.join(wellKnownDir, 'security.txt'), security);

    await writeSitemap(settings, siteData);
    await renderPages(settings, siteData);
  };
}
