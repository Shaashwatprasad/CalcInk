# Delivery status

6 October 2026 — application integrated into `main` through [PR #6](https://github.com/Shaashwatprasad/CalcInk/pull/6), merge `cd6fdf0`. Incremental equation tracking/evaluation, retained rendering, typed math, text/lasso editing and Current/History are implemented and independently reviewed. Repository handoffs, raw task logs and obsolete scaffolding were removed; README and architecture describe the actual product.

Passed: pinned installation; typecheck; lint; formatting; 286 unit/integration tests; 4 registry contract tests; 14 browser preprocessing contracts; production build; 7 real-model/offline E2E cases and 45 product browser cases. Browser validation used isolated preview ports with headless Chrome 155 on Apple M5. Synthetic regression evidence does not imply handwriting accuracy or physical stylus certification.

Measured 200-equation edit: one recognition job, one parse and one evaluation; 199 unchanged projection references, all answers retained. Candidate grouping carried 18 strokes versus 1,200 previously. Renderer callback p95 fell from 6.4 ms to 0.6 ms in the separate controlled workload. Reusable scripts and compact environment/results remain under benchmark and benchmark-data.

Both hosted check runs passed on application commit `3954649`, including the complete ML/product report validators. The merged tree matches the verified local application. The earlier V2 candidate from PR #5 is included in this integration.

Production launch: `npm ci`, `npm run build`, `npm run preview`. Public deployment is pending manual dispatch of [Prepare and deploy GitHub Pages](https://github.com/Shaashwatprasad/CalcInk/actions/workflows/pages.yml) on `main` from an authenticated browser. The connector cannot dispatch workflows, and desktop browser control is unavailable; the user prefers their own browser. Hosting eligibility and a public URL have not been verified. If prompted, configure Pages to use GitHub Actions without changing repository visibility or access.

General handwritten names, nested handwritten fractions, writer-diverse accuracy, physical-device validation and automatic old-cache reclamation remain documented limitations.
