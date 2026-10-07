import { pressureWidth } from '../ink/geometry';
import type { Erasure, SymbolPrediction } from '../shared/types';
import type { FractionLayout, SymbolGroup } from './grouping';

export const DECODER_LIMITS = {
  symbols: 128,
  beam: 16,
  candidatesPerSymbol: 4,
  cache: 128,
} as const;
export type UncertaintyReason =
  | 'crossing'
  | 'confidence'
  | 'layout'
  | 'segmentation';
export interface DecodedExpression {
  expression: string;
  symbols: SymbolPrediction[];
  status: 'recognized' | 'uncertain';
  uncertaintyReasons: UncertaintyReason[];
}
/** Crossing ink remains the model's multiplication class. The extra x candidate
 * is contextual, not a learned seventeenth class and never gains confidence. */
export function contextualCandidates(
  symbol: SymbolPrediction,
): SymbolPrediction {
  const crossing = symbol.topK.find((c) => c.label === '×');
  return crossing && !symbol.topK.some((c) => c.label === 'x')
    ? {
        ...symbol,
        topK: [...symbol.topK, { label: 'x', score: crossing.score }],
      }
    : symbol;
}
/** Bounded grammar filter for the checkpoint vocabulary. It only ranks previews;
 * the safe math parser owns AST construction and invalid/incomplete semantics. */
export function plausibleExpression(text: string): boolean {
  if (text.startsWith('x=') && text.length > 2) text = text.slice(2);
  if (text.endsWith('=')) text = text.slice(0, -1);
  if (text.includes('=')) return false;
  let operand = true,
    depth = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (/[0-9.]/u.test(c)) {
      if (!operand) return false;
      let digits = 0,
        dots = 0;
      while (i < text.length && /[0-9.]/u.test(text[i])) {
        if (text[i++] === '.') dots++;
        else digits++;
      }
      if (dots > 1 || digits === 0) return false;
      operand = false;
    } else if (c === 'x') {
      if (!operand) return false;
      operand = false;
      i++;
    } else if (c === '(') {
      if (!operand || ++depth > 16) return false;
      i++;
    } else if (c === ')') {
      if (operand || --depth < 0) return false;
      i++;
    } else if ('+−-×*/÷'.includes(c)) {
      if (operand && c !== '+' && c !== '-' && c !== '−') return false;
      operand = true;
      i++;
    } else return false;
  }
  // A pending operand/close is a legitimate incomplete expression.
  return depth >= 0;
}
export function decodeSymbols(
  input: SymbolPrediction[],
  ambiguousGrouping = false,
): DecodedExpression {
  const symbols = input.map(contextualCandidates);
  const topExpression = symbols.map((s) => s.label).join('');
  if (symbols.length > DECODER_LIMITS.symbols)
    return {
      symbols,
      expression: topExpression,
      status: 'uncertain',
      uncertaintyReasons: ['layout'],
    };
  let beams: { text: string; score: number; changed: boolean }[] = [
    { text: '', score: 0, changed: false },
  ];
  for (const symbol of symbols) {
    // Never rescue syntax with a remote low-scoring class. Candidates retain raw
    // scores; thresholds are conservative rules pending a real development set.
    const options = symbol.topK
      .filter((c) => c.score >= 0.12 && c.score >= symbol.score - 0.25)
      .slice(0, DECODER_LIMITS.candidatesPerSymbol);
    if (!options.some((c) => c.label === symbol.label))
      options.unshift({ label: symbol.label, score: symbol.score });
    beams = beams
      .flatMap((b) =>
        options.map((c) => ({
          text: b.text + c.label,
          score: b.score + Math.log(Math.max(1e-9, c.score)),
          changed: b.changed || c.label !== symbol.label,
        })),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, DECODER_LIMITS.beam);
  }
  const topPlausible = plausibleExpression(topExpression);
  const preview = topPlausible
    ? topExpression
    : (beams.find((b) => plausibleExpression(b.text))?.text ?? topExpression);
  const lowEvidence = symbols.some(
    (s) =>
      s.label !== '/' &&
      (s.score < 0.65 ||
        s.score -
          (s.topK.find((c) => c.label !== s.label && c.label !== 'x')?.score ??
            0) <
          0.15),
  );
  const uncertaintyReasons: UncertaintyReason[] = [];
  if (ambiguousGrouping) uncertaintyReasons.push('segmentation');
  if (lowEvidence) uncertaintyReasons.push('confidence');
  if (preview !== topExpression) {
    const crossingOnly =
      preview.length === topExpression.length &&
      [...preview].every(
        (c, i) =>
          c === topExpression[i] || (c === 'x' && topExpression[i] === '×'),
      );
    uncertaintyReasons.push(crossingOnly ? 'crossing' : 'confidence');
  }
  return {
    symbols,
    expression: preview,
    status: uncertaintyReasons.length ? 'uncertain' : 'recognized',
    uncertaintyReasons: [...new Set(uncertaintyReasons)],
  };
}
/** Geometry proposes alternatives, while model evidence decides whether they
 * actually compete. A speculative split alone must not hide a clear reading. */
