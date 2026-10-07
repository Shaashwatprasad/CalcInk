# ADR 006: Incremental equations and retained rendering

Status: implemented, 6 October 2026.

Editing one equation previously cascaded invalidation through nearby lines with unlimited horizontal bounds. Group IDs included every stroke ID; each recognized result reparsed and reevaluated the notebook, and drawing replayed all ink/answers.

Keep stable IDs and revisions in EquationTracker, with stroke ownership and cached finite rectangles. Use InkStore’s changed/deleted IDs and old/new bounds to regroup candidate subsets in the worker. Reconcile before invalidating nearby groups. The worker protocol retains document identity/revision guards even when its payload is a subset.

Cache recognized sources, expression text, parsed ASTs, results and definition-specific dependency contexts. Batch projection updates. Retain unchanged projection objects and canvas pixels; repaint clipped damage and cull offscreen content. Clear/replacement, camera, appearance and resize remain explicit invalidation boundaries.

Typed math extends case-sensitive variable identifiers without pretending the sixteen-class checkpoint recognizes letters. Ordinary annotations stay excluded. The user’s exact zero-division diagnostic takes precedence over the old blanket Undefined display. Repository cleanup removes superseded handoff material while preserving technical provenance and tests.

The controlled 200-equation evaluator workload reduced a local edit from 399 parses/evaluations to one of each while preserving 199 projection references. Measurements and environment details are retained under docs/benchmarks; synthetic tests do not establish human handwriting accuracy or universal frame rates.
