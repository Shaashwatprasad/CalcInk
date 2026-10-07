import { describe, expect, it } from 'vitest';
import {
  validateCorpus,
  canonicalJson,
  corpusCounts,
  type LabelledCorpus,
} from '../../scripts/benchmark/corpus/schema';
import {
  classifierMetrics,
  expressionMetrics,
  groupingMetrics,
  ratio,
} from '../../scripts/benchmark/corpus/metrics';

/** Fabricated metadata here tests validators only. Never export as a human accuracy corpus. */
function validatorFixture(): LabelledCorpus {
  return {
    format: 'calcink-labelled-corpus',
    version: 1,
    corpusId: 'synthetic-validator-only',
    notes: 'Not collected human data',
    samples: [
      {
        id: 'fixture',
        writerId: 'validator-writer',
        sessionId: 'validator-session',
        split: 'evaluation',
        capturedAt: '2026-10-03T00:00:00.000Z',
        provenance: {
          kind: 'real-vector',
          basis: 'human-export-attested',
          source: 'validator-only attestation, not real ink',
          annotationBy: 'validator',
          rights: 'validator-only',
        },
        input: {
          pointerType: 'mouse',
          device: 'validator',
          browser: 'validator',
          dpr: 1,
          viewport: { width: 100, height: 100 },
        },
        document: {
          format: 'calcink-document',
          version: 1,
          documentId: 'validator-document',
          generation: 0,
          revision: 0,
          strokes: [
            {
              id: 'stroke',
              width: 2,
              color: '#000000',
              points: [{ x: 5, y: 5, timestamp: 0 }],
              bounds: { minX: 4, minY: 4, maxX: 6, maxY: 6 },
            },
          ],
          erasures: [],
        },
        symbols: [{ id: 'symbol', label: '1', strokeIds: ['stroke'] }],
        ignoredStrokeIds: [],
        expressions: [
          {
            id: 'expression',
            strokeIds: ['stroke'],
            text: '1=',
            ast: { type: 'number', value: 1 },
            expected: { status: 'valid', value: 1 },
          },
        ],
      },
    ],
  };
}
describe('ML-CORPUS v1 data provenance, split and annotation contracts', () => {
  it('ML-COR-001 accepts empty corpus without converting it into accuracy evidence', () => {
    const corpus = validateCorpus({
      format: 'calcink-labelled-corpus',
      version: 1,
      corpusId: 'empty',
      notes: 'pending',
      samples: [],
    });
    expect(corpusCounts(corpus).evaluation).toEqual({
      samples: 0,
      writers: 0,
      symbols: 0,
      expressions: 0,
      assignments: 0,
    });
    expect(ratio(0, 0)).toEqual({
      numerator: 0,
      denominator: 0,
      value: null,
      interval95: null,
    });
  });
  it('ML-COR-002 validates independent stroke labels and recomputes imported bounds', () => {
    const source = validatorFixture();
    source.samples[0].document.strokes[0].bounds = {
      minX: -999,
      minY: -999,
      maxX: 999,
      maxY: 999,
    };
    const corpus = validateCorpus(source);
    expect(corpus.samples[0].document.strokes[0].bounds).toEqual({
      minX: 4,
      minY: 4,
      maxX: 6,
      maxY: 6,
    });
    expect(source.samples[0].document.strokes[0].bounds.minX).toBe(-999);
  });
  it('ML-COR-003 rejects writer leakage across development and evaluation', () => {
    const corpus = validatorFixture();
    const duplicate = structuredClone(corpus.samples[0]);
    duplicate.id = 'another';
    duplicate.document.documentId = 'another-doc';
    duplicate.split = 'development';
    corpus.samples.push(duplicate);
    expect(() => validateCorpus(corpus)).toThrow('writer leakage');
  });
  it.each([
    'unknown-membership',
    'missing-label',
    'duplicate-label',
    'bad-ast',
    'no-ast',
    'duplicate-replay',
    'synthetic',
  ])('ML-COR-004 rejects %s', (defect) => {
    const corpus = validatorFixture(),
      sample = corpus.samples[0];
    if (defect === 'unknown-membership')
      sample.symbols[0].strokeIds = ['missing'];
    if (defect === 'missing-label') sample.symbols = [];
    if (defect === 'duplicate-label')
      sample.symbols.push({ ...sample.symbols[0], id: 'another' });
    if (defect === 'bad-ast')
      sample.expressions[0].ast = { type: 'number', value: Infinity };
    if (defect === 'no-ast') sample.expressions[0].ast = null;
    if (defect === 'duplicate-replay')
      corpus.samples.push({ ...structuredClone(sample), id: 'another' });
    if (defect === 'synthetic')
      (sample.provenance as unknown as { kind: string }).kind = 'synthetic';
    expect(() => validateCorpus(corpus)).toThrow();
  });
  it('ML-COR-005 canonical serialization normalizes object key order but preserves array order', () => {
    expect(canonicalJson({ b: 2, a: [1, 2] })).toBe(
      canonicalJson({ a: [1, 2], b: 2 }),
    );
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});
describe('ML-METRICS independent counts and confidence intervals', () => {
  it('ML-MET-001 includes misses and abstentions in independent classifier denominators', () => {
    const report = classifierMetrics(
      [
        {
          expected: '+',
          topK: [
            { label: '×', score: 0.7 },
            { label: '+', score: 0.2 },
          ],
        },
        { expected: '.', topK: [{ label: '.', score: 0.9 }] },
        { expected: '1', topK: [] },
      ],
      ['1', '+', '×', '.'],
    );
    expect(report.top1).toMatchObject({ numerator: 1, denominator: 3 });
    expect(report.topK).toMatchObject({ numerator: 2, denominator: 3 });
    expect(report.operatorAccuracy).toMatchObject({
      numerator: 0,
      denominator: 1,
    });
    expect(report.decimalRecall).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    expect(report.confusion['1']['<abstain>']).toBe(1);
    expect(report.absentTruthClasses).toEqual(['×']);
  });
  it('ML-MET-002 exact-group matching penalizes duplicate predictions and merged symbols', () => {
    const report = groupingMetrics(
      [['a', 'b'], ['c']],
      [
        ['b', 'a'],
        ['a', 'b'],
        ['c', 'd'],
      ],
    );
    expect(report.precision).toMatchObject({ numerator: 1, denominator: 3 });
    expect(report.recall).toMatchObject({ numerator: 1, denominator: 2 });
  });
  it('ML-MET-003 an equal answer cannot prove AST exact match; corrections stay separate', () => {
    const report = expressionMetrics([
      {
        expectedAst: {
          type: 'binary',
          operator: '+',
          left: { type: 'number', value: 1 },
          right: { type: 'number', value: 2 },
        },
        predictedAst: { type: 'number', value: 3 },
        expectedAnswer: 3,
        predictedAnswer: 3,
        accepted: true,
        userCorrected: false,
      },
      {
        expectedAst: { type: 'number', value: 4 },
        predictedAst: { type: 'number', value: 4 },
        expectedAnswer: 4,
        predictedAnswer: 5,
        accepted: true,
        userCorrected: true,
      },
    ]);
    expect(report.automatic.astExactMatch.numerator).toBe(0);
    expect(report.automatic.answerCorrectness.numerator).toBe(1);
    expect(report.userCorrected.wrongAnswersAmongAccepted).toMatchObject({
      numerator: 1,
      denominator: 1,
    });
    expect(report.automatic.acceptedCoverage.denominator).toBe(1);
  });
  it('ML-MET-004 small perfect sample cannot establish <=1% error target', () => {
    const interval = ratio(0, 10).interval95!;
    expect(interval[0]).toBeGreaterThanOrEqual(0);
    expect(interval[1]).toBeGreaterThan(0.01);
    expect(() => ratio(2, 1)).toThrow();
    expect(() =>
      classifierMetrics([{ expected: 'x', topK: [] }], ['×']),
    ).toThrow('Unsupported truth');
    expect(() =>
      classifierMetrics(
        [{ expected: '×', topK: [{ label: '×', score: NaN }] }],
        ['×'],
      ),
    ).toThrow();
  });
});
