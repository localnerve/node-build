/**
 * node-build webapp example — build file / CLI entry.
 * 
 * Wires command-line flags into the builder factory:
 * 
 *   nbs              dev build (no fingerprinting, sourcemaps on)
 *   nbs --prod       production build (fingerprint + env injection)
 *   nbs --watch      build, then re-run on changes under src/
 * 
 * Run from this folder (paths resolve against the current working directory):
 *   cd examples/webapp && npm run build:prod
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import process from 'node:process';
import fsp from 'node:fs/promises';
import { parseArgs } from 'node-build';
import { createSettings } from './builder/settings.js';
import { createBuild } from './builder/index.js';

// `nbs --prod` -> { prod: true }; unknown flags (e.g. --minify) pass through untouched.
const args = parseArgs(process.argv);

const settings = createSettings({ prod: Boolean(args.prod), revision: Boolean(args.prod) });

// siteData is the factory's second argument — a real builder would take this
// from CMS/API fetches rather than a local JSON file.
const siteData = JSON.parse(await fsp.readFile(settings.dataFile, 'utf8'));

const build = createBuild(settings, siteData);

// Declares what `nbs --watch` monitors: sources, templates, and the site data.
build.globs = ['src/client/**', 'src/styles/**', 'src/templates/**', 'src/data/**'];

export default build;
