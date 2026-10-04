# Human ink collection and independent annotation

Serve this repository locally (`npm run dev`) and open `/benchmark/capture/index.html`. Write real samples naturally. Enter the actual device description and export. Capture records pointer type, browser, DPR, viewport, pressure, timestamps, stroke IDs and pen-up boundaries. A cancelled pointer is discarded. The capture page does not run recognition; its redraw implementation is a collection aid, not CalcInk's production renderer or a performance measurement.

Alternatively export an existing human-written CalcInk notebook. Preserve that original file. Do not manufacture handwriting, writer identities, capture dates or rights statements to populate a benchmark. Real provenance is attested by the annotator, not established by a JSON flag. `benchmark/corpus/empty.json` truthfully represents current availability.

Create an annotation JSON using the `LabelledSample` contract in `benchmark/corpus/schema.ts`, omitting `document`. Include actual `id`, pseudonymous stable `writerId`, `sessionId`, split, capture date, source/rights/annotator, input metadata, symbol labels with exact stroke IDs, explicit ignored stroke IDs, expression text, independently specified canonical AST and expected outcome. Capture-page exports supply date/input automatically; plain notebook exports require these fields in the annotation. Add `corpusId` if desired.

Annotation label vocabulary is the baseline sixteen classes plus required `x` and slash. This does not add classes to the CNN. AST operators are canonical `+`, `-`, `*`, `/`; notation equivalence is annotated as the same division AST. ASTs are number, identifier x, unary, binary or assignment nodes. Invalid/incomplete/uncertain inputs may have `ast: null`; complete/undefined/unbound inputs require AST truth. Never copy model predictions into ground truth. Use every stroke exactly once in symbol labels or explicit exclusions. Expression membership must use labelled strokes and may not overlap another expression. Expression array order represents a variable-definition sequence.

```sh
node benchmark/capture/import.mjs HUMAN_CAPTURE.json INDEPENDENT_ANNOTATION.json NEW_CORPUS.json
node benchmark/corpus/cli.mjs validate NEW_CORPUS.json
node benchmark/corpus/cli.mjs freeze NEW_CORPUS.json NEW_FROZEN_CORPUS.json
node benchmark/corpus/cli.mjs verify NEW_FROZEN_CORPUS.json
npm run build
CALCINK_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node benchmark/corpus/replay.mjs NEW_FROZEN_CORPUS.json NEW_PREDICTIONS.json
```

Combine validated samples into one corpus before freezing. Writers must belong exclusively to development or evaluation, and a session cannot belong to multiple writers. Duplicate document IDs are rejected to keep repeated replays from becoming independent accuracy samples. Assign the split before tuning, never tune on evaluation writers, freeze before comparisons and keep previous locks/reports. `freeze` refuses empty evaluation data and uses exclusive output creation. Freeze verification hashes normalized validated content with stable object-key ordering; arrays retain meaningful order.

Replay uses the actual built production worker for predicted grouping and expression recognition, actual Chrome canonical preprocessing, and pinned ORT Web WASM for independently grouped symbol inference. It retains raw top-three outputs and unsupported x/slash observations separately. Phase 0 lacks AST extraction and complete variable evaluation, so replay reports `BLOCKED_WITH_EVIDENCE` and exit code 2 even when it records available predictions. It is executable collection/replay infrastructure, not a claim that all benchmark acceptance gates already pass.

Proposed collection: three development and two held-out writers; baseline 16 classes × 20 samples × 5 writers, additional x/× ambiguity samples and ≥200 held-out expressions including ≥50 variable sequences. These are budgets. Actual current real samples, writers and expressions: **zero**. No physical-device study or second-device evidence has been supplied. Capture screenshots, synthetic tests and repeated replays cannot fill these counts.
