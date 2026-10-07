import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const argumentsList = process.argv.slice(2);
const argument = (name) =>
  argumentsList
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const registryPath = resolve(
  argument('--registry') ?? 'tests/registry/feature-actions.json',
);
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const errors = [];
const requiredFields = [
  'id',
  'featureId',
  'requirementIds',
  'source',
  'uiLocation',
  'locator',
  'supported',
  'precondition',
  'trigger',
  'expectedVisibleOutcome',
  'expectedEffects',
  'cancellationErrorBehavior',
  'dependentWorkflow',
  'testIds',
  'implementationStatus',
  'latestResult',
  'caseReadiness',
  'assertionLinkage',
];
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const testFiles = files('tests/product').filter((path) =>
  path.endsWith('.spec.ts'),
);
const cases = new Map();
const caseSources = new Map();
for (const path of testFiles) {
  const source = readFileSync(path, 'utf8');
  const matches = [
    ...source.matchAll(/test\(\s*['"](PROD-[A-Z]\d+)\s([^'"]+)['"]/gu),
  ];
  for (const [index, match] of matches.entries()) {
    if (cases.has(match[1]))
      errors.push(`Duplicate executable test ID ${match[1]}`);
    cases.set(match[1], {
      file: relative(process.cwd(), path),
      title: `${match[1]} ${match[2]}`,
      required: match[2].includes('@v2-required'),
    });
    caseSources.set(
      match[1],
      source.slice(match.index, matches[index + 1]?.index),
    );
  }
}
const unique = (values, name) => {
  if (new Set(values).size !== values.length)
    errors.push(`Duplicate ${name} IDs`);
};
unique(
  registry.features.map((feature) => feature.id),
  'feature',
);
unique(
  registry.actions.map((action) => action.id),
  'action',
);
unique(
  registry.requirements.map((requirement) => requirement.id),
  'requirement',
);
if (registry.schemaVersion !== 1)
  errors.push('Unsupported registry schemaVersion');
for (let number = 1; number <= 12; number++) {
  const id = `R${String(number).padStart(2, '0')}`;
  if (!registry.requirements.some((requirement) => requirement.id === id))
    errors.push(`Missing original PS requirement ${id}`);
  if (!registry.features.some((feature) => feature.requirementIds.includes(id)))
    errors.push(`Unmapped original PS requirement ${id}`);
}
for (const action of registry.actions) {
  for (const field of requiredFields)
    if (action[field] === undefined || action[field] === '')
      errors.push(`${action.id}: missing ${field}`);
  if (!registry.features.some((feature) => feature.id === action.featureId))
    errors.push(`${action.id}: unknown feature ${action.featureId}`);
  if (!action.testIds.length)
    errors.push(`${action.id}: no declared acceptance case`);
  for (const id of action.testIds)
    if (!cases.has(id))
      errors.push(`${action.id}: absent executable test ${id}`);
  for (const field of [
    'document',
    'tool',
    'viewport',
    'history',
    'persistence',
  ])
    if (!action.expectedEffects[field])
      errors.push(`${action.id}: no expected ${field} effect`);
  for (const field of ['layouts', 'themes', 'input'])
    if (!action.supported[field]?.length)
      errors.push(`${action.id}: empty supported ${field}`);
  const readinessStatuses = {
    implemented_case: 'meaningful_existing_case',
    pending_integration_case: 'planned_case',
    missing_behavior_case: 'missing_action_assertion',
  };
  if (!(action.caseReadiness in readinessStatuses))
    errors.push(`${action.id}: invalid caseReadiness`);
  if (
    action.assertionLinkage?.status !== readinessStatuses[action.caseReadiness]
  )
    errors.push(`${action.id}: readiness/assertion linkage disagreement`);
  for (const id of action.assertionLinkage?.testIds ?? [])
    if (!action.testIds.includes(id) || !cases.has(id))
      errors.push(
        `${action.id}: assertion linkage references undeclared case ${id}`,
      );
  if (action.caseReadiness === 'implemented_case') {
    const assertions = action.assertionLinkage?.assertions ?? [];
    if (!assertions.length)
      errors.push(
        `${action.id}: meaningful mapping requires explicit assertions`,
      );
    for (const assertion of assertions) {
      const normalize = (value) => value?.replace(/\s+/gu, ' ').trim() ?? '';
      const body = normalize(caseSources.get(assertion.testId));
      if (
        !action.assertionLinkage.testIds.includes(assertion.testId) ||
        !assertion.claim ||
        !assertion.triggerAnchor ||
        !assertion.assertionAnchor ||
        !assertion.assertionAnchor.includes('expect') ||
        !body.includes(normalize(assertion.triggerAnchor)) ||
        !body.includes(normalize(assertion.assertionAnchor))
      )
        errors.push(
          `${action.id}: missing source assertion for ${assertion.testId}`,
        );
    }
  }
}
for (const feature of registry.features) {
  for (const id of feature.testIds)
    if (!cases.has(id))
      errors.push(`${feature.id}: absent executable test ${id}`);
}

// Identity follows the test track runner: include uncommitted/new source,
// exclude generated evidence/review/progress files. An uncommitted hash is never a commit.
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const paths = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path && path !== 'docs/PROGRESS.md' && existsSync(path))
  .sort();
