/**
 * Shared types for the benchmark harness.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */

/** The build systems compared by this benchmark. */
export type SystemName = 'nbs' | 'gulp';

/**
 * Summary statistics for a set of timed runs, in milliseconds.
 * `samples` holds every timed run (warmup excluded), rounded to 3 decimals.
 */
export interface RunStats {
  min: number;
  mean: number;
  median: number;
  max: number;
  samples: number[];
}

/**
 * One benchmark invocation, appended as a single line of results/history.jsonl.
 * The committed history is the source of truth for performance-over-time and the
 * baseline the CI regression gate compares against.
 */
export interface BenchRecord {
  /** ISO-8601 timestamp of the run. */
  ts: string;
  /** Short git SHA the benchmark ran on ('' when not a git work tree). */
  commit: string;
  /** True when the working tree had uncommitted changes at run time. */
  dirty: boolean;
  /** process.version of the Node.js runtime that performed the runs. */
  node: string;
  /** Warmup (untimed) runs per system. */
  warmup: number;
  /** Timed runs per system. */
  runs: number;
  /** Per-system statistics, keyed by system name. */
  systems: Record<SystemName, RunStats>;
}
