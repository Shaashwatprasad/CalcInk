# ADR 003: bounded arithmetic and revision-safe answers

Status: accepted for implementation; automated validation recorded by integration.

## Context

CalcInk must handle arithmetic locally, distinguish incomplete/malformed input and division by zero, and never execute generated code. Worker replies can arrive after edits, clear, recovery, model changes or independent equation requests. Answers are derived state, anchored after a terminal equals, and must disappear as soon as their source equation becomes dirty.

## Decision

Use a deterministic TypeScript recursive-descent parser. Unary signs bind before multiplication/division, then addition/subtraction; binary operations associate left. Normalize ×, ÷ and − while preserving original error locations. Accept optional terminal equals, decimals including `.5` and `5.`, whitespace and parentheses. Reject implicit multiplication, exponential notation, other symbols, interior/repeated equals and duplicate decimal points. Empty input, lone final decimal points and unfinished operands/parentheses return incomplete. Syntax is validated before exposing an undefined arithmetic outcome.

Bound input to 4096 characters, 512 tokens and 64 nested parentheses/unary operations. Use finite JavaScript binary numbers; zero divisors and nonfinite operands/results return Undefined. Render valid values with twelve significant digits followed by removal of insignificant trailing zeros; retain the unrounded number internally. Negative zero displays as zero. This avoids common display artifacts while making no exact-decimal claim. Scientific notation can appear for very large or small values.

ProjectionStore validates the complete worker RESULT shape at runtime and matches protocol, document, generation, equation, equation revision, request, model and preprocessing identity against that equation's expected job. `expect` removes the old answer immediately; `retire` removes grouping identities; `reset` removes all jobs/answers on document-generation changes. A result is consumed once. A recognized expression needs terminal equals and the final equals symbol before evaluation. Uncertain/error messages produce no numeric projection.

RecognitionQueue holds one active job, uses FIFO order across equation IDs and replaces queued work in place when an equation changes. Retiring a line discards queued work without claiming that synchronous inference was interrupted. Reset is reserved for terminated/replaced workers. Drawing continues independently.

## Alternatives

JavaScript eval/generated functions violate the requirements and are rejected. Exact decimal arithmetic would add a separate numeric model without an MVP requirement. A global latest-request guard incorrectly discards valid answers from independent equations. Cancelling an active inference synchronously is not reliable; obsolete results are discarded by identity instead.

## Evidence and consequences

`tests/unit/math.test.ts` covers required arithmetic, decimals, malformed syntax, resource limits, overflow and executable-source rejection. `tests/unit/projection.test.ts` covers stale requests, independent lines, clear/recovery/restart, model/preprocessing versions, malformed worker payloads, terminal-equals handling and queue fairness. Integration owns exact command/results and browser evidence in docs/PROGRESS.md.

Parentheses are a parser convenience, not a claim about handwritten model vocabulary. Font-aware placement/clipping, grouping retirement and generation increments must be applied by the app. Bounds supplied by the store are an approximate answer area; ink is never moved.
