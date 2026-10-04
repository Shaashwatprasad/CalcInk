# Implementation backlog

Suggested issue titles and dependency order. Supervisor creates real issues and records their returned IDs; numbers below are task labels, not GitHub issue IDs.

| Task | Deliverable | Dependencies | Owner |
|---|---|---|---|
| T00 | Inspect repository, preserve work, establish access/policy | none | supervisor |
| T01 | React/TS/Vite, lockfile, lint/format, Vitest, CI | T00 | supervisor |
| T02 | Shared contracts, document revisions, model manifest schema | T01 | supervisor + implementers |
| T03 | Pointer capture/DPR transforms + smooth rAF ink | T02 | ink |
| T04 | Commands, undo/redo, width/clear, stroke/pixel eraser | T03 | ink |
| T05 | Audit primary checkpoint/labels/license/preprocessing | T00 | recognition |
| T06 | Conversion script + Keras/ONNX parity report | T05 | recognition |
| T07 | WASM worker load/warm-up/errors/real inference | T02,T06 | recognition |
| T08 | Tokenizer/parser/evaluator, typed outcomes | T02 | math |
| T09 | Dirty-line scheduler + segmentation/assembler + top-k | T04,T07 | recognition + supervisor |
| T10 | Revision-safe inline projection + reactive editing | T08,T09 | math + supervisor |
| T11 | Notebook UI, tools, confidence/loading/error states | T03,T08 | app |
| T12 | Versioned IndexedDB and failure recovery | T04 | app |
| T13 | Self-host runtime assets + atomic offline cache | T07,T11 | app |
| T14 | Real handwriting collection + reproducible benchmark | T03,T05; final run T09 | recognition + humans |
| T15 | Candidate/backend comparison; freeze verified manifest | T07,T14 | recognition/reviewer |
| T16 | Real-model E2E, offline reload, memory/performance checks | T10,T12,T13,T15 | reviewer |
| T17 | README, ADRs, diagrams, model/licenses, limitations | ongoing; final T16 | supervisor |
| T18 | Public static deployment and fresh reproducibility run | T16,T17 + publishing policy | supervisor |

Begin T03, T05 and T08 in parallel once contracts are agreed. Do not wait for ML to make drawing usable. Use mocked recognition only to test wiring before real artifacts arrive; remove demo dependence on mocks before acceptance.

Milestone A: working ink and passing parser tests. Milestone B: verified model running in worker. Milestone C: complete handwriting → inline result → erase/edit recomputation. Milestone D: persistence/offline/measurement/release. Defer optional extensions until milestone D passes.

For the submission window, prioritize a narrow working end-to-end vertical slice, then complete remaining eraser/history/offline and test requirements. Avoid spending the remaining schedule on a new model training project or C++ toolchain.

