import { describe, expect, it } from 'vitest';
import {
  contextualCandidates,
  decodeFraction,
  decodeSymbols,
  geometricSlash,
  plausibleExpression,
  RecognitionCache,
  recognitionCacheKey,
} from '../../src/recognition/decode';
import {
  estimateBodySize,
  findFractionLayouts,
  groupEquations,
  groupSymbols,
  symbolGroupingCandidates,
} from '../../src/recognition/grouping';
import type {
  Bounds,
  Erasure,
  InkDocument,
  Stroke,
  SymbolPrediction,
} from '../../src/shared/types';
const stroke = (id: string, x: number, y: number, w = 20, h = 40): Stroke => ({
  id,
  width: 3,
  color: '#000',
  bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h },
  points: [
    { x, y, timestamp: 0 },
    { x: x + w, y: y + h, timestamp: 1 },
  ],
});
const document = (
  strokes: Stroke[],
  erasures: Erasure[] = [],
): InkDocument => ({
  format: 'calcink-document',
  version: 2,
  documentId: 'doc',
  generation: 1,
  revision: 1,
  strokes,
  erasures,
});
const prediction = (
  label: string,
  bounds: Bounds = stroke('tmp', 0, 0).bounds,
  score = 0.95,
  alternatives: { label: string; score: number }[] = [],
): SymbolPrediction => ({
  label,
  bounds,
  score,
  topK: [{ label, score }, ...alternatives],
});
const fraction = () => [
  stroke('num', 15, 0, 20, 30),
  stroke('bar', 0, 40, 50, 2),
  stroke('den', 15, 52, 20, 30),
];
describe('local equation grouping', () => {
  it('separates distant equations on one baseline and leaves neighbor revision unchanged', () => {
    const doc = document([stroke('left', 0, 0), stroke('right', 600, 0)]);
    const before = groupEquations(doc);
    expect(before.map((g) => g.strokes.map((s) => s.id))).toEqual([
      ['left'],
      ['right'],
    ]);
    doc.strokes[1].points[0].x++;
    expect(groupEquations(doc)[0]).toEqual(before[0]);
  });
  it('joins a late operator bridge after a right-hand equals seeded the row', () => {
    const ink = [
      stroke('x1', 80, 270, 30, 40),
      stroke('x2', 80, 270, 30, 40),
      stroke('plus-h', 135, 290, 30, 0),
      stroke('plus-v', 150, 275, 0, 30),
      stroke('six', 193, 270, 28, 42),
      stroke('eq1', 250, 284, 25, 0),
      stroke('eq2', 250, 297, 25, 0),
    ];
    for (const order of [ink, [...ink].reverse()])
      expect(
        groupEquations(document(order)).map((g) =>
          g.strokes.map((s) => s.id).sort(),
        ),
      ).toEqual([['eq1', 'eq2', 'plus-h', 'plus-v', 'six', 'x1', 'x2']]);
  });
  it('joins a single fraction and neighboring equals with exact mask routing', () => {
    const ink = [
      ...fraction(),
      stroke('eq1', 70, 37, 20, 1),
      stroke('eq2', 70, 47, 20, 1),
      stroke('other', 600, 35),
    ];
    const mask: Erasure = {
      id: 'erase',
      targetStrokeIds: ['num', 'other'],
      radius: 2,
      path: [{ x: 20, y: 10, timestamp: 1 }],
    };
    const groups = groupEquations(document(ink, [mask]));
    expect(groups).toHaveLength(2);
    expect(new Set(groups[0].strokes.map((s) => s.id))).toEqual(
      new Set(['num', 'bar', 'den', 'eq1', 'eq2']),
    );
    expect(groups[0].erasures[0].targetStrokeIds).toEqual(['num']);
    expect(groups[1].erasures[0].targetStrokeIds).toEqual(['other']);
  });
  it('does not mistake plus crossbars in neighboring complete equations for fraction bars', () => {
    const rows = Array.from({ length: 200 }, (_, row) => {
      const y = row * 60;
      return [
        stroke(`left-${row}`, 10, y, 0, 50),
        stroke(`plus-h-${row}`, 55, y + 25, 30, 0),
        stroke(`plus-v-${row}`, 70, y + 10, 0, 30),
        stroke(`right-${row}`, 125, y, 0, 50),
        stroke(`eq-a-${row}`, 160, y + 19, 25, 0),
        stroke(`eq-b-${row}`, 160, y + 32, 25, 0),
      ];
    }).flat();
    expect(findFractionLayouts(rows)).toEqual([]);
    const groups = groupEquations(document(rows));
    expect(groups).toHaveLength(200);
    expect(groups.every((group) => group.strokes.length === 6)).toBe(true);
  });
  it('accepts thin tall one operands above and below a fraction bar', () => {
    const ink = [
      stroke('num-one', 139, 99, 2, 52),
      stroke('bar', 109, 164, 62, 2),
      stroke('den-one', 139, 179, 2, 52),
      stroke('eq1', 204, 158, 27, 2),
      stroke('eq2', 204, 171, 27, 2),
    ];
    const layouts = findFractionLayouts(ink);
    expect(layouts).toHaveLength(1);
    expect(
      layouts[0].numerator.flatMap((g) => g.strokes.map((s) => s.id)),
    ).toEqual(['num-one']);
    expect(
      layouts[0].denominator.flatMap((g) => g.strokes.map((s) => s.id)),
    ).toEqual(['den-one']);
    expect(groupEquations(document(ink))).toHaveLength(1);
  });
  it('uses median body sizing despite tall marks, dots and bars', () => {
    const ordinary = [
      stroke('a', 0, 0),
      stroke('b', 30, 0),
      stroke('c', 60, 0),
    ];
    expect(
      estimateBodySize([
        ...ordinary,
        stroke('tall', 100, -100, 20, 260),
        stroke('dot', 90, 38, 2, 2),
        stroke('bar', 0, 70, 100, 2),
      ]),
    ).toBe(40);
  });
  it('preserves late division dots and does not call two dots a fraction', () => {
    const ink = [
      stroke('bar', 20, 20, 30, 1),
      stroke('bottom', 33, 32, 3, 3),
      stroke('top', 33, 6, 3, 3),
    ];
    expect(groupSymbols(ink)[0].strokes).toHaveLength(3);
    expect(findFractionLayouts(ink)).toEqual([]);
  });
  it('preserves decimal components with slightly overlapping painted digit bounds and keeps division dots grouped', () => {
    const ink = [
      stroke('digit', 0, 0),
      stroke('dot', 19, 38, 3, 3),
      stroke('right-digit', 21, 0),
    ];
    expect(groupSymbols(ink).map((g) => g.strokes.map((s) => s.id))).toEqual([
      ['digit'],
      ['dot'],
      ['right-digit'],
    ]);
    const division = [
      stroke('bar', 0, 20, 30, 2),
      stroke('top', 14, 7, 3, 3),
      stroke('bottom', 14, 33, 3, 3),
    ];
    expect(groupSymbols(division)).toHaveLength(1);
  });
  it('bounds touching-digit split alternatives and preserves exact source membership', () => {
    const ink = [
      stroke('one', 0, 0),
      stroke('two', 18, 0),
      stroke('three', 36, 0),
    ];
    const candidates = symbolGroupingCandidates(ink);
    expect(candidates[0].ambiguous).toBe(true);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.length).toBeLessThanOrEqual(4);
    for (const c of candidates)
      expect(
        c.groups.flatMap((g) => g.strokes.map((s) => s.id)).sort(),
      ).toEqual(['one', 'three', 'two']);
    expect(
      symbolGroupingCandidates([
        stroke('bar', 0, 10, 25, 2),
        stroke('vertical', 12, 0, 2, 30),
      ]),
    ).toHaveLength(1);
  });
});
describe('bounded decoder and division geometry', () => {
  it('retains learned multiplication and exposes contextual x without accepting ambiguity', () => {
    const crossing = prediction('×', undefined, 0.9, [
      { label: '+', score: 0.06 },
    ]);
    expect(contextualCandidates(crossing).label).toBe('×');
    expect(contextualCandidates(crossing).topK.at(-1)).toEqual({
      label: 'x',
      score: 0.9,
    });
    expect(
      decodeSymbols([
        prediction('2'),
        crossing,
        prediction('3'),
        prediction('='),
      ]),
    ).toMatchObject({ expression: '2×3=', status: 'recognized' });
    expect(
      decodeSymbols([crossing, prediction('='), prediction('2')]),
    ).toMatchObject({ expression: 'x=2', status: 'uncertain' });
  });
  it('does not promote low evidence to a valid answer merely because syntax fits', () => {
    expect(
      decodeSymbols([
        prediction('5'),
        prediction('+', undefined, 0.5),
        prediction('2'),
        prediction('='),
      ]).status,
    ).toBe('uncertain');
    expect(decodeSymbols([prediction('5'), prediction('+')])).toMatchObject({
      expression: '5+',
      status: 'recognized',
    });
    expect(decodeSymbols([prediction('1'), prediction('1')], true).status).toBe(
      'uncertain',
    );
    expect(
      decodeSymbols(Array.from({ length: 129 }, () => prediction('1'))).status,
    ).toBe('uncertain');
    expect(plausibleExpression('5++')).toBe(true);
    expect(plausibleExpression('5÷×2=')).toBe(false);
  });
  it('recognizes only a straight slash geometry, excluding one-like or curved strokes', () => {
    const slash = stroke('slash', 0, 0, 20, 40);
    slash.points = [
      { x: 20, y: 0, timestamp: 0 },
      { x: 0, y: 40, timestamp: 1 },
    ];
    const group = { strokes: [slash], bounds: slash.bounds };
    expect(geometricSlash(group, 40)).toBe(true);
    expect(
      geometricSlash(
        {
          strokes: [stroke('one', 0, 0, 3, 40)],
          bounds: stroke('one', 0, 0, 3, 40).bounds,
        },
        40,
      ),
    ).toBe(false);
    slash.points.splice(1, 0, { x: 22, y: 20, timestamp: 0.5 });
    expect(geometricSlash(group, 40)).toBe(false);
  });
  it('decodes supported single fractions to common division notation with source provenance', () => {
    const layout = findFractionLayouts(fraction())[0];
    expect(layout).toBeDefined();
    const n = {
      ...prediction('6', layout.numerator[0].bounds),
      strokeIds: ['num'],
    };
    const d = {
      ...prediction('2', layout.denominator[0].bounds),
      strokeIds: ['den'],
    };
    const bar = { ...prediction('/', layout.bar.bounds), strokeIds: ['bar'] };
    const decoded = decodeFraction(layout, [n], [d], [], bar);
    expect(decoded).toMatchObject({
      expression: '(6)/(2)',
      status: 'recognized',
    });
    expect(decoded.symbols.flatMap((s) => s.strokeIds ?? [])).toEqual([
      'num',
      'bar',
      'den',
    ]);
    expect(decodeFraction(layout, [n], [], [], bar).status).toBe('uncertain');
    expect(decodeFraction(layout, [n], [d], [], bar, true).status).toBe(
      'uncertain',
    );
  });
});
describe('bounded effective-input cache', () => {
  it('excludes cosmetic color/time and invalidates geometry, pressure, model, preprocessing, scale and targeted masks', () => {
    const s = stroke('a', 10, 20),
      group = { strokes: [s], bounds: s.bounds };
    const key = () => recognitionCacheKey(group, [], 40, 'sha', 'v4');
    const original = key();
    s.color = '#fff';
    s.points[0].timestamp = 50;
    expect(key()).toBe(original);
    s.points[0].x++;
    expect(key()).not.toBe(original);
    s.points[0].x--;
    s.pressureEnabled = true;
    s.points[0].pressure = 0.2;
    expect(key()).not.toBe(original);
    s.pressureEnabled = false;
    for (const [size, sha, version] of [
      [50, 'sha', 'v4'],
      [40, 'other', 'v4'],
      [40, 'sha', 'v5'],
    ] as const)
      expect(recognitionCacheKey(group, [], size, sha, version)).not.toBe(
        original,
      );
    const mask: Erasure = {
      id: 'mask',
      targetStrokeIds: ['unrelated'],
      radius: 3,
      path: [{ x: 10, y: 20, timestamp: 1 }],
    };
    expect(recognitionCacheKey(group, [mask], 40, 'sha', 'v4')).toBe(original);
    mask.targetStrokeIds = ['a'];
    expect(recognitionCacheKey(group, [mask], 40, 'sha', 'v4')).not.toBe(
      original,
    );
  });
  it('evicts least recently used predictions at exactly 128 entries', () => {
    const cache = new RecognitionCache();
    for (let i = 0; i < 128; i++) cache.set(String(i), [i]);
    expect(cache.get('0')).toEqual([0]);
    cache.set('128', [128]);
    expect(cache.size).toBe(128);
    expect(cache.get('1')).toBeUndefined();
    expect(cache.get('0')).toEqual([0]);
  });
});
