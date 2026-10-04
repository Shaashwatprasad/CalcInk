import { evaluateNotebook } from '../math';
import type { NotebookOutcome } from '../math';
import type {
  Bounds,
  Evaluation,
  JobIdentity,
  RecognitionJob,
  RecognitionResult,
  SymbolPrediction,
} from '../shared/types';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number =>
  finite(value) && value >= 0;
const revision = (value: unknown): value is number =>
  nonnegative(value) && Number.isSafeInteger(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const score = (value: unknown): value is number =>
  nonnegative(value) && value <= 1;

function isBounds(value: unknown): value is Bounds {
  return (
    record(value) &&
    finite(value.minX) &&
    finite(value.minY) &&
    finite(value.maxX) &&
    finite(value.maxY) &&
    value.minX <= value.maxX &&
    value.minY <= value.maxY
  );
}

export function isJobIdentity(value: unknown): value is JobIdentity {
  return (
    record(value) &&
    value.protocolVersion === 1 &&
    text(value.documentId) &&
    revision(value.generation) &&
    text(value.equationId) &&
    revision(value.equationRevision) &&
    text(value.requestId) &&
    text(value.modelVersion) &&
    text(value.preprocessingVersion)
  );
}

function isSymbol(value: unknown): value is SymbolPrediction {
  return (
    record(value) &&
    (value.strokeIds === undefined ||
      (Array.isArray(value.strokeIds) &&
        value.strokeIds.length <= 50000 &&
        value.strokeIds.every(text))) &&
    text(value.label) &&
    score(value.score) &&
    isBounds(value.bounds) &&
    Array.isArray(value.topK) &&
    value.topK.length <= 128 &&
    value.topK.every(
      (item) => record(item) && text(item.label) && score(item.score),
    )
  );
}

/** Validate untrusted worker messages before checking their job identity. */
export function isRecognitionResult(
  value: unknown,
): value is RecognitionResult {
  return (
    isJobIdentity(value) &&
    record(value) &&
    value.type === 'RESULT' &&
    Array.isArray(value.symbols) &&
    value.symbols.length <= 512 &&
    value.symbols.every(isSymbol) &&
    typeof value.expression === 'string' &&
    value.expression.length <= 4096 &&
    isBounds(value.bounds) &&
    (value.status === 'recognized' ||
      value.status === 'uncertain' ||
      value.status === 'error') &&
    (value.error === undefined || typeof value.error === 'string') &&
    record(value.timings) &&
    nonnegative(value.timings.preprocessingMs) &&
    nonnegative(value.timings.inferenceMs) &&
    nonnegative(value.timings.totalMs) &&
    (value.uncertaintyReasons === undefined ||
      (Array.isArray(value.uncertaintyReasons) &&
        value.uncertaintyReasons.every((reason) =>
          ['crossing', 'confidence', 'layout', 'segmentation'].includes(
            reason as string,
          ),
        ))) &&
    value.backend === 'wasm'
  );
}

export function sameJob(left: JobIdentity, right: JobIdentity): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.documentId === right.documentId &&
    left.generation === right.generation &&
    left.equationId === right.equationId &&
    left.equationRevision === right.equationRevision &&
    left.requestId === right.requestId &&
    left.modelVersion === right.modelVersion &&
    left.preprocessingVersion === right.preprocessingVersion
  );
}

export interface EquationProjection {
  equationId: string;
  equationRevision: number;
  expression: string;
  bounds: Bounds;
  status: NotebookOutcome['status'] | 'error';
  outcome?: NotebookOutcome;
  normalizedText?: string;
  answerFontSize?: number;
  symbols?: SymbolPrediction[];
  crossingIndex?: number;
  evaluation?: Evaluation;
  equalsBounds?: Bounds;
  answerBounds?: Bounds;
  answerText?: string;
}

/** Per-equation request guards; answers are derived state and never modify ink. */
export class ProjectionStore {
  private documentId = '';
  private generation = -1;
  private expected = new Map<string, JobIdentity>();
  private projections = new Map<string, EquationProjection>();
  private inputs = new Map<string, RecognitionResult>();
  private pending = new Map<string, { bounds: Bounds; text: string }>();
  private corrections = new Map<
    string,
    { revision: number; index: number; label: 'x' | '×' }
  >();

