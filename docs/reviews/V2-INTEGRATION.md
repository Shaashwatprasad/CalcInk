# V2 integration — bounded independent review

4 October 2026. Task `V2-INTEGRATION-review`; workspace HEAD `d8ac04b` plus supervisor's working changes. **Accepted for the repaired bounded integration below; no release/browser/Phase3 acceptance.** Reviewer owns only this report. No implementation, recursive agents, build or broad suite execution. Own annotation model/renderer and accepted unchanged ink/camera/math are excluded; the supervisor separately reviews renderer repairs.

The original P1 notebook finding is resolved: selecting the active ID closes without replacement; a different target is fetched from persisted records after flushing the current notebook, with a missing-row guard and explicit new-record creation. PROD-V13 now reselects the edited active row and compares exported geometry before creating/switching notebooks. This closes the prior stale `records` snapshot overwrite path.

The original P2 crossing finding is resolved: correction accepts a validated symbol index, recognizer/UI pass that index for each crossing, and operand context includes multiplication. Repeated the same controlled test-only actual-module probe `/private/tmp/calcink-integration-crossing.mjs`: after x=2, source `2××=` now yields `2×x=`, uncertain; Variable x correction yields valid answer 4. Inspected the new regression's explicit final-operand correction, invalid-index rejection, operator toggle and restored default correction. Existing source-revision invalidation and non-crossing uncertainty guards remain. This is deterministic integration evidence, not real-model accuracy.

The post-initial grouping merge applies the existing vertical/local-gap criterion to disjoint clusters after bounds grow, removes a cluster on every successful merge and preserves later fraction/mask routing. The exact late-equals/operator-bridge regression asserts all seven source stroke IDs in one group for both input orders; existing distant-neighbor and fraction-mask assertions remain. Inspected rather than reran that suite.

Verified-build still rejects stale source/artifact identities and failed builds; run-track retains its final source-change guard. `includeRequired` now consistently controls child-runner selection and the independent product-case inventory. The supervisor also repaired report metadata: `filteredRequiredCases` is empty only when required cases are enabled and the track actually runs Product (`product`/`release`); ML still lists Product requirements as unexecuted. Independently rechecked that exact guard.

Other initially inspected boundaries have no new blocker in this scope: document/generation/request guards reject retired replies; annotation-only changes preserve recognized math while refreshing pending revision-guarded grouping; canvas mounts remain stable and theme/camera changes redraw derived output. Exact-source runtime validation and broader feature/evidence gates remain the supervisor's responsibility. No outstanding blocking finding in this repaired scope.

## Narrow CI shared-build adjustment

4 October 2026. Reviewed only the small `.github/workflows/ci.yml` diff. **Initial P1, now resolved:** job-level `jobs.validate.env` uses `${{ runner.temp }}`, but GitHub's [context availability table](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability) does not allow `runner` there. This can reject workflow validation before either tester runs. Set the shared path from a runner setup step through `$GITHUB_ENV` using `$RUNNER_TEMP`, or use supported step-level environment contexts. No workflow edits or CI execution by reviewer.

The intended single verified build, inherited path for both tracks, Product required-case environment and retained `if: always()`/artifact step otherwise preserve the tested helper contracts. Narrow re-review confirms job-level env was removed and Build, ML and Product now each use the same `runner.temp` path in their supported step-level env. Product retains required-case selection, `if: always()`, and always-uploaded artifacts. **CI adjustment accepted; no outstanding CI blocker in this scope.** This is static workflow review, not a completed hosted CI run.

## Narrow final Product test maintenance

4 October 2026. **Accepted for these three test/registry edits.** N08 captures the exported initial revision and still requires exactly one pen transaction and one eraser transaction above that baseline; exact endpoints, mask target/path, erased/retained pixels, camera and trusted-pointer assertions remain. No assertion was skipped or weakened into a loose revision bound.

V13 adds cancellation with unchanged exported geometry, confirmation returning to the surviving notebook's document ID, and reload checks showing the deleted name absent and survivor available. The new ACT-NOTEBOOK-DELETE registry entry links the real confirmation action to that persisted-deletion assertion, retains pending acceptance/permutation limits, and does not manufacture a passing latest result. Independently compared parsed registry JSON against HEAD: this action is the only semantic addition; no existing action or top-level value changed (Unicode serialization caused the large textual diff).

Reviewer ran no browser or broad suite and changed no source/test files. The supervisor's focused retest and final frozen-source hash/build remain required; prior failed track evidence does not become accepted through this static review.

## Narrow thin-fraction geometry repair

4 October 2026. **Accepted for the one predicate and regression.** Removing minimum operand width admits tall narrow ones; the median body-size-relative height threshold still excludes small division dots. Existing above/below separation, bar extent/locality, horizontal-bar checks and competing-layout handling are unchanged. The new five-stroke regression asserts one layout, exact numerator/denominator membership and one equation; the existing division-dot exclusion remains intact.

Inspected the saved synthetic real-model browser probe: slash produced 1 while the prior thin fraction split into three equations. This supports the identified geometric failure, not handwriting accuracy or the repaired model result. Reviewer changed no source/test files and ran no build/broad suite. Supervisor's fresh-build real-model replay and final current-source evidence remain pending for the repair.
