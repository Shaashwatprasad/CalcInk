import type {
  Annotation,
  Selection,
  XY,
  Bounds,
  Erasure,
  InkDocument,
  Point,
  Stroke,
} from '../shared/types';
import {
  normalizedStrokeSemantics,
  pointBounds,
  strokeIntersectsPath,
} from '../ink/geometry';

import {
  annotationBounds,
  copyAnnotation,
  transformAnnotation,
  validCoordinate,
} from './annotations';

export interface InkChange {
  documentId: string;
  generation: number;
  revision: number;
  transactionId: string;
  changedStrokeIds: string[];
  deletedStrokeIds: string[];
  changedObjectIds?: string[];
  deletedObjectIds?: string[];
  oldBounds: Bounds[];
  newBounds: Bounds[];
  reason:
    | 'add'
    | 'stroke-erase'
    | 'pixel-erase'
    | 'undo'
    | 'redo'
    | 'clear'
    | 'replace'
    | 'object-add'
    | 'object-update'
    | 'selection-transform'
    | 'selection-duplicate'
    | 'selection-delete';
}
type Content = Pick<InkDocument, 'strokes' | 'erasures'> & {
  objects: Annotation[];
};
interface Transaction {
  before: Content;
  after: Content;
}

export function createInkDocument(): InkDocument {
  return {
    format: 'calcink-document',
    version: 2,
    documentId: crypto.randomUUID(),
    generation: 0,
    revision: 0,
    strokes: [],
    erasures: [],
    objects: [],
  };
}

function freezeDocument(document: InkDocument): InkDocument {
  for (const stroke of document.strokes) {
    if (Object.isFrozen(stroke)) continue;
    stroke.points.forEach(Object.freeze);
    Object.freeze(stroke.points);
    Object.freeze(stroke.bounds);
    Object.freeze(stroke);
  }
  for (const mask of document.erasures) {
    if (Object.isFrozen(mask)) continue;
    mask.path.forEach(Object.freeze);
    Object.freeze(mask.path);
    Object.freeze(mask.targetStrokeIds);
    Object.freeze(mask);
  }
  (document.objects ?? []).forEach(Object.freeze);
  if (document.objects) Object.freeze(document.objects);
  Object.freeze(document.strokes);
  Object.freeze(document.erasures);
  return Object.freeze(document);
}

function copyStroke(stroke: Stroke): Stroke {
  if (
    !stroke.points.length ||
    !Number.isFinite(stroke.width) ||
    stroke.width <= 0 ||
    stroke.width > 100 ||
    !stroke.id ||
    !stroke.color ||
    stroke.points.some(
      (p) =>
        !validCoordinate(p.x) ||
        !validCoordinate(p.y) ||
        !Number.isFinite(p.timestamp) ||
        (p.pressure !== undefined &&
          (!Number.isFinite(p.pressure) || p.pressure < 0 || p.pressure > 1)),
    )
  )
    throw new Error('Invalid stroke');
  const points = stroke.points.map(({ x, y, timestamp, pressure }) => ({
    x,
    y,
    timestamp,
    ...(pressure === undefined ? {} : { pressure }),
  }));
  return {
    id: stroke.id,
    width: stroke.width,
    color: stroke.color,
    ...normalizedStrokeSemantics(stroke),
    points,
    bounds: pointBounds(points, stroke.width / 2),
  };
}

function copyObjects(objects: Annotation[] | undefined): Annotation[] {
  if (objects === undefined) return [];
  if (!Array.isArray(objects) || objects.length > 50000)
    throw new Error('Invalid annotations');
  const copies = objects.map(copyAnnotation);
  if (new Set(copies.map((o) => o.id)).size !== copies.length)
    throw new Error('Duplicate annotation ID');
  return copies;
}
function validateTransform(delta: XY, scale: number, anchor: XY): void {
  if (
    !validCoordinate(delta.x) ||
    !validCoordinate(delta.y) ||
    !validCoordinate(anchor.x) ||
    !validCoordinate(anchor.y) ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 1000
  )
    throw new Error('Invalid selection transform');
}
function transformPoints(
  points: readonly Point[],
  delta: XY,
  scale: number,
  anchor: XY,
): Point[] {
  return points.map((p) => {
    const x = anchor.x + (p.x - anchor.x) * scale + delta.x,
      y = anchor.y + (p.y - anchor.y) * scale + delta.y;
    if (!validCoordinate(x) || !validCoordinate(y))
      throw new Error('Selection exceeds coordinate limits');
    return { ...p, x, y };
  });
}
function transformStroke(
  stroke: Stroke,
  delta: XY,
  scale: number,
  anchor: XY,
): Stroke {
  return copyStroke({
    ...stroke,
    points: transformPoints(stroke.points, delta, scale, anchor),
    width: stroke.width * scale,
  });
}
function transformMask(
  mask: Erasure,
  delta: XY,
  scale: number,
  anchor: XY,
): Erasure {
  const radius = mask.radius * scale;
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100)
    throw new Error('Invalid transformed eraser radius');
  return {
    ...mask,
    path: transformPoints(mask.path, delta, scale, anchor),
    radius,
  };
}

