# ADR 004: Audited Dataset II CNN with local single-threaded WASM

Status: implemented integration; release acceptance awaits live accuracy, all-class browser validation and performance evidence.

The primary pretrained candidate contains the required 16 output classes. At pinned commit `0f90d32afb1e4d8416b3d0c4adf4ce1748d86a16`, the notebook, HDF5 weights and shared architecture agree: 50×50×3 RGB float32 input, six same-padded ReLU convolutions, three valid max-pools, channels-last flatten, 128-unit dense ReLU and 16-unit dense softmax. We retain FP32; a direct graph export performs the exact equivalent ONNX operations. It explicitly transposes back to NHWC before flattening. Keras reconstruction and numeric parity are checked independently of the export graph.

Use ONNX Runtime Web 1.22.0 single-threaded WASM inside a dedicated worker, with all runtime, manifest and model assets on the same origin. READY follows model hash verification, session initialization and a real warm-up run. Use existing output probabilities directly. WebGPU is deferred until measured benefit and recovery tests exist; WASM is the portable baseline rather than an unmeasured WebGPU-first policy. This resolves the earlier conflicting runtime recommendation.

Baseline-aware black-on-white rasterization preserves tiny decimal dots and applies the ink engine's exact per-stroke erase masks. Canvas rasterization/scale is an application choice requiring live validation, not an upstream accuracy guarantee. Confidence thresholds merely expose uncertainty and are not calibrated probabilities. Touching digits, overlapping unrelated glyphs and line segmentation remain limitations. Unsupported worker OffscreenCanvas disables recognition while drawing remains available.
