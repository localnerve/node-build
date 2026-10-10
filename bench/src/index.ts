/**
 * node-build-stream benchmark harness — entry point.
 *
 * Runs the REAL webapp pipeline N times per runner and compares wall-clock time:
 *   • nbs  — spawns `node <root>/bin/nbs.mjs --config examples/webapp/build.mjs --prod`
 *            (cwd = examples/webapp), reusing the example build as-is.
 *   • gulp — spawns the local gulp CLI over bench/gulpfile.mjs (cwd = bench), a faithful
 *            parity pipeline over the same inputs.
 *
 * Each runner gets `warmup + runs` invocations (default 1 + 3); warmup primes caches and is
 * discarded, so only the timed runs feed the stats. A styled one-shot comparison is printed,
 * then ONE BenchRecord line is appended to results/history.jsonl — the committed source of
 * truth for over-time trends. The `--report` flag reads that file back and prints a trend
 * table; adding `--json` prints the same data as a single JSON document on stdout (and nothing
 * else) so CI can parse it, e.g. for the regression gate.
 *
 * Runs via Node's native TypeScript type-stripping: `node src/index.ts`. The harness has zero
 * runtime dependencies — it shells out to the real CLIs and measures with process.hrtime.bigint().
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnAndTime, runRepeatedly } from './lib/timing.ts';
import type { TimedSpawn } from './lib/timing.ts';
import { gitInfo } from './lib/git.ts';
import { evaluateGate, medianOfPct, speedupPct } from './lib/gate.ts';
import type { BenchRecord, RunStats } from './lib/types.ts';

const defaultGateThresholdPercent = 15;

// ---------------------------------------------------------------------------
// Paths — resolved from this file so the harness is cwd-independent.
// ---------------------------------------------------------------------------
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url)); // bench/src
const BENCH_DIR = path.resolve(SRC_DIR, '..'); // bench
const ROOT = path.resolve(BENCH_DIR, '..'); // repo root

const WEBAPP_DIR = path.join(ROOT, 'examples', 'webapp');
const NBS_CLI = path.join(ROOT, 'bin', 'nbs.mjs');
// gulp v5 bundles the CLI; this is the real entry that bench/node_modules/.bin/gulp points at.
const GULP_BIN = path.join(BENCH_DIR, 'node_modules', 'gulp', 'bin', 'gulp.js');
const HISTORY_FILE = path.join(BENCH_DIR, 'results', 'history.jsonl');

/** Harness CLI options (distinct from the nbs build's own flags). */
interface HarnessArgs {
  /** True for `--report` (over-time trend table from history.jsonl). */
  report: boolean;
  /** With `--report`: emit the trend as a single JSON document on stdout (for CI). */
  json: boolean;
  /** Timed runs per system. Default 3. */
  runs: number;
  /** Untimed warmup runs per system. Default 1. */
  warmup: number;
  /** Allowed drop in nbs-vs-gulp speedup (percentage points). Default 15. */
  threshold: number;
  /** True for `--no-gate` (report timings but never fail on regression). */
  noGate: boolean;
  /** Multi-run gate mode: full benchmark invocations to perform (0 => off). CI uses 3. */
  gateRuns: number;
}

/**
 * Parse the harness's own CLI flags.
 *
 * @param {string[]} argv process.argv minus node + script path.
 * @returns {HarnessArgs} Parsed options (defaults: report=false, json=false, runs=3, warmup=1,
 *         threshold=15, noGate=false, gateRuns=0).
 * @throws {Error} On an unknown flag or a non-integer / below-minimum count / bad threshold.
 */
function parseHarnessArgs (argv: string[]): HarnessArgs {
  const out: HarnessArgs = { report: false, json: false, runs: 3, warmup: 1, threshold: defaultGateThresholdPercent, noGate: false, gateRuns: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') out.report = true;
    else if (a === '--json') out.json = true;
    else if (a === '--runs') out.runs = parseCount(argv[++i], '--runs', 1);
    else if (a === '--warmup') out.warmup = parseCount(argv[++i], '--warmup', 0);
    else if (a === '--threshold') out.threshold = parseThreshold(argv[++i]);
    else if (a === '--no-gate') out.noGate = true;
    else if (a === '--gate') {
      // Bare `--gate` => default 3 invocations; `--gate <n>` overrides the count.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.gateRuns = parseCount(next, '--gate', 1);
        i++;
      } else {
        out.gateRuns = 3;
      }
    } else throw new Error(`unknown flag: ${a} (expected --report, --json, --runs <n>, --warmup <n>, --threshold <pct>, --no-gate, --gate [n])`);
  }
  return out;
}

