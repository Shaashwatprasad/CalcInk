# Recognition model

`symbols.onnx` is the intentional offline distribution of the pretrained Dataset II CNN, approximately 9.3 MB. Keep this artifact in Git so a fresh npm install/build and static deployment work without model storage credentials or a conversion toolchain. Larger future models should use a verified download or Git LFS workflow before distribution changes.

`manifest.json` is the runtime registry: it pins upstream source, model version, SHA-256, byte size, tensor names, shapes, label ordering and preprocessing. The worker verifies the artifact and warm-up output before readiness. Input is float32 RGB NHWC `[1,50,50,3]`, black on white normalized by 255; the output has sixteen softmax classes in the manifest's exact order.

See [artifact audit](../../docs/MODEL-AUDIT.md), [conversion instructions](../../scripts/model/README.md), `conversion-report.json`, `browser-verification.json` and the bundled MIT `LICENSE`. Intermediate checkpoints belong in ignored `scripts/model/artifacts/`.
