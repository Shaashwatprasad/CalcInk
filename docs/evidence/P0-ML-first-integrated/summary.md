# ml tester report

Commit: `2a19592c550c3acfc29107c935b3b269f0c56480`; source SHA-256: `9b0dd6d723c1ce46affde03eb4665312fd631557e087473c59a3f0078a68d81d`.

Result: **PASS**.

- deterministic: exit 0; {"passed":175,"failed":0,"skipped":0,"total":175}
- production-build: exit 0
- real-model-browser: exit 0; {"passed":4,"failed":0,"skipped":0,"flaky":0}
- canonical-browser: exit 0; {"passed":14,"failed":0,"skipped":0}
- registry-contract: exit 0
- feature-traceability: exit 0

Pending external evidence:

- real-handwriting-quality: No frozen writer-disjoint labelled human corpus supplied; deterministic replay is not handwriting accuracy.
- physical-input-devices: Physical stylus/touch and slower-device measurements require available hardware.
- feature-completeness: Required actions/features remain unimplemented or lack passing current-source evidence; see feature-traceability.json.
