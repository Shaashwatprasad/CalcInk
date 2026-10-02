import { InkStore } from '../src/document/InkStore';
import { pointBounds, strokeIntersectsPath } from '../src/ink/geometry';
import { groupEquations, groupSymbols } from '../src/recognition/grouping';
import { syntheticDocument, measure } from './fixtures';

export function nodeBenchmark() {
  return [500, 1000, 5000].map((strokeCount) => {
    const document = syntheticDocument(strokeCount, true);
    const extraPoints = [
      { x: 1280, y: 20, timestamp: 0 },
      { x: 1290, y: 35, timestamp: 1 },
    ];
    const extra = {
      id: 'benchmark-append',
      points: extraPoints,
      width: 3,
      color: '#000',
      bounds: pointBounds(extraPoints, 1.5),
    };
    let store = new InkStore(document);
    const prepare = () => {
      store = new InkStore(document);
    };
    const addStroke = measure(() => store.addStroke(extra), 7, prepare);
    const undoRedo = measure(
      () => {
        store.undo();
        store.redo();
      },
      7,
      () => {
        prepare();
        store.addStroke(extra);
      },
    );
    const eraserPath = [
      { x: 0, y: 155, timestamp: 0 },
      { x: 1250, y: 155, timestamp: 1 },
    ];
    let hits = 0;
    const hitTesting = measure(() => {
      hits = document.strokes.filter((stroke) =>
        strokeIntersectsPath(stroke, eraserPath, 6),
      ).length;
    }, 7);
    const serialization = measure(() => {
      JSON.stringify(document);
    }, 7);
    const recovery = measure(() => {
      new InkStore(document);
    }, 7);
    let groups = groupEquations(document);
    const equationGrouping = measure(() => {
      groups = groupEquations(document);
    }, 7);
    const symbolGrouping = measure(() => {
      groups.forEach((group) => groupSymbols(group.strokes));
    }, 7);
    return {
      strokeCount,
      pointCount: strokeCount * 16,
      erasureCount: document.erasures.length,
      equationCount: groups.length,
      jsonBytes: Buffer.byteLength(JSON.stringify(document)),
      hitCount: hits,
      measurements: {
        addStroke,
        undoRedo,
        hitTesting,
        serialization,
        recovery,
        equationGrouping,
        symbolGrouping,
      },
    };
  });
}
