# Decision ledger

Accepted: TypeScript/React/Vite, Canvas2D, vector document, layered rendering, worker recognition, deterministic TypeScript math, versioned IndexedDB, offline asset cache, revision-safe projections and reviewed Git workflow.

Validated during implementation: pinned Dataset II source, exact16-class RGB50×50 NHWC preprocessing, MIT model notice, FP32 ONNX graph reconstruction/parity, actual WASM warm-up and synthetic browser arithmetic/edit/offline paths. Details in docs/MODEL-AUDIT.md and ADRs001–004. The user approved merging after checks and preparing GitHub Pages. Accuracy and release evidence remain conditional; upstream accuracy is not CalcInk accuracy.

Measured lesson: initial main-thread line grouping took223ms p50 at5000 generated strokes on the declared local machine. Move grouping to the worker and validate GROUPS against current document generation/revision. Cached line bounds avoid repeated union scans. Full masked replay still exceeds one60Hz frame at5000 strokes; retain that limitation and measure before optimizing further. Browser HTTP-cache writer contention on model load was reproduced; no-store network fetches coexist with the verified service-worker Cache API.

Conditional: Rafi Dataset II artifact; its claimed 50×50×3/16-class preprocessing details; ONNX conversion; WebGPU preference; optional quantization. Finalize only with recorded verification and benchmark evidence.

Deferred: handwritten variables/all-letter recognition, trig, graphing, C++/WASM math engine, highlighter and gesture erasure. ORT's WASM inference backend remains part of the baseline; it is separate from using C++ for the math parser.

Implementers create numbered ADRs under docs/decisions/ with context, alternatives, decision, evidence, consequences and status. Record meaningful changes here; do not rewrite prior evidence to make a failed experiment appear successful.
