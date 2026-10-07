# Testing and release evidence

Use `npm ci` with the committed lockfile and Node 22.18 or newer. Install the pinned browser with `npx playwright install chromium`, or set `CALCINK_BROWSER_EXECUTABLE` to a compatible installed Chromium executable. Recorded local evidence uses macOS, Apple M5, Node 26.3.0 and Chrome 155.0.8059.27. Synthetic pointer tests do not establish physical stylus behavior.

| Command                 | Coverage                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:ml`       | Deterministic artifact, schema, math and grouping tests; production real-model browser regressions; native-browser preprocessing probe |
| `npm run test:product`  | Production browser interactions, rendering diagnostics and failure paths                                                               |
| `npm run test:baseline` | Typecheck, lint, formatting, deterministic tests and real-model browser regressions                                                    |
| `npm run release:check` | Baseline and ML/product checks, every `@v2-required` workflow and strict feature traceability                                          |

Each run creates a directory under ignored `test-results/tracks/` containing the Git commit, before/after source fingerprints, commands, logs, JSON reports, model/preprocessor identity, selected and filtered IDs, coverage counts and a summary. `CALCINK_REPORT_DIR` selects a different new directory; existing directories are rejected to preserve retry evidence.

Failures, missing or malformed reports, inconsistent case identities, skipped/flaky required cases and source changes during a run fail the process. Baseline runs may pass their executed checks while required workflows remain explicitly filtered. Release selects those workflows and checks feature completeness. The release runner also reports missing human-corpus and physical-device evidence and returns a blocked status even if its executable checks pass.

Cases identified as `ML-DEF-*` and `PROD-D03` are classified as diagnostics by the runner and excluded from requirement acceptance. Some IDs retain historical names after repairs; read their current assertions. Synthetic vectors and parser properties establish specific behavior, not handwriting accuracy. Filtered required workflows appear in reports instead of being counted as passing coverage.

`node tests/registry/check-registry.mjs` validates action/requirement IDs and executable linkage. Its JSON reports current-source action evidence and incomplete IDs. Linkage does not establish assertion quality. `--gate` requires implemented features with passing current-source acceptance evidence and fails when evidence is pending. CI archives available test evidence even on failure; hardware-dependent quality and performance measurements require controlled evaluation outside ordinary CI.

The supported harnesses live in `tests/`, `scripts/testing/` and `scripts/benchmark/`. Compact historical performance reports live in `docs/benchmarks/`. Real vector capture, independent annotation, writer-disjoint validation, freezing and replay are described in the [capture procedure](../scripts/benchmark/capture/README.md) and [recognition evaluation](ML-BENCHMARK.md). The committed empty corpus cannot supply successful quality evidence.
