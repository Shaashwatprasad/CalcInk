# P0-AUDIT — independent baseline preservation and architecture review

Date: 3 October 2026. Reviewer role: independent baseline reviewer, not an application author. Decision: **ACCEPTED for the baseline audit only**. The baseline contains reproduced defects requiring subsequent tasks; this decision does not accept Phase 0 as a whole, V2 implementation, handwriting quality, performance, deployment or a competition release.

## Reviewed identity and preservation

Branch: `codex/calcink-v2`. Git HEAD during source inspection and experiments: `e5e48beb3a698282cc7e0ae14dd5f27375b89a44`. Reviewed source includes the pre-existing working changes inventoried in `docs/evidence/preserved-work.json`, not merely HEAD. The starting specification-only worktree at `6e6ff10` is distinct from this imported working baseline. No branch, Git index, commit or production code was changed by this reviewer.

Read the entire 2,689-line master specification, including Appendices A and B; AGENTS, START-HERE, requirements, architecture, contracts, model decision/audit, backlog, validation, decisions, progress, agent loop, GitHub policy, previous V2 review, source and relevant tests. Read the full archived competition PDF using bundled `pypdf`. Its source requirements include pretrained recognition, on-device/offline operation, inline reactive answers, input responsiveness, fault tolerance, memory stability, model justification and a public demo. The original creativity examples do not supersede the master's now-required x workflow.

The preservation check compared all nine listed files to their stored SHA-256 values. All application/test/style/README/decision/previous-review files matched. `docs/PROGRESS.md` changed during this review because the supervisor was recording the current session; the baseline inventory and preserved original remain separate evidence. No preservation failure was found.

Exact source fingerprints:

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `src/app/App.tsx`             | `7005dbd0b9bec3335dd53dfc4c5b0c12f5c56c47094dfd7fccc60305045fd847` |
| `src/app/styles.css`          | `1d12e7f49e367aab5d2aae57ee168920fa56aaeb54ed3cf0f8af696b5a593581` |
| `src/recognition/grouping.ts` | `7e18c73e1734b039b5b7ef1378fd5e18d0b428644843a896c53dd636b6a8c386` |
| `src/render/mountInk.ts`      | `f643c96285de0c8b29df1cc97065d240847edbcdd694b5f9ae5591c1a04a35bc` |
| `src/projection/index.ts`     | `2fcea311e79b51a926805b9aa3e82d00d4876ce6b20a73fe2b9326ac69d3e18b` |
| `src/math/index.ts`           | `19f176560eda470755cc982156897bbd1dbd404ae25354b3e3b5f7c748cd2386` |
| `src/persistence/document.ts` | `8be5dfb618d1d081f45e6fe5351e0862c50f980e447120ec6cb0c30433f21c7f` |

The supervisor independently verified GitHub main `6d7277bec589b51784c479210c7afa73de5efca4` and successful CI run `37068297601`. This reviewer did not independently fetch GitHub or verify protection/deployment policy. Earlier documentation saying main contains only specifications is stale against that supplied readback.

## Reproduced evidence

Independent focused regression command:

```sh
npm test -- tests/unit/ink-pointer.test.ts tests/unit/ink-render.test.ts tests/unit/ink-store.test.ts tests/unit/projection.test.ts tests/unit/math.test.ts tests/unit/persistence.test.ts tests/unit/recognition.test.ts tests/unit/scheduler.test.ts
```

Result: **115 passed, 8 files**, Vitest 3.2.4, Node 26.3.0; no failed/skipped cases. These tests establish their declared deterministic behavior, not all V2 requirements. The supervisor's separate baseline typecheck/lint/build and 117-test run passed; its production E2E rerun passed 4/4 in 8.0 seconds after the restricted environment prevented server binding. Those are supervisor-supplied checks, not independent executions by this reviewer.

Independent diagnostic commands:

```sh
npm run preview -- --port 4175 --strictPort
node /private/tmp/calcink-p0-audit.mjs
```

