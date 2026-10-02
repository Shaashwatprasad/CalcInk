# Independent review: arithmetic and projection contracts

Reviewer responsibility: ink implementer; reviewed the math implementer's source independently. Review scope is `src/math/index.ts`, `src/projection/index.ts` and their unit suites on branch `codex/feat/calcink-baseline`. No math/projection source changes were made by the reviewer.

## Findings

No blocking findings in this scope. Arithmetic is parsed deterministically without executable-code evaluation. Precedence, left associativity, unary signs, decimal forms, terminal equals, malformed input, zero division, numeric overflow and resource limits are represented by typed outcomes. Syntax failures take priority over partial arithmetic failures, preventing an unfinished expression from displaying an answer.

Projection acceptance validates runtime message structure and every field of the per-equation job identity. Pending expectations are copied and maintained per equation, allowing independent lines to complete in either order. Editing deletes prior projections immediately; document/generation reset and retired equations invalidate prior jobs. Consuming accepted requests prevents duplicate replies from replacing derived state. Queue coalescing preserves FIFO position across equations and does not claim that removing pending jobs interrupts a synchronous active model run.

One additional boundary regression in `tests/unit/review-math.test.ts` verifies that the largest finite JavaScript number, entered as a full decimal integer, retains a finite answer display after rounding. It passes without source changes.

## Reproduced checks

- `npx vitest run tests/unit/review-math.test.ts tests/unit/math.test.ts tests/unit/projection.test.ts`: 3 files, 78 tests passed.
- `npm run typecheck`: passed after current app integration was present.
- `npx eslint src/math src/projection tests/unit/math.test.ts tests/unit/projection.test.ts tests/unit/review-math.test.ts`: passed.

Browser handwriting/classification, group merge/split detection, display clipping, worker restart handling and production offline behavior are integration responsibilities outside this review. These unit results do not prove real-model recognition or end-to-end stale-result prevention unless the app invokes the reset/expect/retire contracts correctly.
