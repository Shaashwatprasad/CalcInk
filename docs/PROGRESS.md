# Project status

Updated 7 October 2026.

CalcInk includes vector ink and erasure, undo/redo, annotations, named notebooks, safe typed math, incremental handwritten recognition, derived answers/history, retained panning and offline production caching. The verified sixteen-class ONNX model runs locally in a worker.

The reorganized tree passes typecheck, lint, formatting, all 304 deterministic tests, production build, 4 registry contract tests, 8 real-model/offline browser tests, 46 required product browser tests and 14 native-browser preprocessing checks. Independent cleanup review found no blockers; the relocated historical evaluator also reproduced 399-to-1 evaluations with 199 unchanged projections. Browser checks used installed Chrome 155.0.8059.40 on Apple M5 / macOS with a dedicated preview port. Historical measured reports are unchanged.

The [pan report](benchmarks/pan-compositing.json) records 274 native pixel comparisons at DPR 1/2 and synthetic fullscreen measurements on Apple M5 / 24 GiB / headless Chrome 155. Frame-interval p95 changed from 233.4 ms to 16.8 ms for the recorded workload. See [validation](VALIDATION.md) for scope and the [layout decision](decisions/008-repository-layout.md) for distribution policy.

Writer-diverse accuracy, physical stylus/touch certification, general handwritten names, nested fractions, dense idle/zoom replay cost and old-cache reclamation remain limitations. Public deployment eligibility and a public demo URL remain unverified. No universal 60 FPS or human handwriting accuracy claim is made.

Calculated answers now display at most four decimal places while preserving full internal precision. Rounding, negative zero, large integers and chained arithmetic are covered by deterministic math tests.
