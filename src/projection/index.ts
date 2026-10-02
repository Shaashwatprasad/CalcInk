import { evaluateExpression } from '../math';
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
  status: Evaluation['status'] | 'uncertain' | 'error';
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

  reset(documentId: string, generation: number): void {
    this.documentId = documentId;
    this.generation = generation;
    this.expected.clear();
    this.projections.clear();
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
    this.projections.delete(job.equationId);
  }

  retire(equationId: string): void {
    this.expected.delete(equationId);
    this.projections.delete(equationId);
  }

  accept(value: unknown): EquationProjection | undefined {
    if (!isRecognitionResult(value)) return undefined;
    const expected = this.expected.get(value.equationId);
    if (!expected || !sameJob(expected, value)) return undefined;
    const projection: EquationProjection = {
      equationId: value.equationId,
      equationRevision: value.equationRevision,
      expression: value.expression,
      bounds: { ...value.bounds },
      status: 'incomplete',
    };
    if (value.status !== 'recognized') projection.status = value.status;
    else if (value.expression.trimEnd().endsWith('=')) {
      const last = value.symbols.at(-1);
      if (last && (last.label === '=' || last.label === 'eq')) {
        const evaluation = evaluateExpression(value.expression);
        projection.status = evaluation.status;
        projection.evaluation = evaluation;
        projection.equalsBounds = { ...last.bounds };
        if (
          evaluation.status === 'valid' ||
          evaluation.status === 'undefined'
        ) {
          projection.answerText = evaluation.display;
          projection.answerBounds = {
            minX: last.bounds.maxX + 12,
            maxX:
              last.bounds.maxX +
              12 +
              Math.max(20, evaluation.display.length * 10),
            minY: last.bounds.minY,
            maxY: Math.max(last.bounds.maxY, last.bounds.minY + 20),
          };
        }
      }
    }
    this.projections.set(value.equationId, projection);
    // Consume accepted jobs, preventing a duplicate message from replacing derived state.
    this.expected.delete(value.equationId);
    return projection;
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
