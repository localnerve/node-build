/**
 * node-build — a no-dependency, Node 24+ streaming build runner.
 * 
 * Drop-in replacement for the core of gulp: define tasks with `task()`, run them
 * with `series()`/`parallel()`, and move files through object-mode streams built
 * from `src()` + your transforms + `dest()`. Existing gulp plugins (object-mode
 * Vinyl transforms) can be used unchanged — see README for interop notes.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { task, series, parallel, run, runDefault, getTask, listTasks, seriesDefault } from './task.js';
import { src, dest, through, wrapFile, unwrapFile } from './stream.js';
import { File } from './file.js';
import { resolveFileClass, resolveFileClassSync } from './vinyl.js';
import { clean } from './clean.js';
import { parseArgs } from './args.js';

export { task, series, parallel, run, runDefault, getTask, listTasks, seriesDefault };
export { src, dest, through, wrapFile, unwrapFile };
export { pipeline } from 'node:stream/promises';
export { File };
export { globFiles, deriveBase } from './glob.js';
export { resolveFileClass, resolveFileClassSync };
export { clean };
export { parseArgs };

/** Default export mirrors gulp's common surface for quick migration. */
import { pipeline as _pipeline } from 'node:stream/promises';
const nodeBuild = { task, series, parallel, run, runDefault, src, dest, through, pipeline: _pipeline };
export default nodeBuild;