The script loads actual current math/grouping/geometry TypeScript with the pinned TypeScript transpiler, uses isolated synthetic vector fixtures, and instruments the production browser's canvas dimension setters without mutating notebook operations through internals. It creates a fresh browser context and performs a real pointer stroke with the deployed model. Source script SHA-256: `9457c32b33e2a1b33d66f3e0f0376dd085eb4e3ea201c807062fddc919f2e26e`; result SHA-256: `f3a326715d4d91fa7367fdc8ccea54b4ec863969f59f34d8b35e27c898fa6bc5`. Supervisor archives the script/result into repository evidence; the temporary files are not durable deliverables on their own.

Attempt 1: restricted headless Chrome launch failed with SIGABRT/EPERM before page execution. Attempt 2: authorized unsandboxed execution passed. Browser: installed Chrome **155.0.8059.27**, headless macOS, Playwright 1.55.0; viewport 1280×1000, production preview, default browser DPR 1. Browser diagnostic observed **zero page errors/unhandled rejections**. This narrow observation is not an all-error-path audit.

| Case                                                                                                               | Expected V2 behavior                                 | Actual baseline                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Joined active/replay four-point stroke, width 3, points `(12.3,12.7)`, `(31.8,25.2)`, `(48.9,10.6)`, `(63.1,42.9)` | Same appearance at pen-up                            | DPR 1: 165 unequal pixels, maximum alpha difference 142; DPR 2: 334 unequal pixels, maximum alpha difference 128        |
| One new pointer stroke after model ready, unchanged canvas size                                                    | No unchanged backing-store reset                     | Six projection width/height pairs reset to the same 1098×540; no committed/active dimension resets after initialization |
| Two distant same-row groups at x=0 and x=500, both height 30                                                       | Independent equations                                | One equation containing both stroke sets                                                                                |
| Two vertically separated 20-unit-high groups, y=0 and y=40                                                         | Same partition after uniform scaling                 | Scale 1 yields two equation groups; scale 0.1 yields one equation and one symbol                                        |
| Numerator `(10,0,10,20)`, bar `(0,35,30,0)`, denominator `(10,50,10,20)`                                           | Preserve candidate relationship for spatial division | Three final equation groups; no fraction relation                                                                       |
| Two touching digit bounds, x=0..10 and x=9..19                                                                     | Retain bounded split alternatives                    | One symbol group, alternative lost                                                                                      |
| `x=2`, `x+6=`                                                                                                      | Definition / dependent evaluation                    | Both invalid `unknown-token`, location 0                                                                                |
| `2×3=`                                                                                                             | Preserve multiplication                              | Valid, 6                                                                                                                |
| `5+`                                                                                                               | Incomplete                                           | Incomplete                                                                                                              |
| `2÷0=`                                                                                                             | Safe undefined outcome                               | Undefined, `division-by-zero`                                                                                           |

The geometry fixtures test contracts and reproduce limitations. They are not captured human handwriting, independent accuracy samples, or proof that those strokes will be read as the intended glyphs.

## Concrete repair findings

**P0-F01 — P1, active-to-committed appearance changes.** Locations: `src/render/mountInk.ts:88`, `src/ink/geometry.ts:109`, `tests/unit/ink-render.test.ts:165`. Trigger: draw the four-point fixture over separate frames and lift the pointer. Active drawing paints a dot and separate round-capped paths; full replay paints one joined path. Browser alpha differences above reproduce the change. The binary test rasterizer cannot detect browser antialias/compositing changes. Fix: render the active gesture with the same joined-path geometry as committed replay, preserving endpoints/dots/cancellation; independently measure long-stroke cost and add browser tolerance evidence. This is a verified pen-up appearance defect. It does **not** isolate every user-reported refresh or prove a blank ink frame.

