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
function extendBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
export function groupEquations(document: InkDocument): EquationGroup[] {
  // Bounds update once per appended stroke, instead of rescanning every preceding
  // stroke during each line candidate check. All grouping runs in the worker.
  const lines: { strokes: Stroke[]; bounds: Bounds; erasures: Erasure[] }[] =
    [];
  const strokeLines = new Map<string, number>();
  for (const stroke of [...document.strokes].sort(
    (a, b) => a.bounds.minY - b.bounds.minY,
  )) {
    const center = (stroke.bounds.minY + stroke.bounds.maxY) / 2;
    const index = lines.findIndex(({ bounds: b }) => {
      const height = Math.max(
        24,
        b.maxY - b.minY,
        stroke.bounds.maxY - stroke.bounds.minY,
      );
      return center >= b.minY - height * 0.6 && center <= b.maxY + height * 0.6;
    });
    if (index >= 0) {
      lines[index].strokes.push(stroke);
      lines[index].bounds = extendBounds(lines[index].bounds, stroke.bounds);
      strokeLines.set(stroke.id, index);
    } else {
      strokeLines.set(stroke.id, lines.length);
      lines.push({
        strokes: [stroke],
        bounds: { ...stroke.bounds },
        erasures: [],
      });
    }
  }
  // Route each mask once, preserving document mask order without line × mask scans.
  for (const erasure of document.erasures) {
    const targets = new Set(
      erasure.targetStrokeIds.map((id) => strokeLines.get(id)),
    );
    for (const index of targets)
      if (index !== undefined) lines[index].erasures.push(erasure);
  }
  return lines.map(({ strokes, bounds, erasures }) => {
    strokes.sort((a, b) => a.bounds.minX - b.bounds.minX);
    const ids = strokes
      .map((s) => s.id)
      .sort()
      .map(encodeURIComponent);
    return {
      id: `line-${ids.join(':')}`,
      revision: hash(JSON.stringify([strokes, erasures])),
      strokes,
      erasures,
      bounds,
    };
  });
}
/** Merge horizontally overlapping components: this preserves multi-stroke +, ×, = and ÷.
 * Neighboring touching digits remain ambiguous; that limitation is exposed in the audit. */
export function groupSymbols(strokes: Stroke[]): SymbolGroup[] {
  const groups: SymbolGroup[] = [];
  for (const stroke of [...strokes].sort(
    (a, b) => a.bounds.minX - b.bounds.minX,
  )) {
    const previous = groups.at(-1);
    const w = stroke.bounds.maxX - stroke.bounds.minX;
    const tolerance = Math.max(2, Math.min(5, w * 0.08));
    if (previous && stroke.bounds.minX <= previous.bounds.maxX + tolerance) {
      previous.strokes.push(stroke);
      previous.bounds = extendBounds(previous.bounds, stroke.bounds);
    } else groups.push({ strokes: [stroke], bounds: { ...stroke.bounds } });
  }
  return groups;
}
