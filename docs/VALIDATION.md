# Validation and definition of done

## Automated checks

Run npm ci, typecheck, lint, format check, unit/integration tests and production build. Establish actual package script names during scaffolding; commit matching CI commands. Browser E2E runs against the production build in CI where available. Lock runtime/model fixture versions. Test outcomes, not just implementation-shaped assertions.

Math cases: 18+4×3=30; 18+5×3=33; 8÷2×2=8; 10−3−2=5; −3+5=2; 2×−3=−6; 12.5÷2=6.25; 0.1+0.2 displayed according to numeric policy; 7÷0=Undefined; empty/incomplete expressions, duplicate decimal points, consecutive equals, unknown tokens and excess-length inputs handled cleanly. Define acceptance of leading/trailing decimal forms such as .5 and 5. explicitly and test it. Unary/binary minus must differ correctly.

Ink cases: rapid pen-up before next frame; dot strokes; final segments; pointer cancellation/capture loss; scroll/resize/DPR; undo/redo after erasing; partial erasure cuts only intended pixels; reloaded masks affect recognition; new strokes ignore old masks. Compare incremental output against full replay within anti-alias tolerance.

Concurrency cases: delayed old result after replacement; two independent equations; clear/recovery/new document while job runs; erase equals; merge/split line groups; worker restart and stale epochs; model-version changes. No stale answer may appear.

Model cases: artifact checksum/shape/classes; Keras/ONNX parity; actual browser inference; all required symbol samples and multi-component symbols. Real-model end-to-end tests must exist independently of mock unit tests. Report whether fixtures are synthetic, upstream or live handwriting.

## Offline production procedure

1. Build and serve/deploy production over HTTPS/localhost.
2. Load the app with a clean browser profile. Wait for model warm-up and verified Offline ready.
3. Disable all network connectivity, then reload.
4. Draw actual handwriting 18+4×3=; verify inline 30.
5. Pixel-erase 4, write 5; verify 33 without network.
6. Undo/redo, erase equals, redraw, resize, reload and recover current ink.
7. Inspect network logs: no external runtime/inference/math dependency. Restore network and test an app/cache update without mixing versions.

Keeping an already-open app offline is insufficient evidence for offline reload.

## Performance and memory

Provide a debug panel behind ?debug=true: frame intervals/timing percentiles, worker preprocessing/inference/end-to-end times, queue length, stroke count and revisions. Keep benchmark data outside production hot paths. Measure rendering under continuous pointer input while recognition runs. 60 Hz permits about 16.67 ms per frame; report dropped-frame distribution and long tasks, not only average FPS. Include device, OS, browser, DPR and backend. Repeat on representative slow hardware or documented CPU throttling; do not label a throttled measurement as an actual separate device.

Benchmark 500/1000/5000-stroke documents for redraw, hit testing, undo/redo, serialization and preprocessing. Record regressions without flaky hard timing thresholds on arbitrary CI machines. Profile repeated draw/erase/undo cycles with bounded history/cache and stable active document size. Memory used by genuinely retained ink should grow; detached buffers, tensors, old sessions/listeners and deleted projections should not remain indefinitely. Use heap/resource evidence before claiming no leaks.

## Release gate

Every R01–R12 requirement has evidence; no production mocks; verified model artifact/licenses/manifest; complete actual tests/build/CI; independent review; offline reload/edit passes; documented measured recognition/performance; clean reproducible README; architecture/ADRs match implementation; public demo works. Known limitations are explicit. Unmet accuracy targets require a recorded model decision, not silent lowering or invented metrics.

A feature is done when behavior, relevant tests, type/lint/build checks, independent review and affected documentation are complete. Deployment success alone does not satisfy the release gate.

