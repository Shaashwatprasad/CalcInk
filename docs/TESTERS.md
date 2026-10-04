# Executable tester systems

Use the pinned lockfile (`npm ci`) and Node 22.18+. Install the pinned browser with `npx playwright install chromium`, or set `CALCINK_BROWSER_EXECUTABLE` to an installed compatible Chromium executable. Current local evidence uses macOS, Apple M5, Node 26.3.0 and Chrome 155.0.8059.27. Emulated/synthetic pointer tests are not physical stylus evidence.

- `npm run test:ml`: ML Implementation Tester — deterministic artifact/schema/math/grouping checks, production real-model browser regressions and actual native-browser canonical preprocessing.
- `npm run test:product`: Product Interaction / Feature Tester — real production browser baseline actions, rendering diagnostics and failure paths.
- `npm run test:baseline`: typecheck/lint/format plus accumulated deterministic and real-model browser regressions.
- `npm run release:check`: all accumulated checks plus every `@v2-required` product workflow and strict feature traceability. Missing human corpus/device evidence prevents release acceptance.

Each run writes a new directory under `test-results/tracks/`: exact Git commit and before/after source fingerprints, child commands/logs/JSON, model/preprocessor identity, selected IDs, explicit filtered required IDs, feature/action denominators, diagnostic observations, counts and summary. `CALCINK_REPORT_DIR` may select a new path; existing directories are rejected so retry evidence survives. Failures, missing/malformed reports, inconsistent or absent case identities, skipped/flaky required cases, and source changes during a run fail the process. Baseline subsets can pass executed checks while completeness remains blocked; they never accept the whole V2 application.

The three `ML-DEF-*` cases reproduce known baseline defects. `PROD-D03` observes layout. Their successful execution is diagnostic evidence, excluded from requirement acceptance. Synthetic vectors and parser properties prove specific behavior; they are not handwriting accuracy measurements. Required V2 product cases are ordinary failing tests, explicitly filtered during baseline development and all selected at release. The report records those exclusions; no skip or expected-failure directive converts them into passing coverage.

`node tests/registry/check-registry.mjs` checks declared action/requirement IDs and executable linkage. Its JSON exposes current-source action evidence and incomplete/unimplemented IDs. Linkage alone does not prove meaningful assertions; independent test review remains necessary. `--gate` requires implemented features and passing current-source acceptance, and fails when evidence is pending. CI runs both available tester tracks and archives evidence even on failure. Hardware-dependent accuracy/performance thresholds remain outside ordinary noisy CI.

Real vector capture, independent annotation, writer-disjoint validation, freezing and real-model replay are documented in `benchmark/capture/README.md` and `docs/ML-BENCHMARK.md`. The committed empty corpus contains zero human samples and cannot be frozen/evaluated as successful quality evidence.

Historical reproduction scripts and JSON in `docs/evidence/` are immutable artifacts, excluded from source lint/format rewriting. They retain their original environment paths and raw measurements; runnable supported harnesses live in `tests/`, `scripts/testing/` and `benchmark/`.
