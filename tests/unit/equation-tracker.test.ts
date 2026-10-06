import { describe, expect, it } from 'vitest';
import { InkStore } from '../../src/document/InkStore';
import { pointBounds } from '../../src/ink/geometry';
import { groupEquations } from '../../src/recognition/grouping';
import { EquationTracker } from '../../src/recognition/tracker';
import type { GroupResult, InkDocument, Stroke } from '../../src/shared/types';
const stroke = (id: string, x: number, y: number, w = 20, h = 40): Stroke => {
  const points = [
    { x, y, timestamp: 0 },
    { x: x + w, y: y + h, timestamp: 1 },
  ];
  return {
    id,
    points,
    bounds: pointBounds(points, 1),
    width: 2,
    color: '#000',
  };
};
const grouped = (document: InkDocument): GroupResult => ({
  type: 'GROUPS',
  documentId: document.documentId,
  generation: document.generation,
  documentRevision: document.revision,
  groups: groupEquations(document),
});
const setup = (strokes: Stroke[]) => {
  const store = new InkStore({
    format: 'calcink-document',
    version: 2,
    documentId: 'test',
    generation: 0,
    revision: 0,
    strokes,
    erasures: [],
  });
  const tracker = new EquationTracker(store.getSnapshot());
  tracker.apply(grouped(tracker.request()));
  const invalidations: string[][] = [];
  store.subscribe((change) => {
    if (change.generation !== store.getSnapshot().generation)
      throw new Error('invalid event');
    invalidations.push(tracker.change(store.getSnapshot(), change));
  });
  const reconcile = () => tracker.apply(grouped(tracker.request()))!;
  return { store, tracker, reconcile, invalidations };
};

