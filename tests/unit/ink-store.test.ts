import { describe, expect, it } from 'vitest';
import { InkStore } from '../../src/document/InkStore';
import { pointBounds, strokeIntersectsPath } from '../../src/ink/geometry';
import type { Point, Stroke } from '../../src/shared/types';

const point = (x: number, y: number): Point => ({ x, y, timestamp: 1 });
const stroke = (id: string, points = [point(0, 0), point(20, 0)]): Stroke => ({
  id,
  points,
  bounds: pointBounds(points),
  width: 2,
  color: '#000',
});

describe('ink document transactions', () => {
  it('copies stroke input, computes width bounds and protects the snapshot', () => {
    const store = new InkStore();
    const input = stroke('a');
    store.addStroke(input);
    input.points[0].x = 900;
    expect(store.getSnapshot().strokes[0].points[0].x).toBe(0);
    expect(store.getSnapshot().strokes[0].bounds).toEqual({
      minX: -1,
      minY: -1,
      maxX: 21,
      maxY: 1,
    });
    expect(() => store.getSnapshot().strokes.push(input)).toThrow();
  });

  it('persists a partial mask scoped only to strokes present in that transaction', () => {
    const store = new InkStore();
    store.addStroke(stroke('old'));
    store.eraseRegion([point(10, -4), point(10, 4)], 2);
    store.addStroke(stroke('new'));
    const recovered = new InkStore(
      JSON.parse(JSON.stringify(store.getSnapshot())),
    );
    expect(recovered.getSnapshot().strokes).toHaveLength(2);
    expect(recovered.getSnapshot().erasures[0].targetStrokeIds).toEqual([
      'old',
    ]);
    expect(recovered.getSnapshot().erasures[0].path).toEqual([
      point(10, -4),
      point(10, 4),
    ]);
  });

  it('restores partial masks and whole-stroke deletions with undo and redo', () => {
    const store = new InkStore();
    store.addStroke(stroke('a'));
    store.eraseRegion([point(10, 0)], 2);
    store.eraseStrokes([point(3, -5), point(3, 5)], 1);
    expect(store.getSnapshot().strokes).toHaveLength(0);
    expect(store.getSnapshot().erasures).toHaveLength(0);
    store.undo();
    expect(store.getSnapshot().strokes[0].id).toBe('a');
    expect(store.getSnapshot().erasures).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().erasures).toHaveLength(0);
    store.redo();
    expect(store.getSnapshot().erasures).toHaveLength(1);
    store.redo();
    expect(store.getSnapshot().strokes).toHaveLength(0);
  });

  it('keeps revisions monotonic and retires the generation on clear and recovery', () => {
    const store = new InkStore();
    const changes: string[] = [];
    store.subscribe((change) =>
      changes.push(`${change.reason}:${change.revision}`),
    );
    store.addStroke(stroke('a'));
    const generation = store.getSnapshot().generation;
    store.clear();
    expect(store.getSnapshot().generation).toBe(generation + 1);
    store.undo();
    expect(store.getSnapshot().strokes).toHaveLength(1);
    store.redo();
    expect(changes).toEqual(['add:1', 'clear:2', 'undo:3', 'redo:4']);
    store.replaceDocument(store.getSnapshot());
    expect(store.getSnapshot().generation).toBe(generation + 2);
    expect(store.canUndo).toBe(false);
  });

  it('bounds history while preserving current ink, and new edits invalidate redo', () => {
    const store = new InkStore(undefined, { historyLimit: 2 });
    store.addStroke(stroke('a'));
    store.addStroke(stroke('b'));
    store.addStroke(stroke('c'));
    store.undo();
    store.undo();
    store.undo();
    expect(store.getSnapshot().strokes.map((s) => s.id)).toEqual(['a']);
    expect(store.canUndo).toBe(false);
    store.addStroke(stroke('d'));
    expect(store.canRedo).toBe(false);
  });

  it('emits affected stroke identities and old/new bounds for mask edits', () => {
    const store = new InkStore();
    store.addStroke(stroke('a'));
    store.addStroke(stroke('far', [point(50, 50)]));
    const changes: unknown[] = [];
    store.subscribe((change) => changes.push(change));
    store.eraseRegion([point(10, 0)], 2);
    expect(changes[0]).toMatchObject({
      reason: 'pixel-erase',
      changedStrokeIds: ['a'],
      deletedStrokeIds: [],
      revision: 3,
    });
    store.eraseStrokes([point(50, 50)], 1);
    expect(changes[1]).toMatchObject({
      reason: 'stroke-erase',
      changedStrokeIds: [],
      deletedStrokeIds: ['far'],
    });
  });
});

describe('capsule hit testing', () => {
  it('uses segment geometry instead of bounding box intersection', () => {
    const diagonal = stroke('diag', [point(0, 0), point(20, 20)]);
    diagonal.bounds = pointBounds(diagonal.points, 1);
    expect(strokeIntersectsPath(diagonal, [point(0, 20)], 1)).toBe(false);
    expect(
      strokeIntersectsPath(diagonal, [point(0, 20), point(20, 0)], 1),
    ).toBe(true);
  });
  it('handles dots, tangencies and zero-length path segments', () => {
    const dot = stroke('dot', [point(4, 4)]);
    dot.bounds = pointBounds(dot.points, 1);
    expect(strokeIntersectsPath(dot, [point(6, 4), point(6, 4)], 1)).toBe(true);
    expect(strokeIntersectsPath(dot, [point(7, 4)], 1)).toBe(false);
  });
});
