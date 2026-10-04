# P1-RENDER — independent bounded renderer repair review

Date: 3 October 2026. Initial decision: **CHANGES_REQUIRED**, one verified fault-isolation regression below. Nominal rendering repair is reproduced. Scope is task P1 renderer lifetime/parity, not Phase 1 acceptance or all V2 projection/layout requirements.

Reviewed branch `codex/calcink-v2`, Git HEAD `e5e48beb3a698282cc7e0ae14dd5f27375b89a44` plus root-owned working repair. Initial source fingerprints: `mountProjection.ts` `aee96af37a57deb870a041b53c081964f45fffb3e61a6484b65c378cca0d067f`; `mountInk.ts` `80eeb80cd296c4efe85ff5196b827f06f77b030a5732a21d13ea968cf94655de`; App `e1160396458733357a7a950dbbc1aad746cbb1ce5ff9a1c62df4c1792c9be375`; unit test `4cb5a004b0fce985a2ba4c54baf6ba9eb3aeb36812a4586786e614af2c2ea043`. Compared against baseline working source from P0-AUDIT: the App projection effect replacement and active-only joined rendering are the new implementation; preserved READ AS/help changes predate this task.

## Implementation and independent checks

`mountProjection` now owns one context/ResizeObserver/window listener/rAF scheduler and reads projections through a current ref. Unchanged backing dimensions are preserved, redraw clears stale/empty pixels, disposal removes resources. App installs one renderer for component lifetime and invalidates on recognition projection changes. Active pen redraw clears and draws only the current gesture as one joined path, using the same geometry as committed replay; no committed notebook replay, React point updates, inference or persistence was added to pointermove.

Independent command:

```sh
npm test -- tests/unit/projection-renderer.test.ts tests/unit/ink-pointer.test.ts tests/unit/ink-render.test.ts tests/unit/projection.test.ts tests/unit/scheduler.test.ts
```

Result: **49/49 passed in 5 files**. Existing pointer tests cover rapid endpoints, coalesced samples, dots, secondary-pointer rejection, clear/import gesture retirement, resize/scroll, cancellation, eraser transaction/history and cleanup. New renderer test covers coalescing, dimension writes, empty retirement, DPR update via resize and listener/disposal behavior. It mocks ResizeObserver away, so browser evidence is needed for observer behavior.

Independent production command:

```sh
CALCINK_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e
```

Result: **4/4 passed in 6.1 seconds**, installed Chrome 155.0.8059.27 / Playwright 1.55.0. Covers actual pretrained worker synthetic arithmetic/edit/undo/redo/offline reload/equals retirement plus drawing, masks, history, persistence, DPR/resize and offline pixels. This is functional evidence, not measured human handwriting accuracy.

Independent browser probes: `/private/tmp/calcink-p1-review.mjs` and `.json` (supervisor to archive), production preview port 4175. Actual UI pointer operations captured active pixels before pen-up and committed pixels afterward. At **DPR 1 and 2: zero unequal pixels, maximum alpha difference 0**, versus baseline 165/334 unequal pixels. Recognition produced **zero unchanged dimension assignments** after initialization. Resizing while a stroke was active retained committed first-stroke pixels and the active stroke start/end (all sampled alpha 255). Zero page errors/unhandled rejections during these nominal workflows.

Isolated browser diagnostic imports actual bundled `mountProjection`, without mocking Canvas2D or ResizeObserver. Answer pixels: **92 before, 0 after empty projections**. CSS resize produced backing **150×50**. Disposal then invalidation/window resize/CSS resize produced no extra draws and backing remained 150×50. These targeted checks do not prove every display frame or unsupported browser/device.

## Blocking finding

**P1-R01 — P1, projection initialization failure destroys otherwise usable ink UI.** Location: App's new projection effect around line 168; `mountProjection.ts:14`. Trigger: projection canvas `getContext('2d')` returns null while other canvases still have usable contexts. The helper throws; the App caller does not catch it. Reproduced by `/private/tmp/calcink-p1-fault.mjs`, which overrides only projection `getContext` in a fresh browser profile. Actual: page error `Canvas2D is required for mathematical feedback.`, `#root` becomes empty, drawing canvas count 0. Expected: preserve drawing/storage and provide a concise unavailable-feedback notice; no unhandled exception. Previous App projection code returned safely on null context, while `mountInk` is already fault-isolated. Fix: catch renderer initialization in App, clear renderer ref, report notice/status and leave notebook mounted; add a meaningful negative-context regression and re-run the fault probe/nominal suite. Supervisor is repairing this finding; current acceptance requires independent re-review of the changed fingerprint.