export function resolveGroupingCandidates(
  candidates: readonly DecodedExpression[],
  unresolvedGeometry = false,
): DecodedExpression {
  const primary = candidates[0];
  if (!primary) throw new Error('A grouping candidate is required');
  const plausible = candidates.filter((candidate) =>
    plausibleExpression(candidate.expression),
  );
  const confident = plausible.filter(
    (candidate) => candidate.status === 'recognized',
  );
  const readings = new Set(confident.map((candidate) => candidate.expression));
  if (!unresolvedGeometry && readings.size === 1) return confident[0];
  const preview = plausibleExpression(primary.expression)
    ? primary
    : (plausible[0] ?? primary);
  return {
    ...preview,
    status: 'uncertain',
    uncertaintyReasons: [
      ...new Set<UncertaintyReason>([
        ...preview.uncertaintyReasons,
        'segmentation',
      ]),
    ],
  };
}
/** Straight rising-right diagonal between operands is a geometric slash candidate.
 * Steep 1-like lines and arbitrary diagonals do not qualify. Masks disable this
 * rule in the worker because remaining pixels can contradict original geometry. */
export function geometricSlash(group: SymbolGroup, bodySize: number): boolean {
  if (group.strokes.length !== 1) return false;
  const stroke = group.strokes[0],
    points = stroke.points;
  if (points.length < 2) return false;
  const a = points[0],
    b = points.at(-1)!;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  if (
    dx * dy >= 0 ||
    Math.abs(dy) < bodySize * 0.6 ||
    Math.abs(dx) < Math.abs(dy) * 0.3 ||
    Math.abs(dx) > Math.abs(dy) * 0.9 ||
    length === 0
  )
    return false;
  return points.every(
    (p) =>
      Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length <=
      Math.max(stroke.width, length * 0.06),
  );
}
/** Fraction output uses parser-native parentheses and division. No synthetic
 * symbols are added: the bar prediction still carries its exact source IDs. */
export function decodeFraction(
  layout: FractionLayout,
  numerator: SymbolPrediction[],
  denominator: SymbolPrediction[],
  remainder: SymbolPrediction[],
  bar: SymbolPrediction,
  ambiguous = false,
): DecodedExpression {
  const n = decodeSymbols(numerator),
    d = decodeSymbols(denominator),
    r = decodeSymbols(remainder);
  const before = remainder
    .filter((s) => s.bounds.maxX < layout.bar.bounds.minX)
    .map((s) => s.label)
    .join('');
  const after = remainder
    .filter((s) => s.bounds.minX > layout.bar.bounds.maxX)
    .map((s) => s.label)
    .join('');
  const expression = `${before}(${n.expression})/(${d.expression})${after}`;
  const unsupported =
    remainder.some(
      (s) =>
        s.bounds.maxX >= layout.bar.bounds.minX &&
        s.bounds.minX <= layout.bar.bounds.maxX,
    ) ||
    !numerator.length ||
    !denominator.length ||
    !plausibleExpression(expression);
  return {
    expression,
    symbols: [...n.symbols, bar, ...d.symbols, ...r.symbols],
    status:
      ambiguous ||
      unsupported ||
      [n, d, r].some((part) => part.status === 'uncertain')
        ? 'uncertain'
        : 'recognized',
    uncertaintyReasons: [
      ...new Set<UncertaintyReason>([
        ...n.uncertaintyReasons,
        ...d.uncertaintyReasons,
        ...r.uncertaintyReasons,
        ...(ambiguous || unsupported ? ['layout' as const] : []),
      ]),
    ],
  };
}
/** Effective canonical input identity excludes display colour/time and includes
 * local crop size, rendered pressure width, and only masks targeting this input. */
export function recognitionCacheKey(
  group: SymbolGroup,
  erasures: Erasure[],
  bodySize: number,
  modelSha: string,
  preprocessing: string,
): string {
  const x = (group.bounds.minX + group.bounds.maxX) / 2,
    y = (group.bounds.minY + group.bounds.maxY) / 2;
  const ids = new Set(group.strokes.map((s) => s.id));
  return JSON.stringify([
    modelSha,
    preprocessing,
    bodySize,
    [
      group.bounds.minX - x,
      group.bounds.minY - y,
      group.bounds.maxX - x,
      group.bounds.maxY - y,
    ],
    group.strokes.map((s) => [
      s.id,
      s.width,
      [
        s.bounds.minX - x,
        s.bounds.minY - y,
        s.bounds.maxX - x,
        s.bounds.maxY - y,
      ],
      s.points.map((p) => [p.x - x, p.y - y, pressureWidth(s, p)]),
    ]),
    erasures
      .filter((e) => e.targetStrokeIds.some((id) => ids.has(id)))
      .map((e) => [
        e.radius,
        e.targetStrokeIds.filter((id) => ids.has(id)).sort(),
        e.path.map((p) => [p.x - x, p.y - y]),
      ]),
  ]);
}
export class RecognitionCache {
  private readonly entries = new Map<string, readonly number[]>();
  get size(): number {
    return this.entries.size;
  }
  get(key: string): readonly number[] | undefined {
    const result = this.entries.get(key);
    if (result) {
      this.entries.delete(key);
      this.entries.set(key, result);
    }
    return result;
  }
  set(key: string, scores: readonly number[]): void {
    this.entries.delete(key);
    this.entries.set(key, [...scores]);
    if (this.entries.size > DECODER_LIMITS.cache)
      this.entries.delete(this.entries.keys().next().value!);
  }
}
