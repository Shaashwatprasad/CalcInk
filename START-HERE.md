# CalcInk: Codex implementation handoff

Prepared 2 October 2026 from the supplied Software Dev Bootcamp PS, pasted discussion, available architecture/model conversation and agent-loop image. This is a consolidated specification, not a verbatim archive of unavailable conversation messages. No application has been implemented or GitHub repository created by this pack.

## How to use this pack

1. Open the target repository in a Codex environment with repository write access, terminal access and agent delegation.
2. Copy AGENTS.md, docs/ and prompts/ into the repository. Preserve existing instructions and application files; reconcile rather than overwrite.
3. Put the original Software Dev Bootcamp.pdf in docs/reference/ when distributing this pack. It is the competition source of truth.
4. Supply your GitHub repository URL and authenticated GitHub access. If no repository exists, explicitly supply the owner, name and desired visibility before creating one.
5. Paste prompts/KICKOFF.md into Codex. Let the supervisor start independent module agents after defining shared contracts.

The pack defines a supervisor/planner/implementer/reviewer feedback loop matching the supplied image. It is instructions for an agent environment, not a scheduler or a guarantee that every Codex interface exposes simultaneous agents. If delegation is unavailable, execute the same roles sequentially and report that limitation.

## Read order

AGENTS.md → docs/REQUIREMENTS.md → docs/ARCHITECTURE.md → docs/CONTRACTS.md → docs/MODEL-DECISION.md → docs/AGENT-LOOP.md → docs/BACKLOG.md → docs/VALIDATION.md → docs/GITHUB.md.

## Final decisions and conditional choices

| Area | Decision |
|---|---|
| Frontend | React + TypeScript + Vite |
| Ink | Canvas2D, vector document as source of truth, rAF batching |
| Layers | committed ink, active stroke, computed/UI overlay; background via CSS |
| Recognition | dedicated worker; segmentation + rasterization + preprocessing + inference off drawing path |
| Primary model candidate | rafiibnsultan/Math_Symbols_Classify Dataset II, modelWeight_dataset2.h5 |
| Model deployment | offline Keras → ONNX conversion, FP32 first |
| Runtime | ONNX Runtime Web; working WASM baseline, benchmark WebGPU with explicit WASM recovery |
| Math | custom deterministic TypeScript tokenizer/parser/evaluator |
| Storage | versioned IndexedDB ink document; derived answers regenerated |
| Offline | versioned service-worker cache of all required assets |
| Quality | Vitest + browser E2E + measurements + independent review + CI |
| Git | issue → branch/worktree → PR → checks/review → merge |
| Extensions | variables, plotting, gesture erasure, C++ math only after baseline passes |

The prior WebGPU-first recommendation is conditional on a measured benefit and successful worker integration. The model remains selected for implementation investigation, not proven for production. Do not report upstream accuracy as CalcInk accuracy.

## Required finish

Deliver a real working arithmetic notebook, bundled pretrained model, reproducible repository, documentation and publicly accessible static demo. Prove offline reload, recognition and edit behavior using the production build. Report unmet gates honestly.

