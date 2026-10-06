import { describe, expect, it } from 'vitest';
import { pointBounds } from '../../src/ink/geometry';
import { groupEquations, groupSymbols } from '../../src/recognition/grouping';
import { evaluateExpression } from '../../src/math';
import type { InkDocument, Stroke } from '../../src/shared/types';

/** Independent geometry fixtures; no synthetic accuracy claim. */
const line = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 2,
): Stroke => {
  const points = [
    { x: x1, y: y1, timestamp: 0 },
    { x: x2, y: y2, timestamp: 10 },
  ];
  return {
    id,
    points,
    bounds: pointBounds(points, width / 2),
    width,
    color: '#000000',
  };
};
const membership = (strokes: Stroke[]) =>
  groupSymbols(strokes).map((group) =>
    group.strokes.map((stroke) => stroke.id).sort(),
  );
const document = (strokes: Stroke[]): InkDocument => ({
  format: 'calcink-document',
  version: 1,
  documentId: 'synthetic-regression',
  generation: 0,
  revision: 1,
  strokes,
  erasures: [],
});

describe('ML-GROUP required preserved grouping behavior', () => {
  it('ML-GRP-001 keeps close digits when painted bounds have a positive gap at multiple scales', () => {
    for (const scale of [0.1, 1, 10]) {
      expect(
        membership([
          line('left', 0, 0, 0, 40 * scale, 2 * scale),
          line('right', 2.1 * scale, 0, 2.1 * scale, 40 * scale, 2 * scale),
        ]),
      ).toEqual([['left'], ['right']]);
    }
  });
  it('ML-GRP-002 groups disconnected equals, multiply and late division dots by exact IDs', () => {
    const strokes = [
      line('eq-top', 10, 14, 30, 14),
      line('multiply-a', 50, 0, 70, 30),
      line('divide-bar', 90, 15, 110, 15),
      line('eq-bottom', 10, 24, 30, 24),
      line('multiply-b', 50, 30, 70, 0),
      line('divide-late-bottom', 100, 26, 100, 26),
      line('divide-late-top', 100, 4, 100, 4),
    ];
    expect(membership(strokes)).toEqual([
      ['eq-bottom', 'eq-top'],
      ['multiply-a', 'multiply-b'],
      ['divide-bar', 'divide-late-bottom', 'divide-late-top'],
    ]);
  });
  it('ML-GRP-003 changing stroke arrival order cannot change symbol membership', () => {
    const strokes = [
      line('digit', 0, 0, 0, 40),
      line('dot', 10, 39, 10, 39),
      line('digit-2', 20, 0, 20, 40),
    ];
    expect(membership(strokes)).toEqual([['digit'], ['dot'], ['digit-2']]);
    expect(membership([...strokes].reverse())).toEqual(membership(strokes));
  });
  it('ML-GRP-004 preserves all exact IDs and mask order across separated equations', () => {
    const doc = document([
      line('upper', 0, 0, 10, 40),
      line('lower', 0, 200, 10, 240),
    ]);
    doc.erasures = [
      {
        id: 'mask-1',
        targetStrokeIds: ['upper'],
        radius: 1,
        path: [{ x: 0, y: 0, timestamp: 0 }],
      },
      {
        id: 'mask-2',
        targetStrokeIds: ['lower', 'upper'],
        radius: 1,
        path: [{ x: 0, y: 0, timestamp: 1 }],
      },
    ];
    const groups = groupEquations(doc);
    expect(
      groups.map((group) => group.strokes.map((stroke) => stroke.id)),
    ).toEqual([['upper'], ['lower']]);
    expect(
      groups.map((group) => group.erasures.map((mask) => mask.id)),
    ).toEqual([['mask-1', 'mask-2'], ['mask-2']]);
  });
});

describe('ML-BASELINE defect observations (these are not acceptance passes)', () => {
  it('ML-DEF-001 reproduces overlapping painted bounds merging distinct digits', () => {
    // Intended truth: two handwritten 1 symbols. Centerlines remain separate; width bounds touch.
    expect(
      membership([
        line('one-left', 10, 0, 10, 40, 3),
        line('one-right', 12.5, 0, 12.5, 40, 3),
      ]),
    ).toEqual([['one-left', 'one-right']]);
  });
  it('ML-DEF-002 regression: independent distant same-row equations stay separate', () => {
    const groups = groupEquations(
      document([
        line('left-equation', 0, 0, 50, 40),
        line('far-right-equation', 500, 0, 550, 40),
      ]),
    );
    expect(groups.map((g) => g.strokes.map((s) => s.id))).toEqual([
      ['left-equation'],
      ['far-right-equation'],
    ]);
  });
  it('ML-DEF-003 reproduces x assignment and variable use rejection downstream of recognition', () => {
    expect(evaluateExpression('x=2')).toMatchObject({
      status: 'invalid',
      code: 'unknown-token',
      location: 0,
    });
    expect(evaluateExpression('x+6=')).toMatchObject({
      status: 'invalid',
      code: 'unknown-token',
      location: 0,
    });
    expect(evaluateExpression('2×3=')).toMatchObject({
      status: 'valid',
      value: 6,
    });
  });
});