/** Parse an integer CLI value >= `min`, throwing a readable error otherwise. */
function parseCount (raw: string | undefined, flag: string, min: number): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n < min) {
    throw new Error(`${flag} needs an integer >= ${min}, got ${String(raw)}`);
  }
  return n;
}

/** Parse a `--threshold` value: a finite number >= 0 (decimals allowed). */
function parseThreshold (raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isFinite(n) || n < 0) {
    throw new Error(`--threshold needs a number >= 0, got ${String(raw)}`);
  }
  return n;
}

/** A runner produces one timed child-process invocation. */
type Runner = () => Promise<TimedSpawn>;

/** The nbs side: the real CLI over the example build (prod), cwd = examples/webapp. */
function makeNbsRunner (): Runner {
  return () => spawnAndTime(
    process.execPath,
    [NBS_CLI, '--config', path.join(WEBAPP_DIR, 'build.mjs'), '--prod'],
    { cwd: WEBAPP_DIR }
  );
}

/** The gulp side: the local gulp CLI over bench/gulpfile.mjs (default task), cwd = bench. */
function makeGulpRunner (): Runner {
  return () => spawnAndTime(process.execPath, [GULP_BIN], { cwd: BENCH_DIR });
}

// ---------------------------------------------------------------------------
// Styling — mirrors the reference debug bench (styleText bars + "% faster"), but
// degrades to plain text when stdout is not a TTY so CI logs stay clean.
// ---------------------------------------------------------------------------
type PaintOpts = { fg?: string; bold?: boolean; dim?: boolean };

/** Apply ANSI styling only when supported and on a TTY; otherwise return the input. */
function paint (text: string, opts: PaintOpts = {}): string {
  const so = process.stdout as unknown as { styleText?: (t: string, o: object) => string };
  if (typeof so.styleText !== 'function') return text;
  try { return so.styleText(text, opts); } catch { return text; }
}

