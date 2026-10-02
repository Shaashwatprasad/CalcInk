# Shared contracts to implement first

These are design requirements, not existing APIs. Supervisor finalizes TypeScript discriminated unions with implementers before parallel code begins.

## Document

InkDocument: format calcink-document; version 1; documentId; generation; revision; strokes; erasures. Stroke: id, points, bounds, width, color. Point: x, y, timestamp, optional pressure. Erasure: id, target stroke IDs, path/radius or tested mask representation. Persist document identity/generation or safely assign a new generation on recovery so old worker responses cannot match.

Change event: document identity/generation, revision, transaction ID, changed/deleted stroke IDs, old/new affected bounds and reason. Commands: add stroke, erase strokes, erase region, clear; undo/redo use reversible transactions. Bounds are normalized document units and account for rendered width.

## Worker protocol

Request envelope: protocolVersion, documentId, generation, equationId, equationRevision, requestId, modelVersion, preprocessingVersion, type. Recognize payload includes immutable stroke/mask data, bounds and grouping context. Transfer private buffer copies when transferring ownership; never detach authoritative document arrays.

Response envelope echoes all identity/version fields. Payload includes symbols with bounds and top-k scores, grouping diagnostics, timing breakdown, backend and typed error/status. INIT/READY/ERROR messages have explicit schemas. Validate incoming messages at runtime. Input/output tensor names and layout come from the model manifest.

Apply a result only if document generation, equation identity/revision and request ID still match the current equation job, and expected model/preprocessing versions match. A global latest request ID would incorrectly discard valid responses from other equations. Unrelated equation edits should not invalidate still-current results unless grouping dependencies actually changed.

Cancellation is cooperative: mark obsolete jobs, replace queued work and discard replies. Do not assume a synchronous model run can be interrupted. Preserve fair scheduling so one busy line cannot starve others. Worker timeout/restart increments generation or job epoch; prevent endless crash/retry loops.

## Evaluation

Result union: valid with numeric value/formatted display; incomplete; invalid with code/location; undefined with reason. Parse operates on canonical text/tokens plus optional source symbol spans. Projection: equation ID/revision, terminal-equals bounds, status, answer bounds/text. Clear/delete retires projection immediately.

## Model manifest

Store source URL and commit SHA, source artifact path/hash, exported ONNX hash/bytes, license references, architecture, conversion-tool versions/opset, input names/dtype/shape/layout, output names and class ordering, normalization/polarity/resize/padding, preprocessing version, tested providers and verification report paths. No unknown field should be guessed; explicitly record unresolved items and prevent production acceptance.
