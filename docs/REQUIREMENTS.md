# Requirements

The original [Software Dev Bootcamp problem statement](reference/Software-Dev-Bootcamp.pdf) defines the CalcInk submission. These stable IDs support test traceability.

| ID  | Behavior                                                       | Validation                                            |
| --- | -------------------------------------------------------------- | ----------------------------------------------------- |
| R01 | Mouse, stylus and touch ink                                    | Pointer regressions; physical-device checks pending   |
| R02 | Undo/redo, stroke and partial erasure, clear, width            | Document and product tests                            |
| R03 | High-DPI rendering and correct coordinates                     | Geometry, DPR and resize tests                        |
| R04 | Pretrained recognition of digits and six arithmetic symbols    | Model audit and real-model tests                      |
| R05 | Precedence, multi-digit numbers, decimals and negative numbers | Parser and evaluator tests                            |
| R06 | Inline answer after terminal equals                            | Real-model browser tests                              |
| R07 | Recalculate after editing                                      | Revision, erasure and dependent-equation tests        |
| R08 | Recognition and math entirely on-device                        | Worker/runtime architecture and network checks        |
| R09 | Offline reload after assets load                               | Production offline browser tests                      |
| R10 | Responsive drawing during recognition                          | Declared-device measurements; universal FPS unclaimed |
| R11 | Safe parsing and graceful math errors                          | Malformed-input and division-by-zero tests            |
| R12 | Reproducible repository, attribution and public demo           | Setup, licenses and deployment verification           |

Product decisions and deviations are recorded in [design decisions](DECISIONS.md). Regression success does not establish writer-diverse accuracy, physical-device certification or a deployed public demo. See [validation](VALIDATION.md) for actual evidence and limitations.
