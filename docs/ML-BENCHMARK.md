# Recognition evaluation

CalcInk evaluates model contracts, grouping, expression interpretation and latency separately. Synthetic ink can validate geometry and execution behavior; it cannot establish handwriting accuracy. The committed corpus currently contains **zero human samples and zero writers**, so writer-diverse accuracy, x/× confusion, assignment/variable interpretation and accepted-answer error rates remain unmeasured.

## Collect and reproduce

Follow the [capture and annotation procedure](../scripts/benchmark/capture/README.md). Install dependencies with `npm ci`, then run from the repository root:

```sh
npm run test:ml
npx vitest run tests/unit/recognition-real-model.test.ts
node scripts/benchmark/corpus/cli.mjs validate scripts/benchmark/corpus/empty.json
CALCINK_BROWSER_EXECUTABLE='/path/to/chrome' node scripts/benchmark/corpus/preprocess-browser.mjs test-results/preprocessing.json
```

`test:ml` runs deterministic tests, a production build, real-model browser regressions and a native-browser preprocessing probe. Reports use new paths so a retry cannot overwrite earlier evidence. The empty corpus's canonical SHA-256 is `ee3506543d505fc0cd0ba0fdb6286c4d35f0c530a5a4cbf30bea9ba9bac1715f`; validation reports zero counts and a blocked evaluation status. Freezing rejects empty evaluation data.

Corpus validation enforces writer-disjoint development/evaluation splits, consistent session ownership, unique document IDs, nonoverlapping stroke annotations, labels or explicit exclusions, and complete expression truth. Provenance and rights are human attestations; schema validation cannot establish authorship.

## Metrics and interpretation

Classifier reports include numerators and denominators, top-one accuracy, top-three recall, macro F1, per-class precision/recall, absent classes, confusion counts, operator accuracy and decimal recall. Empty denominators yield `null`. Grouping uses one-to-one exact source-stroke-set matching; duplicate predictions reduce precision. Expression correctness compares independently annotated canonical operator trees, since equal answers do not establish an AST match.

Answer accuracy, AST accuracy, coverage, abstention and wrong accepted answers are reported separately for automatic and user-corrected results. Wilson 95% binomial intervals do not account for writer clustering, and small sample/writer counts cannot establish a ≤1% accepted-answer error rate.

Diagnostic cases identified as `ML-DEF-*` are excluded from requirement acceptance by the runner. Their identifiers include historical defect observations and a repaired grouping regression; inspect the current assertions before interpreting their results. See [testing](TESTERS.md) for report and release-gate behavior.

## Historical measurements

These are dated observations, not a report of the current source tree's acceptance status. Original evidence remains available for comparison.

| Evidence                                                                                     | Observed result                                                                      | Scope                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Preprocessing baseline, 3 October 2026](../tests/ml/preprocessing-baseline-2026-10-03.json) | 11 checks passed, one failed; extreme translation deviation 0.18039                  | Synthetic native-browser geometry contracts; no inference accuracy or timing claim                                                               |
| [Deterministic baseline, 3 October 2026](../tests/ml/deterministic-baseline-2026-10-03.json) | 39/39 checks passed, including three separately identified diagnostic observations   | Includes pretrained Node WASM execution on synthetic tensors; does not establish live handwriting quality                                        |
| [Preprocessing repair, 3 October 2026](../tests/ml/preprocessing-repair-2026-10-03.json)     | 14/14 checks passed; translation and translated partial-mask maximum deviations zero | Crop-local preprocessing v2 preserved source geometry; tall-context shrink from 253 to 8 dark pixels was still observed in this historical probe |
| [Scalability and rendering measurements](../scripts/benchmark/README.md)                     | Raw local reports retained in `docs/benchmarks/`                                     | Synthetic grouping, replay, preprocessing and incremental-update measurements; each report defines its own scope                                 |

The 3 October browser probe used Apple M5, 10 logical CPUs, 25,769,803,776 RAM bytes, Darwin 25.6.0, Node 26.3.0, headless Chrome 155.0.8059.27 and DPR 1. No deliberate throttling was applied, and concurrent work was not isolated. These measurements do not establish second-device behavior, physical stylus/touch latency, peak memory or universal frame rates.

## Quality targets and missing evidence

Provisional internal targets are ≥97% symbol accuracy, ≥98% operator accuracy, ≥97% decimal recall, ≥90% expression AST exact match, and ≤1% wrong accepted answers at ≥90% coverage. Timing targets are warm symbol p50 <50 ms/p95 <100 ms and complete pen-up-to-visible-feedback p95 ≤500 ms for expressions of at most ten symbols. These are pending engineering targets, not competition thresholds or achieved results.

A proposed collection budget is 16×20×5 baseline symbols from three development and two evaluation writers, plus at least 200 held-out expressions, including 50 variable sequences and additional x/× cases. No samples have been collected into the committed corpus.

Timing evaluation should retain failures and raw samples, use 100 rotated warm repetitions after warm-up, and distinguish cold download, cached cold, warm and cache-hit pipelines. Complete latency includes debounce, queueing, grouping, raster/tensor preparation, inference, decoding/evaluation and visible projection. Corpus replay currently records worker roundtrip observations and returns blocked acceptance; it does not implement the full timing protocol. Peak memory, 30-expression stress behavior, light/dark-theme accuracy and physical-device measurements also remain to be established. Model comparisons require the same frozen compatible corpus; unrelated published scores are not a common evaluation.
