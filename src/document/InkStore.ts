import type {
  Bounds,
  Erasure,
  InkDocument,
  Point,
  Stroke,
} from '../shared/types';
import { pointBounds, strokeIntersectsPath } from '../ink/geometry';

export interface InkChange {
  documentId: string;
  generation: number;
  revision: number;
  transactionId: string;
  changedStrokeIds: string[];
  deletedStrokeIds: string[];
  oldBounds: Bounds[];
  newBounds: Bounds[];
  reason:
    | 'add'
    | 'stroke-erase'
    | 'pixel-erase'
    | 'undo'
    | 'redo'
    | 'clear'
    | 'replace';
}
type Content = Pick<InkDocument, 'strokes' | 'erasures'>;
interface Transaction {
  before: Content;
  after: Content;
}

export function createInkDocument(): InkDocument {
  return {
    format: 'calcink-document',
    version: 1,
    documentId: crypto.randomUUID(),
    generation: 0,
    revision: 0,
    strokes: [],
    erasures: [],
  };
}

function freezeDocument(document: InkDocument): InkDocument {
  for (const stroke of document.strokes) {
    stroke.points.forEach(Object.freeze);
    Object.freeze(stroke.points);
    Object.freeze(stroke.bounds);
    Object.freeze(stroke);
  }
  for (const mask of document.erasures) {
    mask.path.forEach(Object.freeze);
    Object.freeze(mask.path);
    Object.freeze(mask.targetStrokeIds);
    Object.freeze(mask);
  }
  Object.freeze(document.strokes);
  Object.freeze(document.erasures);
  return Object.freeze(document);
}

function copyStroke(stroke: Stroke): Stroke {
  if (
    !stroke.points.length ||
    !Number.isFinite(stroke.width) ||
    stroke.width <= 0 ||
    !stroke.id ||
    !stroke.color ||
    stroke.points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.timestamp),
    )
  )
    throw new Error('Invalid stroke');
  const points = stroke.points.map((point) => ({ ...point }));
  return { ...stroke, points, bounds: pointBounds(points, stroke.width / 2) };
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
    this.document = freezeDocument(structuredClone(document));
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

  eraseRegion(path: Point[], radius: number): void {
    this.validateEraser(path, radius);
    const targetStrokeIds = this.document.strokes
      .filter((stroke) => strokeIntersectsPath(stroke, path, radius))
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
      },
      'pixel-erase',
    );
  }

  clear(): void {
    if (!this.document.strokes.length && !this.document.erasures.length) {
      // Even an empty document may have pending active ink or recognition work.
      this.apply({ strokes: [], erasures: [] }, 'clear', true);
      return;
    }
    this.commit({ strokes: [], erasures: [] }, 'clear', true);
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
    const previous = this.document;
    this.past = [];
    this.future = [];
    this.document = freezeDocument({
      ...structuredClone(document),
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
          !Number.isFinite(p.timestamp),
      )
    )
      throw new Error('Invalid eraser path');
  }

  private commit(
    content: Content,
    reason: InkChange['reason'],
    invalidateGeneration = false,
  ): void {
    this.past.push({ before: this.document, after: content });
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
    for (const mask of [...previous.erasures, ...current.erasures]) {
      if (!previous.erasures.includes(mask) || !current.erasures.includes(mask))
        mask.targetStrokeIds.forEach((id) => maskChanges.add(id));
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
    const change: InkChange = {
      documentId: current.documentId,
      generation: current.generation,
      revision: current.revision,
      transactionId: crypto.randomUUID(),
      changedStrokeIds,
      deletedStrokeIds,
      oldBounds: previous.strokes
        .filter((stroke) => affected.has(stroke.id))
        .map((stroke) => stroke.bounds),
      newBounds: current.strokes
        .filter((stroke) => affected.has(stroke.id))
        .map((stroke) => stroke.bounds),
      reason,
    };
    this.listeners.forEach((listener) => listener(change));
  }
}
