# PAN-FIX integration and independent review return

Task: PAN-FIX. Branch: `codex/fix-pan-compositing`, based on `bdcd47c`. Integration commit is recorded in Git. Root owns application integration and documentation; PAN-TEST owns the native benchmark/report; PAN-REVIEW independently reviews source and runs native checks. Agents share the checkout with disjoint write ownership; only root operates the Git index. No recursive delegation.

Changed files:

- `src/ink/geometry.ts`: stroke-sized scratch work, capacity reuse, cropped copies, mask index.
- `src/render/mountInk.ts`: integer retained-pan copies, exposed-strip replay, residual accumulation, exact settlement and invalidation.
- `tests/unit/ink-render.test.ts`, `tests/unit/ink-v2.test.ts`: coordinate/copy/clear-aware test rasterizers, scoped masks/alpha and bounded operation checks.
- `tests/unit/ink-pointer.test.ts`: pan replay, subpixel accumulation, settlement, immediate drawing/edit and disposal tests.
- `benchmark/pan-compositing.mjs`, `benchmark-data/pan-compositing.json`: separately bundled baseline/candidate, native pixels, raw rAF timings and operation budgets.
- `benchmark/README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/decisions/007-pan-compositing.md`, this review: behavior, rationale, measurements, limitations and resume state.

Exact accepted checks:

- `npm ci --offline`: installed pinned lockfile; passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test`: 304 tests across 28 files passed.
- `npm run build`: production bundle and 31-asset same-origin offline cache passed.
- `node --test tests/registry/check-registry.test.mjs`: 4 passed.
- `CALCINK_TEST_PORT=4287 CALCINK_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx playwright test --workers=1 --output=test-results/pan-e2e`: 8 passed.
- `CALCINK_TEST_PORT=4287 CALCINK_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' CALCINK_PRODUCT_REQUIRED=1 npx playwright test --config playwright.product.config.ts --workers=1 --output=test-results/pan-product`: 46 passed.
- `node benchmark/pan-compositing.mjs`: 274 native comparisons and fullscreen operation-budget assertions passed. Report hashes match final geometry and renderer source. Timing is measured and descriptive, not a flaky CI threshold.
- `git diff --check`: passed.

PAN-REVIEW found a blocking unchanged-dimension resize case: canceling settlement without marking committed ink dirty could leave a snapped image indefinitely. Root corrected `resized()` to require a full redraw. Independent native checks then passed 24 retained-pan lifecycle comparisons at DPR 1/2 (alpha delta ≤1/255, premultiplied color ≤1.36/255), plus 128 affine scratch comparisons (alpha delta ≤1/255). No remaining blocking finding. The committed benchmark independently covers the relevant behavior and is the reusable reproduction; ad hoc reviewer scripts were temporary local diagnostics.

Contract changes: none. Vector ink/masks, history, persistence, worker coordinates and projection APIs are unchanged. During movement, the committed raster can temporarily differ by half a backing pixel from the requested camera; exact idle replay and drawing/edit invalidation restore canonical positions. Integer replacement copies avoid opacity ghosts and accumulated fractional resampling.

Risks/remaining work: headless synthetic timing does not certify interactive fullscreen behavior on every GPU or physical stylus/touch device. Dense idle/zoom full replay remains possible. Extreme world coordinates and arbitrary antialiased clip paths retain native Canvas precision/coverage limits. Hosted CI and publication are recorded on the GitHub pull request for this branch; the connector is used because command-line HTTPS credentials are unavailable. No human review or full submission completeness was fabricated.
