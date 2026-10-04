import { isRecognitionEligible, pressureWidth } from '../ink/geometry';
import type { Bounds, Erasure, InkDocument, Stroke } from '../shared/types';

export interface EquationGroup {
  id: string;
  revision: number;
  strokes: Stroke[];
  erasures: Erasure[];
  bounds: Bounds;
}
export interface SymbolGroup {
  strokes: Stroke[];
  bounds: Bounds;
}
export function unionBounds(items: { bounds: Bounds }[]): Bounds {
  return {
    minX: Math.min(...items.map((x) => x.bounds.minX)),
    minY: Math.min(...items.map((x) => x.bounds.minY)),
    maxX: Math.max(...items.map((x) => x.bounds.maxX)),
    maxY: Math.max(...items.map((x) => x.bounds.maxY)),
  };
}
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
const width = (b: Bounds) => b.maxX - b.minX;
const height = (b: Bounds) => b.maxY - b.minY;
const centerY = (b: Bounds) => (b.minY + b.maxY) / 2;
const centerX = (b: Bounds) => (b.minX + b.maxX) / 2;
const gap = (amin: number, amax: number, bmin: number, bmax: number) =>
  Math.max(0, amin - bmax, bmin - amax);
function extendBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
/** Median body height excludes tiny dots and horizontal bars. Tall outliers cannot
 * set the crop scale for ordinary digits. This is a geometry rule, not calibration. */
export function estimateBodySize(items: { bounds: Bounds }[]): number {
  const heights = items
    .map((s) => s.bounds)
    .filter((b) => height(b) >= 8 && width(b) < height(b) * 4)
    .map(height)
    .sort((a, b) => a - b);
  if (!heights.length) return 20;
  const middle = Math.floor(heights.length / 2);
  return Math.max(
    20,
    heights.length % 2
      ? heights[middle]
      : (heights[middle - 1] + heights[middle]) / 2,
  );
}
export function isHorizontalBar(stroke: Stroke, bodySize: number): boolean {
  const b = stroke.bounds;
  return (
    width(b) >= Math.max(12, bodySize * 0.6) &&
    height(b) <= Math.max(stroke.width * 2, width(b) * 0.12)
  );
}
export interface FractionLayout {
  bar: SymbolGroup;
  numerator: SymbolGroup[];
  denominator: SymbolGroup[];
  remainder: SymbolGroup[];
}
/** Only one level is supported. Multiple eligible bars are returned so callers can
 * abstain on nested/competing layouts rather than flattening them into arithmetic. */
export function findFractionLayouts(strokes: Stroke[]): FractionLayout[] {
  const eligible = strokes.filter(isRecognitionEligible);
  const size = estimateBodySize(eligible);
  const layouts: FractionLayout[] = [];
  for (const bar of eligible.filter((s) => isHorizontalBar(s, size))) {
    const above: Stroke[] = [],
      below: Stroke[] = [];
    for (const stroke of eligible) {
      if (stroke.id === bar.id) continue;
      const b = stroke.bounds;
      if (
        centerX(b) < bar.bounds.minX ||
        centerX(b) > bar.bounds.maxX ||
        width(b) > width(bar.bounds) * 1.3
      )
        continue;
      if (b.maxY < bar.bounds.minY && bar.bounds.minY - b.maxY <= size * 1.1)
        above.push(stroke);
      if (b.minY > bar.bounds.maxY && b.minY - bar.bounds.maxY <= size * 1.1)
        below.push(stroke);
    }
    // Two small dots describe ÷, not numerator and denominator operands.
    const body = (s: Stroke) => height(s.bounds) >= size * 0.35;
    if (!above.some(body) || !below.some(body)) continue;
    const used = new Set([
      bar.id,
      ...above.map((s) => s.id),
      ...below.map((s) => s.id),
    ]);
    layouts.push({
      bar: { strokes: [bar], bounds: { ...bar.bounds } },
      numerator: groupSymbols(above),
      denominator: groupSymbols(below),
      remainder: groupSymbols(eligible.filter((s) => !used.has(s.id))),
    });
  }
  return layouts;
}
export function groupEquations(document: InkDocument): EquationGroup[] {
  const eligible = document.strokes.filter(isRecognitionEligible);
  const size = estimateBodySize(eligible);
  const lines: { strokes: Stroke[]; bounds: Bounds; erasures: Erasure[] }[] =
    [];
  for (const stroke of [...eligible].sort(
    (a, b) =>
      centerY(a.bounds) - centerY(b.bounds) || a.bounds.minX - b.bounds.minX,
  )) {
    const b = stroke.bounds;
    const index = lines.findIndex(
      ({ bounds: a }) =>
        Math.abs(centerY(a) - centerY(b)) <=
          Math.max(size * 0.6, Math.min(height(a), height(b)) * 0.55) &&
        gap(a.minX, a.maxX, b.minX, b.maxX) <= size * 3,
    );
    if (index >= 0) {
      lines[index].strokes.push(stroke);
      lines[index].bounds = extendBounds(lines[index].bounds, b);
    } else lines.push({ strokes: [stroke], bounds: { ...b }, erasures: [] });
  }
  // A late bridging operator can connect rows initially seeded by far-apart ink.
  // Merge compatible local clusters after their bounds grow; otherwise an early
  // right-hand equals can isolate the leftmost operand of the same equation.
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i].bounds,
          b = lines[j].bounds;
        if (
          Math.abs(centerY(a) - centerY(b)) <=
            Math.max(size * 0.6, Math.min(height(a), height(b)) * 0.55) &&
          gap(a.minX, a.maxX, b.minX, b.maxX) <= size * 3
        ) {
          lines[i].strokes.push(...lines[j].strokes);
          lines[i].bounds = extendBounds(a, b);
          lines.splice(j--, 1);
          joined = true;
        }
      }
  }
  // Join only rows participating in a spatially supported fraction. Late bars and
  // dots work independently of pen order. Work is local to each short bar's extent.
  for (const layout of findFractionLayouts(eligible)) {
    const ids = new Set(
      [layout.bar, ...layout.numerator, ...layout.denominator].flatMap((g) =>
        g.strokes.map((s) => s.id),
      ),
    );
    const targets = lines.filter((line) =>
      line.strokes.some((s) => ids.has(s.id)),
    );
    if (targets.length > 1) {
      const first = targets[0];
      for (const other of targets.slice(1)) {
        first.strokes.push(...other.strokes);
        first.bounds = extendBounds(first.bounds, other.bounds);
        lines.splice(lines.indexOf(other), 1);
      }
    }
  }
  const strokeLines = new Map<string, number>();
  lines.forEach((line, index) =>
    line.strokes.forEach((s) => strokeLines.set(s.id, index)),
  );
  for (const erasure of document.erasures) {
    const targets = new Set(
      erasure.targetStrokeIds.map((id) => strokeLines.get(id)),
    );
    for (const index of targets)
      if (index !== undefined)
        lines[index].erasures.push({
          ...erasure,
          targetStrokeIds: erasure.targetStrokeIds.filter(
            (id) => strokeLines.get(id) === index,
          ),
        });
  }
  return lines
    .sort(
      (a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX,
    )
    .map(({ strokes, bounds, erasures }) => {
      strokes.sort(
        (a, b) =>
          a.bounds.minX - b.bounds.minX ||
          a.bounds.minY - b.bounds.minY ||
          a.id.localeCompare(b.id),
      );
      const ids = strokes
        .map((s) => s.id)
        .sort()
        .map(encodeURIComponent);
      return {
        id: `line-${ids.join(':')}`,
        revision: hash(
          JSON.stringify([
            strokes.map((s) => ({
              id: s.id,
              width: s.width,
              points: s.points.map((p) => ({
                x: p.x,
                y: p.y,
                width: pressureWidth(s, p),
              })),
            })),
            erasures,
          ]),
        ),
        strokes,
        erasures,
        bounds,
      };
    });
}
/** Horizontal overlap plus vertical locality retains multi-stroke operators.
 * Fraction rows are grouped separately by findFractionLayouts before inference. */