**P0-F02 — P1, projection dimensions reset on status updates.** Location: `src/app/App.tsx:163`. Trigger: a stroke starts grouping/recognition with unchanged viewport. Fresh projections arrays reinstall the effect/observer and assign both backing dimensions unconditionally. Six unchanged resets were observed. Fix: one persistent rAF/ResizeObserver lifecycle, dimensions changed only when necessary, explicit projection dirty/empty invalidation and cleanup. Preserve immediate stale-answer retirement. Verify resize/DPR transitions separately. Existing committed/active canvases already guard unchanged dimensions and must retain that behavior.

**P0-F03 — P1, mandatory x capability is absent downstream and in vocabulary.** Locations: `src/math/index.ts:64`, `src/projection/index.ts:168`, `public/models/manifest.json`, `src/workers/recognition.worker.ts:148`. The tokenizer rejects identifiers; the projection only evaluates text ending in terminal equals; the real sixteen-class model maps its crossing class to `×`, not an independently trained x. Fix: typed AST with Identifier/Assignment, complete RHS assignment grammar, notebook environment/dependency policy, stale snapshot guards, and source-attached x/× alternatives/corrections. Preserve `2×3=6`. Evaluator-only tests do not satisfy automatic handwriting recognition; report correction-assisted performance separately.

**P0-F04 — P1, grouping prematurely loses independent equation/structure evidence.** Locations: `src/recognition/grouping.ts:46`, `src/recognition/grouping.ts:100`. Trigger/actual behavior: same-row distant expressions merge; an absolute 24-unit floor changes line partition under scale; touching symbols irreversibly merge; the fraction fixture splits before any spatial decoder can see it. Fix: relative candidate regions, bounded merge/split hypotheses, source-stroke provenance and early spatial hypotheses, while preserving equals/divide multi-component grouping and erase semantics. Do not accept a geometry heuristic merely because it yields a plausible number.

**P0-F05 — P1, handwriting-relative answer layout missing.** Locations: `src/app/App.tsx:176`, `src/projection/index.ts:180`. Answer font uses terminal-equals height clamped to 22–36 px, fixed 12-unit gap and heuristic character widths. `fillText` squeezes long answers to remaining canvas width. Trigger: small/large handwriting, long answers or near-edge equations. Expected: body-symbol scale/baseline and measured world-space answer bounds. Fix: layout metadata from plausible body symbols, actual font measurement, stable anchor/scale and explicit offscreen handling. Source inspection verifies the fixed policy; the full visual size matrix is pending, so this report does not invent oversize counts.

**P0-F06 — P2, top-k/provenance disappears before feedback.** Locations: `src/workers/recognition.worker.ts:132`, `src/projection/index.ts:107`, `src/shared/types.ts:49`. The real worker retains top-three raw softmax candidates but concatenates top-one labels, and projections retain neither alternatives nor stroke-to-symbol IDs. Fix: bounded decoder output with raw candidates, selected tokens, source alignment, corrections and model/preprocessor/decoder versions. Do not describe raw softmax as calibrated confidence.

**P0-F07 — P2, scheduling/snapshot work needs measurement and bounded policy.** Locations: `src/app/recognizer.ts:94`, `src/persistence/document.ts:112`, `src/workers/recognition.worker.ts:138`. Every edit resets the global 220 ms grouping delay; continuous unrelated writing can defer a completed equation. Group requests clone a full notebook, storage validates/clones immediately before serialized saves, and worker results spread the input job, returning ink payloads unnecessarily. These source-visible costs occur at transactions rather than pointermove. Fix: bounded per-equation/affected-region scheduling and measured snapshot/coalescing contracts. Preserve current per-equation stale guards and fair inference queue. This is not a new measured latency or leak claim.

**P0-F08 — material V2 acceptance gap, preserve existing controls while expanding scope.** Locations: `src/app/App.tsx:323`, `src/app/App.tsx:389`, `src/app/styles.css:126`, `src/shared/types.ts:26`. Current delivered tools are pen, whole-stroke eraser and true pixel eraser, width, undo/redo, immediate undoable clear, JSON import/export, Help, notification dismissal and keyboard P/E/history. There is no current camera, semantic Auto ink, dark theme, highlighter/pencil, selection/lasso, text/shapes/regions/arrows, controlled panels, paper modes, notebook naming or clear confirmation. Their Figma presence is not baseline implementation evidence. Preserve every working action and JSON/mask/history behavior; implement required additions through explicit action/feature entries. Do not mark new UI acceptance by opening a panel without checking its effect.