export class InkStore {
  private document: InkDocument;
  private readonly listeners = new Set<(change: InkChange) => void>();
  private past: Transaction[] = [];
  private future: Transaction[] = [];
  private readonly historyLimit: number;

  constructor(
    document: InkDocument = createInkDocument(),
    options: { historyLimit?: number } = {},
  ) {
    this.historyLimit = Math.max(0, Math.floor(options.historyLimit ?? 100));
    if (document.version !== 1 && document.version !== 2)
      throw new Error('Unsupported notebook format');
    this.document = freezeDocument({
      ...structuredClone(document),
      version: 2,
      strokes: document.strokes.map(copyStroke),
      objects: copyObjects(document.objects),
    });
  }

  getSnapshot = (): InkDocument => this.document;
  subscribe = (listener: (change: InkChange) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  addStroke(stroke: Stroke): void {
    if (this.document.strokes.some((existing) => existing.id === stroke.id))
      throw new Error('Duplicate stroke ID');
    this.commit(
      {
        strokes: [...this.document.strokes, copyStroke(stroke)],
        erasures: this.document.erasures,
        objects: this.document.objects ?? [],
      },
      'add',
    );
  }

  eraseStrokes(path: Point[], radius: number): void {
    this.validateEraser(path, radius);
    const removed = new Set(
      this.document.strokes
        .filter((stroke) => strokeIntersectsPath(stroke, path, radius))
        .map((stroke) => stroke.id),
    );
    if (!removed.size) return;
    this.commit(
      {
        strokes: this.document.strokes.filter(
          (stroke) => !removed.has(stroke.id),
        ),
        objects: this.document.objects ?? [],
        erasures: this.document.erasures
          .map((mask) => {
            const targetStrokeIds = mask.targetStrokeIds.filter(
              (id) => !removed.has(id),
            );
            return targetStrokeIds.length === mask.targetStrokeIds.length
              ? mask
              : { ...mask, targetStrokeIds };
          })
          .filter((mask) => mask.targetStrokeIds.length),
      },
      'stroke-erase',
    );
  }

  eraseRegion(
    path: Point[],
    radius: number,
    onlyStrokeIds?: readonly string[],
  ): void {
    this.validateEraser(path, radius);
    const targetStrokeIds = this.document.strokes
      .filter(
        (stroke) =>
          (!onlyStrokeIds || onlyStrokeIds.includes(stroke.id)) &&
          strokeIntersectsPath(stroke, path, radius),
      )
      .map((stroke) => stroke.id);
    if (!targetStrokeIds.length) return;
    const mask: Erasure = {
      id: crypto.randomUUID(),
      targetStrokeIds,
      path: path.map((point) => ({ ...point })),
      radius,
    };
    this.commit(
      {
        strokes: this.document.strokes,
        erasures: [...this.document.erasures, mask],
        objects: this.document.objects ?? [],
      },
      'pixel-erase',
    );
  }

  addObject(object: Annotation): void {
    const copied = copyAnnotation(object);
    if ((this.document.objects ?? []).some((o) => o.id === copied.id))
      throw new Error('Duplicate annotation ID');
    this.commit(
      {
        strokes: this.document.strokes,
        erasures: this.document.erasures,
        objects: [...(this.document.objects ?? []), copied],
      },
      'object-add',
    );
  }

  /** A complete replacement keeps the original stable ID and discriminant. */
  updateObject(id: string, object: Annotation): void {
    const existing = (this.document.objects ?? []).find((o) => o.id === id);
    if (!existing) return;
    const copied = copyAnnotation(object);
    if (copied.id !== id || copied.kind !== existing.kind)
      throw new Error('Annotation identity cannot change');
    if (JSON.stringify(copied) === JSON.stringify(copyAnnotation(existing)))
      return;
    this.commit(
      {
        strokes: this.document.strokes,
        erasures: this.document.erasures,
        objects: (this.document.objects ?? []).map((o) =>
          o.id === id ? copied : o,
        ),
      },
      'object-update',
    );
  }

  transformSelection(
    selection: Selection,
    delta: XY,
    scale = 1,
    anchor: XY = { x: 0, y: 0 },
  ): void {
    validateTransform(delta, scale, anchor);
    if (delta.x === 0 && delta.y === 0 && scale === 1) return;
    const strokes = new Set(selection.strokeIds),
      objects = new Set(selection.objectIds);
    if (
      !this.document.strokes.some((s) => strokes.has(s.id)) &&
      !(this.document.objects ?? []).some((o) => objects.has(o.id))
    )
      return;
    const transformedStrokes = this.document.strokes.map((s) =>
      strokes.has(s.id) ? transformStroke(s, delta, scale, anchor) : s,
    );
    const transformedObjects = (this.document.objects ?? []).map((o) =>
      objects.has(o.id) ? transformAnnotation(o, delta, scale, anchor) : o,
    );
    const erasures = this.document.erasures.flatMap((mask) => {
      const selected = mask.targetStrokeIds.filter((id) => strokes.has(id));
      if (!selected.length) return [mask];
      const unselected = mask.targetStrokeIds.filter((id) => !strokes.has(id));
      const transformed = transformMask(mask, delta, scale, anchor);
      return unselected.length
        ? [
            { ...mask, targetStrokeIds: unselected },
            {
              ...transformed,
              id: crypto.randomUUID(),
              targetStrokeIds: selected,
            },
          ]
        : [transformed];
    });
    this.commit(
      { strokes: transformedStrokes, objects: transformedObjects, erasures },
      'selection-transform',
    );
  }

  duplicateSelection(
    selection: Selection,
    delta: XY = { x: 16, y: 16 },
  ): Selection {
    validateTransform(delta, 1, { x: 0, y: 0 });
    const selectedStrokes = new Set(selection.strokeIds),
      selectedObjects = new Set(selection.objectIds);
    const ids = new Map<string, string>();
    const strokes = this.document.strokes
      .filter((s) => selectedStrokes.has(s.id))
      .map((s) => {
        const copied = transformStroke(s, delta, 1, { x: 0, y: 0 });
        copied.id = crypto.randomUUID();
        ids.set(s.id, copied.id);
        return copied;
      });
    const objects = (this.document.objects ?? [])
      .filter((o) => selectedObjects.has(o.id))
      .map((o) => ({
        ...transformAnnotation(o, delta, 1, { x: 0, y: 0 }),
        id: crypto.randomUUID(),
      }));
    if (!strokes.length && !objects.length)
      return { strokeIds: [], objectIds: [] };
    const masks = this.document.erasures.flatMap((mask) => {
      const targetStrokeIds = mask.targetStrokeIds
        .filter((id) => ids.has(id))
        .map((id) => ids.get(id)!);
      return targetStrokeIds.length
        ? [
            {
              ...transformMask(mask, delta, 1, { x: 0, y: 0 }),
              id: crypto.randomUUID(),
              targetStrokeIds,
            },
          ]
        : [];
    });
    this.commit(
      {
        strokes: [...this.document.strokes, ...strokes],
        objects: [...(this.document.objects ?? []), ...objects],
        erasures: [...this.document.erasures, ...masks],
      },
      'selection-duplicate',
    );
    return {
      strokeIds: strokes.map((s) => s.id),
      objectIds: objects.map((o) => o.id),
    };
  }

  deleteSelection(selection: Selection): void {
    const selectedStrokes = new Set(selection.strokeIds),
      selectedObjects = new Set(selection.objectIds);
    const strokes = this.document.strokes.filter(
      (s) => !selectedStrokes.has(s.id),
    );
    const objects = (this.document.objects ?? []).filter(
      (o) => !selectedObjects.has(o.id),
    );
    if (
      strokes.length === this.document.strokes.length &&
      objects.length === (this.document.objects ?? []).length
    )
      return;
    const erasures = this.document.erasures
      .map((mask) => {
        const targetStrokeIds = mask.targetStrokeIds.filter(
          (id) => !selectedStrokes.has(id),
        );
        return targetStrokeIds.length === mask.targetStrokeIds.length
          ? mask
          : { ...mask, targetStrokeIds };
      })
      .filter((mask) => mask.targetStrokeIds.length);
    this.commit({ strokes, objects, erasures }, 'selection-delete');
  }

  clear(): void {
    if (
      !this.document.strokes.length &&
      !this.document.erasures.length &&
      !this.document.objects?.length
    ) {
      // Even an empty document may have pending active ink or recognition work.
      this.apply({ strokes: [], erasures: [], objects: [] }, 'clear', true);
      return;
    }
    this.commit({ strokes: [], erasures: [], objects: [] }, 'clear', true);
  }

  undo(): void {
    const transaction = this.past.pop();
    if (!transaction) return;
    this.future.push(transaction);
    this.apply(transaction.before, 'undo');
  }

  redo(): void {
    const transaction = this.future.pop();
    if (!transaction) return;
    this.past.push(transaction);
    this.apply(transaction.after, 'redo');
  }

  replaceDocument(document: InkDocument): void {
    if (document.version !== 1 && document.version !== 2)
      throw new Error('Unsupported notebook format');
    const copied = {
      ...structuredClone(document),
      version: 2 as const,
      strokes: document.strokes.map(copyStroke),
      objects: copyObjects(document.objects),
    };
    const previous = this.document;
    this.past = [];
    this.future = [];
    this.document = freezeDocument({
      ...copied,
      generation: Math.max(previous.generation, document.generation) + 1,
      revision: document.revision + 1,
    });
    this.notify(previous, 'replace');
  }

  private validateEraser(path: Point[], radius: number): void {
    if (
      !Number.isFinite(radius) ||
      radius <= 0 ||
      path.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          !Number.isFinite(p.timestamp) ||
          (p.pressure !== undefined &&
            (!Number.isFinite(p.pressure) || p.pressure < 0 || p.pressure > 1)),
      )
    )
      throw new Error('Invalid eraser path');
  }