## Performance and scope limits

Measured synthetic joined active-stroke Canvas command submission with 10 warmups/100 repetitions each, 1200×500 backing canvas, DPR1, Apple M5 / 25,769,803,776 RAM bytes / Darwin25.6 / Node26.3 / Chrome155.0.8059.27. Sample counts 500/1000/5000 each p50 0 ms at timer resolution, p95 approximately 0.10 ms; 20,000 samples p50/p95 approximately 0.20/0.20 ms. Raw samples and methodology are in `/private/tmp/calcink-p1-active-cost.json`, script `.mjs`.

These are deferred Canvas command timings, excluding input dispatch, raster/compositor/display completion and active inference contention. They cannot establish fluid 60 FPS, stylus latency or safe universal long-stroke performance. Active replay remains O(current gesture points) and must be profiled under continuous long gestures on declared devices; bound/simplify only with geometry-preservation evidence. Timer-resolution zeros are not zero execution cost.

Answer sizing/font/offscreen compression remains the baseline policy deliberately retained for later handwriting-relative layout. No schema, erasure semantics, worker protocol/model, mathematical revision or persistence contract changed. DPR transforms are recomputed on invalidation; monitor DPR changes through real resize/display transitions in phase/device checks. The repaired nominal task does not establish a recognition-caused blank-ink-frame absence for every trace, nor validate themes/highlighter/camera that do not exist yet.

Required return: task `P1-RENDER`; exact branch/head/fingerprints above; changed reviewer file only this report; behavior reviewed as above; 49 deterministic/4 production cases and browser diagnostics passed; R01 remains blocking until independently reproduced fixed. No reviewer production edit, Git operation or human approval.

## Re-review — projection fault isolation

Reviewed changed App SHA-256 `7686d3bda27b246a1254dc85bf7f9f40cb4a168f8b55dc19be7511ea10d3394f`, same Git HEAD; mountProjection/mountInk/test fingerprints above remain unchanged. App now catches initialization failure, shows its message and retains the notebook. Repeated isolated projection-null browser probe against the supervisor's finished production build: **page errors []**, drawing canvas count **1**, root retains controls/model-ready/save status and the concise `Canvas2D is required for mathematical feedback.` notice. Original failing probe remains above; R01 is **resolved**.

An intermediate rerun occurred before the asynchronous build finished and therefore re-observed the old production fault. It is not a failure of the corrected source and was not counted as a fixed-head check. The reviewer also started a duplicate production build; it was still transforming concurrently with the supervisor's successful build, then explicitly terminated (exit 130). Only the supervisor's completed build supplies the corrected production artifact; no successful independent build is claimed for that terminated attempt.

Final task decision: **ACCEPTED for the bounded P1 repair at these fingerprints**, with measured nominal parity/lifecycle, fault isolation, regression results and performance limitations recorded. This does not accept a phase; integrated tester reports, fresh independent phase review and any subsequent source changes require new exact-source verification. Broader answer-layout/camera/theme/long-device-trace requirements remain later gates.

## Replacement reviewer verification

3 October 2026; same branch/HEAD. Independently confirmed App hash `7686d3bda27b246a1254dc85bf7f9f40cb4a168f8b55dc19be7511ea10d3394f` and unchanged mountInk/mountProjection hashes above. Production app bundle `dist/assets/index-CfI1iTwK.js` SHA-256 `50ca7434ffef854cb03c53ccecad2092f228d93457b96ea3c9599b5c24ad942e`. No independent production build is claimed in this replacement review; actual finished dist was used.

Repeated `/private/tmp/calcink-p1-fault.mjs` against an independently started production preview on port 4175 with Chrome 155.0.8059.27. Result: **errors []**, Drawing canvas count **1**, drawing controls/save status retained and the expected feedback-unavailable notice visible. Independently executed the five renderer/input/projection/scheduler unit files together with ML/report-contract regressions: **91/91 cases passed**, including all **49 renderer-related cases** previously enumerated. Actual production `CALCINK_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e -- --reporter=json`: **4 passed, 0 failed/skipped/flaky**, 5.398 seconds; raw output `/private/tmp/calcink-review-high-browser.json`.

Read the prior DPR 1/2 parity and lifecycle scripts/raw evidence retained in docs/evidence; renderer fingerprints are unchanged, so those results are preserved as prior review evidence rather than falsely claimed as newly measured. The corrected catch and its fault recovery are freshly reproduced. **ACCEPTED remains for this bounded P1 task only**, with the original long-stroke/device/frame-completion limitations. Changed reviewer file only; no production, contracts or Git edits.
