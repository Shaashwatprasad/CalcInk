import { describe, expect, it } from 'vitest';
import {
  NotebookEvaluator,
  evaluateAST,
  evaluateNotebook,
  parseMath,
} from '../../src/math';
import { ProjectionStore, type TypedMathEntry } from '../../src/projection';
import type { RecognitionResult } from '../../src/shared/types';

const entry = (id: string, text: string) => ({
  id,
  text,
  state: 'recognized' as const,
});
const typed = (
  id: string,
  text: string,
  y: number,
  revision = 1,
): TypedMathEntry => ({
  id,
  text,
  revision,
  bounds: { minX: 10, maxX: 200, minY: y, maxY: y + 24 },
});
function recognized(
  id: string,
  expression: string,
  y: number,
  revision = 1,
): RecognitionResult {
  return {
    type: 'RESULT',
    protocolVersion: 1,
    documentId: 'doc',
    generation: 0,
    equationId: id,
    equationRevision: revision,
    requestId: `${id}-${revision}`,
    modelVersion: 'test-fixture',
    preprocessingVersion: 'test-fixture',
    expression,
    bounds: { minX: 0, maxX: 100, minY: y, maxY: y + 24 },
    status: 'recognized',
    backend: 'wasm',
    symbols: [...expression].map((label, index) => ({
      label,
      score: 1,
      topK: [{ label, score: 1 }],
      bounds: { minX: index * 10, maxX: index * 10 + 8, minY: y, maxY: y + 24 },
    })),
    timings: { preprocessingMs: 0, inferenceMs: 0, totalMs: 0 },
  };
}

describe('incremental cached notebook evaluation', () => {
  it('accepts generalized case-sensitive identifiers, specific bindings, and variable-derived definitions', () => {
    const notebook = evaluateNotebook([
      entry('a', 'price=2.5'),
      entry('b', 'qty_2=4'),
      entry('c', 'total=price*qty_2'),
      entry('use', 'total+price='),
      entry('upper', 'Price+1='),
    ]);
    expect(notebook.environment).toEqual({ price: 2.5, qty_2: 4, total: 10 });
    expect(notebook.entries[3]).toMatchObject({
      outcome: { status: 'valid', value: 12.5 },
      bindings: { price: 'a', total: 'c' },
    });
    expect(notebook.entries[4].outcome).toEqual({
      status: 'unbound',
      name: 'Price',
    });
    const proto = parseMath('__proto__+1=');
    expect(proto.status).toBe('parsed');
    if (proto.status === 'parsed')
      expect(evaluateAST(proto.ast)).toEqual({
        status: 'unbound',
        name: '__proto__',
      });
  });

  it('evaluates only the edited definition and its specific consumers, including dependent definitions', () => {
    const evaluator = new NotebookEvaluator();
    const rows = [
      entry('a', 'price=2'),
      entry('b', 'total=price*3'),
      entry('c', 'total+1='),
      entry('d', 'price=9'),
      entry('e', 'price+1='),
      entry('f', '5*4='),
    ];
    const before = evaluator.evaluate(rows);
    evaluator.resetMetrics();
    const after = evaluator.evaluate([entry('a', 'price=4'), ...rows.slice(1)]);
    expect(evaluator.metrics).toEqual({ parseCount: 1, evaluationCount: 3 });
    expect(after.entries[2].outcome).toMatchObject({ value: 13 });
    expect(after.entries[4]).toBe(before.entries[4]);
    expect(after.entries[5]).toBe(before.entries[5]);
    evaluator.resetMetrics();
    const reordered = evaluator.evaluate([
      rows[3],
      rows[4],
      rows[0],
      rows[1],
      rows[2],
      rows[5],
    ]);
    expect(reordered.entries[1].bindings).toEqual({ price: 'd' });
    expect(reordered.entries[4].outcome).toMatchObject({ value: 7 });
    expect(evaluator.metrics.parseCount).toBe(1);
  });

  it('blocks only the pending named definition, clears invalid redefinitions and recovers cached ASTs', () => {
    const evaluator = new NotebookEvaluator();
    const rows = [
      entry('a', 'a=2'),
      entry('b', 'b=3'),
      entry('u', 'a+b='),
      entry('v', 'b*2='),
    ];
    const original = evaluator.evaluate(rows);
    evaluator.resetMetrics();
    const pending = evaluator.evaluate([
      { ...rows[0], state: 'pending' },
      ...rows.slice(1),
    ]);
    expect(pending.entries[2].outcome).toEqual({
      status: 'pending',
      reason: 'definition-not-current',
      definitionId: 'a',
    });
    expect(pending.entries[3]).toBe(original.entries[3]);
    expect(evaluator.metrics).toEqual({ parseCount: 0, evaluationCount: 0 });
    const restored = evaluator.evaluate(rows);
    expect(restored.entries[2].outcome).toMatchObject({ value: 5 });
    expect(evaluator.metrics.parseCount).toBe(0);
    expect(
      evaluator.evaluate([entry('a', 'a=2/0'), ...rows.slice(1)]).entries[2]
        .outcome,
    ).toEqual({ status: 'unbound', name: 'a' });
  });

  it('caches syntax diagnostics and scales a chain without recursively expanding cache keys', () => {
    const evaluator = new NotebookEvaluator();
    const rows = [
      entry('bad', '1..2='),
      entry('v0', 'v0=1'),
      ...Array.from({ length: 199 }, (_, i) =>
        entry(`v${i + 1}`, `v${i + 1}=v${i}+1`),
      ),
    ];
    const original = evaluator.evaluate(rows);
    expect(original.environment.v199).toBe(200);
    evaluator.resetMetrics();
    expect(evaluator.evaluate(rows).entries[0]).toBe(original.entries[0]);
    expect(evaluator.metrics).toEqual({ parseCount: 0, evaluationCount: 0 });
    evaluator.evaluate([rows[0], entry('v0', 'v0=2'), ...rows.slice(2)]);
    expect(evaluator.metrics).toEqual({ parseCount: 1, evaluationCount: 200 });
  });
});

