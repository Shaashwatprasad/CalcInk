# Delivery status

6 October 2026 — finished local candidate on `codex/finish-calcink`, based on the existing V2 application. Incremental equation tracking/evaluation, retained rendering, typed math, text/lasso editing and Current/History are implemented and independently reviewed. Repository handoffs, raw task logs and obsolete scaffolding were removed; README and architecture describe the actual product.

Passed: pinned installation; typecheck; lint; formatting; 285 unit/integration tests; 4 registry contract tests; production build; 7 real-model/offline E2E cases and 45 product browser cases. Browser validation used isolated preview ports with headless Chrome 155 on Apple M5. Synthetic regression evidence does not imply handwriting accuracy or physical stylus certification.

Measured 200-equation edit: one recognition job, one parse and one evaluation; 199 unchanged projection references, all answers retained. Candidate grouping carried 18 strokes versus 1,200 previously. Renderer callback p95 fell from 6.4 ms to 0.6 ms in the separate controlled workload. Reusable scripts and compact environment/results remain under benchmark and benchmark-data.

GitHub publication and hosted CI are the next integration steps. General handwritten names, nested handwritten fractions, writer-diverse accuracy, physical-device validation and automatic old-cache reclamation remain documented limitations.