/** An ASCII bar of `width` cells filled proportionally to ms / maxMs. */
function bar (ms: number, maxMs: number, width: number): string {
  if (maxMs <= 0) return '';
  const filled = Math.max(1, Math.min(width, Math.round((ms / maxMs) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** One table row: min / mean / median / max plus the raw sample list (ms). */
function formatRow (name: string, s: RunStats): string {
  const samples = s.samples.map((v) => v.toFixed(1)).join(', ');
  return `${name.padEnd(6)} | ${s.min.toFixed(1).padStart(8)} ${s.mean.toFixed(1).padStart(8)} ${s.median.toFixed(1).padStart(8)} ${s.max.toFixed(1).padStart(8)} | [${samples}]`;
}

/** Append one record line to history.jsonl, creating the dir if needed. */
async function appendRecord (record: BenchRecord): Promise<void> {
  await fsp.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fsp.appendFile(HISTORY_FILE, `${JSON.stringify(record)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Over-time report — reads the committed history.jsonl and prints a trend table.
// ---------------------------------------------------------------------------

/**
 * Read and parse history.jsonl into BenchRecord[] (file order). Blank lines are ignored;
 * malformed lines are skipped with a warning so one bad line never breaks the whole report.
 *
 * @returns {BenchRecord[]} The parsed records, oldest first. Empty when the file is absent/empty.
 */
async function readHistory (): Promise<BenchRecord[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(HISTORY_FILE, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const records: BenchRecord[] = [];
  raw.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const rec = JSON.parse(trimmed) as BenchRecord;
      const nbs = rec?.systems?.nbs;
      // Minimal shape check: we need a median per system to render the trend.
      if (typeof nbs?.median !== 'number' || typeof rec.systems?.gulp?.median !== 'number') {
        throw new Error('missing systems.*.median');
      }
      records.push(rec);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ skipping malformed history line ${i + 1}: ${reason}`);
    }
  });
  return records;
}

/** Compact UTC timestamp from an ISO string: "2026-10-09 20:01". */
function shortTs (iso: string): string {
  return typeof iso === 'string' && iso.length >= 16 ? iso.slice(0, 16).replace('T', ' ') : '?';
}

/** Display form of {@link speedupPct}: "on par" within a 0.05 ms epsilon, else signed pct. */
function deltaPct (nbsMs: number, gulpMs: number): string {
  if (Math.abs(nbsMs - gulpMs) < 0.05) return 'on par';
  const pct = speedupPct(nbsMs, gulpMs);
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** Print the over-time trend table for the parsed history records. */
function printReport (records: BenchRecord[]): void {
  if (records.length === 0) {
    console.log('No benchmark history yet — run `npm run bench` first, then `npm run report`.');
    return;
  }

  console.log('node-build-stream · over-time trend (vs gulp)');
  console.log(`source : ${path.relative(BENCH_DIR, HISTORY_FILE)} (${records.length} record(s))`);
  console.log('──────────────────────────────────────────────────────────────────────');
  const header = `#${String(' ').padStart(3)} | ${'when (UTC)'.padEnd(16)} | ${'commit'.padEnd(9)} | ${'nbs med'.padStart(8)} | ${'gulp med'.padStart(8)} | Δ nbs`;
  console.log(header);
  console.log('─'.repeat(header.length));

  records.forEach((rec, i) => {
    const nbsMed = rec.systems.nbs.median;
    const gulpMed = rec.systems.gulp.median;
    const commit = rec.commit || '—';
    const node = rec.node ? ` ${rec.node}` : '';
    console.log(
      `${String(i + 1).padStart(3)} | ${shortTs(rec.ts).padEnd(16)} | ${commit.padEnd(9)} | ` +
      `${nbsMed.toFixed(1).padStart(8)} | ${gulpMed.toFixed(1).padStart(8)} | ${deltaPct(nbsMed, gulpMed)}${node}`
    );
  });

  console.log('──────────────────────────────────────────────────────────────────────');
  const last = records[records.length - 1];
  console.log(`latest : nbs median ${last.systems.nbs.median.toFixed(1)} ms · gulp median ${last.systems.gulp.median.toFixed(1)} ms (${deltaPct(last.systems.nbs.median, last.systems.gulp.median)})`);
}

/** One machine-readable row of the over-time trend (medians in ms + signed Δ%). */
interface TrendRow {
  ts: string;
  commit: string;
  dirty: boolean;
  node: string;
  warmup: number;
  runs: number;
  nbsMedianMs: number;
  gulpMedianMs: number;
  /** Signed "% faster" for nbs vs gulp (positive => nbs faster). */
  deltaPct: number;
}

/**
 * Print the trend as a single JSON document on stdout — and nothing else — so CI can parse it
 * (e.g. `npm run report -- --json`). `latest` is the most recent row or null when no history.
 */
function printJsonReport (records: BenchRecord[]): void {
  const rows: TrendRow[] = records.map((rec) => ({
    ts: rec.ts,
    commit: rec.commit,
    dirty: rec.dirty,
    node: rec.node,
    warmup: rec.warmup,
    runs: rec.runs,
    nbsMedianMs: rec.systems.nbs.median,
    gulpMedianMs: rec.systems.gulp.median,
    deltaPct: speedupPct(rec.systems.nbs.median, rec.systems.gulp.median)
  }));
  const out = {
    source: path.relative(BENCH_DIR, HISTORY_FILE),
    count: records.length,
    latest: rows.length > 0 ? rows[rows.length - 1] : null,
    records: rows
  };
  console.log(JSON.stringify(out, null, 2));
}

/** Warm up + time one system, printing a short live progress cue. */
async function timeSystem (name: string, runner: Runner, args: HarnessArgs): Promise<RunStats> {
  console.log(`\n▶ ${name}: ${args.warmup} warmup + ${args.runs} timed run(s)…`);
  const stats = await runRepeatedly(runner, { warmup: args.warmup, runs: args.runs });
  console.log(`  median ${stats.median.toFixed(1)} ms (min ${stats.min.toFixed(1)} / max ${stats.max.toFixed(1)})`);
  return stats;
}

/** The styled one-shot comparison: stats table + bars + "% faster" verdict. */
function printComparison (nbs: RunStats, gulp: RunStats): void {
  console.log('');
  console.log(`${'system'.padEnd(6)} |    min     mean   median    max | samples (ms)`);
  console.log(formatRow('nbs', nbs));
  console.log(formatRow('gulp', gulp));

  const width = 28;
  const maxMs = Math.max(nbs.max, gulp.max);
  console.log('');
  console.log(`${paint('nbs ', { fg: 'green' })}${bar(nbs.median, maxMs, width)}  ${nbs.median.toFixed(1)} ms`);
  console.log(`${paint('gulp', { fg: 'cyan' })} ${bar(gulp.median, maxMs, width)}  ${gulp.median.toFixed(1)} ms`);

  console.log('');
  console.log(`→ ${verdictLine(nbs.median, gulp.median)}`);
}

/** Human "% faster" line comparing the two medians (0.05 ms epsilon for "on par"). */
function verdictLine (nbsMs: number, gulpMs: number): string {
  if (Math.abs(nbsMs - gulpMs) < 0.05) return 'on par — medians are equal';
  if (nbsMs < gulpMs) {
    const pct = ((gulpMs - nbsMs) / gulpMs) * 100;
    return `${paint('nbs', { fg: 'green', bold: true })} is ${pct.toFixed(1)}% faster than gulp (median ${nbsMs.toFixed(1)} vs ${gulpMs.toFixed(1)} ms)`;
  }
  const pct = ((nbsMs - gulpMs) / nbsMs) * 100;
  return `${paint('gulp', { fg: 'cyan', bold: true })} is ${pct.toFixed(1)}% faster than nbs (median ${gulpMs.toFixed(1)} vs ${nbsMs.toFixed(1)} ms)`;
}

/**
 * Regression gate: compare this run's nbs-vs-gulp speedup % against `baselinePct` — the
 * MEDIAN OF ALL PRIOR records' speedups in history (robust to a single noisy record).
 * Machine-independent: both systems run on the same hardware, so only relative regressions
 * move the metric. Report-only when the gate is disabled (`--no-gate`) or no baseline exists.
 * Returns true when the speedup dropped beyond the threshold.
 */
function applyGate (currentPct: number, baselinePct: number | null, baselineCount: number, args: HarnessArgs): boolean {
  if (args.noGate) {
    console.log('gate     : disabled (--no-gate)');
    return false;
  }
  if (baselinePct === null) {
    console.log('gate     : skipped — no prior history yet (this run seeds the baseline)');
    return false;
  }
  const res = evaluateGate(currentPct, baselinePct, args.threshold);
  if (res.regressed) {
    console.error(`gate     : ${paint('REGRESSED', { fg: 'red', bold: true })} — nbs only +${res.currentPct.toFixed(1)}% faster than gulp (baseline +${res.baselinePct.toFixed(1)}%; drop ${res.dropPct.toFixed(1)}pp > threshold ${args.threshold}pp, median of ${baselineCount} prior run(s))`);
    return true;
  }
  const sign = res.dropPct >= 0 ? '' : '-';
  console.log(`gate     : ${paint('PASS', { fg: 'green' })} — nbs +${res.currentPct.toFixed(1)}% faster than gulp (baseline +${res.baselinePct.toFixed(1)}%; Δ ${sign}${Math.abs(res.dropPct).toFixed(1)}pp, threshold ${args.threshold}pp)`);
  return false;
}

/**
/**
 * Benchmark entry point: time both runners, print a styled comparison, append one record to
 * history.jsonl, then run the regression gate — this run's nbs median vs the MEDIAN OF ALL
 * PRIOR nbs medians in history (a run is never compared against itself) — exiting non-zero
 * when it regressed beyond `--threshold` (default +15%; disable with `--no-gate`).
 * With `--report` it instead reads that file and prints the over-time trend table — or, with
 * `--json`, a single machine-readable JSON document on stdout (no runs are performed and
 * nothing is appended in report mode).
 */
/**
 * CI multi-run gate: capture the baseline (median of ALL prior records' speedup %) BEFORE
 * any append, perform `gateRuns` full benchmark invocations, then compare the MEDIAN OF
 * THEIR SPEEDUPS against that baseline — a single noisy run can't trip the gate. Machine-
 * independent: both systems run on the same hardware so only relative regressions matter.
 * Each invocation still appends its own record (CI never commits them; locally they are
 * legitimate history).
 */
async function mainGateMode (args: HarnessArgs): Promise<void> {
  // Fail fast with a clear message if a runner's entry point is missing.
  for (const [label, p] of [['nbs CLI', NBS_CLI], ['gulp CLI', GULP_BIN]] as const) {
    if (!fs.existsSync(p)) throw new Error(`${label} not found at ${p} — run \`npm install\` in bench/ first`);
  }

  const prior = await readHistory();
  const baselinePct = prior.length > 0
    ? medianOfPct(prior.map((rec) => speedupPct(rec.systems.nbs.median, rec.systems.gulp.median)))
    : null;

  console.log(`node-build-stream · benchmark gate (vs gulp) — ${args.gateRuns} invocation(s)`);
  console.log('───────────────────────────────────────');
  if (baselinePct !== null) {
    console.log(`baseline : nbs +${baselinePct.toFixed(1)}% faster than gulp (median of ${prior.length} prior run${prior.length === 1 ? '' : 's'}, gate ${args.threshold}pp)`);
  } else {
    console.log('baseline : none yet — this gate seeds history; no regression check this time');
  }

  if (args.noGate) {
    console.log('gate     : disabled (--no-gate)');
    return;
  }

  const speedups: number[] = [];
  for (let i = 1; i <= args.gateRuns; i++) {
    console.log(`\n──── invocation ${i}/${args.gateRuns} ────`);
    const nbsStats = await timeSystem('nbs', makeNbsRunner(), args);
    const gulpStats = await timeSystem('gulp', makeGulpRunner(), args);
    printComparison(nbsStats, gulpStats);
    speedups.push(speedupPct(nbsStats.median, gulpStats.median));

    const git = gitInfo();
    const record: BenchRecord = {
      ts: new Date().toISOString(),
      commit: git?.commit ?? '',
      dirty: git?.dirty ?? false,
      node: process.version,
      warmup: args.warmup,
      runs: args.runs,
      systems: { nbs: nbsStats, gulp: gulpStats }
    };
    await appendRecord(record);
  }

  if (baselinePct === null) {
    console.log('\ngate     : PASS (no prior history to compare against — baseline seeded)');
    return;
  }

  const runPct = medianOfPct(speedups) ?? 0;
  const res = evaluateGate(runPct, baselinePct, args.threshold);
  if (res.regressed) {
    console.error(`\ngate     : ${paint('REGRESSED', { fg: 'red', bold: true })} — median speedup +${runPct.toFixed(1)}% vs baseline +${baselinePct.toFixed(1)}% (drop ${res.dropPct.toFixed(1)}pp > threshold ${args.threshold}pp)`);
    process.exitCode = 1;
  } else {
    console.log(`\ngate     : ${paint('PASS', { fg: 'green' })} — median speedup +${runPct.toFixed(1)}% vs baseline +${baselinePct.toFixed(1)}% (Δ ${res.dropPct >= 0 ? '' : '-'}${Math.abs(res.dropPct).toFixed(1)}pp, threshold ${args.threshold}pp)`);
  }
}

async function main (): Promise<void> {
  const args = parseHarnessArgs(process.argv.slice(2));

  if (args.report) {
    const records = await readHistory();
    if (args.json) printJsonReport(records);
    else printReport(records);
    return;
  }

  if (args.gateRuns > 0) {
    await mainGateMode(args);
    return;
  }

  // Fail fast with a clear message if a runner's entry point is missing.
  for (const [label, p] of [['nbs CLI', NBS_CLI], ['gulp CLI', GULP_BIN]] as const) {
    if (!fs.existsSync(p)) throw new Error(`${label} not found at ${p} — run \`npm install\` in bench/ first`);
  }

  const git = gitInfo();
  // Baseline for the regression gate = MEDIAN OF ALL PRIOR records' speedup % BEFORE this
  // run's own append, so a run is never compared against itself. Machine-independent: both
  // systems run on the same hardware, so only relative regressions move the metric.
  const prior = await readHistory();
  const baselinePct = prior.length > 0
    ? medianOfPct(prior.map((rec) => speedupPct(rec.systems.nbs.median, rec.systems.gulp.median)))
    : null;

  console.log('node-build-stream · benchmark (vs gulp)');
  console.log('───────────────────────────────────────');
  console.log('workload : examples/webapp');
  console.log(`node     : ${process.version}`);
  console.log(`git      : ${git ? `${git.commit}${git.dirty ? ' (dirty)' : ''}` : 'not a git work tree'}`);
  console.log(`timing   : ${args.warmup} warmup × ${args.runs} timed run(s) per system`);
  if (baselinePct !== null) {
    console.log(`baseline : nbs +${baselinePct.toFixed(1)}% faster than gulp (median of ${prior.length} prior run${prior.length === 1 ? '' : 's'}, gate ${args.threshold}pp)`);
  } else {
    console.log('baseline : none yet — this run seeds the first committed record');
  }

  const nbsStats = await timeSystem('nbs', makeNbsRunner(), args);
  const gulpStats = await timeSystem('gulp', makeGulpRunner(), args);

  printComparison(nbsStats, gulpStats);

  const record: BenchRecord = {
    ts: new Date().toISOString(),
    commit: git?.commit ?? '',
    dirty: git?.dirty ?? false,
    node: process.version,
    warmup: args.warmup,
    runs: args.runs,
    systems: { nbs: nbsStats, gulp: gulpStats }
  };
  await appendRecord(record);
  console.log(`\nrecord appended → ${path.relative(BENCH_DIR, HISTORY_FILE)}`);

  const currentPct = speedupPct(nbsStats.median, gulpStats.median);
  if (applyGate(currentPct, baselinePct, prior.length, args)) {
    process.exitCode = 1;
  }
}

// Run only when executed directly (`node src/index.ts`), not when imported (keeps this
// entry import-safe for future tests). Node resolves argv[1] to an absolute path.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `benchmark failed: ${err.message}` : String(err));
    process.exit(1);
  });
}
