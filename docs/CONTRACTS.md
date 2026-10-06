# Runtime contracts

`src/shared/types.ts` defines the canonical document and worker envelopes. Documents accept versions 1 and 2 and normalize to version 2. Strokes retain pressure, brush, colour, opacity and eligibility. Erasures retain target stroke IDs, path and radius. Text annotations optionally carry `math: true`; missing/false values stay ordinary text. Import discards unrecognized fields, recomputes bounds and rejects malformed geometry, duplicate IDs and oversized documents.

Ink changes include changed/deleted IDs, old/new bounds, generation, revision and transaction ID. Source snapshots are immutable. All geometry uses document units; device pixels and camera transforms belong to renderers.

GROUP carries a validated document-shaped candidate subset, retaining the real document identity/generation/revision. GROUPS echoes those fields. Initial grouping receives all eligible ink; later grouping receives cached nearby candidates. EquationTracker reconciles subset results with untouched cached groups. A stale grouping result cannot recreate cleared or edited answers.

RECOGNIZE/RESULT envelopes carry protocol, document ID, generation, equation ID/revision, request ID, model version and preprocessing version. A reply applies only if every field matches the current expected job. RecognitionResult includes source-backed symbol predictions/top-k, bounds, recognized/uncertain/error state and timing. Runtime validates messages before applying identity guards. The queue runs one job at a time, preserves FIFO fairness and replaces queued work for repeated edits.

`ProjectionStore.batch` coalesces mutations. `invalidate` marks only the edited source pending and invalidates its expected job. `syncTyped` supplies canonical typed text/revisions/bounds to the same evaluator. General ASCII identifiers are case-sensitive; handwritten vocabulary is separately constrained by the audited model. Parsed ASTs and cached outcomes are derived, never persisted as authoritative ink.

Math outcomes distinguish valid, variable-defined, pending, incomplete, uncertain, invalid, unbound, undefined and unavailable. Undefined zero division uses the exact display “Cannot divide by zero”; nonfinite arithmetic uses “Undefined”. Inputs are bounded to 4096 characters, 512 tokens and nesting depth 64. Definitions and consumers follow spatial notebook order and bind to exact definition IDs.
