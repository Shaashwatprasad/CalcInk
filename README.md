# CalcInk

CalcInk is a private, on-device notebook for handwritten arithmetic. Write an expression ending in `=` to place its answer beside the ink. Editing an equation updates that answer and any dependent calculations; unrelated answers stay visible.

Pen, pencil and highlighter support colour, width and optional pressure. Whole-stroke and partial erasers, undo/redo, lasso selection, movement, resizing, duplication and deletion preserve the vector document. Add ordinary text, shapes, arrows and dashed regions; **Edit** changes selected text. Enable **Calculate as math** in the text editor to calculate typed expressions or define named variables such as `total=3.5`. Current shows the active calculation; History lists five completed calculations first, with older records accessible.

Pan and zoom move ink, annotations and answers together. Notebook names, switching, import/export, themes and paper patterns are available. Notebooks save in IndexedDB on this device; export JSON for a portable backup. Clear is undoable. Undo history contains up to 100 transactions per session. Calculation history is derived from current equations, one record per equation; editing updates that record, deleting removes it, and reload regenerates it.

## Local setup

Use Node.js 22.18 or newer and npm. A current Chromium browser with Canvas2D, Pointer Events, workers, WASM and worker OffscreenCanvas supports recognition.

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. To run the production application:

```sh
npm run build
npm run preview
```

The pretrained model is committed at `public/models/symbols.onnx`, with its manifest, license and conversion evidence. Development startup and the build copy matching ONNX Runtime Web 1.22.0 WASM/module files from the pinned dependency into `public/runtime/`; no separate model download or Python installation is needed to run CalcInk. Reconstructing the model is optional and documented in [scripts/model/README.md](scripts/model/README.md).

Production builds generate a versioned same-origin offline cache. Serve over localhost or HTTPS, load once, and wait for **Offline ready** before disconnecting and reloading. That badge requires cached assets and a runnable model. Development does not install the service worker.

## Recognition and math

Recognition uses [Rafi Ibn Sultan’s Dataset II CNN](https://github.com/rafiibnsultan/Math_Symbols_Classify/tree/0f90d32afb1e4d8416b3d0c4adf4ce1748d86a16), pinned at `0f90d32`. The FP32 ONNX model accepts RGB float32 NHWC `[1,50,50,3]`, black ink on white divided by 255, and returns 16 softmax classes: `0–9`, `+`, `.`, `÷`, `=`, `×`, `−`. Its SHA-256 is `2fdae454d72c885e12718cc810c3a40513f0338c933fc19dc1bd6fe3ad108786`. Runtime checks the manifest, artifact hash and warm-up output before announcing readiness. See the [model audit](docs/MODEL-AUDIT.md).

All production recognition and calculation run locally. A dedicated worker performs grouping, mask-aware rasterization, preprocessing and inference using single-threaded WASM. There are no production cloud inference or math calls.

Write separated symbols of similar size. Slash and simple stacked fractions use geometry outside the model’s class vocabulary. Crossing ink can represent `x` in operand positions, with a revision-bound **Variable x / Multiply ×** correction. The model has no general letter classes: arbitrary handwritten variable names remain unsupported. Typed math supports case-sensitive identifiers such as `price`, `rate2` and `_subtotal`. Definitions apply to later equations in spatial notebook order, with later definitions rebinding subsequent consumers. Self-referential definitions are rejected.

The bounded parser supports decimals, unary signs, parentheses and the four basic operations with normal precedence and left associativity. Math strings are never executed as code. JavaScript binary floating point is displayed to twelve significant digits. Division by zero shows **Cannot divide by zero**; incomplete, malformed or uncertain input withholds its answer. Nested handwritten fractions, handwritten parentheses, touching glyphs and unrestricted letter handwriting remain limitations. Confidence thresholds are uncertainty guards, not calibrated accuracy estimates; no writer-diverse accuracy claim is made.

## Architecture

- `src/document` stores immutable vectors, targeted erasure masks, annotations and reversible transactions. Text marked as math is canonical source; computed answers are derived.
- `src/render` owns committed ink, active ink, answer and annotation canvases. Drawing uses animation frames outside React’s render loop. Retained pixels, clipped damaged areas and viewport culling avoid replaying the entire page for a local edit. Active gestures clear only their previous pixel bounds before canonical replay, preserving pressure and translucent joins.
- `src/recognition` tracks stable equation identities, revisions and stroke ownership. Change events select cached nearby candidates; reconciliation preserves unchanged groups. Bootstrap groups the document once; later worker requests contain only candidate vectors and masks.
- `src/workers` runs the verified classifier and compares up to four segmentation candidates. Queued jobs coalesce per equation; identity, generation, revision, request and model/preprocessing versions reject stale replies. A bounded symbol cache includes vector, mask and model/preprocessing identity. A failed equation does not clear other answers or stop later jobs.
- `src/math` caches parsed ASTs and outcomes. Dependencies bind to specific preceding definitions. Changed expressions evaluate fully; consumers reuse their AST and reevaluate when their dependency context changes.
- `src/projection` maintains stable answer objects, local pending states, diagnostics, corrections and calculation history. Status-only updates reuse the answer array; history recalculates when that array changes.
- `src/persistence`, `src/offline` and `src/viewport` handle serialized IndexedDB saves that wait for pen-up, offline assets and shared camera transforms. `src/app` supplies React controls; `src/metrics` supplies optional frame observations.

Dependencies are React 19.1.1, ONNX Runtime Web 1.22.0 and the pinned Vite/TypeScript toolchain. [Architecture and contracts](docs/ARCHITECTURE.md), [design decisions](docs/DECISIONS.md), tests under `tests/`, and reusable measurements under `benchmark/` provide more detail. Model/runtime/font notices remain in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Checks and troubleshooting

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
CALCINK_PRODUCT_REQUIRED=1 npx playwright test --config playwright.product.config.ts --workers=1
```

`npm run test:ml` and `npm run test:product` retain machine-readable reports under ignored `test-results/`. [Validation](docs/VALIDATION.md) distinguishes regression evidence from handwriting accuracy and physical-device measurements. Open `?debug=true` to inspect queue, revision, worker duration and frame interval observations.

For repeatable synthetic drawing checks, run `node benchmark/render-benchmark.mjs` or, with a production preview running, `node benchmark/notebook-benchmark.mjs http://127.0.0.1:4173/ /tmp/notebook-latency.json`. The latter exercises 20 equations with the real model and autosave. Measurements describe the recorded hardware/browser; they do not establish universal frame rates.

If the recognition worker fails, **Retry** recreates it; drawing and typed math remain available. An individual failed equation can be edited or rewritten. If no answer appears, check Current for recognized text and pending/uncertain/syntax feedback. Large separated symbols help; export failing ink with its intended expression to reproduce a recognition problem. If storage fails, export before closing. If offline reload fails, reconnect and wait for Offline ready; confirm the model and matching `.wasm`/`.mjs` assets are served from the same origin with correct MIME types.

For GitHub Pages, the existing manual workflow builds with `CALCINK_BASE=/CalcInk/`. Other static hosts can serve `dist/` with the default relative base. Hosting must preserve worker/runtime paths and service-worker scope.

Source is [Apache-2.0](LICENSE). The model ships its [MIT notice](public/models/LICENSE); ONNX Runtime and bundled fonts retain their separate notices and attribution.
