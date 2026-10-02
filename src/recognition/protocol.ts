import type {
  GroupResult,
  InkDocument,
  RecognitionJob,
  WorkerRequest,
} from '../shared/types';
function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function revision(v: unknown): boolean {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}
function bounds(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    ['minX', 'minY', 'maxX', 'maxY'].every((k) => finite(b[k])) &&
    Number(b.minX) <= Number(b.maxX) &&
    Number(b.minY) <= Number(b.maxY)
  );
}
function points(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 100000 &&
    v.every(
      (p) =>
        p &&
        typeof p === 'object' &&
        finite(p.x) &&
        finite(p.y) &&
        finite(p.timestamp),
    )
  );
}
function geometry(
  value: Pick<InkDocument, 'strokes' | 'erasures'>,
  limit: number,
): boolean {
  return (
    Array.isArray(value.strokes) &&
    value.strokes.length <= limit &&
    value.strokes.every(
      (s) =>
        s != null &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.color === 'string' &&
        finite(s.width) &&
        s.width > 0 &&
        bounds(s.bounds) &&
        points(s.points),
    ) &&
    Array.isArray(value.erasures) &&
    value.erasures.length <= limit &&
    value.erasures.every(
      (e) =>
        e != null &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        Array.isArray(e.targetStrokeIds) &&
        e.targetStrokeIds.every((id) => typeof id === 'string') &&
        finite(e.radius) &&
        e.radius > 0 &&
        points(e.path),
    )
  );
}
export function isGroupingDocument(value: unknown): value is InkDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as InkDocument;
  return (
    doc.format === 'calcink-document' &&
    doc.version === 1 &&
    typeof doc.documentId === 'string' &&
    doc.documentId.length > 0 &&
    revision(doc.generation) &&
    revision(doc.revision) &&
    geometry(doc, 50000) &&
    new Set(doc.strokes.map((s) => s.id)).size === doc.strokes.length
  );
}
export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as WorkerRequest;
  if (request.type === 'INIT') return true;
  if (request.type === 'GROUP') return isGroupingDocument(request.document);
  const r = request as RecognitionJob;
  return (
    r.type === 'RECOGNIZE' &&
    r.protocolVersion === 1 &&
    [
      'documentId',
      'equationId',
      'requestId',
      'modelVersion',
      'preprocessingVersion',
    ].every(
      (k) => typeof (r as unknown as Record<string, unknown>)[k] === 'string',
    ) &&
    revision(r.generation) &&
    revision(r.equationRevision) &&
    bounds(r.bounds) &&
    geometry(r, 5000)
  );
}

export function isGroupResult(value: unknown): value is GroupResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as GroupResult;
  return (
    result.type === 'GROUPS' &&
    typeof result.documentId === 'string' &&
    result.documentId.length > 0 &&
    revision(result.generation) &&
    revision(result.documentRevision) &&
    Array.isArray(result.groups) &&
    result.groups.length <= 50000 &&
    result.groups.every(
      (group) =>
        group != null &&
        typeof group === 'object' &&
        typeof group.id === 'string' &&
        group.id.length > 0 &&
        revision(group.revision) &&
        bounds(group.bounds) &&
        geometry(group, 50000),
    )
  );
}
