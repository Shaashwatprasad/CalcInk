import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const registry = JSON.parse(
  readFileSync('tests/registry/feature-actions.json', 'utf8'),
);
function check(args = []) {
  const result = spawnSync(
    process.execPath,
    ['tests/registry/check-registry.mjs', ...args],
    {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  return { exitCode: result.status, report: JSON.parse(result.stdout) };
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'calcink-registry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return (name, value) => {
    const path = join(directory, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
}

test('declared links cannot inflate meaningful action coverage or pass completeness gate', () => {
  const { exitCode, report } = check(['--gate']);
  assert.equal(exitCode, 2);
  assert.equal(report.schemaAndMappingValid, true);
  const actions = report.coverage.actions;
  assert.equal(actions.declaredLinks, registry.actions.length);
  assert.ok(actions.meaningfulMapped < actions.declaredLinks);
  assert.equal(
    actions.meaningfulMapped + actions.uncovered,
    actions.denominator,
  );
  assert.equal(
    actions.planned + actions.missingBehaviorCases.length,
    actions.uncovered,
  );
  assert.ok(actions.uncoveredIds.includes('ACT-PEN-PRESSURE'));
  assert.ok(actions.uncoveredIds.includes('ACT-TEXT-EDIT'));
  assert.ok(actions.uncoveredIds.includes('ACT-TEXT-EDIT'));
  assert.ok(actions.uncoveredIds.includes('ACT-CLEAR-ESCAPE'));
  assert.ok(actions.uncoveredIds.includes('ACT-CORRECTION-MULTIPLY'));
});

test('meaningful mapping requires anchors to assertions in the owning executable case', (t) => {
  const save = fixture(t);
  const changed = structuredClone(registry);
  const action = changed.actions.find((entry) => entry.id === 'ACT-WIDTH');
  action.assertionLinkage.assertions[0].assertionAnchor =
    'expect(impossibleFixture).toBe(123)';
  const { exitCode, report } = check([
    `--registry=${save('registry.json', changed)}`,
  ]);
  assert.equal(exitCode, 1);
  assert.equal(report.status, 'INVALID_REGISTRY');
  assert.ok(
    report.errors.some((error) =>
      error.startsWith('ACT-WIDTH: missing source assertion'),
    ),
  );
  assert.ok(!report.coverage.actions.meaningfulMappedIds.includes('ACT-WIDTH'));
});

test('even all-green workflow reports cannot pass missing, planned or unavailable actions', (t) => {
  const save = fixture(t);
  const initial = check().report;
  const changed = structuredClone(registry);
  // Demonstrate readiness protection separately from unavailable-action protection.
  changed.actions.find(
    (action) => action.id === 'ACT-PEN-PRESSURE',
  ).implementationStatus = 'implemented_unverified';
  const planned = changed.actions.find(
    (action) => action.id === 'ACT-TOOL-SELECT',
  );
  planned.implementationStatus = 'implemented_unverified';
  planned.caseReadiness = 'pending_integration_case';
  planned.assertionLinkage.status = 'planned_case';
  planned.assertionLinkage.assertions = [];
  // The actual Select action is covered; this controlled mutation isolates the
  // checker rule that a merely planned mapping cannot count as execution proof.
  const reportPath = save('playwright.json', {
    suites: [
      {
        specs: initial.executableCaseInventory.map((entry) => ({
          title: entry.title,
          tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
        })),
      },
    ],
  });
  const identityPath = save('identity.json', {
    commit: initial.commit,
    sourceHash: initial.sourceHash,
  });
  const { exitCode, report } = check([
    '--gate',
    `--registry=${save('registry.json', changed)}`,
    `--report=${reportPath}`,
    `--identity-report=${identityPath}`,
  ]);
  assert.equal(exitCode, 2);
  assert.equal(report.exactSourceReportAvailable, true);
  const results = new Map(
    report.latestActionResults.map((action) => [action.id, action.status]),
  );
  assert.equal(results.get('ACT-PEN-PRESSURE'), 'MISSING_BEHAVIOR_CASE');
  assert.equal(results.get('ACT-TOOL-SELECT'), 'PLANNED_CASE');
  assert.equal(results.get('ACT-STATE-INCOMPLETE'), 'MISSING_BEHAVIOR_CASE');
  assert.equal(results.get('ACT-LIGHT'), 'UNIMPLEMENTED');
  assert.equal(results.get('ACT-WIDTH'), 'PASSED_AVAILABLE_SCOPE');
});

test('stale identity and failed initial attempts cannot be counted as a passing action', (t) => {
  const save = fixture(t);
  const initial = check().report;
  const spec = {
    title: 'PROD-B01 baseline',
    tests: [
      {
        status: 'expected',
        results: [{ status: 'failed' }, { status: 'passed' }],
      },
    ],
  };
  const reportPath = save('playwright.json', { suites: [{ specs: [spec] }] });
  const identityPath = save('identity.json', {
    commit: initial.commit,
    sourceHash: initial.sourceHash,
  });
  const result = check([
    `--report=${reportPath}`,
    `--identity-report=${identityPath}`,
  ]).report;
  assert.notEqual(
    result.latestActionResults.find((action) => action.id === 'ACT-WIDTH')
      .status,
    'PASSED_AVAILABLE_SCOPE',
  );
  const stalePath = save('stale.json', {
    commit: initial.commit,
    sourceHash: 'stale-source',
  });
  const stale = check([
    `--report=${reportPath}`,
    `--identity-report=${stalePath}`,
  ]).report;
  assert.equal(stale.exactSourceReportAvailable, false);
  assert.equal(
    stale.latestActionResults.find((action) => action.id === 'ACT-WIDTH')
      .testResults[0].status,
    'STALE',
  );
});
