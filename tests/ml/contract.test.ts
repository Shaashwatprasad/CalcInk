import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../src/recognition/manifest';
import { PREPROCESSING_VERSION } from '../../src/recognition/preprocess';
import { BASELINE_LABELS } from '../../scripts/benchmark/corpus/schema';

describe('ML-ARTIFACT real checkpoint contract (not accuracy)', () => {
  it('ML-ART-001 checks actual non-LFS bytes against the pinned conversion audit', () => {
    const raw = JSON.parse(readFileSync('public/models/manifest.json', 'utf8'));
    const manifest = validateManifest(raw);
    const model = readFileSync('public/models/symbols.onnx');
    expect(model.subarray(0, 80).toString('utf8')).not.toContain(
      'version https://git-lfs.github.com/spec',
    );
    expect(model.byteLength).toBe(9310762);
    expect(createHash('sha256').update(model).digest('hex')).toBe(
      '2fdae454d72c885e12718cc810c3a40513f0338c933fc19dc1bd6fe3ad108786',
    );
    expect(manifest.onnx.bytes).toBe(model.byteLength);
    expect(raw.source.commit).toBe('0f90d32afb1e4d8416b3d0c4adf4ce1748d86a16');
    expect(manifest.input).toEqual({
      name: 'input',
      dtype: 'float32',
      shape: [1, 50, 50, 3],
      layout: 'NHWC',
    });
    expect(manifest.output.canonicalLabels).toEqual(BASELINE_LABELS);
    expect(manifest.output.labels).toEqual([
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
      'add',
      'dec',
      'div',
      'eq',
      'mul',
      'sub',
    ]);
    expect(manifest.output.kind).toBe('probabilities');
    expect(manifest.preprocessingVersion).toBe(PREPROCESSING_VERSION);
    expect(raw.preprocessing).toMatchObject({
      polarity: 'black-on-white',
      channels: 'RGB',
      normalization: 'divide by 255',
    });
    expect(existsSync('public/models/LICENSE')).toBe(true);
  });
  it.each([
    { input: { name: 'wrong' } },
    { output: { name: 'probabilities', kind: 'logits' } },
    { preprocessingVersion: 'unknown' },
    { onnx: { file: 'symbols.onnx', sha256: 'git-lfs-pointer', bytes: 123 } },
  ])('ML-ART-002 rejects incompatible manifest mutation %j', (override) => {
    const original = JSON.parse(
      readFileSync('public/models/manifest.json', 'utf8'),
    );
    expect(() => validateManifest({ ...original, ...override })).toThrow();
  });
  it('ML-ART-003 records multiplication vocabulary separately from required variable x', () => {
    const manifest = validateManifest(
      JSON.parse(readFileSync('public/models/manifest.json', 'utf8')),
    );
    expect(manifest.output.canonicalLabels).toContain('×');
    expect(manifest.output.canonicalLabels).not.toContain('x');
    expect(manifest.output.canonicalLabels).not.toContain('/');
  });
});
