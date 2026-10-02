# Progress ledger

Status (2 October 2026): implemented baseline; final integration/CI underway. Competition release gates remain unmet.

Repository: https://github.com/Shaashwatprasad/CalcInk (private). Remote starting commit `cf1589241d32ea177bdd2aae3bc48c013748e551`; local imported snapshot `6e6ff10582d2bdb7aecbcac91614469c07cdf2bd`; working branch `codex/feat/calcink-baseline`. Connector Git-object publication preserves the actual remote parent; terminal Git authentication is unavailable. Issues #2 (baseline) and #3 (model/evidence) exist. User approved merge after checks and preparation of GitHub Pages; public Pages eligibility/setup remains to verify.

## Implemented and reviewed

- T01/T02: pinned React/TypeScript/Vite, lockfile, Vitest, ESLint/Prettier, production browser checks, shared discriminated protocols, CI.
- T03/T04: vector ink, rAF drawing, pointer capture/coalesced samples, DPR/resize, dots/endpoints, stroke/persistent partial erasure, undo/redo/clear, bounded100-transaction history. Active gestures retire on clear/import.
- T05/T06/T07: pinned real Dataset II checkpoint/architecture/labels/preprocessing/license audit, reproducible FP32 ONNX export, Keras/ONNX parity, manifest/hash checks and runnable WASM worker warm-up. No production mocks.
- T08/T10: bounded arithmetic parser, Unicode operators, decimals/unary negatives, twelve-significant-digit display, typed incomplete/invalid/Undefined results, per-equation request/version/generation guards, immediately retired edited answers.
- T11/T12/T13: notebook/tool UI, accessible controls/status, import/export, validated versioned IndexedDB, serialized saves, same-origin model/runtime assets, atomic versioned production cache and verified offline-ready status.
- T09 performance repair: worker-side line grouping and runtime grouping-response validation; only current document generation/revision groups may schedule inference. This supersedes the initial main-thread grouping path measured in the first benchmark.
- T17: quick start, ADRs, model/license inventory, independent reviews, original competition PDF archived without editing it. No human contribution evidence invented.

## Actual evidence

- Latest completed combined unit snapshot before worker-grouping refinement:104 tests passed, including real pretrained ONNX Runtime Web WASM execution. Typecheck/lint/format passed.
- Production browser snapshot before grouping refinement:4/4 passed in7.6s on installed headless Chromium149 (Playwright1.55 with explicit executable override because pinned local Chromium download was incomplete). Synthetic vectors verify `1+1=2`, pixel edit to`11+1=12`, undo/redo, offline reload and equals erasure. Drawing/DPR/resize/persistence and offline pixel erasure also pass. External runtime requests:0. Final refinement is being checked again; CI uses pinned Chromium on Linux.
- Conversion:8/8 synthetic tensors agree top1; maximum absolute deviation1.19e-7. ONNX9,310,762bytes, SHA-256`2fdae454d72c885e12718cc810c3a40513f0338c933fc19dc1bd6fe3ad108786`. Synthetic tensors/ink do not prove handwriting accuracy.
- Independent source reviews: `docs/REVIEW.md`, `docs/REVIEW-MATH.md`. Findings repaired include hosting paths, active gesture retirement, nested message validation, imported bounds, recovery/save races, silent recognition failures and frame-monitor lifecycle. Browser model cache writer collision was reproduced and repaired with no-store HTTP fetches; offline Cache API remains active.
- Benchmark: `benchmark-data/local-synthetic-2026-10-02.json`, AppleM5/24GiB/Darwin25.6/Node26.3/headless Chromium153; 500/1000/5000 generated documents. Initial5000-stroke grouping p50/p95:223.22/271.22ms; masked canvas command submission22.40/22.50ms; all-symbol preprocessing300.10/317.20ms. These prompted worker grouping. They are timing evidence on one machine, not a universal60FPS or accuracy claim.

## Blockers and next actions

Finish worker-grouping review/tests and publication; await real GitHubCI before user-authorized merge. Pages workflow is prepared with explicit`/CalcInk/` paths and manual dispatch; no public deployment URL exists yet.

The user can provide live mouse/stylus/touch ink through notebook JSON export. Writer-diverse samples/all-class accuracy, required`18+4×3=30`→pixel-edit`33` scenario, physical-device responsiveness, memory/long-session evidence and two-version cache updates remain release gates. Geometry merges touching neighboring glyphs; confidence is uncalibrated. Recognition requires worker OffscreenCanvas. WebGPU comparison is pending; WASM is the actual implemented provider. Large full replay, serialization and worker transfer costs need further measurement/optimization; no blanket60FPS claim. Preserve this baseline and address the next ready evidence tasks; do not regenerate it.
