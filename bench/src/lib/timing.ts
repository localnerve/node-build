/**
 * Timing primitives for the benchmark harness.
 *
 * Everything here measures WALL-CLOCK time of a real child process (startup +
 * full build), which is what users feel — never in-process imports. Uses only
 * node: builtins so the harness stays dependency-free.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { spawn } from 'node:child_process';
import type { RunStats } from './types.ts';

/** Result of one timed child-process invocation. */
export interface TimedSpawn {
  /** Wall-clock duration in milliseconds (unrounded). */
  ms: number;
  /** Process exit code (-1 when the process was signalled or never started). */
  exitCode: number;
  /** Combined standard output as a string. */
  stdout: string;
  /** Combined standard error as a string. */
  stderr: string;
}

/** Options accepted by spawnAndTime. */
export interface SpawnOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Environment for the child process (defaults to the current one). */
  env?: NodeJS.ProcessEnv;
}

/** Round a millisecond value to 3 decimals (sub-millisecond precision, tidy output). */
export function roundMs (value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Compute summary statistics from raw timed samples.
 *
 * @param {readonly number[]} samples Raw per-run durations in ms (any order).
 * @returns {RunStats} min/mean/median/max + rounded samples, or all zeros when empty.
 */
export function computeStats (samples: readonly number[]): RunStats {
  if (samples.length === 0) return { min: 0, mean: 0, median: 0, max: 0, samples: [] };

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;

  return {
    min: roundMs(sorted[0]),
    mean: roundMs(sum / sorted.length),
    median: roundMs(median),
    max: roundMs(sorted[sorted.length - 1]),
    samples: samples.map(roundMs)
  };
}

/**
 * Spawn a child process and measure its total wall-clock lifetime.
 *
 * The clock starts immediately before spawn() and stops on the 'close' event,
 * so the result includes process startup and I/O — exactly what a user waits for.
 *
 * @param {string} cmd Executable to run (e.g. process.execPath or a bin path).
 * @param {readonly string[]} args Argument list for the executable.
 * @param {SpawnOptions} [options] cwd / env overrides.
 * @returns {Promise<TimedSpawn>} Duration, exit code, and captured output.
 * @throws {Error} When the executable itself cannot be started (e.g. ENOENT).
 */
export function spawnAndTime (cmd: string, args: readonly string[], options: SpawnOptions = {}): Promise<TimedSpawn> {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    let stdout = '';
    let stderr = '';

    const child = spawn(cmd, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (err: Error) => reject(err));
    child.on('close', (code) => {
      const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
      resolve({ ms, exitCode: code ?? -1, stdout, stderr });
    });
  });
}

/** Options for runRepeatedly. */
export interface RepeatOptions {
  /** Number of untimed warmup invocations (discarded). Default 0. */
  warmup?: number;
  /** Number of timed invocations. Must be >= 1. */
  runs: number;
}

/**
 * Run an async runner `warmup + runs` times, timing only the last `runs`.
 *
 * Warmup results are discarded (they prime caches/page cache); every invocation —
 * warmup or timed — must exit 0, otherwise the error includes the child's stderr
 * tail so a broken pipeline fails loudly instead of producing bogus numbers.
 *
 * @param {() => Promise<TimedSpawn>} runner Zero-arg factory for one timed run.
 * @param {RepeatOptions} options Warmup count + timed run count.
 * @returns {Promise<RunStats>} Statistics over the timed runs only.
 */
export async function runRepeatedly (runner: () => Promise<TimedSpawn>, options: RepeatOptions): Promise<RunStats> {
  if (!Number.isInteger(options.runs) || options.runs < 1) {
    throw new TypeError(`runs must be an integer >= 1, got ${options.runs}`);
  }
  const warmup = Math.max(0, options.warmup ?? 0);

  for (let i = 0; i < warmup; i++) {
    const r = await runner();
    if (r.exitCode !== 0) throw new Error(`warmup run ${i + 1} failed (exit ${r.exitCode}): ${stderrTail(r.stderr)}`);
  }

  const samples: number[] = [];
  for (let i = 0; i < options.runs; i++) {
    const r = await runner();
    if (r.exitCode !== 0) throw new Error(`run ${i + 1} of ${options.runs} failed (exit ${r.exitCode}): ${stderrTail(r.stderr)}`);
    samples.push(roundMs(r.ms));
  }

  return computeStats(samples);
}

/** Last ~2000 chars of stderr — enough for a real error, small enough to stay readable. */
function stderrTail (stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length > 2000 ? `…${trimmed.slice(-2000)}` : trimmed;
}
