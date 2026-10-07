import { validateDocument } from '../../../src/persistence/document';
import type { InkDocument } from '../../../src/shared/types';

/** Corpus v1 stores only attested human vector ink. Synthetic tests live outside it. */
export const CORPUS_VERSION = 1;
export const BASELINE_LABELS = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '+',
  '.',
  '÷',
  '=',
  '×',
  '−',
] as const;
export const ANNOTATION_LABELS = [...BASELINE_LABELS, 'x', '/'] as const;
export type GroundTruthAst =
  | { type: 'number'; value: number }
  | { type: 'identifier'; name: 'x' }
  | { type: 'unary'; operator: '+' | '-'; operand: GroundTruthAst }
  | {
      type: 'binary';
      operator: '+' | '-' | '*' | '/';
      left: GroundTruthAst;
      right: GroundTruthAst;
    }
  | { type: 'assignment'; name: 'x'; value: GroundTruthAst };
export type ExpectedOutcome =
  | { status: 'valid'; value: number }
  | { status: 'variable-defined'; name: 'x'; value: number }
  | { status: 'incomplete' | 'uncertain' }
  | { status: 'invalid'; code: string }
  | { status: 'undefined'; reason: string }
  | { status: 'unbound'; name: 'x' };
export interface LabelledSample {
  id: string;
  writerId: string;
  sessionId: string;
  split: 'development' | 'evaluation';
  capturedAt: string;
  provenance: {
    kind: 'real-vector';
    basis: 'direct-human-capture' | 'human-export-attested';
    source: string;
    annotationBy: string;
    rights: string;
  };
  input: {
    pointerType: 'mouse' | 'pen' | 'touch' | 'mixed';
    device: string;
    browser: string;
    dpr: number;
    viewport: { width: number; height: number };
  };
  document: InkDocument;
  symbols: { id: string; label: string; strokeIds: string[] }[];
  ignoredStrokeIds: string[];
  /** Array order is the notebook definition/dependency sequence. */
  expressions: {
    id: string;
    strokeIds: string[];
    text: string;
    ast: GroundTruthAst | null;
    expected: ExpectedOutcome;
  }[];
}
export interface LabelledCorpus {
  format: 'calcink-labelled-corpus';
  version: 1;
  corpusId: string;
  notes: string;
  samples: LabelledSample[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;
const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;
function requireThat(test: unknown, message: string): asserts test {
  if (!test) throw new Error(`Corpus validation: ${message}`);
}
function uniqueIds(items: { id: string }[], name: string) {
  requireThat(
    items.every((item) => text(item.id)),
    `${name} IDs must be nonempty`,
  );
  requireThat(
    new Set(items.map((item) => item.id)).size === items.length,
    `duplicate ${name} ID`,
  );
}
function ast(value: unknown, depth = 0): value is GroundTruthAst {
  if (!object(value) || depth > 64) return false;
  switch (value.type) {
    case 'number':
      return typeof value.value === 'number' && Number.isFinite(value.value);
    case 'identifier':
      return value.name === 'x';
    case 'unary':
      return (
        ['+', '-'].includes(String(value.operator)) &&
        ast(value.operand, depth + 1)
      );
    case 'binary':
      return (
        ['+', '-', '*', '/'].includes(String(value.operator)) &&
        ast(value.left, depth + 1) &&
        ast(value.right, depth + 1)
      );
    case 'assignment':
      return value.name === 'x' && ast(value.value, depth + 1);
    default:
      return false;
  }
}
function outcome(value: unknown): value is ExpectedOutcome {
  if (!object(value)) return false;
  switch (value.status) {
    case 'valid':
      return typeof value.value === 'number' && Number.isFinite(value.value);
    case 'variable-defined':
      return (
        value.name === 'x' &&
        typeof value.value === 'number' &&
        Number.isFinite(value.value)
      );
    case 'unbound':
      return value.name === 'x';
    case 'incomplete':
    case 'uncertain':
      return true;
    case 'invalid':
      return text(value.code);
    case 'undefined':
      return text(value.reason);
    default:
      return false;
  }
}
export function validateCorpus(value: unknown): LabelledCorpus {
  requireThat(object(value), 'expected an object');
  requireThat(
    value.format === 'calcink-labelled-corpus' && value.version === 1,
    'unsupported format/version',
  );
  requireThat(
    text(value.corpusId) && typeof value.notes === 'string',
    'missing corpus metadata',
  );
  requireThat(
    Array.isArray(value.samples) && value.samples.length <= 100000,
    'invalid sample list',
  );
  const corpus = structuredClone(value) as unknown as LabelledCorpus;
  uniqueIds(corpus.samples, 'sample');
  const writerSplits = new Map<string, string>();
  const sessionWriters = new Map<string, string>();
  const seenDocuments = new Set<string>();
  for (const sample of corpus.samples) {
    requireThat(object(sample), 'invalid sample');
    requireThat(
      text(sample.writerId) && text(sample.sessionId),
      `${sample.id}: writer/session required`,
    );
    requireThat(
      ['development', 'evaluation'].includes(sample.split),
      `${sample.id}: invalid split`,
    );
    requireThat(
      !writerSplits.has(sample.writerId) ||
        writerSplits.get(sample.writerId) === sample.split,
      `writer leakage: ${sample.writerId}`,
    );
    requireThat(
      !sessionWriters.has(sample.sessionId) ||
        sessionWriters.get(sample.sessionId) === sample.writerId,
      `session belongs to different writers: ${sample.sessionId}`,
    );
    writerSplits.set(sample.writerId, sample.split);
    sessionWriters.set(sample.sessionId, sample.writerId);
    requireThat(
      text(sample.capturedAt) &&
        /^\d{4}-\d{2}-\d{2}T/.test(sample.capturedAt) &&
        Number.isFinite(Date.parse(sample.capturedAt)),
      `${sample.id}: capture date required`,
    );
    const provenance = sample.provenance;
    requireThat(
      object(provenance) &&
        provenance.kind === 'real-vector' &&
        ['direct-human-capture', 'human-export-attested'].includes(
          provenance.basis,
        ),
      `${sample.id}: human provenance required; synthetic fixtures are excluded`,
    );
    requireThat(
      [provenance.source, provenance.annotationBy, provenance.rights].every(
        text,
      ),
      `${sample.id}: source/annotator/rights required`,
    );
    const input = sample.input;
    requireThat(
      object(input) &&
        ['mouse', 'pen', 'touch', 'mixed'].includes(input.pointerType) &&
        text(input.device) &&
        text(input.browser) &&
        positive(input.dpr) &&
        object(input.viewport) &&
        positive(input.viewport.width) &&
        positive(input.viewport.height),
      `${sample.id}: device/input metadata required`,
    );
    sample.document = validateDocument(sample.document);
    requireThat(
      !seenDocuments.has(sample.document.documentId),
      `repeated document ${sample.document.documentId} is not an independent sample`,
    );
    seenDocuments.add(sample.document.documentId);
    requireThat(
      Array.isArray(sample.symbols) &&
        Array.isArray(sample.ignoredStrokeIds) &&
        Array.isArray(sample.expressions),
      `${sample.id}: annotations required`,
    );
    uniqueIds(sample.symbols, 'symbol');
    uniqueIds(sample.expressions, 'expression');
    const ids = new Set(sample.document.strokes.map((stroke) => stroke.id));
    const claimed = new Set<string>();
    const checkStrokeSet = (strokeIds: unknown, name: string) => {
      requireThat(
        Array.isArray(strokeIds) &&
          strokeIds.length > 0 &&
          strokeIds.every((id) => text(id) && ids.has(id)) &&
          new Set(strokeIds).size === strokeIds.length,
        `${sample.id}: invalid ${name} stroke membership`,
      );
    };
    for (const symbol of sample.symbols) {
      requireThat(
        ANNOTATION_LABELS.includes(
          symbol.label as (typeof ANNOTATION_LABELS)[number],
        ),
        `${sample.id}: unsupported annotation label ${symbol.label}`,
      );
      checkStrokeSet(symbol.strokeIds, 'symbol');
      for (const id of symbol.strokeIds) {
        requireThat(
          !claimed.has(id),
          `${sample.id}: stroke belongs to multiple symbols`,
        );
        claimed.add(id);
      }
    }
    requireThat(
      sample.ignoredStrokeIds.every(
        (id) => text(id) && ids.has(id) && !claimed.has(id),
      ) &&
        new Set(sample.ignoredStrokeIds).size ===
          sample.ignoredStrokeIds.length,
      `${sample.id}: invalid ignored stroke IDs`,
    );
    sample.ignoredStrokeIds.forEach((id) => claimed.add(id));
    requireThat(
      claimed.size === ids.size,
      `${sample.id}: every stroke needs a label or explicit exclusion`,
    );
    const expressionClaims = new Set<string>();
    for (const expression of sample.expressions) {
      checkStrokeSet(expression.strokeIds, 'expression');
      requireThat(
        text(expression.text) &&
          expression.text.length <= 4096 &&
          (expression.ast === null || ast(expression.ast)) &&
          outcome(expression.expected),
        `${sample.id}: invalid expression ground truth`,
      );
      requireThat(
        !['valid', 'variable-defined', 'undefined', 'unbound'].includes(
          expression.expected.status,
        ) || expression.ast !== null,
        `${sample.id}: complete expression requires independently annotated AST`,
      );
      for (const id of expression.strokeIds) {
        requireThat(
          !sample.ignoredStrokeIds.includes(id) && !expressionClaims.has(id),
          `${sample.id}: excluded/duplicate expression stroke`,
        );
        expressionClaims.add(id);
      }
    }
  }
  return corpus;
}
/** Stable serialization: object order never changes a frozen corpus hash. Array order is meaningful. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function corpusCounts(corpus: LabelledCorpus) {
  const count = (split: 'development' | 'evaluation') => {
    const samples = corpus.samples.filter((sample) => sample.split === split);
    return {
      samples: samples.length,
      writers: new Set(samples.map((sample) => sample.writerId)).size,
      symbols: samples.reduce((sum, sample) => sum + sample.symbols.length, 0),
      expressions: samples.reduce(
        (sum, sample) => sum + sample.expressions.length,
        0,
      ),
      assignments: samples
        .flatMap((sample) => sample.expressions)
        .filter((expression) => expression.ast?.type === 'assignment').length,
    };
  };
  return { development: count('development'), evaluation: count('evaluation') };
}
