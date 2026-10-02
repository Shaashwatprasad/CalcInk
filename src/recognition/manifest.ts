export const MODEL_VERSION = 'rafi-dataset2-0f90d32-fp32-v1';
export interface ModelManifest {
  modelVersion: string;
  preprocessingVersion: string;
  onnx: { file: string; sha256: string; bytes: number };
  input: {
    name: string;
    dtype: 'float32';
    shape: [1, 50, 50, 3];
    layout: 'NHWC';
  };
  output: {
    name: string;
    kind: 'probabilities';
    labels: string[];
    canonicalLabels: string[];
  };
}
export function validateManifest(value: unknown): ModelManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid model manifest');
  const m = value as ModelManifest;
  if (
    m.modelVersion !== MODEL_VERSION ||
    m.preprocessingVersion !== 'rgb-white-baseline-v1' ||
    m.input?.name !== 'input' ||
    m.input.dtype !== 'float32' ||
    m.input.layout !== 'NHWC' ||
    JSON.stringify(m.input.shape) !== '[1,50,50,3]' ||
    m.output?.name !== 'probabilities' ||
    m.output.kind !== 'probabilities' ||
    JSON.stringify(m.output.canonicalLabels) !==
      JSON.stringify([
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '+',
        '.',
        '÷',
        '=',
        '×',
        '−',
      ]) ||
    !/^[a-f0-9]{64}$/.test(m.onnx?.sha256) ||
    m.onnx.file !== 'symbols.onnx' ||
    !Number.isInteger(m.onnx.bytes)
  )
    throw new Error('Unsupported or unverified model manifest');
  return m;
}