  reset(documentId: string, generation: number): void {
    this.documentId = documentId;
    this.generation = generation;
    this.expected.clear();
    this.projections.clear();
    this.inputs.clear();
    this.pending.clear();
    this.corrections.clear();
  }

  expect(job: JobIdentity): void {
    if (
      !isJobIdentity(job) ||
      job.documentId !== this.documentId ||
      job.generation !== this.generation
    ) {
      throw new Error('Job does not belong to the current document generation');
    }
    // Copy only identity fields, even when the caller supplies a full ink job.
    this.expected.set(job.equationId, {
      protocolVersion: job.protocolVersion,
      documentId: job.documentId,
      generation: job.generation,
      equationId: job.equationId,
      equationRevision: job.equationRevision,
      requestId: job.requestId,
      modelVersion: job.modelVersion,
      preprocessingVersion: job.preprocessingVersion,
    });
    const previous = this.inputs.get(job.equationId);
    const full = job as RecognitionJob;
    if (full.bounds)
      this.pending.set(job.equationId, {
        bounds: { ...full.bounds },
        text: previous?.expression ?? '',
      });
    this.inputs.delete(job.equationId);
    this.corrections.delete(job.equationId);
    this.projections.delete(job.equationId);
    this.recompute();
  }

  retire(equationId: string): void {
    this.expected.delete(equationId);
    this.projections.delete(equationId);
    this.inputs.delete(equationId);
    this.pending.delete(equationId);
    this.corrections.delete(equationId);
    this.recompute();
  }

  accept(value: unknown): EquationProjection | undefined {
    if (!isRecognitionResult(value)) return undefined;
    const expected = this.expected.get(value.equationId);
    if (!expected || !sameJob(expected, value)) return undefined;
    this.inputs.set(value.equationId, value);
    this.pending.delete(value.equationId);
    this.expected.delete(value.equationId);
    this.recompute();
    return this.projections.get(value.equationId);
  }

  /** A correction belongs to one source equation revision, never global glyph replacement. */
  correct(equationId: string, label: 'x' | '×', symbolIndex?: number): boolean {
    const value = this.inputs.get(equationId);
    const index =
      symbolIndex ?? this.projections.get(equationId)?.crossingIndex ?? -1;
    if (
      !value ||
      !Number.isInteger(index) ||
      !['×', 'x'].includes(value.symbols[index]?.label)
    )
      return false;
    this.corrections.set(equationId, {
      revision: value.equationRevision,
      index,
      label,
    });
    this.recompute();
    return true;
  }

