/**
 * Git metadata for stamping benchmark records.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { spawnSync } from 'node:child_process';

/** Git state used to attribute a benchmark record to a point in history. */
export interface GitInfo {
  /** Short commit SHA of HEAD (7+ hex chars). */
  commit: string;
  /** True when the working tree has uncommitted changes at run time. */
  dirty: boolean;
}

/**
 * Best-effort git info for stamping benchmark records.
 *
 * @param {string} [cwd] Directory to query (defaults to the current one).
 * @returns {GitInfo | null} Commit + dirtiness, or null when not inside a git
 *   work tree (e.g. running from an archive copy) — callers must handle null.
 */
export function gitInfo (cwd?: string): GitInfo | null {
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd });
  if (sha.status !== 0 || !sha.stdout.trim()) return null;

  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd });
  const dirty = status.status === 0 && status.stdout.trim().length > 0;

  return { commit: sha.stdout.trim(), dirty };
}
