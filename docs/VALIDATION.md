# Validation

Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` and `npm run build`. Browser checks use the production output: `npx playwright install chromium`, `npm run test:e2e`, and `CALCINK_PRODUCT_REQUIRED=1 npx playwright test --config playwright.product.config.ts`.

Unit/integration regressions cover arithmetic, generalized variables, definition rebinding, cached ASTs/results, revision races, 200 independent equations, grouping merges/splits/fractions, both erasers, undo/redo, pressure/alpha, retained redraw, object editing/lasso, persistence and derived history. Production browser tests run the actual model and cover drawing/editing, offline reload, notebook switching, annotations, typed math, diagnostics and UI controls. Synthetic geometry and fake worker messages are labelled test fixtures, never production recognition.

`npm run test:ml` and `npm run test:product` retain exact commands, counts, source identity and browser reports in ignored test-results. Reusable measurements live in benchmark and compact outputs in benchmark-data. Record actual browser/CPU/runtime; do not convert a Node evaluation benchmark into an inference or FPS claim.

For offline validation, load production on localhost/HTTPS, wait for Offline ready, disable network, reload, draw/edit a real-model fixture and verify undo/redo plus persistence. Keep network observations: inference/runtime/math must have no remote dependency.

Human handwriting quality is a separate open evidence requirement. The corpus in benchmark/corpus/empty.json intentionally has zero human samples. Capture and independent annotation tools remain available under benchmark/capture. No writer-diverse accuracy, physical stylus/touch certification, universal 60 FPS or WebGPU benefit is claimed.
