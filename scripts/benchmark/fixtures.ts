import type { InkDocument, Stroke } from '../../src/shared/types';
import { pointBounds } from '../../src/ink/geometry';

/** Deterministic machine-generated wave polylines, never handwriting/accuracy fixtures. */
export function syntheticDocument(count: number, masked = false): InkDocument {
  const strokes: Stroke[] = Array.from({ length: count }, (_, index) => {
    const x = 12 + (index % 40) * 30;
    const y = 12 + Math.floor(index / 40) * 48;
    const points = Array.from({ length: 16 }, (_, sample) => ({
      x: x + sample,
      y: y + Math.sin(sample * 0.5) * 8,
      timestamp: index * 20 + sample,
      pressure: 0.5,
    }));
    return {
      id: `synthetic-${index}`,
      points,
      bounds: pointBounds(points, 1.5),
      width: 3,
      color: '#172033',
    };
  });
  return {
    format: 'calcink-document',
    version: 1,
    documentId: `synthetic-${count}`,
    generation: 0,
    revision: count,
    strokes,
    erasures: masked
      ? strokes
          .filter((_, index) => index % 25 === 0)
          .map((stroke) => ({
            id: `mask-${stroke.id}`,
            targetStrokeIds: [stroke.id],
            radius: 4,
            path: [
              {
                x: stroke.points[8].x,
                y: stroke.points[8].y,
                timestamp: count * 20,
              },
            ],
          }))
      : [],
  };
}

export interface Measurement {
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  repetitions: number;
}
export function measure(
  run: () => void,
  repetitions: number,
  prepare?: () => void,
): Measurement {
  prepare?.();
  run(); // One unrecorded warm-up per operation/size.
  const samplesMs: number[] = [];
  for (let index = 0; index < repetitions; index++) {
    prepare?.();
    const started = performance.now();
    run();
    samplesMs.push(performance.now() - started);
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    samplesMs,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minMs: sorted[0],
    maxMs: sorted.at(-1)!,
    repetitions,
  };
}
