# P1-PHASE — independent integrated acceptance review

3 October 2026. Task `P1-PHASE`; branch `codex/calcink-v2`. Decision: **ACCEPTED for Phase 1 at committed HEAD `a12fe42f21abb54c8a0a0e8217add98560d3ca48` only**, using integrated source identity `22b0107bbce8e3d3c59f650c2f6d905c047a760ee4184a03f2af9eaad0f8a9f7`. No blocking finding in this scope.

Scope follows master Phase 1: stable ink/projection lifetimes, pointer/render separation, DPR/resize, active/committed replay, retirement of derived answers, and drawing through recognition work/failure. Read `docs/tasks/P1.md`, independent `P1-RENDER` repair/re-review, the Phase 1 master gate, relevant renderer/App/recognizer code, meaningful unit/product assertions and retained integrated raw reports. This reviewer did not author the repairs or rerun expensive suites; test execution below is explicitly reused root/tester and prior independent-review evidence.

## Source and lifecycle assessment

Independently hashed committed files through `git show a12fe42:<path>`:

- App: `7686d3bda27b246a1254dc85bf7f9f40cb4a168f8b55dc19be7511ea10d3394f`.
- mountInk: `80eeb80cd296c4efe85ff5196b827f06f77b030a5732a21d13ea968cf94655de`.
- mountProjection: `aee96af37a57deb870a041b53c081964f45fffb3e61a6484b65c378cca0d067f`.

They match the accepted independent renderer repair. App mounts input independently of recognition state/retry, owns one projection renderer for its component lifetime, supplies current projections through a ref, and invalidates on changes. Feedback initialization failure is caught without removing notebook controls or storage. Cleanup disposes frames, observers and listeners.

Recognition does not write ink backing dimensions or remount input. Pointer samples append imperatively; rAF draws the active gesture as the same joined path used by committed replay. Store changes request committed replay; inference results update a separate feedback canvas. Backing dimensions are assigned conditionally, and actual resize/DPR changes redraw from vector ink. Empty projections clear obsolete feedback. Recognition queues and projections retain revision/document/generation validation; store edit/erase/history/clear/replacement invalidate affected results before delayed replies can restore them. Ink and masks remain persisted source data; answers remain derived.

## Evidence supporting the phase gate

Both retained reports under `docs/evidence/P0-integrated/{ml,product}/` declare the exact commit/source identity above, identical before/after hashes and `sourceChanged: false`. Independently inspected raw aggregate results and decoded Product diagnostic attachments rather than accepting summary counts alone. Phase 0's independent re-review verifies retained raw logs survive subsequent browser runs.

| Reused integrated command | Result                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:ml`         | 175 deterministic, 4 real-model production browser and 14 canonical passes; zero failures/skips/flakes; production build and registry/traceability subprocesses exit 0 |
| `npm run test:product`    | 4 real-model production browser and 17 Product passes; zero failures/skips/flakes; production build and registry/traceability subprocesses exit 0                      |

The deterministic assertions cover rapid/coalesced endpoints, dots, secondary pointers, resize/scroll/cancellation, clear/import retirement, eraser transactions/cleanup, empty projection redraw/dimensions, independent equation ordering, edit/merge/clear/replacement stale replies, and recognition timeout/disposal. Product B02/B03 verify whole-stroke and targeted partial masks, later ink survival, undo/redo and reload. B08 checks dimensions/geometry across eight widths. B09 verifies real equals erasure clears actual answer pixels and undo restores recognition. B11 injects a real model asset failure, draws/exports ink and recovers through Retry. B14 injects only null feedback context and verifies drawing/export/undo; raw browser issues are empty.

Decoded D01: DPR1 active/committed parity has **0 differing pixels, max alpha difference 0**, 3,458 ink pixels. D02 samples existing committed ink during drawing and real recognition: **33 samples, 0 zero-alpha samples, 0 unchanged projection dimension assignments**, no browser issues. Prior independent P1 diagnostics at the same renderer hashes provide DPR1/2 exact parity, active-input resize preservation, real ResizeObserver feedback resize, empty feedback pixels and disposal checks. Those measurements are reused, not newly reproduced here. The unit projection test alone mocks away ResizeObserver; the browser evidence supplies that missing interaction.

## Limits and subsequent work

These traces establish no reproducible recognition-caused blank ink frame in the tested cases. D02 observes one known ink pixel at rAF boundaries, not every pixel or physical display frame. D01 records 370 frame intervals, maximum approximately **100.1 ms**; passing parity does not establish universal 60 FPS. Active rendering remains O(current gesture points). Long continuous gestures, concurrent inference, physical stylus/touch and slower-device latency require later declared-device measurements. Environment records Apple M5, arm64 Darwin 25.6.0, approximately 24 GiB RAM and installed Chrome 155; input is synthetic/emulated. No human accuracy claim follows from these cases.

Answer scale, placement/offscreen compression and broader tools/themes/viewport requirements remain later gates. The integrated reports explicitly filter 16 later V2 Product cases and retain feature-completeness blockers; this decision does not count those as passes or accept the submission.

During review, supervisor copied Phase 2 camera/paper integration into the working tree. Its hash differs from the reports. Committed renderer/App contents were explicitly rechecked; **this acceptance excludes that working diff**. Phase 2 must independently retest affected Phase 1 behavior. The unused viewport module in committed `a12fe42` is not accepted as an integrated camera by this review.

Required return: task `P1-PHASE`; branch/commit/source above; changed file only `docs/reviews/P1-PHASE.md`; independent checks were bounded source/assertion/report inspection and committed-file SHA-256 comparison. No production behavior, contract, Git or benchmark changes. Supervisor must record this scoped decision in progress and verify subsequent integration. Human/device quality and remaining V2 phases remain pending.
