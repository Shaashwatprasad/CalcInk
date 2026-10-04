/** Test-only worker responses isolate scheduling; production always uses the real model. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startRecognizer,
  type RecognitionState,
} from '../../src/app/recognizer';
import { InkStore } from '../../src/document/InkStore';
import { pointBounds } from '../../src/ink/geometry';
import { groupEquations } from '../../src/recognition/grouping';
import type {
  GroupRequest,
  GroupResult,
  InkDocument,
  RecognitionJob,
  RecognitionResult,
  Stroke,
  WorkerRequest,
} from '../../src/shared/types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: WorkerRequest[] = [];
  onmessage?: (event: MessageEvent<unknown>) => void;
  onerror?: () => void;
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(value: WorkerRequest) {
    this.posted.push(structuredClone(value));
  }
  terminate() {
    this.terminated = true;
  }
  reply(value: unknown) {
    this.onmessage?.({ data: structuredClone(value) } as MessageEvent<unknown>);
  }
  get grouping() {
    return this.posted.filter(
      (value): value is GroupRequest => value.type === 'GROUP',
    );
  }
  get recognition() {
    return this.posted.filter(
      (value): value is RecognitionJob => value.type === 'RECOGNIZE',
    );
  }
}
const makeStroke = (id: string, y = 100, x = 10, height = 40): Stroke => {
  const points = [
    { x, y, timestamp: 1 },
    { x: x + 20, y: y + height, timestamp: 2 },
  ];
  return {
    id,
    points,
    bounds: pointBounds(points, 1),
    width: 2,
    color: '#000000',
  };
};
const grouped = (document: InkDocument): GroupResult => ({
  type: 'GROUPS',
  documentId: document.documentId,
  generation: document.generation,
  documentRevision: document.revision,
  groups: groupEquations(document),
});
const recognized = (
  job: RecognitionJob,
  expression = '1+1=',
): RecognitionResult => ({
  ...job,
  type: 'RESULT',
  status: 'recognized',
  expression,
  symbols: [
    {
      label: '=',
      score: 0.99,
      topK: [{ label: '=', score: 0.99 }],
      bounds: job.bounds,
    },
  ],
  timings: { preprocessingMs: 1, inferenceMs: 1, totalMs: 2 },
  backend: 'wasm',
});
let cleanups: (() => void)[] = [];
function setup(store = new InkStore()) {
  const states: RecognitionState[] = [];
  const stop = startRecognizer(store, (state) => states.push(state));
  cleanups.push(stop);
  const worker = FakeWorker.instances.at(-1)!;
  worker.reply({
    type: 'READY',
    modelVersion: 'test-model',
    preprocessingVersion: 'test-preprocess',
    backend: 'wasm',
  });
  return { store, worker, states, latest: () => states.at(-1)! };
}
function finishGroups(worker: FakeWorker) {
  vi.advanceTimersByTime(220);
  const request = worker.grouping.at(-1)!;
  worker.reply(grouped(request.document));
  return request;
}
function finishRecognition(worker: FakeWorker, expression = '1+1=') {
  worker.reply(recognized(worker.recognition.at(-1)!, expression));
}
beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('worker equation grouping scheduler', () => {
  it('debounces edits into the latest document and ignores earlier grouping revisions', () => {
    const { store, worker, latest } = setup();
    store.addStroke(makeStroke('a'));
    const earlier = store.getSnapshot();
    vi.advanceTimersByTime(100);
    store.addStroke(makeStroke('b', 100, 50));
    vi.advanceTimersByTime(219);
    expect(worker.grouping).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(worker.grouping).toHaveLength(1);
    expect(worker.grouping[0].document.revision).toBe(
      store.getSnapshot().revision,
    );
    worker.reply(grouped(earlier));
    expect(worker.recognition).toHaveLength(0);
    worker.reply(grouped(worker.grouping[0].document));
    expect(worker.recognition).toHaveLength(1);
    finishRecognition(worker);
    expect(latest().projections[0].answerText).toBe('2');
  });

  it('retires the affected answer immediately while preserving an unrelated equation', () => {
    const store = new InkStore();
    store.addStroke(makeStroke('a'));
    store.addStroke(makeStroke('b', 300));
    const { worker, latest } = setup(store);
    const original = finishGroups(worker).document;
    finishRecognition(worker);
    finishRecognition(worker, '2+2=');
    expect(latest().projections.map((p) => p.answerText)).toEqual(['2', '4']);
    store.eraseRegion([{ x: 20, y: 120, timestamp: 3 }], 3);
    expect(latest().projections.map((p) => p.answerText)).toEqual(['4']);
    worker.reply(grouped(original));
    expect(latest().projections.map((p) => p.answerText)).toEqual(['4']);
    finishGroups(worker);
    finishRecognition(worker, '3+3=');
    expect(
      latest()
        .projections.map((p) => p.answerText)
        .sort(),
    ).toEqual(['4', '6']);
    expect(worker.recognition).toHaveLength(3);
  });

  it('accepts an unrelated active result while another equation awaits regrouping', () => {
    const store = new InkStore();
    store.addStroke(makeStroke('a'));
    store.addStroke(makeStroke('b', 300));
    const { worker, latest } = setup(store);
    finishGroups(worker);
    const unaffected = worker.recognition[0];
    store.eraseRegion([{ x: 20, y: 320, timestamp: 3 }], 3);
    worker.reply(recognized(unaffected));
    expect(latest().projections.map((p) => p.answerText)).toEqual(['2']);
    // The obsolete queued second equation was retired before it could run.
    expect(worker.recognition).toHaveLength(1);
    expect(latest().queued).toBe(1);
    finishGroups(worker);
    finishRecognition(worker, '2+2=');
    expect(latest().projections.map((p) => p.answerText)).toEqual(['2', '4']);
  });

  it('retires nearby potentially affected answers before locally regrouping a separate late mark', () => {
    const store = new InkStore();
    store.addStroke(makeStroke('a'));
    const { worker, latest } = setup(store);
    finishGroups(worker);
    finishRecognition(worker);
    expect(latest().projections[0].answerText).toBe('2');
    store.addStroke(makeStroke('dot', 163, 80, 0));
    expect(
      groupEquations(store.getSnapshot())
        .flatMap((g) => g.strokes.map((s) => s.id))
        .sort(),
    ).toEqual(['a', 'dot']);
    expect(groupEquations(store.getSnapshot())).toHaveLength(2);
    expect(latest().projections).toEqual([]);
  });

  it('conservatively retires potential neighbors without letting a tall outlier merge separate rows', () => {
    const store = new InkStore();
    store.addStroke(makeStroke('a', 0));
    store.addStroke(makeStroke('b', 120));
    store.addStroke(makeStroke('c', 220));
    const { worker, latest } = setup(store);
    finishGroups(worker);
    finishRecognition(worker);
    finishRecognition(worker);
    finishRecognition(worker);
    expect(latest().projections).toHaveLength(3);
    store.addStroke(makeStroke('bridge', 0, 70, 100));
    expect(
      groupEquations(store.getSnapshot()).map((g) =>
        g.strokes.map((s) => s.id),
      ),
    ).toEqual([['a'], ['bridge'], ['b'], ['c']]);
    expect(latest().projections).toEqual([]);
  });

  it('annotation and highlighter commits preserve current answers and avoid unnecessary model grouping', () => {
    const store = new InkStore();
    store.addStroke(makeStroke('a'));
    const { worker, latest } = setup(store);
    finishGroups(worker);
    finishRecognition(worker);
    const answer = latest().projections,
      requests = worker.grouping.length;
    store.addObject({
      id: 'text',
      kind: 'text',
      x: 10,
      y: 100,
      text: 'notes',
      fontSize: 16,
      color: '#252D38',
      colorMode: 'auto',
      opacity: 1,
      strokeWidth: 2,
      recognitionEligible: false,
    });
    store.addStroke({
      ...makeStroke('highlight'),
      kind: 'highlighter',
      recognitionEligible: false,
    });
    vi.advanceTimersByTime(800);
    expect(worker.grouping).toHaveLength(requests);
    expect(latest().projections).toEqual(answer);
  });
  it.each(['clear', 'replace'] as const)(
    'rejects delayed groups following %s',
    (operation) => {
      const store = new InkStore();
      store.addStroke(makeStroke('a'));
      const { worker, latest } = setup(store);
      vi.advanceTimersByTime(220);
      const old = worker.grouping[0].document;
      if (operation === 'clear') store.clear();
      else store.replaceDocument({ ...old, documentId: 'replacement' });
      worker.reply(grouped(old));
      expect(worker.recognition).toHaveLength(0);
      expect(latest().projections).toEqual([]);
      finishGroups(worker);
      if (operation === 'clear') expect(worker.recognition).toHaveLength(0);
      else {
        expect(worker.recognition[0].documentId).toBe('replacement');
        finishRecognition(worker);
        expect(latest().projections[0].answerText).toBe('2');
      }
    },
  );

  it('discards an active recognition reply after replacement and then runs the current job', () => {
    const store = new InkStore();
    store.addStroke(makeStroke('a'));
    const { worker, latest } = setup(store);
    finishGroups(worker);
    const oldJob = worker.recognition[0];
    store.replaceDocument({
      ...store.getSnapshot(),
      documentId: 'new-document',
    });
    finishGroups(worker);
    expect(worker.recognition).toHaveLength(1);
    worker.reply(recognized(oldJob));
    expect(latest().projections).toEqual([]);
    expect(worker.recognition).toHaveLength(2);
    expect(worker.recognition[1].documentId).toBe('new-document');
    finishRecognition(worker, '3+4=');
    expect(latest().projections[0].answerText).toBe('7');
  });

  it('reports grouping timeout while preserving ink and stops work when disposed', () => {
    const store = new InkStore();
    store.addStroke(makeStroke('a'));
    const { worker, latest } = setup(store);
    vi.advanceTimersByTime(220 + 30000);
    expect(latest().status).toBe('error');
    expect(latest().message).toContain('grouping timed out');
    expect(worker.terminated).toBe(true);
    expect(store.getSnapshot().strokes).toHaveLength(1);
    cleanups[0]();
    const messages = worker.posted.length;
    store.addStroke(makeStroke('b'));
    vi.advanceTimersByTime(60000);
    expect(worker.posted).toHaveLength(messages);
  });
});
