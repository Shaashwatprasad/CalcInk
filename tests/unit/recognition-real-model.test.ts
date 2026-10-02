/** Real pretrained model: synthetic tensors validate the WASM contract, not handwriting accuracy. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web/wasm';
import { expect, it } from 'vitest';
import { validateManifest } from '../../src/recognition/manifest';
it('runs the actual bundled pretrained model through pinned ORT Web WASM', async () => {
  const manifest = validateManifest(
    JSON.parse(readFileSync('public/models/manifest.json', 'utf8')),
  );
  const model = readFileSync('public/models/symbols.onnx');
  expect(createHash('sha256').update(model).digest('hex')).toBe(
    manifest.onnx.sha256,
  );
  expect(model.byteLength).toBe(manifest.onnx.bytes);
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
  });
  try {
    expect(session.inputNames).toEqual([manifest.input.name]);
    expect(session.outputNames).toEqual([manifest.output.name]);
    for (const fill of [0, 1]) {
      const input = new ort.Tensor(
        'float32',
        new Float32Array(7500).fill(fill),
        [1, 50, 50, 3],
      );
      const output = await session.run({ input });
      try {
        const probabilities = output.probabilities as ort.Tensor;
        expect(probabilities.dims).toEqual([1, 16]);
        const values = Array.from(probabilities.data as Float32Array);
        expect(
          values.every((x) => Number.isFinite(x) && x >= 0 && x <= 1),
        ).toBe(true);
        expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      } finally {
        input.dispose();
        Object.values(output).forEach((t) => (t as ort.Tensor).dispose());
      }
    }
  } finally {
    await session.release();
  }
}, 30000);