  private recompute(): void {
    const values = [...this.inputs.values()].sort(
      (a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX,
    );
    const expressions = new Map<string, string>();
    for (const value of values) {
      const correction = this.corrections.get(value.equationId);
      // Only the crossing in an operand position can be x; 2×3 remains multiplication.
      const labels = value.symbols.map((s) => s.label);
      for (let i = 0; i < labels.length; i++) {
        if (
          correction?.revision === value.equationRevision &&
          correction.index === i
        )
          labels[i] = correction.label;
        else if (
          labels[i] === '×' &&
          (i === 0 ||
            ['+', '-', '−', '×', '*', '/', '÷', '(', '='].includes(
              labels[i - 1],
            ))
        )
          labels[i] = 'x';
      }
      // Structured division expressions can differ from a flat symbol concatenation.
      const flat = value.symbols.map((s) => s.label).join('');
      const flatCompatible =
        value.expression.length === flat.length &&
        [...value.expression].every(
          (c, i) => c === flat[i] || (c === 'x' && flat[i] === '×'),
        );
      expressions.set(
        value.equationId,
        flatCompatible ? labels.join('') : value.expression,
      );
    }
    const entries = [
      ...values.map((v) => ({
        id: v.equationId,
        text: expressions.get(v.equationId)!,
        state:
          v.status === 'recognized' ||
          (this.corrections.has(v.equationId) &&
            v.uncertaintyReasons?.length &&
            v.uncertaintyReasons.every((r) => r === 'crossing'))
            ? ('recognized' as const)
            : v.status === 'uncertain'
              ? ('uncertain' as const)
              : ('error' as const),
        bounds: v.bounds,
      })),
      ...[...this.pending].map(([id, p]) => ({
        id,
        text: p.text,
        state: 'pending' as const,
        bounds: p.bounds,
      })),
    ].sort(
      (a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX,
    );
    const evaluated = evaluateNotebook(entries).entries;
    this.projections.clear();
    for (const value of values) {
      const result = evaluated.find((e) => e.id === value.equationId)!;
      const outcome = result.outcome;
      const last = value.symbols.at(-1);
      const equals =
        last && (last.label === '=' || last.label === 'eq')
          ? last.bounds
          : undefined;
      const bodyHeights = value.symbols
        .filter((s) => !['=', '−', '-', '.', '÷'].includes(s.label))
        .map((s) => s.bounds.maxY - s.bounds.minY)
        .filter((h) => h > 0)
        .sort((a, b) => a - b);
      const fontSize = Math.max(
        12,
        Math.min(
          128,
          (bodyHeights[Math.floor(bodyHeights.length / 2)] ??
            value.bounds.maxY - value.bounds.minY) * 0.95,
        ),
      );
      const answer =
        equals && (outcome.status === 'valid' || outcome.status === 'undefined')
          ? outcome.display
          : undefined;
      const projection: EquationProjection = {
        equationId: value.equationId,
        equationRevision: value.equationRevision,
        expression: expressions.get(value.equationId)!,
        bounds: { ...value.bounds },
        status: outcome.status,
        outcome,
        symbols: value.symbols,
        normalizedText: result.normalizedText ?? undefined,
        crossingIndex: (() => {
          const candidates = value.symbols.flatMap((s, i) =>
            ['×', 'x'].includes(s.label) ? [i] : [],
          );
          return (
            candidates.find(
              (i) =>
                i === 0 ||
                ['+', '-', '−', '×', '*', '/', '÷', '(', '='].includes(
                  value.symbols[i - 1].label,
                ),
            ) ??
            candidates[0] ??
            -1
          );
        })(),
        ...(outcome.status === 'valid' ||
        outcome.status === 'undefined' ||
        outcome.status === 'invalid' ||
        outcome.status === 'incomplete'
          ? { evaluation: outcome }
          : {}),
        ...(equals ? { equalsBounds: { ...equals } } : {}),
        ...(answer && equals
          ? {
              answerText: answer,
              answerFontSize: fontSize,
              answerBounds: {
                minX: equals.maxX + 12,
                maxX:
                  equals.maxX +
                  12 +
                  Math.max(20, answer.length * fontSize * 0.65),
                minY: equals.minY,
                maxY: Math.max(equals.maxY, equals.minY + fontSize),
              },
            }
          : {}),
      };
      this.projections.set(value.equationId, projection);
    }
  }

  get(equationId: string): EquationProjection | undefined {
    return this.projections.get(equationId);
  }
  all(): EquationProjection[] {
    return [...this.projections.values()];
  }
  get size(): number {
    return this.projections.size;
  }
}

/** FIFO across equations, coalescing queued edits without starving other lines. */
export class RecognitionQueue {
  private pending = new Map<string, RecognitionJob>();
  private active?: RecognitionJob;

  enqueue(job: RecognitionJob): void {
    // Updating an existing Map entry preserves its original fair scheduling position.
    this.pending.set(job.equationId, job);
  }

  takeNext(): RecognitionJob | undefined {
    if (this.active) return undefined;
    const next = this.pending.values().next().value as
      | RecognitionJob
      | undefined;
    if (!next) return undefined;
    this.pending.delete(next.equationId);
    this.active = next;
    return next;
  }

  complete(identity: JobIdentity): boolean {
    if (!this.active || !sameJob(this.active, identity)) return false;
    this.active = undefined;
    return true;
  }

  retire(equationId: string): void {
    this.pending.delete(equationId);
  }
  /** Call reset only after terminating/replacing the worker; a live model run cannot be interrupted. */
  reset(): void {
    this.pending.clear();
    this.active = undefined;
  }
  get size(): number {
    return this.pending.size;
  }
  get isRunning(): boolean {
    return this.active !== undefined;
  }
}
