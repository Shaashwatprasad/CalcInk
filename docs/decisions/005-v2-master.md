# ADR 005: V2 master specification and preserved implementation

Status: accepted scope, 3 October 2026. Source: `docs/reference/CalcInk-V2-Master-Implementation-Prompt.md`, read in full including both appendices before edits. Original competition requirements and latest user instructions take precedence.

The managed worktree initially held specification-only `6e6ff10`. Existing local implementation `e5e48be` and the primary checkout's modified files were preserved in this isolated `codex/calcink-v2` branch. `docs/evidence/preserved-work.json` records copied-file hashes; the original checkout remains untouched. GitHub main `6d7277bec589b51784c479210c7afa73de5efca4` contains V1, and CI run 37068297601 succeeded. Terminal Git authentication is unavailable; connector publication must retain remote main as parent. No repository creation, access change, merge or deployment is authorized by this ADR.

Resolved contradictions:

| Topic                   | Binding decision                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recognition UI          | One contextual expression/result/state box; no visible AST or separate parser card. AST remains internal.                                                                                    |
| Dark/light feedback     | Dark #1A202B/#333D4E and soft-white expression; light #5275AE accent, #F3F6FC surface, #CCD9EA border, #345B8C text.                                                                         |
| Variables               | x assignment and dependency evaluation are mandatory now. Invalid/unbound/cyclic definitions never publish a value.                                                                          |
| x versus multiplication | Preserve ×; retain ambiguous evidence and explicit source-linked correction. Sixteen model classes do not establish a learned x class.                                                       |
| Themes                  | Auto ink #E4E7EB on #10151C and #252D38 on light; new blue #5275AE, new soft-white preset #E4E7EB. Preserve legacy explicit values. Appearance/camera never change canonical geometry input. |
| Pan                     | 36 px desktop button, centred 24 px SVG and at least 44 px touch hit area.                                                                                                                   |
| Typography/layout       | Self-host DM Sans, restrained grid, sentence-case labels, neutral selected controls and useful material previews.                                                                            |
| Preservation            | Every existing feature survives. New required features need actual behaviour and evidence. Optional unimplemented plotting/broader vocabulary/PDF remain backlog entries.                    |
| Evidence                | Measured, upstream-reported, target and pending are separate; no synthetic handwriting accuracy or manufactured reviewers/writers.                                                           |
| Review                  | Two executable independent tester tracks, independent task and fresh phase reviews; source changes invalidate relevant evidence.                                                             |

Architecture repair precedes added scope. Existing vector document, target-scoped masks, worker/runtime, revision guards and safe arithmetic are retained. New contracts are agreed before specialist production implementation. Missing human corpus/device evidence blocks only dependent quality/device gates while implementation continues.
