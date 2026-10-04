# CI Retry recovery — bounded independent review

4 October 2026. Reviewed only PROD-B11's assertion repair, ACT-RETRY's anchor and existing recognizer ready/message semantics. Reviewer owns this report; no application/test edits, build, broad suites or delegation.

The diagnosis is correct: `pump` uses status `ready` for an idle worker with recognized projections, while uncertain retained ink legitimately changes the text to “Some handwriting is uncertain”. Requiring the neutral ready message after Retry is therefore too specific. Existing injected asset fault, retained pixels and exact exported geometry assertions remain; no skip, retry or timeout increase was added.

**Initial P2 test-evidence gap, now resolved:** the replacement `.recognized-lines` nonempty assertion can match App's fallback “Recognizing…” span, not a newly processed result. Recognizer also emits transient `ready` immediately upon worker READY, before GROUP/RESULT. Consequently ready followed by a nonempty fallback can pass before inference completes, contrary to the new comment. Require a real projection child `.recognized-lines > [data-state]` first, then final ready, and preserve geometry. For B11's single retained stroke, exactly one result is a meaningful check. Align the registry anchor with the final ready assertion.

This is an assertion gap, not evidence of an application recovery failure. The earlier hosted Product failure remains separate evidence; focused real-model and subsequent required hosted-CI execution must establish the repaired candidate. Production certification, human/device validation and full action-permutation limits remain unchanged.

Bounded re-review: **accepted**. B11 now waits for exactly one real `.recognized-lines > [data-state]` projection, then final worker `ready`, then unchanged exported geometry. The fallback/notEmpty assertion is removed. ACT-RETRY anchors that final ready assertion correctly. This sequence closes the identified transient-ready/placeholder false-pass path. No application edits or broad checks by reviewer; focused and hosted required-CI execution remain separate runtime evidence.
