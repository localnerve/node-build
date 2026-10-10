/**
 * CI regression gate — compares this run's nbs-vs-gulp speedup percentage against the
 * baseline (median of all prior records' speedups) and flags a regression when the
 * speedup drops beyond the allowed threshold.
 *
 * The metric is machine-independent: both nbs and gulp run on identical hardware in the
 * same invocation, so absolute wall-clock times cancel out in the ratio. A slow CI runner
 * inflates BOTH medians equally; only a real relative regression (nbs getting slower vs
 * gulp) moves the percentage.
 *
 * Pure + testable: no I/O, no process access. The harness (src/index.ts) reads the
 * baseline from results/history.jsonl and feeds it in here.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */

/** How much faster nbs is than gulp, as a signed percentage (positive => nbs faster). */
export function speedupPct (nbsMs: number, gulpMs: number): number {
  if (gulpMs <= 0) return 0;
  return Math.round(((gulpMs - nbsMs) / gulpMs) * 1000) / 10;
}

/** Outcome of one regression-gate evaluation. */
export interface GateResult {
  /** Baseline speedup % (median of all prior records' nbs-vs-gulp speedup). */
  baselinePct: number;
  /** Current run's speedup % (how much faster nbs is than gulp this invocation). */
  currentPct: number;
  /** How much the speedup dropped vs baseline (positive => worse). Rounded to 1 decimal. */
  dropPct: number;
  /** Allowed drop in percentage points before the gate fails. */
  thresholdPct: number;
  /** True when the speedup dropped by MORE than `thresholdPct` percentage points. */
  regressed: boolean;
}

/**
 * Median of a list of non-finite-filtered numbers (does NOT mutate the input). Even counts
 * average the two middle values. Returns 0 for an empty/all-non-finite list — call sites
 * treat that as "no usable baseline".
 *
 * Note: this variant filters out non-positive values; use {@link medianOfPct} for signed
 * metrics like speedup percentages where negative values are legitimate.
 *
 * @param {number[]} values The values to summarize.
 * @returns {number} The median, or 0 when there is nothing to summarize.
 */
export function medianOf (values: number[]): number {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * Median of a list of signed numbers (does NOT mutate the input). Only non-finite values
 * are filtered — negative and zero values are legitimate. Even counts average the two middle
 * values. Returns null when there are no finite values (clear "no baseline" signal).
 *
 * @param {number[]} values The values to summarize (may include negatives/zeros).
 * @returns {number | null} The median, or null when nothing usable is present.
 */
export function medianOfPct (values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * Evaluate whether a benchmark run regressed against its baseline speedup.
 *
 * A regression is strictly beyond the threshold: exactly at the threshold still passes.
 * Improvements (speedup increased, negative drop) always pass. Non-finite inputs can't be
 * compared — `dropPct` is reported as 0 and `regressed` is false, so call sites treat
 * "no usable baseline" as report-only.
 *
 * @param {number} currentPct Current run's speedup % (how much faster nbs is than gulp).
 * @param {number} baselinePct Baseline speedup % — the median of ALL prior records' speedups.
 * @param {number} thresholdPct Allowed drop in percentage points (e.g. 15 => 15pp).
 * @returns {GateResult} The evaluation, including the drop for display.
 */
export function evaluateGate (currentPct: number, baselinePct: number, thresholdPct: number): GateResult {
  const comparable = Number.isFinite(currentPct) && Number.isFinite(baselinePct);
  const dropPct = comparable ? Math.round((baselinePct - currentPct) * 10) / 10 : 0;
  return {
    baselinePct,
    currentPct,
    dropPct,
    thresholdPct,
    regressed: comparable && dropPct > thresholdPct
  };
}
