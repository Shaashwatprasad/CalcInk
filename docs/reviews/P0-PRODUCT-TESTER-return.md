# P0-PRODUCT-TESTER return

Task: P0-PRODUCT-TESTER. Branch: `codex/calcink-v2`. Inherited HEAD: `e5e48beb3a698282cc7e0ae14dd5f27375b89a44`. Changes are uncommitted integration work; no exact integrated commit or final acceptance is claimed. Supervisor owns Git and shared configuration.

## Owned files

- `tests/product/support.ts`: isolated production-browser helpers, actual pointer/UI/file chooser/download operations, unexpected browser/required-asset error guards and JSON evidence.
- `tests/product/baseline.spec.ts`: fourteen available behavior regressions for vector ink/style/persistence, genuine partial and whole erasure/history, shortcuts, import/export/rejection, Help/home, DPR/resize, real arithmetic/stale-answer invalidation, cached offline inference/edit/save, real model failure/Retry, Clear/history, runtime control drift, and projection Canvas2D failure resilience.
- `tests/product/diagnostics.spec.ts`: three diagnostics for active/committed ink parity, unchanged projection backing-store resets during real inference, and measured paper/viewport occupancy at specified widths. Occupancy observations do not accept final layout or universal frame rate.
- `tests/product/required-workflows.spec.ts`: sixteen executable `@v2-required` later acceptance workflows. They fail when missing V2 controls/behavior are enabled; they contain no skips, expected failures or fake inference. Some action-specific assertions are explicitly incomplete and remain coverage blockers.
- `tests/registry/feature-actions.json`: forty-one features (thirty-eight required and three optional), original R01–R12 and 125 action/state entries. Supported permutations describe required scope rather than delivered evidence.
- `tests/registry/check-registry.mjs`: schema/case/explicit assertion-anchor validation, exact commit/source identity checking, action result overlay, inventory and completeness gate. Exits 0 for valid inventory, 1 for schema/linkage errors, 2 for incomplete `--gate` acceptance.
- `tests/registry/check-registry.test.mjs`: four meaningful report/gate regressions using Node's test runner; synthetic report inputs test the checker and never constitute application behavior evidence.
- `docs/FEATURE-PRESERVATION.md`: feature map, commands, scope and honest limitations.
- This return file.

## Coverage contract changes

`coverage.actions.mapped` was removed because it only counted declared links. Its replacements are `denominator`, `declaredLinks`/`declaredLinkIds`, `meaningfulMapped`/`meaningfulMappedIds`, `uncovered`/`uncoveredIds`, and `planned`/`plannedIds`; existing `missingBehaviorCases`, `unimplemented` and `pendingOrFailed` arrays remain. Current source has **125 declared links, 20 meaningful available-baseline mappings, 105 uncovered actions: 62 planned integration cases and 43 missing behavior assertions**. There are 103 unimplemented actions and one unmapped required feature, F-SUBMISSION. `executableCaseInventory` remains compatible with the supervisor runner: 33 cases including 16 required V2 cases.

Meaningful baseline links include an owning test ID, human-readable claim, exact trigger source and exact assertion source. The checker verifies both snippets exist in that test body. This detects deleted/disconnected assertion links; it does not prove causal adequacy or replace independent review. `accepted` remains false pending review and integrated execution. Current-source reports never mark unimplemented, missing, planned or invalid links as passing merely because a broader workflow is green. Initial failed retries, skips and stale source identities do not pass.

The checker accepts `--registry=...` for isolated registry fixtures; the production runner uses the default tracked registry. The Node checker regressions need explicit `node --test tests/registry/check-registry.test.mjs` wiring because the existing Vitest include list does not select this file. Shared scripts/CI changes are supervisor-owned.

## Exact verification

- `npm run typecheck`: exit 0.
- `npm exec -- eslint tests/product tests/registry`: exit 0.
- `npm exec -- prettier --check tests/product tests/registry docs/FEATURE-PRESERVATION.md`: exit 0.
- `node --test tests/registry/check-registry.test.mjs`: 4 passed, 0 failed, 0 skipped; exit 0. Tests cover declaration/meaningful denominator separation and release blocking; invalid source assertion rejection; all-green workflows unable to pass missing/planned/unavailable actions; stale source identity and failed first attempts.
- `node tests/registry/check-registry.mjs --json=/tmp/calcink-product-final.json`: exit 0, `BLOCKED_WITH_EVIDENCE`, zero schema errors, counts above. This is inventory validation, not an accepted product run.
- `node tests/registry/check-registry.mjs --gate`: exit 2 as required for current incomplete coverage/implementation/report state.

The independent reviewer is running focused production-browser cases. Supervisor must produce fresh accumulated product and ML reports on the same stable integrated source after these final tester edits. This return does not claim a full browser/production-build acceptance result or Phase 0 acceptance; fresh integrated checks and independent reviews remain necessary.

## Risks and remaining work

All uncovered/unimplemented features remain release blockers. Pressure checkbox wiring does not prove pressure-aware ink; mouse pan/Control-wheel do not prove touch/pinch; object creation does not prove save/reload. Missing acceptance includes resize, text editing, clear Escape, multiplication correction, most feedback states, rendered paper settings, independent zoom effects/fit, opacity, cancellation and full responsive/theme permutations. Control drift discovery covers the observed baseline button/link/slider state, with menu/gesture completeness requiring independent inspection.

Synthetic vectors exercise wiring and real model inference, not human recognition accuracy. No human dataset, hardware timings or physical stylus/touch evidence is fabricated. Frozen writer-disjoint corpus and actual physical/slower-device evidence remain pending. Mathematical, ML artifact/grouping and public submission gates are supplemented by other tracks, never inferred from a green UI fixture. Final accessible names in V2 tests remain proposed shared test contracts until implementation review.