const source = createHash('sha256');
for (const path of paths) {
  source.update(path);
  source.update('\0');
  source.update(readFileSync(path));
}
const sourceHash = source.digest('hex');
const outcomes = new Map();
const playwrightPath = argument('--report');
const identityPath = argument('--identity-report');
let currentReport = false;
let reportIdentity;
if (playwrightPath) {
  if (!identityPath)
    errors.push(
      '--report requires --identity-report with its actual commit/sourceHash',
    );
  else {
    reportIdentity = JSON.parse(readFileSync(identityPath, 'utf8'));
    currentReport =
      reportIdentity.commit === commit &&
      reportIdentity.sourceHash === sourceHash;
  }
  const report = JSON.parse(readFileSync(playwrightPath, 'utf8'));
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const id = /\b(PROD-[A-Z]\d+)\b/u.exec(spec.title)?.[1];
      if (!id) continue;
      const tests = spec.tests ?? [];
      const statuses = tests.flatMap((entry) =>
        (entry.results ?? []).map((result) => result.status),
      );
      const passed =
        currentReport &&
        tests.length > 0 &&
        tests.every((entry) => entry.status === 'expected') &&
        statuses.length > 0 &&
        statuses.every((status) => status === 'passed');
      outcomes.set(id, {
        status: passed
          ? 'PASSED'
          : currentReport
            ? 'FAILED_OR_SKIPPED'
            : 'STALE',
        attempts: statuses,
      });
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  visit(report);
}
const actionResults = registry.actions.map((action) => {
  const testResults = action.testIds.map((id) => ({
    id,
    ...(outcomes.get(id) ?? { status: 'PENDING', attempts: [] }),
  }));
  return {
    id: action.id,
    featureId: action.featureId,
    implementationStatus: action.implementationStatus,
    testResults,
    // An unavailable action cannot be passed by a related baseline test.
    status:
      action.implementationStatus === 'unimplemented'
        ? 'UNIMPLEMENTED'
        : errors.some((error) => error.startsWith(`${action.id}:`))
          ? 'INVALID_CASE_LINK'
          : action.caseReadiness === 'missing_behavior_case'
            ? 'MISSING_BEHAVIOR_CASE'
            : action.caseReadiness !== 'implemented_case'
              ? 'PLANNED_CASE'
              : testResults.length > 0 &&
                  testResults.every((result) => result.status === 'PASSED')
                ? 'PASSED_AVAILABLE_SCOPE'
                : 'PENDING_OR_FAILED',
    commit: currentReport ? commit : null,
    sourceHash: currentReport ? sourceHash : null,
    evidence: currentReport ? [playwrightPath, identityPath] : [],
  };
});
const requiredFeatures = registry.features.filter(
  (feature) => feature.scope === 'required',
);
const missingBehaviorCases = registry.actions
  .filter((action) => action.caseReadiness === 'missing_behavior_case')
  .map((action) => action.id);
