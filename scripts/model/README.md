# Reproduce the pretrained-model export

The Python tools are build-time only. Production recognition runs in a dedicated browser worker; no Python or server is required.

```sh
git clone https://github.com/rafiibnsultan/Math_Symbols_Classify.git /tmp/calcink-model-upstream
git -C /tmp/calcink-model-upstream checkout 0f90d32afb1e4d8416b3d0c4adf4ce1748d86a16
python3 -m venv /tmp/calcink-model-env
/tmp/calcink-model-env/bin/pip install -r scripts/model/requirements.txt
/tmp/calcink-model-env/bin/python scripts/model/convert.py /tmp/calcink-model-upstream
```

`convert.py` reconstructs the original Keras inference architecture and imports every checkpoint kernel/bias. It directly exports equivalent operations into ONNX opset 17 (IR 9), removes inference-inactive dropout and preserves channels-last flatten order. Eight deterministic tensors compare Keras against CPU ONNX Runtime with `atol=1e-5, rtol=1e-4`. These conversion fixtures are synthetic and measure numeric equivalence only, not recognition accuracy.

The source checkpoint must hash to `8ce0b567cba9677e83dde6c404b782f277c40e1f6c256e5641eae6131fa2d2a8`. Export replaces `public/models/symbols.onnx` and `conversion-report.json`; update the manifest hash/bytes only after checking parity. Keep `public/models/LICENSE` intact. The upstream architecture is archived in `upstream-architecture.json` for review. `environment.txt` records the complete actual conversion environment.
