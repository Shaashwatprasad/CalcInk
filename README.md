# CalcInk

A browser notebook for handwritten arithmetic. React/TypeScript/Vite controls sit above an imperative, layered Canvas2D ink engine. A dedicated worker runs a bundled pretrained CNN through ONNX Runtime Web WASM. Arithmetic runs through a bounded TypeScript parser; no remote inference or executable math strings.

## Run locally

Use Node.js 22.18 or newer:

```sh
npm ci
npm run dev
```

Production and checks:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run preview
```

The build copies matching ORT 1.22.0 WASM/module assets from the pinned dependency into the static output and generates a content-versioned, same-origin offline cache. Production requires localhost or HTTPS. Wait for **Offline ready** before disconnecting and reloading; that badge requires verified asset caching and actual model warm-up. Development does not install a service worker.

## Notebook controls

Write large, separated symbols and put each equation on a separate line. Recognition supports the pretrained model's 16 classes: digits, +, −, ×, ÷, decimal point, and equals. A confidently recognized terminal equals projects the result inline. Definitions such as x=2 feed later equations such as x+6=; edits retire stale dependent answers. Geometric slash and single fraction layouts feed the same safe math parser; unsupported nested layouts abstain. Results can be hidden or copied. Uncertain expressions withhold answers. Drawing stays available if recognition fails; **Retry** recreates its worker.

If no answer appears, check **Recognition feedback** below the notebook: it shows the model's recognized symbols and whether the expression is incomplete, invalid or uncertain. Start with `1 + 1 =`, using separated symbols of similar height. Variable x is interpreted from crossing ink in operand positions; use the per-symbol Variable x / Multiply × correction when needed. General letters remain outside this model's vocabulary. If symbols are misread, use **Export ink** and retain the intended expression alongside the JSON so the exact failure can be reproduced; synthetic fixtures do not establish accuracy on your handwriting. A loading/error status indicates a runtime problem rather than a completed recognition result.

Use Pen options for Pen, Pencil or Highlighter, colour, width and pressure. Eraser options offer whole-stroke or partial erasure and radius. Select/Lasso support move, corner resize, duplicate and delete. Text, Shapes, Box Region and Arrow create persistent annotations excluded from recognition. Hand controls pan/zoom; Canvas controls paper patterns and finite/infinite paper. Theme changes adaptive ink while explicit colours retain their identity. Undo/redo and confirmed Clear preserve reversible history. Clear is undoable. Pixel erasures target only strokes present during the erasing gesture, persist across reloads, and do not affect later ink. History retains 100 transactions in memory; current vectors and masks persist in IndexedDB. Name, create, open and delete notebooks stored on this device. Import replaces the active notebook and resets history; export first to retain another copy. Export JSON also provides real handwriting samples for validation. Answers are regenerated, never saved as authoritative ink.

Keyboard: P for pen, E for pixel eraser, Ctrl/⌘+Z to undo, Shift+Ctrl/⌘+Z or Ctrl/⌘+Y to redo. The canvas uses pointer capture and CSS document coordinates, with high-DPI backing stores. The debug view at `?debug=true` reports queue/stroke/revision data, worker duration, bounded frame interval percentiles and long tasks.

## Model and architecture

Pretrained checkpoint: [Rafi Ibn Sultan's Math_Symbols_Classify Dataset II](https://github.com/rafiibnsultan/Math_Symbols_Classify/tree/0f90d32afb1e4d8416b3d0c4adf4ce1748d86a16), under its bundled MIT notice. The six-convolution CNN accepts NHWC RGB float32 50×50 pixels, black ink on white, divided by 255, and outputs 16 softmax probabilities. The FP32 ONNX asset is committed, 9,310,762 bytes, SHA-256 `2fdae454d72c885e12718cc810c3a40513f0338c933fc19dc1bd6fe3ad108786`. Production checks its manifest/hash before loading.

[Model audit](docs/MODEL-AUDIT.md) records architecture/class/preprocessing evidence, training-data provenance limits and actual numerical parity. [Reproduction instructions](scripts/model/README.md) describe conversion; Python is build-time only. [Third-party notices](THIRD_PARTY_LICENSES.md) distinguish model/runtime terms from this repository's Apache-2.0 source license. No model training or fine-tuning was performed.

[Architecture](docs/ARCHITECTURE.md), [contracts](docs/CONTRACTS.md), [ADRs](docs/decisions), [validation gates](docs/VALIDATION.md), and [progress](docs/PROGRESS.md) document the implementation. Source requirements are archived at `docs/reference/Software-Dev-Bootcamp.pdf`.

Numbers use JavaScript binary floating point, displayed to twelve significant digits. Leading/trailing decimals `.5` and `5.` are accepted. Unary signs, precedence and parentheses are supported internally; handwritten parentheses are outside the model vocabulary. Division by zero/nonfinite arithmetic displays Undefined. Incomplete or malformed expressions withhold old answers.

## Status and limitations

This is a V2 project/demo implementation retaining the V1 architecture. Current verification and remaining gates are recorded in docs/PROGRESS.md and docs/evidence; project checks do not establish production certification. Synthetic conversion/runtime/vector fixtures prove specific contracts and are not a handwriting accuracy dataset. Actual writer-diverse samples, all-class accuracy, the required 18+4×3 edit scenario, representative physical-input/frame-time and memory measurements, and cache-update verification remain release gates. Touching digits can merge; segmentation and confidence thresholds need live validation. OffscreenCanvas in workers is required for recognition. WASM is the implemented provider; WebGPU comparison remains pending. No human contribution history is invented by agent work.

## GitHub Pages

The manual **Prepare and deploy GitHub Pages** workflow builds with `CALCINK_BASE=/CalcInk/`. Enable Pages with GitHub Actions as its source when account/repository hosting is eligible, then dispatch after release validation. The private repository may require a suitable GitHub plan for Pages. No public demo URL is claimed until deployment succeeds. Other static hosts can use the default relative build base; all runtime/model assets must retain same-origin paths, correct MIME types, and service-worker scope.

User approved merging a reviewed candidate after passing checks and preparing GitHub Pages. CI runs pinned installation, type/lint/format/unit/build checks and production browser tests. Review is independently performed by agents and does not represent a human GitHub approval.
