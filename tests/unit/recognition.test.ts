import { describe, expect, it } from 'vitest';
import { groupEquations, groupSymbols } from '../../src/recognition/grouping';
import { isGroupResult, isWorkerRequest } from '../../src/recognition/protocol';
import type { InkDocument, Stroke } from '../../src/shared/types';
const stroke = (
  id: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Stroke => ({
  id,
  points: [
    { x: minX, y: minY, timestamp: 0 },
    { x: maxX, y: maxY, timestamp: 1 },
  ],
  bounds: { minX, minY, maxX, maxY },
  width: 3,
  color: '#000',
});
const document = (strokes: Stroke[]): InkDocument => ({
  format: 'calcink-document',
  version: 1,
  documentId: 'doc',
  generation: 0,
  revision: 1,
  strokes,
  erasures: [],
});
describe('recognition geometry', () => {
  it('combines equals lines and division dots without consuming a neighboring digit', () => {
    const groups = groupSymbols([
      stroke('a', 0, 20, 20, 20),
      stroke('b', 0, 30, 20, 30),
      stroke('c', 35, 20, 55, 20),
      stroke('d', 44, 10, 46, 12),
      stroke('e', 44, 30, 46, 32),
      stroke('f', 70, 0, 85, 40),
    ]);
    expect(groups.map((g) => g.strokes.length)).toEqual([2, 3, 1]);
  });
  it('keeps a decimal as a separate tiny component', () => {
    expect(
      groupSymbols([
        stroke('digit', 0, 0, 20, 40),
        stroke('dot', 30, 38, 32, 40),
        stroke('digit2', 42, 0, 62, 40),
      ]),
    ).toHaveLength(3);
  });
  it('keeps an unrelated equation revision valid and binds masks to their equation', () => {
    const doc = document([
      stroke('a', 0, 0, 20, 40),
      stroke('b', 0, 120, 20, 160),
    ]);
    const before = groupEquations(doc);
    doc.strokes[1].points[0].x += 1;
    doc.erasures.push({
      id: 'mask',
      targetStrokeIds: ['b'],
      radius: 3,
      path: [{ x: 1, y: 120, timestamp: 2 }],
    });
    const after = groupEquations(doc);
    expect(after[0]).toEqual(before[0]);
    expect(after[1].revision).not.toBe(before[1].revision);
    expect(after[1].erasures).toHaveLength(1);
  });
  it('retires line identities when grouping splits', () => {
    const doc = document([
      stroke('a', 0, 0, 20, 40),
      stroke('b', 30, 0, 50, 40),
    ]);
    const old = groupEquations(doc)[0].id;
    doc.strokes[1] = stroke('b', 30, 150, 50, 190);
    expect(groupEquations(doc).every((g) => g.id !== old)).toBe(true);
  });
});
describe('worker protocol validation', () => {
  it('rejects malformed messages and nonfinite geometry', () => {
    expect(isWorkerRequest(null)).toBe(false);
    expect(isWorkerRequest({ type: 'RECOGNIZE' })).toBe(false);
    expect(isWorkerRequest({ type: 'INIT' })).toBe(true);
    const job = {
      ...groupEquations(document([stroke('a', 0, 0, 20, 40)]))[0],
      type: 'RECOGNIZE',
      protocolVersion: 1,
      documentId: 'doc',
      generation: 0,
      equationId: 'e',
      equationRevision: 1,
      requestId: 'r',
      modelVersion: 'm',
      preprocessingVersion: 'p',
    };
    expect(isWorkerRequest(job)).toBe(true);
    expect(isWorkerRequest({ ...job, strokes: [null] })).toBe(false);
    expect(isWorkerRequest({ ...job, erasures: [null] })).toBe(false);
    expect(
      isWorkerRequest({
        ...job,
        strokes: [{ ...job.strokes[0], points: [null] }],
      }),
    ).toBe(false);
    job.strokes[0].points[0].x = Infinity;
    expect(isWorkerRequest(job)).toBe(false);
  });
});

describe('worker equation grouping snapshots', () => {
  it('routes masks once to all affected lines and retains exact bounds over 5000 strokes', () => {
    const strokes = Array.from({ length: 5000 }, (_, i) =>
      stroke(
        `s${i}`,
        (i % 200) * 25,
        Math.floor(i / 200) * 100,
        (i % 200) * 25 + 20,
        Math.floor(i / 200) * 100 + 40,
      ),
    );
    const doc = document(strokes);
    doc.erasures = [
      {
        id: 'across',
        targetStrokeIds: ['s3', 's201', 's404'],
        radius: 2,
        path: [{ x: 75, y: 20, timestamp: 0 }],
      },
      {
        id: 'later',
        targetStrokeIds: ['s3'],
        radius: 2,
        path: [{ x: 75, y: 20, timestamp: 1 }],
      },
    ];
    const groups = groupEquations(doc);
    expect(groups).toHaveLength(25);
    expect(groups.every((g) => g.strokes.length === 200)).toBe(true);
    expect(
      new Set(groups.flatMap((g) => g.strokes.map((s) => s.id))).size,
    ).toBe(5000);
    expect(groups[0].bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 4995,
      maxY: 40,
    });
    expect(groups[0].erasures.map((e) => e.id)).toEqual(['across', 'later']);
    expect(groups[1].erasures.map((e) => e.id)).toEqual(['across']);
    expect(groups[2].erasures.map((e) => e.id)).toEqual(['across']);
    expect(groups[3].erasures).toEqual([]);
  });
  it('validates grouping requests and rejects malformed snapshots without throwing', () => {
    const doc = document([stroke('a', 0, 0, 20, 40)]);
    expect(isWorkerRequest({ type: 'GROUP', document: doc })).toBe(true);
    expect(isWorkerRequest({ type: 'GROUP', document: document([]) })).toBe(
      true,
    );
    for (const malformed of [
      null,
      { ...doc, version: 2 },
      { ...doc, generation: -1 },
      { ...doc, revision: NaN },
      { ...doc, strokes: [null] },
      { ...doc, strokes: [doc.strokes[0], doc.strokes[0]] },
      { ...doc, erasures: [null] },
    ])
      expect(isWorkerRequest({ type: 'GROUP', document: malformed })).toBe(
        false,
      );
  });
  it('validates grouped responses so the supervisor can discard stale identities', () => {
    const doc = document([stroke('a', 0, 0, 20, 40)]);
    const result = {
      type: 'GROUPS',
      documentId: doc.documentId,
      generation: doc.generation,
      documentRevision: doc.revision,
      groups: groupEquations(doc),
    };
    expect(isGroupResult(result)).toBe(true);
    expect(isGroupResult({ ...result, groups: [null] })).toBe(false);
    expect(
      isGroupResult({
        ...result,
        groups: [
          {
            ...result.groups[0],
            bounds: { minX: NaN, minY: 0, maxX: 0, maxY: 0 },
          },
        ],
      }),
    ).toBe(false);
    expect(isGroupResult({ ...result, documentRevision: -1 })).toBe(false);
    expect(isGroupResult({ ...result, type: 'RESULT' })).toBe(false);
    expect(isGroupResult(null)).toBe(false);
  });
});