## Correct architecture and remaining reliability evidence

Keep the vector document, frozen snapshots/stable IDs, target-scoped persistent erase masks, history, safe bounded arithmetic, real pretrained model/manifest/hash checks, worker rasterization/inference, independent equation/request/version/generation guards, serialized saves and same-origin offline cache. Recognition does not remount `mountInk`: its effect depends on store/loading, not recognition. Pointermove only appends local samples and schedules rAF. It performs no React document update, inference, parsing or storage save. Committed replay is transaction/resize driven. Replaying within a frame alone is not proof of display flicker.

Actual ONNX recheck: **9,310,762 bytes**, SHA-256 `2fdae454d72c885e12718cc810c3a40513f0338c933fc19dc1bd6fe3ad108786`, matching audited artifact. Browser model warmup succeeded in this diagnostic. WASM is the implemented provider. There is no production mock classifier or cloud math/inference path in inspected source. This does not establish all-class accuracy, calibrated confidence or WebGPU comparison.

Persistence validation recomputes imported bounds, rejects unsupported versions and malformed geometry, and preserves V1 explicit six-digit colours. Saves are serialized and snapshot isolated; tests cover these behaviors. A corrupt saved record causes load failure and the app retains it without installing a save subscriber, allowing new drawing/export with a storage-unavailable status. Pending requirements: separately exercise that UI path, provide recovery/quarantine access to original records, pure V1→V2 migration fixtures, unsupported-import non-destructive tests, storage quota/transaction failure and notebook isolation. No destructive overwrite was reproduced or claimed.

The build's offline worker atomically populates a versioned cache, serves local assets and does not delete old caches while tabs may use them. Existing production tests cover reload/recognition/edit offline with synthetic ink. Pending: real `18+4×3=30`→partial-edit→33 evidence, two-version update with old/new open tabs, asset corruption/startup recovery, cache retention policy and fonts once introduced. No universal offline/browser compatibility claim is accepted. Worker OffscreenCanvas absence currently means unavailable recognition while drawing remains usable.

Reported 5000-stroke masked replay near 22 ms is earlier synthetic canvas-command evidence on declared hardware, not a display-frame measurement. Required physical stylus/touch, slower real device, whole latency chain, all-class/writer-disjoint quality, long-session heap/resources and model comparison remain blocked by missing evidence/data where unavailable. Those blockers must be explicit in both tester reports, not counted as passes.

## Contracts, next tasks and review consequence

No contract was changed in this review. Agreed Phase 1 direction: persistent `mountProjection` with `invalidate`/`dispose`; redraw on DPR changes even if backing dimensions coincide; redraw empty projections after retirement; active-only joined replay; long-stroke performance measured. No schema or worker change is necessary for this scoped repair. Phase 2 needs canvas-local CSS/world/DPR units and gesture arbitration; Phase 3 needs versioned migration and explicit math eligibility; Phase 4 needs AST/environment/correction contracts before parallel authors edit callers.

Next ready work: independently review both executable tester harnesses and registry/report semantics; integrate the reproduced defects as expected baseline evidence; complete fresh Phase 0 review; then repair F01/F02 with regression tests, tester runs and independent re-review before accepting Phase 1. F03–F08 stay tracked in dependency order. The audit itself is accepted; the known defects and absent acceptance evidence prevent V2/release acceptance.

Required return: task `P0-AUDIT`; branch/head above; changed file only `docs/reviews/P0-AUDIT.md`; implemented behavior none (independent inspection/diagnostics); exact checks and failed-first/rerun evidence above; no contract changes; risks and remaining work explicitly listed. This is an agent review, not a human GitHub approval.
