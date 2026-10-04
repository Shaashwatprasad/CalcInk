import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  openNotebookStorage,
  validateDocument,
} from '../../src/persistence/document';
import type { InkDocument } from '../../src/shared/types';
const doc = (): InkDocument => ({
  format: 'calcink-document',
  version: 1,
  documentId: 'test',
  generation: 0,
  revision: 0,
  strokes: [],
  erasures: [],
});
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase('calcink-notebook');
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
describe('notebook persistence', () => {
  it('recomputes imported bounds instead of trusting malformed metadata', () => {
    const d = doc();
    d.strokes.push({
      id: 's',
      points: [{ x: 10, y: 20, timestamp: 1 }],
      bounds: {} as InkDocument['strokes'][number]['bounds'],
      width: 4,
      color: '#123456',
    });
    expect(validateDocument(d).strokes[0].bounds).toEqual({
      minX: 8,
      minY: 18,
      maxX: 12,
      maxY: 22,
    });
  });
  it('serializes snapshots so the last edit wins', async () => {
    const storage = await openNotebookStorage();
    const first = doc();
    const second = doc();
    second.revision = 2;
    await Promise.all([storage.save(first), storage.save(second)]);
    expect((await storage.load())?.revision).toBe(2);
    storage.close();
  });
  it('preserves masks and separates saved data from later mutation', async () => {
    const storage = await openNotebookStorage();
    const d = doc();
    d.strokes.push({
      id: 's',
      points: [{ x: 10, y: 10, timestamp: 1 }],
      bounds: { minX: 8, minY: 8, maxX: 12, maxY: 12 },
      width: 4,
      color: '#123456',
    });
    d.erasures.push({
      id: 'e',
      targetStrokeIds: ['s'],
      path: [{ x: 10, y: 10, timestamp: 2 }],
      radius: 3,
    });
    const save = storage.save(d);
    d.strokes[0].points[0].x = 99;
    await save;
    expect((await storage.load())?.strokes[0].points[0].x).toBe(10);
    expect((await storage.load())?.erasures[0].targetStrokeIds).toEqual(['s']);
    storage.close();
  });
  it('rejects unsupported, malformed and nonfinite data', () => {
    expect(() => validateDocument({ ...doc(), version: 3 })).toThrow();
    expect(() =>
      validateDocument({ ...doc(), strokes: [{ points: [{ x: NaN }] }] }),
    ).toThrow();
    expect(() =>
      validateDocument({
        ...doc(),
        erasures: [
          { id: 'e', targetStrokeIds: ['missing'], path: [], radius: 3 },
        ],
      }),
    ).toThrow();
  });
});
