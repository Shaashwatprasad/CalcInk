import { describe, expect, it } from 'vitest';
import { InkStore } from '../../src/document/InkStore';
import {
  annotationBounds,
  copyAnnotation,
  drawAnnotations,
  selectAtPoint,
  selectInPolygon,
} from '../../src/document/annotations';
import { pointBounds } from '../../src/ink/geometry';
import { validateDocument } from '../../src/persistence/document';
import type {
  Annotation,
  InkDocument,
  Point,
  Stroke,
} from '../../src/shared/types';
import type { InkChange } from '../../src/document/InkStore';
const point = (x: number, y = 0, pressure?: number): Point => ({
  x,
  y,
  timestamp: 17,
  ...(pressure === undefined ? {} : { pressure }),
});
const stroke = (
  id: string,
  points = [point(0), point(20)],
  width = 2,
): Stroke => ({
  id,
  points,
  width,
  color: '#5275AE',
  bounds: pointBounds(points, width / 2),
  kind: 'pencil',
  colorMode: 'explicit',
  pressureEnabled: true,
  opacity: 0.7,
  recognitionEligible: true,
});
const text = (id = 'text'): Annotation => ({
  id,
  kind: 'text',
  x: 5,
  y: 10,
  text: 'x = 2\nnotes',
  fontSize: 16,
  color: '#5275AE',
  colorMode: 'auto',
  strokeWidth: 2,
  opacity: 0.8,
  recognitionEligible: false,
});
const box = (x: number, y: number, width: number, height: number) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const selection = { strokeIds: ['a'], objectIds: ['text'] };
function sharedMaskStore() {
  const store = new InkStore();
  store.addStroke(stroke('a', [point(0, 0, 0), point(20, 0, 1)]));
  store.addStroke(stroke('b'));
  store.eraseRegion([point(10, -4), point(10, 4)], 3);
  store.addObject(text());
  return store;
}
describe('annotation persistence and identity', () => {
  it('migrates missing objects, persists every kind, sanitizes unknown fields and rejects eligible annotations', () => {
    const store = new InkStore();
    const style = text();
    const objects: Annotation[] = [
      style,
      {
        ...style,
        id: 'box',
        kind: 'shape',
        shape: 'rectangle',
        x: -5,
        y: 3,
        width: 40,
        height: 12,
      },
      {
        ...style,
        id: 'ellipse',
        kind: 'shape',
        shape: 'ellipse',
        x: -5,
        y: 3,
        width: 40,
        height: 12,
      },
      {
        ...style,
        id: 'line',
        kind: 'shape',
        shape: 'line',
        x1: 30,
        y1: 20,
        x2: -8,
        y2: 1,
      },
      {
        ...style,
        id: 'region',
        kind: 'region',
        x: 50,
        y: 3,
        width: 30,
        height: 40,
      },
      {
        ...style,
        id: 'arrow',
        kind: 'arrow',
        x1: 15,
        y1: 20,
        x2: -10,
        y2: -20,
      },
    ];
    objects.forEach((o) => store.addObject(o));
    const exported = JSON.parse(JSON.stringify(store.getSnapshot()));
    exported.objects[0].bounds = { minX: 999 };
    exported.objects[0].unknown = 'discard';
    const recovered = validateDocument(exported);
    expect(recovered.objects).toEqual(objects.map(copyAnnotation));
    expect(annotationBounds(recovered.objects![0])).toEqual({
      minX: 5,
      minY: 10,
      maxX: 85,
      maxY: 50,
    });
    const legacy = { ...exported, version: 1 };
    delete legacy.objects;
    expect(validateDocument(legacy).objects).toEqual([]);
    expect(new InkStore(legacy).getSnapshot().objects).toEqual([]);
    exported.objects[0].recognitionEligible = true;
    expect(() => validateDocument(exported)).toThrow(
      'Invalid annotation style',
    );
    expect(() =>
      copyAnnotation({ ...style, recognitionEligible: undefined }),
    ).toThrow();
    expect(() => copyAnnotation({ ...style, fontSize: Infinity })).toThrow();
    expect(() =>
      copyAnnotation({ ...style, text: 'a'.repeat(10001) }),
    ).toThrow();
    expect(() =>
      validateDocument({ ...recovered, objects: [style, style] }),
    ).toThrow('Duplicate');
  });
  it('edits objects without reporting phantom stroke changes and restores clear/edit/delete', () => {
    const store = new InkStore();
    store.addStroke(stroke('a'));
    store.addObject(text());
    const changes: InkChange[] = [];
    store.subscribe((c) => changes.push(c));
    store.updateObject('text', {
      ...text(),
      text: 'annotation 4',
    } as Annotation);
    expect(changes[0].changedStrokeIds).toEqual([]);
    expect(changes[0].changedObjectIds).toEqual(['text']);
    expect(changes[0].oldBounds).toHaveLength(1);
    store.undo();
    expect(store.getSnapshot().objects![0]).toEqual(text());
    store.redo();
    expect(
      (store.getSnapshot().objects![0] as Extract<Annotation, { kind: 'text' }>)
        .text,
    ).toBe('annotation 4');
    const before = store.getSnapshot();
    store.clear();
    expect(store.getSnapshot().objects).toEqual([]);
    store.undo();
    expect(store.getSnapshot().objects).toEqual(before.objects);
    store.deleteSelection({ strokeIds: [], objectIds: ['text'] });
    expect(changes.at(-1)!.deletedObjectIds).toEqual(['text']);
    store.undo();
    expect(store.getSnapshot().objects).toEqual(before.objects);
    expect(() =>
      store.updateObject('text', { ...text(), id: 'other' }),
    ).toThrow('identity');
  });
});
describe('atomic selection transactions', () => {
  it('moves/scales vectors and only their scoped masks while preserving pressure and untouched geometry', () => {
    const store = sharedMaskStore(),
      original = store.getSnapshot();
    const changes: InkChange[] = [];
    store.subscribe((c) => changes.push(c));
    store.transformSelection(selection, { x: 3, y: -5 }, 2, { x: 5, y: 0 });
    const after = store.getSnapshot();
    expect(after.revision).toBe(original.revision + 1);
    expect(after.strokes[0].points).toEqual([
      point(-2, -5, 0),
      point(38, -5, 1),
    ]);
    expect(after.strokes[0].width).toBe(4);
    expect(after.strokes[0].opacity).toBe(0.7);
    expect(after.strokes[1]).toBe(original.strokes[1]);
    expect(after.erasures).toHaveLength(2);
    const unchanged = after.erasures.find((m) =>
      m.targetStrokeIds.includes('b'),
    )!;
    expect(unchanged.id).toBe(original.erasures[0].id);
    expect(unchanged.path).toBe(original.erasures[0].path);
    expect(unchanged.radius).toBe(3);
    const moved = after.erasures.find((m) => m.targetStrokeIds.includes('a'))!;
    expect(moved.path).toEqual([point(18, -13), point(18, 3)]);
    expect(moved.radius).toBe(6);
    expect(moved.targetStrokeIds).toEqual(['a']);
    expect(changes[0].changedStrokeIds).toEqual(['a']);
    expect(changes[0].changedObjectIds).toEqual(['text']);
    expect(
      (after.objects![0] as Extract<Annotation, { kind: 'text' }>).fontSize,
    ).toBe(32);
    expect(selectAtPoint(after, { x: 18, y: -5 }).strokeIds).not.toContain('a');
    expect(selectAtPoint(after, { x: 10, y: 0 }).strokeIds).not.toContain('b');
    store.undo();
    expect(store.getSnapshot().strokes).toEqual(original.strokes);
    expect(store.getSnapshot().erasures).toEqual(original.erasures);
    expect(store.getSnapshot().objects).toEqual(original.objects);
    store.redo();
    expect(store.getSnapshot().erasures).toEqual(after.erasures);
  });
  it('duplicates only chosen content with fresh IDs and targeted masks, then atomically prunes deletes', () => {
    const store = sharedMaskStore(),
      original = store.getSnapshot();
    const duplicated = store.duplicateSelection(selection, { x: 100, y: 20 });
    const after = store.getSnapshot();
    expect(duplicated.strokeIds).toHaveLength(1);
    expect(duplicated.objectIds).toHaveLength(1);
    expect(duplicated.strokeIds[0]).not.toBe('a');
    expect(duplicated.objectIds[0]).not.toBe('text');
    expect(after.erasures[0]).toBe(original.erasures[0]);
    const clonedMask = after.erasures[1];
    expect(clonedMask.id).not.toBe(original.erasures[0].id);
    expect(clonedMask.targetStrokeIds).toEqual(duplicated.strokeIds);
    expect(clonedMask.path).toEqual([point(110, 16), point(110, 24)]);
    expect(selectAtPoint(after, { x: 110, y: 20 }).strokeIds).toEqual([]);
    store.undo();
    expect(store.getSnapshot().strokes).toEqual(original.strokes);
    expect(store.getSnapshot().objects).toEqual(original.objects);
    store.redo();
    store.deleteSelection({
      strokeIds: ['a', ...duplicated.strokeIds],
      objectIds: duplicated.objectIds,
    });
    expect(store.getSnapshot().erasures).toHaveLength(1);
    expect(store.getSnapshot().erasures[0].targetStrokeIds).toEqual(['b']);
    store.undo();
    expect(store.getSnapshot().erasures).toEqual(after.erasures);
    expect(validateDocument(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });
  it('validates the entire transaction before changing history, and ignores no-op selections/updates', () => {
    const store = sharedMaskStore();
    const before = store.getSnapshot(),
      seen: InkChange[] = [];
    store.subscribe((c) => seen.push(c));
    for (const [delta, scale] of [
      [{ x: NaN, y: 0 }, 1],
      [{ x: 1e6, y: 0 }, 2],
      [{ x: 0, y: 0 }, 0],
      [{ x: 0, y: 0 }, 100],
    ] as const)
      expect(() => store.transformSelection(selection, delta, scale)).toThrow();
    expect(() =>
      store.duplicateSelection(selection, { x: 1e6, y: 0 }),
    ).toThrow();
    expect(store.getSnapshot()).toBe(before);
    expect(seen).toEqual([]);
    store.transformSelection(selection, { x: 0, y: 0 });
    store.transformSelection(
      { strokeIds: ['missing'], objectIds: [] },
      { x: 4, y: 4 },
    );
    store.deleteSelection({ strokeIds: ['missing'], objectIds: [] });
    expect(store.duplicateSelection({ strokeIds: [], objectIds: [] })).toEqual({
      strokeIds: [],
      objectIds: [],
    });
    store.updateObject('text', text());
    expect(store.getSnapshot()).toBe(before);
    store.undo();
    expect(store.getSnapshot().objects).toEqual([]); // original last transaction is still object-add
  });
});
describe('selection sees visible geometry', () => {
  it('excludes erased gaps and fully erased ink for point, tolerance and polygon hits', () => {
    const store = new InkStore();
    store.addStroke(stroke('a'));
    store.eraseRegion([point(10, -4), point(10, 4)], 3);
    expect(
      selectAtPoint(store.getSnapshot(), { x: 10, y: 0 }).strokeIds,
    ).toEqual([]);
    expect(
      selectAtPoint(store.getSnapshot(), { x: 10, y: 0 }, 1).strokeIds,
    ).toEqual([]);
    expect(
      selectInPolygon(store.getSnapshot(), box(9, -0.5, 2, 1)).strokeIds,
    ).toEqual([]);
    expect(
      selectInPolygon(store.getSnapshot(), box(1, -0.5, 2, 1)).strokeIds,
    ).toEqual(['a']);
    store.eraseRegion([point(-5), point(25)], 5);
    expect(
      selectAtPoint(store.getSnapshot(), { x: 10, y: 0 }, 8).strokeIds,
    ).toEqual([]);
    expect(
      selectInPolygon(store.getSnapshot(), box(-5, -5, 30, 10)).strokeIds,
    ).toEqual([]);
  });
  it('selects crossed sparse segments but rejects bounding-box-only overlap and keeps visible partial-width fragments', () => {
    const store = new InkStore();
    store.addStroke(stroke('diagonal', [point(0, 0), point(20, 20)]));
    expect(
      selectInPolygon(store.getSnapshot(), box(9, 9, 2, 2)).strokeIds,
    ).toEqual(['diagonal']);
    expect(
      selectInPolygon(store.getSnapshot(), box(1, 15, 2, 2)).strokeIds,
    ).toEqual([]);
    const wide = new InkStore();
    wide.addStroke(stroke('wide', [point(0), point(20)], 8));
    wide.eraseRegion([point(-2), point(22)], 2);
    expect(
      selectAtPoint(wide.getSnapshot(), { x: 10, y: 0 }).strokeIds,
    ).toEqual([]);
    expect(
      selectInPolygon(wide.getSnapshot(), box(9, 2.5, 2, 1)).strokeIds,
    ).toEqual(['wide']);
    expect(
      selectAtPoint(wide.getSnapshot(), { x: 10, y: 0 }, 3).strokeIds,
    ).toEqual(['wide']);
    const doc = store.getSnapshot();
    const invisible: InkDocument = {
      ...doc,
      strokes: [{ ...doc.strokes[0], opacity: 0 }],
    };
    expect(selectInPolygon(invisible, box(-5, -5, 30, 30)).strokeIds).toEqual(
      [],
    );
  });
  it('uses object bounds without selecting unrelated boxes at concave lasso bounding overlap', () => {
    const store = new InkStore();
    store.addObject({
      ...text(),
      kind: 'region',
      x: 7,
      y: 7,
      width: 1,
      height: 1,
    });
    const lasso = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(selectInPolygon(store.getSnapshot(), lasso).objectIds).toEqual([]);
    expect(
      selectAtPoint(store.getSnapshot(), { x: 7.5, y: 7.5 }).objectIds,
    ).toEqual(['text']);
  });
});
it('draws text with DM Sans and resolves Auto at paint time without mutating stored objects', () => {
  const log: unknown[] = [];
  const context = {
    save() {},
    restore() {},
    globalAlpha: 1,
    setLineDash() {},
    fillText(...args: unknown[]) {
      log.push(args);
    },
    font: '',
    textBaseline: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  } as unknown as CanvasRenderingContext2D;
  const o = text();
  const before = structuredClone(o);
  drawAnnotations(context, [o], 'dark');
  expect(context.font).toBe('16px "DM Sans", sans-serif');
  expect(context.fillStyle).toBe('#E4E7EB');
  expect(log).toEqual([
    ['x = 2', 5, 10],
    ['notes', 5, 30],
  ]);
  expect(o).toEqual(before);
});
