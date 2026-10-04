/** Reject incomplete child reports even when their process exits successfully. */
export function inspectReport(data, kind, expectedTestIds) {
  let counts;
  let selectedTestIds = [];
  if (kind === 'vitest') {
    counts = {
      passed: data.numPassedTests,
      failed: data.numFailedTests,
      skipped: data.numPendingTests,
      total: data.numTotalTests,
    };
    selectedTestIds = (data.testResults ?? []).flatMap((file) =>
      (file.assertionResults ?? []).map((item) => item.fullName),
    );
  } else if (kind === 'playwright') {
    counts = {
      passed: data.stats?.expected,
      failed: data.stats?.unexpected,
      skipped: data.stats?.skipped,
      flaky: data.stats?.flaky,
    };
    const visit = (suites) =>
      suites.flatMap((suite) => [
        ...(suite.specs ?? []).map((spec) => spec.title),
        ...visit(suite.suites ?? []),
      ]);
    selectedTestIds = visit(data.suites ?? []);
  } else if (kind === 'probe') {
    counts = { passed: data.passed, failed: data.failed, skipped: 0 };
    selectedTestIds = Object.keys(data.checks ?? {});
  } else throw new Error('Unknown report kind');
  let reportError;
  if (Object.values(counts).some((v) => !Number.isSafeInteger(v) || v < 0))
    reportError = 'Missing or invalid test counts';
  else if (counts.passed + counts.failed === 0)
    reportError = 'No required cases executed';
  else if (counts.skipped > 0 || counts.flaky > 0)
    reportError = 'Skipped or flaky required cases';
  else if (
    kind === 'vitest' &&
    counts.total !== counts.passed + counts.failed + counts.skipped
  )
    reportError = 'Inconsistent total test count';
  else if (
    selectedTestIds.length !==
    counts.passed + counts.failed + counts.skipped + (counts.flaky ?? 0)
  )
    reportError = 'Test IDs do not account for reported cases';
  else if (selectedTestIds.some((id) => typeof id !== 'string' || !id.trim()))
    reportError = 'Missing test identity';
  if (
    kind === 'probe' &&
    Object.values(data.checks ?? {}).some((v) => typeof v !== 'boolean')
  )
    reportError = 'Invalid probe outcomes';
  if (
    kind === 'probe' &&
    Object.values(data.checks ?? {}).filter(Boolean).length !== counts.passed
  )
    reportError = 'Inconsistent probe outcomes';
  if (expectedTestIds) {
    const actual = new Set(selectedTestIds);
    const expected = new Set(expectedTestIds);
    if (
      expectedTestIds.some((id) => !actual.has(id)) ||
      selectedTestIds.some((id) => !expected.has(id))
    )
      reportError =
        'Selected report cases differ from required source inventory';
  }
  return { counts, selectedTestIds, reportError };
}
