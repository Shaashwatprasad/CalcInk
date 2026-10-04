# Requirements and traceability

Source: attached Software Dev Bootcamp.pdf, CalcInk: On-Device Handwritten Math Calculator. Cover states team size 1–3 and submission deadline 7 October; the PDF does not specify a year. Confirm the applicable deadline externally rather than infer one from its cover.

| ID | Mandatory behavior | Acceptance evidence |
|---|---|---|
| R01 | Smooth mouse, stylus and touch ink | manual device checks + automated pointer tests |
| R02 | Undo/redo, stroke eraser, pixel eraser, clear, width | history/erase tests + browser interactions |
| R03 | High-DPI crispness and correct coordinates | DPR/resize coordinate tests + visual QA |
| R04 | Existing open-source pretrained recognition for 0–9, +, −, ×, ÷, ., = | verified artifact/labels/license + real model tests |
| R05 | Precedence, multi-digit integers, decimals, negative numbers | tokenizer/parser/evaluator suite |
| R06 | Inline answer immediately after terminal equals | real stroke-to-result E2E |
| R07 | Editing updates answer automatically | erase/replace + undo/redo + stale-response tests |
| R08 | Entire workload inside browser; no remote inference/math | network audit + production review |
| R09 | Offline lifecycle after assets loaded | offline production reload/draw/edit |
| R10 | Fluid 60-FPS drawing during recognition; heavy work off UI thread | frame-time traces on declared devices |
| R11 | No unsafe eval; graceful malformed math and division by zero | invalid syntax/error boundary tests |
| R12 | Repository, quick-start/model attribution, public demo | reproducible install + README + deployment URL |

Division by zero displays Undefined. Malformed or incomplete expressions never produce an unhandled exception or a misleading old answer.

## Rubric

Feature implementation/tests 25; architecture/model justification 20; performance/runtime constraints 20; teamwork/engineering discipline 15; creativity/UX 20. Real participating humans need meaningful ownership and review. Agent count and fabricated author commits do not satisfy human teamwork requirements.

## Added engineering decisions

IndexedDB recovery, format versioning, capability detection, fault isolation, top-k recognition, metrics, model comparison, ADRs and CI improve reliability. They are our architecture choices rather than separately mandated PS features.

## Scope boundary

Baseline handwritten vocabulary is exactly the 16 required symbols. Variables and letters are an extension requiring a separately verified recognizer and grammar; Dataset II must not be presented as recognizing all letters. Parentheses may be supported internally by the parser but handwritten parentheses, trigonometry, powers, algebra solving and graphing are not MVP recognition requirements. No training or fine-tuning is planned. The PS says training from scratch is not required/expected; do not misquote it as an absolute training prohibition.

