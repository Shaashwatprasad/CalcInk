import { expect, it } from 'vitest';
import { scratchTargets } from '../../src/ink/scratch';
import { InkStore } from '../../src/document/InkStore';
import { pointBounds } from '../../src/ink/geometry';
it('requires dense reversals over existing ink and preserves highlight targets and undo', () => {
  const store = new InkStore(),
    points = [
      { x: 100, y: 150, timestamp: 1 },
      { x: 300, y: 150, timestamp: 2 },
    ];
  store.addStroke({
    id: 'a',
    points,
    bounds: pointBounds(points, 1),
    width: 2,
    color: '#252D38',
  });
  store.addStroke({
    id: 'highlight',
    points,
    bounds: pointBounds(points, 6),
    width: 12,
    color: '#FFE66B',
    kind: 'highlighter',
    recognitionEligible: false,
  });
  const before = store.getSnapshot(),
    scratch = Array.from({ length: 40 }, (_, i) => ({
      x: i % 2 ? 240 : 170,
      y: 130 + (i % 8) * 5,
      timestamp: i,
    }));
  expect(scratchTargets(points, before.strokes)).toEqual([]);
  expect(scratchTargets(scratch, before.strokes)).toEqual(['a']);
  store.eraseRegion(scratch, 3, scratchTargets(scratch, before.strokes));
  expect(store.getSnapshot().erasures[0].targetStrokeIds).toEqual(['a']);
  store.undo();
  expect(store.getSnapshot().strokes).toEqual(before.strokes);
  expect(store.getSnapshot().erasures).toEqual(before.erasures);
});
