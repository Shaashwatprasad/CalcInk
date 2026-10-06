import type { Point, Stroke } from '../shared/types';
import { pointBounds, strokeIntersectsPath } from './geometry';
/** Deliberately conservative: dense repeated horizontal reversals over existing ink.
 * This is gesture geometry, not a trained handwriting classifier. */
export function scratchTargets(
  points: readonly Point[],
  strokes: readonly Stroke[],
): string[] {
  if (points.length < 24) return [];
  const b = pointBounds(points as Point[]),
    width = b.maxX - b.minX,
    height = b.maxY - b.minY;
  if (width < 20 || width > 240 || height < 8 || height > 120) return [];
  let turns = 0,
    lastDirection = 0,
    length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x,
      dy = points[i].y - points[i - 1].y;
    length += Math.hypot(dx, dy);
    if (Math.abs(dx) < width * 0.35) continue;
    const direction = Math.sign(dx);
    if (lastDirection && direction !== lastDirection) turns++;
    lastDirection = direction;
  }
  if (turns < 12 || length < 8 * Math.hypot(width, height)) return [];
  return strokes
    .filter(
      (s) =>
        s.kind !== 'highlighter' &&
        strokeIntersectsPath(s, points as Point[], 3),
    )
    .map((s) => s.id);
}