const meaningfulMappedIds = registry.actions
  .filter(
    (action) =>
      action.caseReadiness === 'implemented_case' &&
      action.assertionLinkage?.status === 'meaningful_existing_case' &&
      action.assertionLinkage.assertions?.length > 0 &&
      !errors.some((error) => error.startsWith(`${action.id}:`)),
  )
  .map((action) => action.id);
const plannedIds = registry.actions
  .filter((action) => action.caseReadiness === 'pending_integration_case')
  .map((action) => action.id);
const uncoveredIds = registry.actions
  .filter((action) => !meaningfulMappedIds.includes(action.id))
  .map((action) => action.id);
const declaredLinkIds = registry.actions
  .filter((action) => action.testIds.length > 0)
  .map((action) => action.id);
const unmappedFeatures = requiredFeatures
  .filter((feature) => !feature.testIds.length)
  .map((feature) => feature.id);
const incompleteFeatures = requiredFeatures
  .filter((feature) => feature.v2Status !== 'implemented_unverified')
  .map((feature) => feature.id);
const pendingActions = actionResults
  .filter((action) => action.status !== 'PASSED_AVAILABLE_SCOPE')
  .map((action) => action.id);
const coverage = {
  declaredRequirements: registry.requirements.length,
  features: {
    total: registry.features.length,
    required: requiredFeatures.length,
    optional: registry.features.length - requiredFeatures.length,
    unmapped: unmappedFeatures,
    incomplete: incompleteFeatures,
  },
  actions: {
    total: registry.actions.length,
    exposedInBaseline: registry.actions.filter(
      (action) => action.exposedInBaseline,
    ).length,
    denominator: registry.actions.length,
    declaredLinks: declaredLinkIds.length,
    declaredLinkIds,
    meaningfulMapped: meaningfulMappedIds.length,
    meaningfulMappedIds,
    uncovered: uncoveredIds.length,
    uncoveredIds,
    planned: plannedIds.length,
    plannedIds,
    missingBehaviorCases,
    unimplemented: registry.actions
      .filter((action) => action.implementationStatus === 'unimplemented')
      .map((action) => action.id),
    pendingOrFailed: pendingActions,
  },
  executableCases: {
    total: cases.size,
    required: [...cases.values()].filter((entry) => entry.required).length,
  },
};
const blocked =
  unmappedFeatures.length > 0 ||
  incompleteFeatures.length > 0 ||
  pendingActions.length > 0 ||
  missingBehaviorCases.length > 0 ||
  uncoveredIds.length > 0 ||
  !currentReport;
const output = {
  schemaVersion: 1,
  registry: relative(process.cwd(), registryPath),
  commit,
  sourceHash,
  registryHash: createHash('sha256')
    .update(readFileSync(registryPath))
    .digest('hex'),
  status: errors.length
    ? 'INVALID_REGISTRY'
    : blocked
      ? 'BLOCKED_WITH_EVIDENCE'
      : 'PASS',
  schemaAndMappingValid: errors.length === 0,
  exactSourceReportAvailable: currentReport,
  errors,
  coverage,
  latestActionResults: actionResults,
  executableCaseInventory: [...cases.entries()].map(([id, data]) => ({
    id,
    ...data,
  })),
  filteredRequiredCaseIds: [...cases.entries()]
    .filter(([id, data]) => data.required && !outcomes.has(id))
    .map(([id]) => id),
  limitation:
    'Declared test linkage is traceability, not proof that every assertion is meaningful or that a workflow passed. Independent review and full current-source execution remain mandatory.',
};
if (argument('--json'))
  writeFileSync(argument('--json'), JSON.stringify(output, null, 2) + '\n');
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
process.stderr.write(
  `Registry: ${output.status}; ${registry.actions.length} actions; ${coverage.actions.unimplemented.length} unimplemented; ${unmappedFeatures.length} unmapped required features; ${errors.length} schema errors.\n`,
);
process.exitCode = errors.length
  ? 1
  : argumentsList.includes('--gate') && blocked
    ? 2
    : 0;
