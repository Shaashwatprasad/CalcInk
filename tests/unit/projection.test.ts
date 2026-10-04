import { beforeEach, describe, expect, it } from 'vitest';
import {
  isRecognitionResult,
  ProjectionStore,
  RecognitionQueue,
} from '../../src/projection';
import type {
  JobIdentity,
  RecognitionJob,
  RecognitionResult,
} from '../../src/shared/types';

const bounds = { minX: 0, minY: 0, maxX: 60, maxY: 20 };
const identity = (overrides: Partial<JobIdentity> = {}): JobIdentity => ({
  protocolVersion: 1,
  documentId: 'doc',
  generation: 1,
  equationId: 'line-a',
  equationRevision: 1,
  requestId: 'request-a',
  modelVersion: 'model-1',
  preprocessingVersion: 'preprocess-1',
  ...overrides,
});
const job = (overrides: Partial<JobIdentity> = {}): RecognitionJob => ({
  ...identity(overrides),
  type: 'RECOGNIZE',
  strokes: [],
  erasures: [],
  bounds,
});
const result = (
  overrides: Partial<RecognitionResult> = {},
): RecognitionResult => ({
  ...identity(),
  type: 'RESULT',
  expression: '18+4×3=',
  bounds,
  status: 'recognized',
  symbols: [
    { label: '=', score: 0.99, bounds, topK: [{ label: '=', score: 0.99 }] },
  ],
  timings: { preprocessingMs: 1, inferenceMs: 2, totalMs: 3 },
  backend: 'wasm',
  ...overrides,
});

describe('revision-safe equation projections', () => {
  let store: ProjectionStore;
  beforeEach(() => {
    store = new ProjectionStore();
    store.reset('doc', 1);
  });

  it('places a derived answer after terminal equals and consumes duplicate replies', () => {
    store.expect(identity());
    expect(store.accept(result())).toMatchObject({
      status: 'valid',
      answerText: '30',
      answerBounds: { minX: 72 },
    });
    expect(store.get('line-a')?.evaluation).toMatchObject({
      status: 'valid',
      value: 30,
    });
    expect(store.accept(result())).toBeUndefined();
  });

  it('invalidates edited answers immediately and rejects a delayed previous request', () => {
    store.expect(identity());
    store.accept(result());
    const replacement = identity({ equationRevision: 2, requestId: 'new' });
    store.expect(replacement);
    expect(store.get('line-a')).toBeUndefined();
    expect(store.accept(result())).toBeUndefined();
    expect(
      store.accept(result({ ...replacement, expression: '18+5×3=' })),
    ).toMatchObject({ answerText: '33' });
  });

  it('lets independent equations finish in either order', () => {
    const lineB = identity({ equationId: 'line-b', requestId: 'request-b' });
    store.expect(identity());
    store.expect(lineB);
    expect(
      store.accept(result({ ...lineB, expression: '1+1=' })),
    ).toMatchObject({ answerText: '2' });
    expect(store.accept(result())).toMatchObject({ answerText: '30' });
    expect(store.size).toBe(2);
  });

  it.each([
    { documentId: 'other' },
    { generation: 2 },
    { equationId: 'retired' },
    { equationRevision: 0 },
    { requestId: 'old' },
    { modelVersion: 'model-0' },
    { preprocessingVersion: 'preprocess-0' },
  ])('rejects stale identity %j', (changes) => {
    store.expect(identity());
    expect(store.accept(result(changes))).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('retires erased equals/merged groups and invalidates jobs on clear/recovery/restart', () => {
    store.expect(identity());
    store.accept(result());
    store.retire('line-a');
    expect(store.get('line-a')).toBeUndefined();
    expect(store.accept(result())).toBeUndefined();
    store.expect(identity());
    store.reset('doc', 2);
    expect(store.accept(result())).toBeUndefined();
    expect(() => store.expect(identity())).toThrow(
      'current document generation',
    );
    store.reset('new-document', 1);
    expect(store.accept(result())).toBeUndefined();
  });

  it.each([
    { expression: '18+4×3' },
    { symbols: [] },
    { symbols: [{ label: '+', score: 0.99, bounds, topK: [] }] },
    { expression: '1+=', status: 'recognized' as const },
    { status: 'uncertain' as const },
    { status: 'error' as const, error: 'inference failed' },
  ])('does not manufacture an answer for %j', (changes) => {
    store.expect(identity());
    expect(store.accept(result(changes))?.answerText).toBeUndefined();
  });

  it('projects undefined results and tolerates invalid syntax without stale answers', () => {
    store.expect(identity());
    expect(store.accept(result({ expression: '7/0=' }))).toMatchObject({
      status: 'undefined',
      answerText: 'Undefined',
    });
    store.expect(identity({ requestId: 'syntax' }));
    expect(
      store.accept(result({ requestId: 'syntax', expression: '1..2=' })),
    ).toMatchObject({ status: 'invalid' });
    expect(store.get('line-a')?.answerText).toBeUndefined();
  });

  it.each([
    null,
    {},
    { ...result(), generation: -1 },
    { ...result(), protocolVersion: 2 },
    {
      ...result(),
      timings: { preprocessingMs: -1, inferenceMs: 1, totalMs: 1 },
    },
    { ...result(), bounds: { ...bounds, minX: NaN } },
    { ...result(), bounds: { ...bounds, minX: 61 } },
    { ...result(), symbols: [{ label: '=', score: 1.1, bounds, topK: [] }] },
    {
      ...result(),
      symbols: [
        {
          label: '=',
          score: 1,
          bounds,
          topK: [{ label: '=', score: Infinity }],
        },
      ],
    },
    { ...result(), expression: '1'.repeat(4097) },
    { ...result(), backend: 'webgpu' },
  ])('rejects malformed runtime message %#', (value) => {
    expect(isRecognitionResult(value)).toBe(false);
    store.expect(identity());
    expect(store.accept(value)).toBeUndefined();
  });
});

describe('fair recognition queue', () => {
  it('coalesces edits while allowing one active run and FIFO across equations', () => {
    const queue = new RecognitionQueue();
    queue.enqueue(job());
    queue.enqueue(job({ equationId: 'line-b', requestId: 'b' }));
    queue.enqueue(job({ requestId: 'a2', equationRevision: 2 }));
    expect(queue.size).toBe(2);
    const active = queue.takeNext()!;
    expect(active.requestId).toBe('a2');
    expect(queue.takeNext()).toBeUndefined();
    queue.enqueue(job({ requestId: 'a3', equationRevision: 3 }));
    expect(queue.complete(identity())).toBe(false);
    expect(queue.complete(active)).toBe(true);
    expect(queue.takeNext()?.equationId).toBe('line-b');
  });

  it('retiring queued work does not pretend to interrupt an active model run', () => {
    const queue = new RecognitionQueue();
    queue.enqueue(job());
    const active = queue.takeNext()!;
    queue.enqueue(job({ requestId: 'a2' }));
    queue.retire('line-a');
    expect(queue.size).toBe(0);
    expect(queue.isRunning).toBe(true);
    expect(queue.complete(active)).toBe(true);
    expect(queue.takeNext()).toBeUndefined();
    queue.enqueue(job());
    queue.takeNext();
    queue.reset();
    expect(queue.size).toBe(0);
    expect(queue.isRunning).toBe(false);
    expect(queue.complete(active)).toBe(false);
  });
});
