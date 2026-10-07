import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
// Harness-only fixture reports. These never stand in for model inference.
const require = createRequire(import.meta.url);
const { inspectReport } = require('../../scripts/testing/report-contract.mjs');
const {
  validateDeterministicInventory,
  canonicalCaseInventory,
} = require('../../scripts/testing/case-inventory.mjs');

describe('tester child-report contract', () => {
  it('requires each deterministic declaration and every canonical check identity', () => {
    const inventory = [
      {
        path: 'tests/a.test.ts',
        declarations: [{ title: 'required %s', minimum: 2 }],
      },
    ];
    const report = {
      testResults: [
        {
          name: '/repo/tests/a.test.ts',
          assertionResults: [{ title: 'unrelated' }],
        },
      ],
    };
    expect(validateDeterministicInventory(report, inventory)).toBeTruthy();
    report.testResults[0].assertionResults = [
      { title: 'required one' },
      { title: 'required two' },
    ];
    expect(validateDeterministicInventory(report, inventory)).toBeUndefined();
    const required = canonicalCaseInventory(
      'scripts/benchmark/corpus/browser-probe.ts',
    );
    expect(required.length).toBeGreaterThan(10);
    expect(
      inspectReport(
        { passed: 1, failed: 0, checks: { unrelated: true } },
        'probe',
        required,
      ).reportError,
    ).toBeTruthy();
  });
  it('rejects well-formed reports that omit required selected cases', () => {
    const report = {
      stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
      suites: [{ specs: [{ title: 'unrelated' }] }],
    };
    expect(inspectReport(report, 'playwright').reportError).toBeUndefined();
    expect(
      inspectReport(report, 'playwright', ['requiredA', 'requiredB'])
        .reportError,
    ).toBeTruthy();
    expect(
      inspectReport(report, 'playwright', ['unrelated']).reportError,
    ).toBeUndefined();
  });
  it('rejects absent counts and all-skipped browser runs', () => {
    expect(inspectReport({}, 'playwright').reportError).toBeTruthy();
    expect(
      inspectReport(
        { stats: { expected: 0, unexpected: 0, skipped: 7, flaky: 0 } },
        'playwright',
      ).reportError,
    ).toBeTruthy();
  });
  it('requires identified executed cases and consistent totals', () => {
    const report = {
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTotalTests: 1,
      testResults: [{ assertionResults: [{ fullName: 'case' }] }],
    };
    expect(inspectReport(report, 'vitest').reportError).toBeUndefined();
    expect(
      inspectReport({ ...report, testResults: [] }, 'vitest').reportError,
    ).toBeTruthy();
    expect(
      inspectReport({ ...report, numTotalTests: 2 }, 'vitest').reportError,
    ).toBeTruthy();
  });
  it('rejects flaky, negative and inconsistent probe outcomes', () => {
    expect(
      inspectReport(
        { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 1 } },
        'playwright',
      ).reportError,
    ).toBeTruthy();
    expect(
      inspectReport({ passed: -1, failed: 0, checks: {} }, 'probe').reportError,
    ).toBeTruthy();
    expect(
      inspectReport(
        { passed: 2, failed: 0, checks: { a: true, b: false } },
        'probe',
      ).reportError,
    ).toBeTruthy();
    expect(
      inspectReport(
        { passed: 1, failed: 1, checks: { a: true, b: false } },
        'probe',
      ).reportError,
    ).toBeUndefined();
  });
});
