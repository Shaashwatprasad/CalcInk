# Model decision and evidence gate

## Decision

Primary integration candidate: [rafiibnsultan/Math_Symbols_Classify](https://github.com/rafiibnsultan/Math_Symbols_Classify), specifically modelWeight_dataset2.h5. Use existing pretrained weights; reconstruct its exact Keras architecture offline and convert to ONNX. FP32 first; no initial fine-tuning.

Why investigate it first: earlier artifact analysis identified a compact single-symbol CNN with the required vocabulary, fitting incremental symbol recognition. Current repository lookup confirms the Dataset II weight filename, CNN description and MIT repository license. The README reports three test accuracies, including 99.01%, but its table repeats Dataset I on every row. This prevents the README alone from proving the precise checkpoint-to-metric mapping.

Prior conversation claimed input 50×50×3, 16 outputs, approximately 9.35 MB weights, Dataset II labels 0–9/add/dec/div/eq/mul/sub, /255 normalization and 99.01% test accuracy. Treat these as artifact-audit leads until independently verified. Notebook retrieval in this handoff preparation was unavailable. We have not downloaded, loaded, converted or benchmarked the checkpoint here.

Do not silently use the shared model.json: verify it matches Dataset II, particularly the final layer dimensions. Recover the exact model definition from its notebook if necessary. Do not apply a second softmax to probabilities.

## Candidate comparison retained from discussion

| Candidate | Fit and disposition | Required verification |
|---|---|---|
| Rafi Dataset II CNN | Primary candidate; expected exact 16-class symbol fit | all artifact, license, preprocessing and browser gates |
| Sagyam browser MobileNet/TFJS | Backup; upstream project demonstrates client-side character calculation | actual checkpoint architecture/classes/license, ÷ drawing style and same benchmark |
| Rafi Dataset III | Earlier analysis says decimal absent; unsuitable if confirmed | actual labels; do not pick solely for higher headline accuracy |
| MNIST ONNX + operator rules | Digits-only classifier adds heuristic operator complexity; reserve fallback | all six operator behaviors and PS recognition interpretation |
| HASYv2 | Useful dataset, not itself a deployable pretrained model | checkpoint availability/license/required classes |
| Lightweight 2025 CNN | Earlier research lacked a suitable ready checkpoint | identify paper/artifact and reproducible evidence before reconsideration |
| TrOCR/full-expression LaTeX | Lower priority: expression generation complicates incremental updates and payload budget | exact variant size, license, browser latency and expression accuracy |
| AI-Math-Notes training scaffold | Not usable as primary if it requires training to obtain weights | actual existing pretrained artifact |

Sagyam's README currently lists arithmetic characters and browser TensorFlow.js execution, with GPL-3.0 for the repository; division is described as a percent-like glyph. Do not assume it recognizes the required ÷ reliably. Earlier claims of 19 classes, 14 MB, class X/Y/Z and model-specific accuracy remain unverified. Do not sum X and multiply probabilities without evaluating whether that mapping is semantically appropriate. Review the exact applicable artifact terms and retain attribution/notices before distributing any backup weights.

No universal size/accuracy comparison is established: candidate datasets, writers, splits and preprocessing differ. Symbol accuracy does not equal whole-expression accuracy. Preserve qualitative reasons but use one shared validation protocol for final choice.

## Mandatory verification stages

1. Pin upstream commit. Download exact checkpoint/architecture and license; record SHA-256, file size and source provenance. Confirm distribution permissions for the relevant model artifact, not only a repository badge.
2. Inspect model layers/weights, exact input/output shape/names/dtype, label encoding and trained class order. Verify polarity, channel order, normalization, resizing and training-image examples. Identify missing provenance rather than invent it.
3. Reconstruct/load the exact Keras model. Run deterministic labeled samples before conversion. Export with pinned conversion toolchain and compatible opset; save a reproducible conversion script and environment manifest. No browser Python dependency.
4. Run identical input tensors through Keras and ONNX: record max/mean numeric deviation and top-1 agreement across a representative fixture set. Choose and document tolerance; investigate disagreement.
5. Run ONNX in the actual worker/browser with actual app preprocessing. Validate output length and finite scores and test all 16 classes. Model input layout after conversion may differ from the original Keras layout.
6. Measure cold start, warm-up, warm p50/p95 inference and end-to-end recognition, asset sizes, memory and frame times. Compare WASM with WebGPU on identical hardware/samples; test WebGPU failure recovery and WASM-only environments.
7. Evaluate writer-diverse real mouse/stylus/touch data and full expressions. Accept only when evidence supports the targets; otherwise try the backup through the same process or record a replacement ADR.

## Preprocessing and dataset

Worker path: apply erase semantics → group symbols → determine geometry/baseline context → rasterize with measured padding → resize to verified shape → apply verified polarity/channels/normalization/layout → tensor. Use this same pipeline in evaluation. Decimal/division dots and multi-stroke equals need special segmentation care; do not discard tiny components as noise by default.

Aim for 16 classes × 20 samples × 3 writers = 960 labeled live-canvas samples, with writer/input-device metadata and representative width/scale changes. These must be actual samples, not generated claims. Keep frozen final evaluation separate from samples used for preprocessing tuning; split by writer/session when feasible. Ask teammates for samples when needed while continuing independent work. Include complete-expression fixtures and editing scenarios.

Report overall accuracy, macro F1, per-class precision/recall, confusion matrix, operator errors, decimal recall, expression exact-match and final-answer accuracy. Review 1/7, 3/8, 5/6, 0/6, −/=, ×/+, dot/noise and ÷/=. If labels are low-confidence, preserve uncertainty rather than make syntax choose a convenient answer.

Provisional project targets: symbol accuracy ≥97%; operator accuracy ≥98%; decimal recall ≥97%; warm per-symbol p50 <50 ms, p95 <100 ms on declared reference hardware. These are project targets, not PS thresholds or measured results. Also measure whole-expression latency and drawing responsiveness; a good symbol latency can still yield a slow long expression.

## Runtime policy

Start with a proven single-threaded WASM worker baseline. Benchmark optional WebGPU; prefer it only where supported and beneficial. Recover from initialization and runtime failure with WASM session recreation. Use a dedicated application worker; ONNX Runtime's WASM proxy mode is not the WebGPU worker solution. Bundle all matching runtime/worker/WASM assets locally. Check API behavior against the pinned ORT release, including resource disposal. Release sessions/tensors/buffers when no longer needed.

INT8 is optional after FP32 passes. Compare size, supported ops/providers, accuracy and p50/p95; quantization does not automatically improve speed. Keep FP32 when quantization fails a gate. Maintain a license/model inventory and a checked-in labels/manifest file tied to artifact hash.

## Sources consulted / follow-up

- [Primary repository](https://github.com/rafiibnsultan/Math_Symbols_Classify)
- [Dataset II notebook to audit](https://github.com/rafiibnsultan/Math_Symbols_Classify/blob/main/Working%20with%20Dataset%20II.ipynb)
- [Backup repository](https://github.com/Sagyam/Handwritten-Optical-Character-Recognition)
- [ORT web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)
- [ORT flags/session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
- [ORT performance diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html)
- [ORT WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)

Lookups dated 2 October 2026. Record artifact checks separately from these website checks.

