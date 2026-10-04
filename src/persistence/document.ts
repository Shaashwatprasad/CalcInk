import { copyAnnotation } from '../document/annotations';
import type { InkDocument, Point } from '../shared/types';
import {
  normalizedStrokeSemantics,
  pointBounds,
  validStrokeSemantics,
} from '../ink/geometry';

function point(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const p = value as Point;
  return (
    [p.x, p.y, p.timestamp].every(Number.isFinite) &&
    Math.abs(p.x) <= 1e6 &&
    Math.abs(p.y) <= 1e6 &&
    (p.pressure === undefined ||
      (Number.isFinite(p.pressure) && p.pressure >= 0 && p.pressure <= 1))
  );
}
export function validateDocument(value: unknown): InkDocument {
  if (!value || typeof value !== 'object') throw new Error('Invalid notebook');
  const d = value as InkDocument;
  if (
    d.format !== 'calcink-document' ||
    (d.version !== 1 && d.version !== 2) ||
    typeof d.documentId !== 'string' ||
    !d.documentId ||
    !Number.isSafeInteger(d.generation) ||
    d.generation < 0 ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0 ||
    !Array.isArray(d.strokes) ||
    !Array.isArray(d.erasures) ||
    d.strokes.length > 50000 ||
    d.erasures.length > 50000 ||
    (d.objects !== undefined &&
      (!Array.isArray(d.objects) || d.objects.length > 50000))
  )
    throw new Error('Unsupported notebook format');
  const objects = (d.objects ?? []).map(copyAnnotation);
  if (new Set(objects.map((o) => o.id)).size !== objects.length)
    throw new Error('Duplicate annotation ID');
  const ids = new Set<string>();
  let samples = 0;
  for (const s of d.strokes) {
    if (
      !s ||
      typeof s.id !== 'string' ||
      !s.id ||
      ids.has(s.id) ||
      !Array.isArray(s.points) ||
      !s.points.length ||
      !s.points.every(point) ||
      !Number.isFinite(s.width) ||
      s.width <= 0 ||
      s.width > 100 ||
      typeof s.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(s.color) ||
      !validStrokeSemantics(s)
    )
      throw new Error('Invalid stroke');
    ids.add(s.id);
    samples += s.points.length;
  }
  const erasureIds = new Set<string>();
  for (const e of d.erasures) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      !e.id ||
      erasureIds.has(e.id) ||
      !Array.isArray(e.targetStrokeIds) ||
      !e.targetStrokeIds.every((id) => typeof id === 'string' && ids.has(id)) ||
      !Array.isArray(e.path) ||
      !e.path.length ||
      !e.path.every(point) ||
      !Number.isFinite(e.radius) ||
      e.radius <= 0 ||
      e.radius > 100
    )
      throw new Error('Invalid erasure');
    erasureIds.add(e.id);
    samples += e.path.length;
  }
  if (samples > 2e6) throw new Error('Notebook is too large');
  // Copy only documented fields: no unvalidated imported properties reach workers.
  const copyPoint = ({ x, y, timestamp, pressure }: Point): Point => ({
    x,
    y,
    timestamp,
    ...(pressure === undefined ? {} : { pressure }),
  });
  return {
    format: 'calcink-document',
    version: 2,
    documentId: d.documentId,
    generation: d.generation,
    revision: d.revision,
    objects,
    strokes: d.strokes.map((stroke) => {
      const points = stroke.points.map(copyPoint);
      return {
        id: stroke.id,
        width: stroke.width,
        color: stroke.color,
        ...normalizedStrokeSemantics(stroke),
        points,
        // Bounds are derived metadata, never trusted from imported documents.
        bounds: pointBounds(points, stroke.width / 2),
      };
    }),
    erasures: d.erasures.map((mask) => ({
      id: mask.id,
      targetStrokeIds: [...mask.targetStrokeIds],
      path: mask.path.map(copyPoint),
      radius: mask.radius,
    })),
  };
}

export interface NotebookStorage {
  load(): Promise<InkDocument | undefined>;
  save(document: InkDocument): Promise<void>;
  close(): void;
}
export async function openNotebookStorage(): Promise<NotebookStorage> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('calcink-notebook', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Storage unavailable'));
    request.onblocked = () =>
      reject(new Error('Close other notebook tabs to upgrade storage'));
  });
  let pending: Promise<void> = Promise.resolve();
  let closed = false;
  db.onversionchange = () => db.close();
  return {
    async load() {
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('documents', 'readonly');
        const request = tx.objectStore('documents').get('current');
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Read aborted'));
      });
      return value === undefined ? undefined : validateDocument(value);
    },
    save(document) {
      const snapshot = validateDocument(document);
      const next = pending
        .catch(() => {})
        .then(
          () =>
            new Promise<void>((resolve, reject) => {
              if (closed) {
                reject(new Error('Storage closed'));
                return;
              }
              const tx = db.transaction('documents', 'readwrite');
              tx.objectStore('documents').put(snapshot, 'current');
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(tx.error ?? new Error('Save aborted'));
            }),
        );
      pending = next;
      return next;
    },
    close() {
      void pending
        .finally(() => {
          closed = true;
          db.close();
        })
        .catch(() => {});
    },
  };
}
