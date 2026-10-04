import { canonicalJson, type GroundTruthAst } from './schema';

export interface Ratio {
  numerator: number;
  denominator: number;
  value: number | null;
  interval95: [number, number] | null;
}
/** Wilson binomial interval. Writer clustering remains a separate reported limitation. */
export function ratio(numerator: number, denominator: number): Ratio {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator < numerator
  )
    throw new Error('Invalid metric counts');
  if (denominator === 0)
    return { numerator, denominator, value: null, interval95: null };
  const p = numerator / denominator,
    z = 1.959963984540054;
  const divisor = 1 + (z * z) / denominator;
  const center = (p + (z * z) / (2 * denominator)) / divisor;
  const margin =
    (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * denominator)) / denominator)) /
    divisor;
  return {
    numerator,
    denominator,
    value: p,
    interval95: [Math.max(0, center - margin), Math.min(1, center + margin)],
  };
}
export interface SymbolObservation {
  expected: string;
  topK: { label: string; score: number }[];
}
export function classifierMetrics(
  observations: SymbolObservation[],
  labels: readonly string[],
) {
  const supported = new Set(labels);
  if (supported.size !== labels.length || !labels.length)
    throw new Error('Invalid vocabulary');
  const confusion = Object.fromEntries(
    labels.map((label) => [
      label,
      Object.fromEntries(
        [...labels, '<abstain>'].map((prediction) => [prediction, 0]),
      ),
    ]),
  );
  let correct = 0,
    topK = 0,
    operators = 0,
    operatorCorrect = 0,
    decimals = 0,
    decimalCorrect = 0;
  for (const observation of observations) {
    if (!supported.has(observation.expected))
      throw new Error('Unsupported truth must be reported separately');
    if (
      observation.topK.some(
        (candidate) =>
          !supported.has(candidate.label) ||
          !Number.isFinite(candidate.score) ||
          candidate.score < 0 ||
          candidate.score > 1,
      ) ||
      new Set(observation.topK.map((candidate) => candidate.label)).size !==
        observation.topK.length ||
      observation.topK.some(
        (candidate, index) =>
          index > 0 && candidate.score > observation.topK[index - 1].score,
      )
    )
      throw new Error('Invalid ranked model candidates');
    const prediction = observation.topK[0]?.label ?? '<abstain>';
    confusion[observation.expected][prediction]++;
    const hit = prediction === observation.expected;
    correct += Number(hit);
    topK += Number(
      observation.topK.some(
        (candidate) => candidate.label === observation.expected,
      ),
    );
    if (['+', '−', '×', '÷', '='].includes(observation.expected)) {
      operators++;
      operatorCorrect += Number(hit);
    }
    if (observation.expected === '.') {
      decimals++;
      decimalCorrect += Number(hit);
    }
  }
  const perClass = labels.map((label) => {
    const tp = confusion[label][label];
    const truth = Object.values(confusion[label]).reduce(
      (sum, n) => sum + n,
      0,
    );
    const predicted = labels.reduce(
      (sum, expected) => sum + confusion[expected][label],
      0,
    );
    return {
      label,
      precision: ratio(tp, predicted),
      recall: ratio(tp, truth),
      f1: truth + predicted ? (2 * tp) / (truth + predicted) : null,
    };
  });
  const represented = perClass.filter((row) => row.f1 !== null);
  return {
    top1: ratio(correct, observations.length),
    topK: ratio(topK, observations.length),
    operatorAccuracy: ratio(operatorCorrect, operators),
    decimalRecall: ratio(decimalCorrect, decimals),
    macroF1: represented.length
      ? represented.reduce((sum, row) => sum + row.f1!, 0) / represented.length
      : null,
    macroF1ClassCount: represented.length,
    vocabularyClassCount: labels.length,
    absentTruthClasses: perClass
      .filter((row) => row.recall.denominator === 0)
      .map((row) => row.label),
    perClass,
    confusion,
  };
}
const strokeKey = (ids: string[]) => {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('Invalid group stroke membership');
  return canonicalJson([...ids].sort());
};
/** One-to-one exact source-stroke-set match; duplicate predictions remain false positives. */
export function groupingMetrics(truth: string[][], predicted: string[][]) {
  const remaining = new Map<string, number>();
  for (const group of truth) {
    const key = strokeKey(group);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let matched = 0;
  for (const group of predicted) {
    const key = strokeKey(group),
      available = remaining.get(key) ?? 0;
    if (available > 0) {
      matched++;
      remaining.set(key, available - 1);
    }
  }
  return {
    matchingRule: 'one-to-one exact source-stroke-set',
    precision: ratio(matched, predicted.length),
    recall: ratio(matched, truth.length),
  };
}
export interface ExpressionObservation {
  expectedAst: GroundTruthAst;
  predictedAst: GroundTruthAst | null;
  expectedAnswer: number;
  predictedAnswer: number | null;
  accepted: boolean;
  userCorrected: boolean;
}
export function expressionMetrics(observations: ExpressionObservation[]) {
  const subset = (rows: ExpressionObservation[]) => {
    let exact = 0,
      answer = 0,
      accepted = 0,
      wrongAccepted = 0;
    for (const row of rows) {
      if (
        !Number.isFinite(row.expectedAnswer) ||
        (row.predictedAnswer !== null && !Number.isFinite(row.predictedAnswer))
      )
        throw new Error('Nonfinite benchmark answer');
      const astMatches =
        row.predictedAst !== null &&
        canonicalJson(row.expectedAst) === canonicalJson(row.predictedAst);
      const answerMatches =
        row.predictedAnswer !== null &&
        Math.abs(row.expectedAnswer - row.predictedAnswer) <=
          1e-10 * Math.max(1, Math.abs(row.expectedAnswer));
      exact += Number(astMatches);
      answer += Number(answerMatches);
      accepted += Number(row.accepted);
      wrongAccepted += Number(row.accepted && !answerMatches);
    }
    return {
      astExactMatch: ratio(exact, rows.length),
      answerCorrectness: ratio(answer, rows.length),
      acceptedCoverage: ratio(accepted, rows.length),
      abstention: ratio(rows.length - accepted, rows.length),
      wrongAnswersAmongAccepted: ratio(wrongAccepted, accepted),
    };
  };
  return {
    automatic: subset(observations.filter((row) => !row.userCorrected)),
    userCorrected: subset(observations.filter((row) => row.userCorrected)),
    all: subset(observations),
  };
}