  private commit(
    content: Content,
    reason: InkChange['reason'],
    invalidateGeneration = false,
  ): void {
    this.past.push({
      before: {
        strokes: this.document.strokes,
        erasures: this.document.erasures,
        objects: this.document.objects ?? [],
      },
      after: content,
    });
    if (this.past.length > this.historyLimit) this.past.shift();
    this.future = [];
    this.apply(content, reason, invalidateGeneration);
  }

  private apply(
    content: Content,
    reason: InkChange['reason'],
    invalidateGeneration = false,
  ): void {
    const previous = this.document;
    this.document = freezeDocument({
      ...previous,
      ...content,
      revision: previous.revision + 1,
      generation: previous.generation + Number(invalidateGeneration),
    });
    this.notify(previous, reason);
  }

  private notify(previous: InkDocument, reason: InkChange['reason']): void {
    const current = this.document;
    const before = new Map(
      previous.strokes.map((stroke) => [stroke.id, stroke]),
    );
    const after = new Map(current.strokes.map((stroke) => [stroke.id, stroke]));
    const maskChanges = new Set<string>();
    if (previous.erasures !== current.erasures) {
      const indexMasks = (masks: Erasure[]) => {
        const index = new Map<string, Erasure[]>();
        for (const mask of masks)
          for (const id of mask.targetStrokeIds) {
            const values = index.get(id) ?? [];
            values.push(mask);
            index.set(id, values);
          }
        return index;
      };
      const oldMasks = indexMasks(previous.erasures),
        newMasks = indexMasks(current.erasures);
      for (const id of new Set([...oldMasks.keys(), ...newMasks.keys()])) {
        const old = oldMasks.get(id) ?? [],
          next = newMasks.get(id) ?? [];
        if (
          old.length !== next.length ||
          old.some(
            (mask, i) =>
              mask.path !== next[i].path || mask.radius !== next[i].radius,
          )
        )
          maskChanges.add(id);
      }
    }
    const changedStrokeIds = current.strokes
      .filter(
        (stroke) =>
          before.get(stroke.id) !== stroke || maskChanges.has(stroke.id),
      )
      .map((stroke) => stroke.id);
    const deletedStrokeIds = previous.strokes
      .filter((stroke) => !after.has(stroke.id))
      .map((stroke) => stroke.id);
    const affected = new Set([...changedStrokeIds, ...deletedStrokeIds]);
    const oldObjects = new Map((previous.objects ?? []).map((o) => [o.id, o]));
    const newObjects = new Map((current.objects ?? []).map((o) => [o.id, o]));
    const changedObjectIds = (current.objects ?? [])
      .filter((o) => oldObjects.get(o.id) !== o)
      .map((o) => o.id);
    const deletedObjectIds = (previous.objects ?? [])
      .filter((o) => !newObjects.has(o.id))
      .map((o) => o.id);
    const affectedObjects = new Set([...changedObjectIds, ...deletedObjectIds]);
    const change: InkChange = {
      documentId: current.documentId,
      generation: current.generation,
      revision: current.revision,
      transactionId: crypto.randomUUID(),
      changedStrokeIds,
      deletedStrokeIds,
      changedObjectIds,
      deletedObjectIds,
      oldBounds: previous.strokes
        .filter((stroke) => affected.has(stroke.id))
        .map((stroke) => stroke.bounds)
        .concat(
          (previous.objects ?? [])
            .filter((o) => affectedObjects.has(o.id))
            .map(annotationBounds),
        ),
      newBounds: current.strokes
        .filter((stroke) => affected.has(stroke.id))
        .map((stroke) => stroke.bounds)
        .concat(
          (current.objects ?? [])
            .filter((o) => affectedObjects.has(o.id))
            .map(annotationBounds),
        ),
      reason,
    };
    this.listeners.forEach((listener) => listener(change));
  }
}
