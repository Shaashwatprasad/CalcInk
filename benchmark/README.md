# Synthetic scalability measurements

These fixtures are deterministic machine-generated wave strokes. They are **not human handwriting**, an accuracy dataset or evidence of handwriting recognition. The harness imports actual ink/grouping/preprocessing code, bundles it in memory with the lockfile's esbuild dependency and runs the operations locally. It does not change the production build or run inference.

## Reproduce

From the repository root after `npm ci`:

```sh
npx playwright install chromium
node benchmark/run.mjs benchmark-data/my-local-run.json
```

An existing compatible Chromium executable can be selected with `CALCINK_BROWSER_EXECUTABLE`. The recorded run used:

```sh
CALCINK_BROWSER_EXECUTABLE='/Users/shaashwatprasad/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' node benchmark/run.mjs
```

On a sandboxed workstation Chromium may require approval to launch. No package script/config changes are necessary. The runner writes only the requested JSON report and uses a standalone blank browser page.

## Recorded environment and method

Evidence: [`local-synthetic-2026-10-02.json`](../benchmark-data/local-synthetic-2026-10-02.json), collected 2 October 2026 at 22:51 IST. Apple M5, 10 logical CPUs, 24 GiB memory, Darwin 25.6.0 arm64; Node 26.3.0; headless Chromium **153.0.8010.12**. Device pixel ratio 1, canvas 1280 × 900, no CPU throttling. Other implementation/build work may have run concurrently, so this is a local observation rather than an isolated benchmark certification. The JSON records the base commit and states explicitly that imports came from the working tree.

Each document has 500/1000/5000 strokes, 16 points per stroke, 40 columns and row spacing 48 CSS units. The masked fixture places one partial erase mask on every 25th stroke (4%). Larger documents extend below the viewport; full replay processes their paths without culling and Canvas2D clips their pixels. Node operations use one unrecorded warm-up and seven samples; browser operations use one warm-up and five samples. p50/p95 use nearest rank, so p95 is the maximum with these small sample counts. All raw samples are retained. Preparation of a store before append and undo/redo is excluded from those timings; store recovery is measured separately.

## Results

Values are **p50 / p95 milliseconds**, rounded to two decimal places. Node and browser operations run in different environments and should not be compared as equivalent workloads.

| Operation                                  |   500 strokes |  1000 strokes |        5000 strokes |
| ------------------------------------------ | ------------: | ------------: | ------------------: |
| Node append one two-point stroke           |   0.35 / 0.47 |   0.66 / 0.71 |         3.62 / 7.02 |
| Node undo followed by redo                 |   0.60 / 0.62 |   1.12 / 1.18 |         5.80 / 7.23 |
| Node swept-path hit query over all strokes |   0.05 / 0.13 |   0.05 / 0.07 |         0.11 / 0.17 |
| Node JSON serialization                    |   0.45 / 0.48 |   0.88 / 0.94 |         4.52 / 6.33 |
| Node store recovery/clone/freeze           |   2.79 / 3.03 |   5.64 / 6.18 |       30.18 / 31.05 |
| Node equation grouping                     |   3.81 / 5.68 | 10.39 / 11.04 | **223.22 / 271.22** |
| Node symbol grouping across all equations  |   0.05 / 0.07 |   0.03 / 0.03 |         0.15 / 0.28 |
| Chromium unmasked Canvas2D replay          |   0.20 / 0.40 |   0.40 / 0.50 |         1.80 / 1.90 |
| Chromium masked Canvas2D replay            |   0.60 / 0.90 |   2.00 / 2.20 |   **22.40 / 22.50** |
| Chromium preprocessing all symbols         | 26.70 / 27.60 | 48.50 / 75.30 |     300.10 / 317.20 |

The preprocessing batches contain respectively 500, 1000 and 5000 synthetic symbols. These are whole-document batch costs, not per-symbol or inference times. Every measured rasterization uses the actual 50 × 50 RGB tensor conversion and persisted erase masks.

## Risks and remaining measurements

The initial `groupEquations` implementation repeatedly rebuilds line bounds during every candidate comparison. Its measured 5000-stroke cost is a serious long-task risk where `src/app/recognizer.ts` invokes it on the UI thread. Cached/incremental bounds or moving grouping into the worker should be evaluated; save a separate report after changes rather than replacing the baseline measurements.

Masked replay exceeds the 16.67 ms budget of a 60 Hz frame at 5000 strokes even before display completion. Scratch-layer compositing and document-wide mask scans need profiling; viewport/dirty-region rendering and mask indexing are candidate improvements.

Canvas replay measures synchronous CPU command submission only. It does not force GPU/display completion, include rAF scheduling or prove actual display frame rate. No continuous pointer input during inference, physical stylus/touch testing, low-end device, worker inference, long-task trace, peak memory or heap-leak evidence is supplied by this harness. These results do **not** establish universal 60 FPS or any model accuracy claim.
