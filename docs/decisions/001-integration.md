# ADR 001: Baseline integration and deployment

Status: accepted for development, 2 October 2026.

The remote repository contained the specification pack and Apache-2.0 license; the local checkout had no commits or remote. GitHub connector access was verified. Terminal Git authentication was unavailable, so upstream files were imported into a local snapshot and publication uses GitHub Git-object APIs with the actual remote parent. Local imported history and remote history initially differ; neither shared history nor user files are overwritten.

The supervisor owns root tooling, shared contracts, app/persistence/offline integration and Git operations. Implementers own disjoint paths in the shared filesystem. Independent math/projection review and integration review are recorded separately. Shared worktrees were used because local Git authentication and workspace Git writes require escalation; source independence is enforced through path ownership. No human contributor identity or review was fabricated.

React 19.1.1, TypeScript 5.9.2, Vite 7.1.4, Vitest 3.2.4 and ONNX Runtime Web 1.22.0 are pinned with a lockfile. Runtime assets are generated from the installed pinned package, while pretrained ONNX weights and their hash manifest are committed. No production mocks exist. The worker proves a runnable WASM session before READY, requires worker Canvas2D, and reports typed failures while keeping ink usable. Worker results are guarded per equation and document generation.

Each production build generates an asset list and content-derived cache name. Installation caches all critical same-origin assets before activation; the ready badge verifies that cache and model warm-up. No skipWaiting or deletion of prior caches risks mixing open-tab model/app versions. Cache cleanup and two-version lifecycle tests remain necessary before release; retaining old versions can consume storage until cleanup policy is implemented.

The user approved merging after passing checks and preparing GitHub Pages. The Pages workflow is manual with explicit `/CalcInk/` base. Public release depends on hosting eligibility and remaining evidence gates. The original PDF was supplied during implementation and agrees with the mandatory consolidated requirements; it gives 7 October without a year. Deployment links, accuracy figures and universal60FPS claims must not be invented.
