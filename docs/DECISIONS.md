# Design decisions

- Vector ink, scoped masks and immutable transactions remain authoritative; retained Canvas pixels are disposable caches. Damaged redraw clips in device pixels and queries using the same rounded world region so edge antialiasing is preserved.
- Active previews retain bounded damage rectangles but replay complete gesture geometry: appending pressure/alpha segments changes caps and compositing. Native comparisons at DPR 1 and 2 cover pressure, pencil, highlighter and eraser previews.
- Masked/translucent scratch work is bounded to current stroke geometry in device pixels. Pan-only camera movement shifts retained committed pixels by integer device deltas and replays exposed strips; canonical replay after 100 ms or invalidation restores exact subpixel positioning. Details and tradeoffs: [pan compositing](decisions/007-pan-compositing.md).
- Autosave waits for the existing drawing/camera lock to clear; this adds no React state or persistence work to pointermove. Explicit notebook operations still flush the latest immutable snapshot.
- Recognition status changes reuse unchanged projection arrays, while actual content/revision changes publish new arrays. Typed math follows immutable object identity; calculation history follows document/projection identity.
- Equation identity is independent of its complete stroke set. Cached ownership and finite nearby rectangles replace cascading, horizontally unlimited invalidation. Reconciliation decides which candidate equations actually changed.
- Model inference stays in a worker with a real audited checkpoint. Queue/revision guards apply per equation, rather than invalidating unrelated in-flight results.
- Geometry proposes bounded segmentation alternatives; the classifier compares them before accepting a uniquely confident plausible reading. A wide digit alone is not evidence of joined symbols. An equation-level recognition error retains known dependency hints, withholds that row's answer and drains later jobs without clearing unrelated calculations.
- AST/result caches depend on canonical expression state and specific preceding variable definitions. Rebindings and pending/deleted definitions alter only affected consumers. Typed math shares this evaluator while ordinary text remains an annotation.
- The verified Dataset II model has sixteen classes. Letter/slash classes are not fabricated in its manifest. General variable identifiers work in typed math; handwritten x uses the existing crossing correction and other handwritten names remain unsupported.
- Division-by-zero feedback follows the latest product request: “Cannot divide by zero”, replacing the older blanket “Undefined” requirement. Nonfinite results still display “Undefined”.
- Calculation history is derived from live equations, one stable record per equation, newest completed content first. Undo and source deletion reconcile records; reload regenerates rather than persisting derived math.
- Source/model/runtime/font licenses, conversion evidence and reusable tests/benchmarks remain in the repository. Obsolete implementation handoffs and raw task logs are removed; prior versions remain in Git.

Technical rationale: [vector layers and erasure](decisions/002-ink.md), [safe math](decisions/003-math.md), [model/runtime](decisions/004-model.md), [incremental updates](decisions/006-incremental.md).
