# P0-PHASE — independent integrated acceptance review

3 October 2026. Task `P0-PHASE`; branch `codex/calcink-v2`. Initial inspection: HEAD `2a19592c550c3acfc29107c935b3b269f0c56480` plus the unused viewport module/tests. Final reviewed HEAD: `a12fe42f21abb54c8a0a0e8217add98560d3ca48`. Reviewer did not author these tasks or modify source/Git. Final decision: **ACCEPTED for Phase 0 only**, after the evidence-retention repair and re-review below. Initial CHANGES_REQUIRED remains documented. This does not accept Phase 1 or later V2 behavior.

Bounded inspection reused the independent baseline audit, root harness HR-04 re-review, ML foundation review and Product PT-01 re-review; read Phase 0 task/progress, master §§7.1/7.2/Phase 0, tester documentation, ADR005, preservation inventory, capture/replay methodology, current wrapper/source identity and production browser configuration. No expensive suites were rerun by this reviewer.

## Blocking finding

**P0-PH-01 — Playwright output cleanup removes retained track evidence.** `playwright.config.ts` omits `outputDir`, leaving Playwright's default `test-results`; `scripts/testing/run-track.mjs` writes its exclusive track directory beneath that same directory. A Playwright invocation can therefore remove preceding deterministic/build evidence, and a later product invocation can remove preceding browser or ML-track evidence. This violates master §7.2's retained raw reports/logs and failure/retry evidence requirements.

Actual evidence: `test-results/tracks/2026-10-03T12-51-38.302Z-ml/report.json` reports PASS at HEAD above, identical before/after source SHA-256 `9b0dd6d723c1ce46affde03eb4665312fd631557e087473c59a3f0078a68d81d`. It declares 175 deterministic, 4 real-model browser and 14 canonical passes, no failed/skipped cases, 3 diagnostic observations and 16 explicitly filtered required cases. Read-only filesystem inspection found its referenced `deterministic.json`, `deterministic.log` and `production-build.log` absent. The real-model/canonical/registry files remained. Aggregate totals alone cannot replace deleted raw evidence.

Repair: isolate Playwright artifact output from retained track directories and give invocations exclusive artifact paths where needed; preserve prior failures/retries. Then rerun both integrated tracks on the repaired unchanged identity and verify every referenced raw report/log and earlier track survives subsequent browser runs. Do not recover acceptance by suppressing reporting or reconstructing deleted results.

## Accepted foundations and pending scope

No other blocking Phase 0 finding arose in the bounded inspection. Baseline source preservation and real defect reproductions have independent evidence; ADR005 records resolved requirement conflicts. Both executable tester systems, registry/discovery, real model artifact/runtime checks, canonical probe and human capture/annotation/freeze/replay tools exist. Harness reviews independently resolved HR-01–HR-04 and PT-01. CI invokes both available tracks and uploads evidence on failure.

Traceability initialization truthfully distinguishes 41 features (38 required), 125 declared action links, 20 meaningful baseline mappings, 105 uncovered actions and 103 unimplemented actions; F-SUBMISSION remains unmapped. Diagnostics and 16 later-phase required browser cases remain distinct from requirement passes. These are initialized foundations, not complete V2 acceptance. Empty real corpus, physical stylus/touch/slower-device evidence, replay state/AST metric extensions and all remaining V2 requirements stay explicitly pending in their dependency phases. Synthetic regressions are not human accuracy or physical-device measurements.

## P0-PH-01 re-review — resolved

Root repaired every Playwright child command with `--output=<exclusive track directory>/<step>-artifacts`. The wrapper already refuses an existing track directory, so cleanup is confined to one browser invocation and cannot remove sibling logs/JSON or previous attempts. Independently inspected repaired wrapper SHA-256 `9ef0cdf728e776e2c19c87954bfcb083e6be2f9786c9c5763682e0df7f1bb3d9` and both actual rerun reports. No assertion/error guard was relaxed.

Both reports are tied to final HEAD above and identical before/after/current source SHA-256 `22b0107bbce8e3d3c59f650c2f6d905c047a760ee4184a03f2af9eaad0f8a9f7`:

| Root command           | Retained report directory                              | Actual result                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:ml`      | `test-results/tracks/2026-10-03T12-58-31.325Z-ml`      | PASS: 175 deterministic, 4 real-model browser, 14 canonical checks; 193 executed passes, 0 failures/skips/flakes; 3 separately recorded ML defect observations |
| `npm run test:product` | `test-results/tracks/2026-10-03T13-02-17.937Z-product` | PASS: 4 real-model browser and 17 product cases; 21 executed passes, 0 failures/skips/flakes; 1 separately recorded layout diagnostic                          |

Production build, registry-contract and feature-traceability subprocesses exit zero in both tracks. Each explicitly filters `PROD-V01` through `PROD-V16` with later-phase reasons; feature traceability remains BLOCKED_WITH_EVIDENCE for incomplete V2 acceptance. Diagnostic counts are execution evidence, not requirement-acceptance counts. The real model identity remains `2fdae454d72c885e12718cc810c3a40513f0338c933fc19dc1bd6fe3ad108786`, preprocessing v2.

Independent post-Product filesystem check found **zero missing referenced logs/raw reports in either track**; ML deterministic/build/browser artifacts survive both later Product browser invocations. The original incomplete-retention aggregate also remains, with its missing artifacts disclosed rather than reconstructed. Current source identity independently recomputed to the shared report hash. This directly verifies the previously failing retention interaction without rerunning unrelated suites.

Environment: wrapper reports Node 24.19.0, Apple M5, arm64 Darwin 25.6.0, installed Chrome executable; canonical raw probe additionally records Chrome 155.0.8059.27, DPR 1 and its subprocess Node 26.3.0. Input remains synthetic/emulated; concurrent work was not isolated. These reports establish executable foundations and selected regression behavior, not human/device quality.

Phase 0's gate is satisfied: preserved baseline and reproduced defects, explicit missing data, initialized discovery/traceability, both runnable systems, independently reviewed harnesses and both unchanged integrated-source reports. No remaining blocking Phase 0 finding. The unused viewport module is present in the source identity and deterministic suite; App does not yet use it, so no viewport/Phase 2 integration is accepted here.

Required return: changed file only `docs/reviews/P0-PHASE.md`; independent checks were bounded source/configuration/report/filesystem inspection and source-hash recomputation. Executed suites above are root-run evidence, not reviewer reruns. No production behavior, contracts or Git state changed. Remaining work: supervisor progress/Git checkpoint, fresh Phase 1 review, subsequent required V2 implementation, human corpus and physical-device gates. This is an agent review, not a human submission/GitHub approval.
