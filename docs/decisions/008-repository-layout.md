# Repository layout and distribution

Status: accepted, 7 October 2026.

Keep application modules under `src/`, behavior tests under `tests/`, executable maintenance/conversion/measurement tools under `scripts/`, and durable design and validation evidence under `docs/`. A single Vite application does not need an apps/packages monorepo. Conventional entrypoints such as `index.ts` remain valid; domain modules already describe their responsibilities.

Benchmark tools move to `scripts/benchmark/`; preserved measured reports move to `docs/benchmarks/`. Fresh reports default to ignored `benchmark-results/` so reproducing a measurement cannot overwrite published evidence. Original report contents retain their historical commands and source identities.

Keep npm, exact dependency versions and `package-lock.json`. Build output, runtime copies, editor state, environment secrets, intermediate checkpoints and temporary reports stay ignored. The small verified ONNX distribution remains tracked to make offline deployment reproducible; its manifest is the model registry. Duplicating it into a second top-level models folder would create conflicting authorities.

Remove obsolete task/review reports after their technical behavior and evidence are captured in architecture, ADRs, tests and measured reports. Preserve existing Git history and worktrees; new commit messages remain concise. Branch cleanup must verify ancestry and preserve any unique work before removing obsolete refs.
