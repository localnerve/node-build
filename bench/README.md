# node-build-stream · benchmark (vs gulp)

Measures the performance of **node-build-stream** and compares it to **gulp**, using the
`examples/webapp` pipeline as a realistic workload. Modeled after the author's debug bench
([localnerve/debug `bench/bench-node`](https://github.com/localnerve/debug/tree/public-package/bench/bench-node)) —
a TypeScript entry that runs directly via Node 24 native type-stripping and times work with
`process.hrtime.bigint()`.

## What it measures

A full build **cannot** be looped 100k× like a hot-function microbenchmark, so this harness
runs the **real webapp pipeline N times per runner** and records wall-clock time for each.
Each runner gets `warmup(1) + runs(3)` by default (honest, not extravagant — the pipeline is
I/O bound, so a couple of timed runs is enough); override locally with `--runs <n>` / `--warmup <n>`.
We report `min / mean / median / max` plus the raw samples so variance is visible.

- **nbs side** reuses `examples/webapp` **as-is**: the harness spawns
  `node <root>/bin/nbs.mjs --config examples/webapp/build.mjs` (cwd = `examples/webapp`, prod).
- **gulp side** runs a faithful equivalent pipeline in [`gulpfile.mjs`](./gulpfile.mjs) over the
  same inputs (`examples/webapp/src/**`) into a separate `dist-gulp/` dir.

Measurement is **wall-clock of the real CLI** (startup + full build), which is what users feel —
not an in-process import. The harness itself has zero runtime dependencies
(`node:child_process` + `node:fs` only).

## Over-time model

Results are **append-only** to [`results/history.jsonl`](./results/). One record per invocation:

```jsonc
{ "ts": "...", "commit": "...", "dirty": false, "node": "v24.x", "runs": 3, "warmup": 1,
  "systems": {
    "nbs":  { "min": 0, "mean": 0, "median": 0, "max": 0, "samples": [ /* ms */ ] },
    "gulp": { "min": 0, "mean": 0, "median": 0, "max": 0, "samples": [ /* ms */ ] }
  } }
```

The committed history is the source of truth for performance-over-time trends. Points accumulate
from maintainer local runs (see [How points accumulate](#how-points-accumulate)); CI gates only.
`npm run report` reads the file and prints a per-invocation trend table.

## Usage

```sh
cd bench
npm install          # first time only (harness devDeps + gulp v5 + webapp-parity plugins)
npm run bench        # run the comparison, print a styled summary, append one history record
npm run bench -- --runs 10 --warmup 2   # more timed runs for a local deep-dive
npm run gate         # CI mode: 3 invocations, gate median-of-medians vs prior history (+15%)
npm run report       # over-time trend table from results/history.jsonl
npm run report -- --json   # same data as a single JSON document on stdout (for CI)
```

Flags: `--runs <n>` (timed runs, default 3), `--warmup <n>` (untimed warmup, default 1),
`--report` (over-time mode), `--json` (with `--report`: print one JSON document on stdout —
and nothing else — with `{ source, count, latest, records[] }`; each row carries
`ts / commit / dirty / node / warmup / runs / nbsMedianMs / gulpMedianMs / deltaPct`),
`--threshold <pct>` (allowed regression vs the baseline, default 15), `--no-gate`
(report timings but never fail on regression), and `--gate [n]` (CI mode: perform n full
invocations, default 3). Each `npm run bench` appends exactly one record and then runs the
**regression gate**: this run's nbs median is compared against the **median of ALL prior nbs
medians** in history (a run is never compared against itself; one noisy record can't move the
baseline), exiting non-zero when it regressed beyond the threshold. `npm run gate` runs 3
invocations and gates the **median of their medians** — a single noisy run can't trip it.
No committed history yet → report only, exit 0. `--report` only reads the file (it performs no
runs and appends nothing). The harness shells out to the real CLIs and measures wall-clock time
— it has zero runtime dependencies of its own.

## How points accumulate

`results/history.jsonl` is **append-only** and committed; it is the source of truth for
performance-over-time trends. Points are added by **maintainers running `npm run bench` locally
and committing the new record**. CI (`.github/workflows/verify.yml`, step *Benchmark
(regression gate)*) runs `npm run gate` on PRs as a **regression gate only** — 3 benchmark
invocations whose median-of-medians is compared against the median of all prior nbs medians,
failing beyond +15% (overridable with `--threshold`) — but does **not** commit new history, so
the baseline stays maintainer-controlled.
`npm run report` renders the committed history as a per-invocation trend table (nbs vs gulp
median + Δ%); add `--json` (`npm run report -- --json`) for a machine-readable version CI can
parse to make gate decisions.

## Status

See `tmp/session-restore-packet.md` for the chunk plan.

- **Done (Chunks 1–6, complete):** subproject scaffold; timing core
  (`src/lib/{types,timing,git,gate}.ts`); the gulp parity pipeline (`gulpfile.mjs`, verified
  byte-identical to the nbs webapp build); the one-shot harness (`src/index.ts`) that times both
  runners, prints a styled comparison, appends one record per run, and runs the regression gate
  (`--threshold` / `--no-gate`); the over-time `--report` trend table (+ `--json`) seeded with a
  first committed baseline point; and the CI wiring in `.github/workflows/verify.yml`.

`results/history.jsonl` is append-only and committed; it is the source of truth for trends.
