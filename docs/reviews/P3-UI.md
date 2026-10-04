# P3-UI independent integration review

Task: P3-UI review. Branch `codex/calcink-v2`, uncommitted root integration over accepted Phase2 `91af82b`; reviewer makes no production/test/Git changes. Scope: App, ToolOptions, semantic appearance additions, mountInk wiring, finite ViewportStore. Intermediate functional tool UI only; this does not accept all Phase3 features.

## Findings and repairs

1. **P1: finite-page filtering invents an eraser path and deletes untouched ink.** `mountInk.append` removes out-of-page samples but connects remaining samples. On a 200×100 page, pointer samples `(190,10) → (210,10) → (210,90) → (190,90)` persist only `(190,10) → (190,90)`. A whole-stroke eraser with radius 2 following this route deletes a dot at `(190,50)` although the real pointer never traverses it. Pen and partial erase share the same invented chord. Preserve path discontinuities/clipping semantics across page exit/re-entry; do not connect across discarded samples. Require one reversible gesture and preservation of unrelated source ink.

2. **P2: resizing during a gesture leaves finite bounds stale.** App's resize callback calls `setFinitePage` while mountInk locks the camera, so it returns false. Pointer-up unlocks without retry; App listens only to window resize/paper setting/loaded changes. Repro: finite 200×100 page, start drawing, resize to 100×100, release. Finite bounds remain 200×100 until another resize or setting change, diverging from visible paper and allowing wrong camera limits/input eligibility. Apply pending size after unlock or otherwise synchronise actual canvas size without moving an active gesture.

**Both blockers resolved in independent exact-module re-review.** Finite gestures reject margin starts, clip/interpolate their first exiting point to the boundary and ignore subsequent samples including coalesced events/re-entry/up. This intentionally ends the gesture at first exit while retaining one transaction. `resizeFinitePage` queues only the latest valid resize under the camera lock and applies it on unlock; ordinary locked navigation commands remain discarded. Existing out-of-page document ink is retained. Root added meaningful pen/both-eraser/coalesced and latest-resize regressions; assertions were inspected independently.

## Other integration observations

- Resolved by source inspection: Hand/generic Eraser now cache previous drawing styles, DrawingOptions restores per-kind settings, and Pen's visual selection now checks kind. Keyboard P/E dismiss stale panels; P restores remembered Pen/default Auto style and preserves current eraser radius; editing/modifier shortcuts are guarded.
- Resolved by final source inspection: toolbar/internal drawing modes now preserve current eraser radius when restoring cached styles, avoiding reset of a recently changed eraser setting.
- Projection repaint is requested on theme change, but the existing projection renderer still hardcodes `#287568`; native rendering/contrast/theme and canonical preprocessing evidence remain integrator verification.

## Exact focused checks

`node /private/tmp/calcink-p3-ui-review.cjs` imports the current actual TS InkStore, ViewportStore and mountInk through TypeScript transpilation. Only DOM EventTarget/canvas scheduling is stubbed. Output:

```text
excursion persisted points [{"x":190,"y":10},{"x":190,"y":90}]
untouched middle stroke count after outside excursion 0
resize attempted while gesture locked false
page after pointer release {"width":200,"height":100}
```

After repair the same actual-module probe was extended with assertions and re-run successfully:

```text
PASS pen first exit clips boundary and does not resume [{"x":190,"y":10},{"x":200,"y":10}]
PASS outside excursion preserves untouched dot and masks stroke-eraser
PASS outside excursion preserves untouched dot and masks pixel-eraser
PASS finite margin start does not create entering stroke
PASS resize keeps active camera and applies latest bounds/clamp on unlock
```

Root reported 30 affected unit tests passing and typecheck/lint passing again after final shortcut/style fixes; reviewer did not duplicate these suites. Final source inspection includes remembered styles/radius, shortcut guards, Clear accessible label and desktop/coarse-pointer rail CSS; actual layout pixels remain root verification. This bounded review has no remaining data-loss/eligibility/lifecycle blocker. Native-browser/pressure/performance evidence, actual appearance/projection/canonical preprocessing verification and final exact-source checks remain integrator work. This acceptance covers only the reviewed intermediate P3-UI implementation; P3 objects, final layout and complete phase exit remain outstanding. Document the first-exit finite-page policy as the resolved behavior.
