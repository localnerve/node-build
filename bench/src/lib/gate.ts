/**
 * CI regression gate — compares this run's nbs median against the last committed
 * baseline record and flags a regression beyond the allowed threshold.
 *
 * Pure + testable: no I/O, no process access. The harness (src/index.ts) reads the
 * baseline from results/history.jsonl and feeds it in here.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */

/** Outcome of one regression-gate evaluation. */
export interface GateResult {
  /** Baseline nbs median (ms) from the last committed history record. */
  baselineMs: number;
  /** Current run's nbs median (ms). */
  currentMs: number;
  /** Signed % change vs baseline, rounded to 1 decimal (positive => slower than baseline). */
  changePct: number;
  /** Allowed regression in percent before the gate fails. */
  thresholdPct: number;
  /** True when the run is slower than the baseline by MORE than `thresholdPct`. */
  regressed: boolean;
}

/**
 * Median of a list of numbers (does NOT mutate the input). Even counts average the two
 * middle values. Returns 0 for an empty/all-non-finite list — call sites treat that as
 * "no usable baseline".
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
 * Evaluate whether a benchmark run regressed against its baseline.
 *
 * A regression is strictly beyond the threshold: exactly at the threshold still passes.
 * Improvements (negative change) always pass. A non-positive baseline (missing/zero
 * median) can't be compared — `changePct` is reported as 0 and `regressed` is false,
 * so call sites treat "no usable baseline" as report-only.
 *
 * @param {number} currentMs Current run's nbs median in ms.
 * @param {number} baselineMs Baseline nbs median (ms) — the median of ALL prior nbs medians.
 * @param {number} thresholdPct Allowed regression in percent (e.g. 15 => +15%).
 * @returns {GateResult} The evaluation, including the signed change for display.
 */
export function evaluateGate (currentMs: number, baselineMs: number, thresholdPct: number): GateResult {
  const comparable = Number.isFinite(currentMs) && Number.isFinite(baselineMs) && baselineMs > 0;
  const changePct = comparable ? Math.round(((currentMs - baselineMs) / baselineMs) * 1000) / 10 : 0;
  return {
    baselineMs,
    currentMs,
    changePct,
    thresholdPct,
    regressed: comparable && changePct > thresholdPct
  };
}