describe('stable shared projections', () => {
  it('keeps 199 independent answers and ASTs stable through a local pending edit in 200 equations', () => {
    const store = new ProjectionStore();
    store.reset('doc', 0);
    const results = Array.from({ length: 200 }, (_, i) =>
      recognized(`line-${i}`, `${i}+1=`, i * 50),
    );
    for (const result of results) {
      store.expect(result);
      store.accept(result);
    }
    expect(store.metrics).toEqual({ parseCount: 200, evaluationCount: 200 });
    const original = store.all();
    store.resetMetrics();
    store.invalidate('line-100');
    expect(store.get('line-100')?.status).toBe('pending');
    expect(store.get('line-100')?.answerText).toBeUndefined();
    expect(store.accept(results[100])).toBeUndefined();
    const changed = recognized('line-100', '100+2=', 5000, 2);
    store.expect(changed);
    store.accept(changed);
    expect(store.metrics).toEqual({ parseCount: 1, evaluationCount: 1 });
    for (const previous of original)
      if (previous.equationId !== 'line-100') {
        expect(store.get(previous.equationId)).toBe(previous);
        expect(store.get(previous.equationId)?.answerText).toBe(
          previous.answerText,
        );
      }
    expect(store.get('line-100')?.answerText).toBe('102');
  });

  it('shares typed definitions with ink consumers; movement rebinds and clear/reset releases caches', () => {
    const store = new ProjectionStore();
    store.reset('doc', 0);
    store.syncTyped([
      typed('price', 'price=3', 0),
      typed('total', 'price*2=', 50),
    ]);
    const use = recognized('ink-use', 'price+1=', 100);
    store.expect(use);
    store.accept(use);
    expect(store.get('ink-use')?.answerText).toBe('4');
    store.resetMetrics();
    store.syncTyped([
      typed('price', 'price=5', 0, 2),
      typed('total', 'price*2=', 50),
    ]);
    expect(store.metrics).toEqual({ parseCount: 1, evaluationCount: 3 });
    expect(store.get('total')?.answerText).toBe('10');
    const preserved = store.get('total');
    store.resetMetrics();
    store.syncTyped([
      typed('price', 'price=5', 0, 2),
      typed('total', 'price*2=', 50),
    ]);
    expect(store.metrics).toEqual({ parseCount: 0, evaluationCount: 0 });
    expect(store.get('total')).toBe(preserved);
    store.syncTyped([
      typed('price', 'price=5', 200, 3),
      typed('total', 'price*2=', 50),
    ]);
    expect(store.get('total')?.status).toBe('unbound');
    expect(store.get('ink-use')?.status).toBe('unbound');
    store.reset('other', 1);
    expect(store.size).toBe(0);
    expect(store.metrics).toEqual({ parseCount: 0, evaluationCount: 0 });
  });

  it('retains cached dependency hints when recognition of a known arithmetic row fails', () => {
    const store = new ProjectionStore();
    store.reset('doc', 0);
    store.syncTyped([typed('definition', 'x=2', 0), typed('use', 'x+1=', 200)]);
    const arithmetic = recognized('arithmetic', '2+2=', 100);
    store.expect(arithmetic);
    store.accept(arithmetic);
    const consumer = store.get('use');
    const edited = recognized('arithmetic', '2+3=', 100, 2);
    store.expect(edited);
    expect(store.get('use')).toBe(consumer);
    store.accept({
      ...edited,
      expression: '',
      symbols: [],
      status: 'error',
      error: 'Equation preprocessing failed',
    });
    expect(store.get('arithmetic')?.status).toBe('unavailable');
    expect(store.get('arithmetic')?.answerText).toBeUndefined();
    expect(store.get('use')).toBe(consumer);
    expect(store.get('use')?.answerText).toBe('3');
  });

  it('keeps failed definition consumers blocked without blocking unrelated variable names', () => {
    const store = new ProjectionStore();
    store.reset('doc', 0);
    store.syncTyped([
      typed('other-definition', 'price=5', 0),
      typed('other-use', 'price+1=', 300),
    ]);
    const definition = recognized('definition', 'x=2', 100);
    const consumer = recognized('consumer', 'x+1=', 200);
    store.expect(definition);
    store.accept(definition);
    store.expect(consumer);
    store.accept(consumer);
    const unrelated = store.get('other-use');
    const edited = recognized('definition', 'x=3', 100, 2);
    store.expect(edited);
    store.accept({
      ...edited,
      expression: '',
      symbols: [],
      status: 'error',
      error: 'Equation preprocessing failed',
    });
    expect(store.get('consumer')?.outcome).toEqual({
      status: 'pending',
      reason: 'definition-not-current',
      definitionId: 'definition',
    });
    expect(store.get('other-use')).toBe(unrelated);
    expect(store.get('other-use')?.answerText).toBe('6');
    const unknown = recognized('unknown', '', 250);
    store.expect(unknown);
    store.accept({
      ...unknown,
      status: 'error',
      error: 'Unknown new equation',
    });
    expect(store.get('other-use')?.status).toBe('pending');
  });

  it('batches reconciliation and shows division diagnostics beside typed expressions', () => {
    const store = new ProjectionStore();
    store.reset('doc', 0);
    const a = recognized('a', '1+1=', 0),
      b = recognized('b', '2+2=', 50);
    store.batch(() => {
      store.expect(a);
      store.accept(a);
      store.expect(b);
      store.accept(b);
    });
    expect(store.metrics).toEqual({ parseCount: 2, evaluationCount: 2 });
    store.syncTyped([typed('zero', '10/0=', 100)]);
    expect(store.get('zero')).toMatchObject({
      status: 'undefined',
      answerText: 'Cannot divide by zero',
    });
    store.syncTyped([]);
    expect(store.get('zero')).toBeUndefined();
  });
});
