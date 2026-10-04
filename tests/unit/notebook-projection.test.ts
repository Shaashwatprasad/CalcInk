import { expect, it } from 'vitest';
import { ProjectionStore } from '../../src/projection';
import type { RecognitionResult } from '../../src/shared/types';
const b = { minX: 0, minY: 0, maxX: 100, maxY: 40 };
function result(id: string, text: string, y: number): RecognitionResult {
  return {
    protocolVersion: 1,
    documentId: 'doc',
    generation: 0,
    equationId: id,
    equationRevision: 1,
    requestId: id,
    modelVersion: 'm',
    preprocessingVersion: 'p',
    type: 'RESULT',
    status: 'recognized',
    expression: text,
    bounds: { ...b, minY: y, maxY: y + 40 },
    symbols: [...text].map((label, i) => ({
      label,
      score: 0.99,
      topK: [{ label, score: 0.99 }],
      strokeIds: [`${id}-${i}`],
      bounds: { minX: i * 20, minY: y, maxX: i * 20 + 15, maxY: y + 40 },
    })),
    backend: 'wasm',
    timings: { preprocessingMs: 1, inferenceMs: 1, totalMs: 2 },
  };
}
it('rebuilds variable dependencies in reading order, keeps multiplication, retires stale definitions', () => {
  const p = new ProjectionStore();
  p.reset('doc', 0);
  const use = result('use', '×+6=', 120),
    def = result('def', '×=2', 0),
    mul = result('mul', '2×3=', 240);
  p.expect(use);
  p.accept(use);
  expect(p.get('use')?.status).toBe('unbound');
  p.expect(def);
  p.accept(def);
  expect(p.get('def')?.status).toBe('variable-defined');
  expect(p.get('use')?.answerText).toBe('8');
  p.expect(mul);
  p.accept(mul);
  expect(p.get('mul')?.answerText).toBe('6');
  p.retire('def');
  expect(p.get('use')?.status).toBe('unbound');
  expect(p.get('use')?.answerText).toBeUndefined();
  const pending = {
    ...def,
    type: 'RECOGNIZE' as const,
    strokes: [],
    erasures: [],
    requestId: 'next',
    equationRevision: 2,
  };
  p.expect(pending);
  expect(p.get('use')?.status).toBe('pending');
  expect(p.accept(def)).toBeUndefined();
});
it('explicit crossing corrections cannot override confidence or unsupported layout uncertainty', () => {
  const p = new ProjectionStore();
  p.reset('doc', 0);
  const v = {
    ...result('a', '×=2', 0),
    expression: 'x=2',
    status: 'uncertain' as const,
    uncertaintyReasons: ['crossing' as const],
  };
  p.expect(v);
  p.accept(v);
  expect(p.get('a')?.status).toBe('uncertain');
  p.correct('a', 'x');
  expect(p.get('a')?.status).toBe('variable-defined');
  p.correct('a', '×');
  expect(p.get('a')?.status).toBe('invalid');
  const bad = {
    ...v,
    equationRevision: 2,
    requestId: 'bad',
    uncertaintyReasons: ['crossing' as const, 'layout' as const],
  };
  p.expect(bad);
  p.accept(bad);
  p.correct('a', 'x');
  expect(p.get('a')?.status).toBe('uncertain');
});

it('corrects an operand crossing after multiplication without changing the operator', () => {
  const p = new ProjectionStore();
  p.reset('doc', 0);
  const def = result('def', '×=2', 0);
  p.expect(def);
  p.accept(def);
  p.correct('def', 'x');
  const use = {
    ...result('use', '2××=', 120),
    status: 'uncertain' as const,
    uncertaintyReasons: ['crossing' as const],
  };
  p.expect(use);
  p.accept(use);
  expect(p.get('use')?.crossingIndex).toBe(2);
  expect(p.correct('use', 'x', 99)).toBe(false);
  p.correct('use', 'x', 2);
  expect(p.get('use')?.expression).toBe('2×x=');
  expect(p.get('use')?.answerText).toBe('4');
  p.correct('use', '×', 2);
  expect(p.get('use')?.status).toBe('invalid');
  p.correct('use', 'x');
  expect(p.get('use')?.answerText).toBe('4');
});
