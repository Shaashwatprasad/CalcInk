# Delivery status

7 October 2026 — CalcInk includes incremental equation tracking/evaluation, retained ink and answer rendering, typed math, text/lasso editing, undoable erasure, named notebooks and Current/History. The prior application was integrated through [PR #7](https://github.com/Shaashwatprasad/CalcInk/pull/7), merge `9546f94`. README and architecture describe the shipped source and its model limitations.

The drawing performance follow-up bounds active preview clearing, publishes each stroke change once, reuses unchanged answer arrays, memoizes history reconciliation and defers automatic notebook saves until pen-up. A delayed IndexedDB completion regression also verifies that queued snapshots wait if the next stroke has begun. No model or runtime dependency changed. Pressure, pencil, highlighter and eraser previews match canonical native Canvas replay at DPR 1 and 2, with no remaining preview pixels after pen-up.

Passed locally: typecheck, lint, formatting, production build, 299 unit/integration tests, 4 registry contract tests, 14 browser preprocessing contracts, 8 real-model/offline E2E cases and 46 product browser cases. The registry still distinguishes passing executable workflows from unsupported physical-device/handwriting-quality evidence; these limitations are not hidden by green regression results.

The full-app synthetic workload verifies 20 solved equations before continued drawing, with real recognition and autosave enabled. Active cleared pixel area fell from 843,864,480 to 190,580; notebook writes during active gestures fell from 18 to zero. Baseline and candidate both had frame-interval p95 near 16.8 ms on Apple M5 / Chrome 155: severe device jitter was not reproduced, and no universal frame-rate claim is made. Reusable scripts and source/environment/results remain under benchmark and benchmark-data. A separate 200-equation regression preserves 199 unchanged answers while recognizing/evaluating one edited equation.

Production launch: `npm ci`, `npm run build`, `npm run preview`. Public deployment still requires an authenticated user to configure Pages with GitHub Actions if prompted and dispatch [Prepare and deploy GitHub Pages](https://github.com/Shaashwatprasad/CalcInk/actions/workflows/pages.yml) on `main`. The connector cannot dispatch it; hosting eligibility and a public URL remain unverified. Repository visibility and access must stay unchanged.

General handwritten names, nested handwritten fractions, writer-diverse accuracy, physical-device validation and automatic old-cache reclamation remain documented limitations.