describe('incremental equation ownership', () => {
  it('groups at most nearby candidates when one of 200 independent rows changes, preserving the other 199 identities and object references', () => {
    const { store, tracker, reconcile, invalidations } = setup(
      Array.from({ length: 200 }, (_, i) => stroke(`row-${i}`, 0, i * 70)),
    );
    const previous = tracker.all;
    const id = tracker.owner('row-100')!;
    store.eraseRegion([{ x: 10, y: 7020, timestamp: 2 }], 3);
    expect(invalidations.at(-1)).toEqual([id]);
    const request = tracker.request();
    expect(request.strokes.length).toBeLessThanOrEqual(3);
    expect(request.strokes.length).toBeLessThan(200);
    const update = reconcile();
    expect(update.changed.map((g) => g.id)).toEqual([id]);
    expect(update.retired).toEqual([]);
    expect(tracker.owner('row-100')).toBe(id);
    expect(tracker.all.find((g) => g.id === id)?.revision).toBe(2);
    for (const group of previous.filter((g) => g.id !== id))
      expect(tracker.all.find((g) => g.id === group.id)).toBe(group);
  });
  it('keeps a nearby candidate unchanged when a late mark forms a separate equation', () => {
    const { store, tracker, reconcile, invalidations } = setup([
      stroke('digit', 0, 0),
    ]);
    const old = tracker.all[0];
    store.addStroke(stroke('late-dot', 80, 63, 0, 0));
    expect(invalidations.at(-1)).toEqual([]);
    expect(tracker.request().strokes).toHaveLength(2);
    expect(reconcile().changed).toHaveLength(1);
    expect(tracker.all.find((g) => g.id === old.id)).toBe(old);
  });
  it('preserves ownership across extension, partial erase, complete move and undo/redo', () => {
    const { store, tracker, reconcile } = setup([stroke('a', 0, 0)]);
    const id = tracker.owner('a')!;
    store.addStroke(stroke('b', 40, 0));
    expect(reconcile().changed[0]).toMatchObject({ id, revision: 2 });
    store.eraseRegion([{ x: 10, y: 20, timestamp: 2 }], 3);
    expect(reconcile().changed[0]).toMatchObject({ id, revision: 3 });
    store.transformSelection(
      { strokeIds: ['a', 'b'], objectIds: [] },
      { x: 500, y: 200 },
    );
    expect(reconcile().changed[0]).toMatchObject({ id, revision: 4 });
    expect(tracker.owner('b')).toBe(id);
    store.undo();
    expect(reconcile().changed[0]).toMatchObject({ id, revision: 5 });
    store.redo();
    expect(reconcile().changed[0]).toMatchObject({ id, revision: 6 });
  });
  it('reconciles merges and splits, routing exact surviving ownership and masks', () => {
    const { store, tracker, reconcile } = setup([
      stroke('a', 0, 0),
      stroke('b', 200, 0),
    ]);
    const left = tracker.owner('a')!,
      right = tracker.owner('b')!;
    store.addStroke(stroke('bridge', 100, 0));
    const merged = reconcile();
    expect(merged.changed).toHaveLength(1);
    expect(merged.retired).toHaveLength(1);
    expect([left, right]).toContain(merged.changed[0].id);
    expect(tracker.owner('a')).toBe(tracker.owner('b'));
    store.deleteSelection({ strokeIds: ['bridge'], objectIds: [] });
    const split = reconcile();
    expect(tracker.all).toHaveLength(2);
    expect(new Set(tracker.all.map((g) => g.id)).size).toBe(2);
    expect(tracker.owner('a')).not.toBe(tracker.owner('b'));
    expect(split.changed).toHaveLength(2);
  });
  it('groups late fraction bars locally and restores erased equation identity on undo', () => {
    const { store, tracker, reconcile } = setup([
      stroke('num', 15, 0, 20, 30),
      stroke('den', 15, 52, 20, 30),
      stroke('other', 600, 35),
    ]);
    const other = tracker.all.find((g) => g.id === tracker.owner('other'))!;
    store.addStroke(stroke('bar', 0, 40, 50, 0));
    const update = reconcile();
    expect(update.changed).toHaveLength(1);
    expect(update.changed[0].strokes.map((s) => s.id).sort()).toEqual([
      'bar',
      'den',
      'num',
    ]);
    expect(tracker.all.find((g) => g.id === other.id)).toBe(other);
    const id = tracker.owner('num');
    store.deleteSelection({ strokeIds: ['bar', 'den', 'num'], objectIds: [] });
    expect(reconcile().retired).toEqual([id]);
    store.undo();
    reconcile();
    expect(tracker.owner('num')).toBe(id);
  });
  it('coalesces edits and rejects stale grouping without dropping changed ink', () => {
    const { store, tracker, reconcile } = setup([
      stroke('a', 0, 0),
      stroke('far', 600, 0),
    ]);
    store.addStroke(stroke('b', 40, 0));
    const obsolete = grouped(tracker.request());
    store.addStroke(stroke('c', 80, 0));
    expect(tracker.apply(obsolete)).toBeUndefined();
    expect(tracker.dirty).toBe(true);
    const update = reconcile();
    expect(update.changed).toHaveLength(1);
    expect(update.changed[0].strokes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(tracker.dirty).toBe(false);
    // An edit followed by undo before grouping must still clear its local pending state.
    store.eraseRegion([{ x: 10, y: 20, timestamp: 2 }], 3);
    store.undo();
    expect(reconcile().changed).toHaveLength(1);
  });
  it('bootstraps replaced notebooks and rejects previous generations', () => {
    const { store, tracker } = setup([stroke('a', 0, 0)]);
    const obsolete = grouped(tracker.request());
    store.clear();
    tracker.reset(store.getSnapshot());
    expect(tracker.apply(obsolete)).toBeUndefined();
    expect(tracker.apply(grouped(tracker.request()))).toEqual({
      changed: [],
      retired: [],
    });
    store.undo();
    tracker.reset(store.getSnapshot());
    expect(tracker.apply(grouped(tracker.request()))?.changed[0].id).toBe(
      'equation-a',
    );
  });
});