export function groupSymbols(strokes: Stroke[]): SymbolGroup[] {
  const groups: SymbolGroup[] = [];
  const size = estimateBodySize(strokes);
  for (const stroke of strokes
    .filter(isRecognitionEligible)
    .sort(
      (a, b) => a.bounds.minX - b.bounds.minX || a.bounds.minY - b.bounds.minY,
    )) {
    const previous = groups.at(-1);
    if (
      previous &&
      stroke.bounds.minX <= previous.bounds.maxX &&
      gap(
        previous.bounds.minY,
        previous.bounds.maxY,
        stroke.bounds.minY,
        stroke.bounds.maxY,
      ) <=
        size * 0.65
    ) {
      previous.strokes.push(stroke);
      previous.bounds = extendBounds(previous.bounds, stroke.bounds);
    } else groups.push({ strokes: [stroke], bounds: { ...stroke.bounds } });
  }
  return groups;
}
export interface GroupingCandidate {
  groups: SymbolGroup[];
  ambiguous: boolean;
}
/** At most four local hypotheses. Split only weak horizontal overlap between
 * distinct source strokes; never synthesize new ink or split an operator crossbar. */
export function symbolGroupingCandidates(
  strokes: Stroke[],
): GroupingCandidate[] {
  const groups = groupSymbols(strokes);
  const size = estimateBodySize(groups);
  const candidates: GroupingCandidate[] = [{ groups, ambiguous: false }];
  for (let i = 0; i < groups.length && candidates.length < 4; i++) {
    const group = groups[i];
    const sorted = [...group.strokes].sort(
      (a, b) => centerX(a.bounds) - centerX(b.bounds),
    );
    if (sorted.length === 1 && width(group.bounds) > size * 1.6)
      candidates[0].ambiguous = true;
    if (sorted.length < 2 || sorted.length > 8) continue;
    for (let j = 1; j < sorted.length && candidates.length < 4; j++) {
      const left = {
        strokes: sorted.slice(0, j),
        bounds: unionBounds(sorted.slice(0, j)),
      };
      const right = {
        strokes: sorted.slice(j),
        bounds: unionBounds(sorted.slice(j)),
      };
      const overlap = left.bounds.maxX - right.bounds.minX;
      if (
        overlap >= 0 &&
        overlap <= size * 0.2 &&
        centerX(right.bounds) - centerX(left.bounds) >= size * 0.35 &&
        height(left.bounds) >= size * 0.5 &&
        height(right.bounds) >= size * 0.5
      ) {
        candidates[0].ambiguous = true;
        candidates.push({
          groups: [...groups.slice(0, i), left, right, ...groups.slice(i + 1)],
          ambiguous: true,
        });
      }
    }
  }
  return candidates;
}
