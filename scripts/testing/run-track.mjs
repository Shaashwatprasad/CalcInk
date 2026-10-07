import { inspectReport } from './report-contract.mjs';
import {
  browserCaseInventory,
  deterministicCaseInventory,
  validateDeterministicInventory,
  canonicalCaseInventory,
} from './case-inventory.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';

const track = process.argv[2] ?? 'baseline';
if (!['baseline', 'ml', 'product', 'release'].includes(track))
  throw new Error('Unknown tester track');
const includeRequired =
  track === 'release' || process.env.CALCINK_PRODUCT_REQUIRED === '1';
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const stamp = new Date().toISOString().replaceAll(':', '-');
const output = resolve(
  process.env.CALCINK_REPORT_DIR ?? `test-results/tracks/${stamp}-${track}`,
);
mkdirSync(resolve(output, '..'), { recursive: true });
mkdirSync(output); // A retry gets a new directory; never overwrite an earlier attempt.
const sourceHash = sourceIdentity();
const model = JSON.parse(readFileSync('public/models/manifest.json', 'utf8'));
const steps = [];
function run(id, args, kind, expectedTestIds) {
  // Playwright cleans outputDir at startup: keep it inside this step, away from
  // sibling logs/reports and previous attempts in test-results/tracks.
  if (kind === 'playwright')
    args = [...args, `--output=${resolve(output, `${id}-artifacts`)}`];
  process.stdout.write(`\n${id}: npm ${args.join(' ')}\n`);
  const start = Date.now();
  const result = spawnSync('npm', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      CALCINK_PRODUCT_REQUIRED: includeRequired ? '1' : '0',
      PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(output, `${id}.json`),
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(
    resolve(output, `${id}.log`),
    (result.stdout ?? '') +
      (result.stderr ?? '') +
      (result.error?.message ?? ''),
  );
  process.stdout.write((result.stdout ?? '').slice(-6000));
  process.stderr.write((result.stderr ?? '').slice(-2000));
  let counts;
  let reportError;
  let selectedTestIds = [];
  const json = resolve(output, `${id}.json`);
  if (existsSync(json)) {
    let data;
    try {
      data = JSON.parse(readFileSync(json, 'utf8'));
    } catch {
      reportError = 'Invalid JSON report';
      data = {};
    }
    if (kind && !reportError) {
      try {
        ({ counts, selectedTestIds, reportError } = inspectReport(
          data,
          kind,
          expectedTestIds,
        ));
        if (kind === 'vitest')
          reportError ??= validateDeterministicInventory(
            data,
            deterministicCaseInventory([
              'tests/unit',
              'tests/ml',
              ...(existsSync('tests/integration') ? ['tests/integration'] : []),
            ]),
          );
      } catch {
        reportError = 'Malformed machine-readable report';
      }
    }
  } else if (kind)
    reportError = 'Required machine-readable test report is missing';
  steps.push({
    id,
    command: ['npm', ...args],
    exitCode: result.status ?? -1,
    elapsedMs: Date.now() - start,
    counts,
    reportError,
    selectedTestIds,
    expectedTestIds,
    log: `${id}.log`,
    report: existsSync(json) ? `${id}.json` : undefined,
  });
}
if (track === 'baseline' || track === 'release') {
  for (const name of ['typecheck', 'lint', 'format:check'])
    run(name.replace(':', '-'), ['run', name]);
}
if (track !== 'product')
  run(
    'deterministic',
    [
      'test',
      '--',
      '--reporter=json',
      `--outputFile=${resolve(output, 'deterministic.json')}`,
    ],
    'vitest',
  );
if (
  track === 'baseline' ||
  track === 'release' ||
  track === 'product' ||
  track === 'ml'
) {
  if (process.env.CALCINK_VERIFIED_BUILD)
    run('production-build', [
      'exec',
      '--',
      'node',
      'scripts/testing/verified-build.mjs',
      'verify',
      process.env.CALCINK_VERIFIED_BUILD,
    ]);
  else run('production-build', ['run', 'build']);
  run(
    'real-model-browser',
    ['run', 'test:e2e', '--', '--reporter=json'],
    'playwright',
    browserCaseInventory('tests/e2e', true),
  );
}
if (track === 'product' || track === 'release')
  run(
    'product-browser',
    [
      'exec',
      '--',
      'playwright',
      'test',
      '--config=playwright.product.config.ts',
      '--reporter=json',
    ],
    'playwright',
    browserCaseInventory('tests/product', includeRequired),
  );
if (track === 'ml' || track === 'release')
  run(
    'canonical-browser',
    [
      'exec',
      '--',
      'node',
      'scripts/benchmark/corpus/preprocess-browser.mjs',
      resolve(output, 'canonical-browser.json'),
    ],
    'probe',
    canonicalCaseInventory('scripts/benchmark/corpus/browser-probe.ts'),
  );
run('registry-contract', [
  'exec',
  '--',
  'node',
  '--test',
  'tests/registry/check-registry.test.mjs',
]);
writeFileSync(
  resolve(output, 'identity.json'),
  JSON.stringify({ commit, sourceHash }),
);
const registryArgs = [
  'exec',
  '--',
  'node',
  'tests/registry/check-registry.mjs',
  `--json=${resolve(output, 'feature-traceability.json')}`,
];
if (existsSync(resolve(output, 'product-browser.json')))
  registryArgs.push(
    `--report=${resolve(output, 'product-browser.json')}`,
    `--identity-report=${resolve(output, 'identity.json')}`,
  );
if (track === 'release') registryArgs.push('--gate');
run('feature-traceability', registryArgs);
let traceability;
try {
  traceability = JSON.parse(
    readFileSync(resolve(output, 'feature-traceability.json'), 'utf8'),
  );
} catch {
  steps.at(-1).reportError =
    'Required feature traceability report missing or malformed';
}
const blockers = [
  {
    id: 'real-handwriting-quality',
    reason:
      'No frozen writer-disjoint labelled human corpus supplied; deterministic replay is not handwriting accuracy.',
  },
  {
    id: 'physical-input-devices',
    reason:
      'Physical stylus/touch and slower-device measurements require available hardware.',
  },
];
const filteredRequiredCases =
  includeRequired && (track === 'product' || track === 'release')
    ? []
    : (traceability?.executableCaseInventory ?? [])
        .filter((entry) => entry.required)
        .map((entry) => ({
          id: entry.id,
          reason:
            'Later-phase V2 acceptance case explicitly excluded from available baseline scope; mandatory at release.',
        }));
if (traceability?.status !== 'PASS')
  blockers.push({
    id: 'feature-completeness',
    reason:
      'Required actions/features remain unimplemented or lack passing current-source evidence; see feature-traceability.json.',
  });
const diagnosticCases = steps.flatMap((step) =>
  step.selectedTestIds.filter((id) => /ML-DEF-|PROD-D03/u.test(id)),
);
const finalSourceHash = sourceIdentity();
const sourceChanged = sourceHash !== finalSourceHash;
const failed =
  sourceChanged ||
  steps.some(
    (s) =>
      s.exitCode !== 0 ||
      s.reportError ||
      s.counts?.failed > 0 ||
      s.counts?.flaky > 0 ||
      s.counts?.skipped > 0,
  );
const report = {
  schemaVersion: 1,
  track,
  createdAt: new Date().toISOString(),
  commit,
  sourceHash,
  finalSourceHash,
  sourceChanged,
  modelHash: model.onnx.sha256,
  preprocessingVersion: model.preprocessingVersion,
  environment: {
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    architecture: os.arch(),
    browserExecutable:
      process.env.CALCINK_BROWSER_EXECUTABLE ?? 'pinned Playwright Chromium',
    cpu: os.cpus()[0]?.model,
    memoryBytes: os.totalmem(),
  },
  seed: 0,
  steps,
  diagnosticCases,
  diagnosticPolicy:
    'Defect observations and layout discovery are execution evidence only, never passing requirement acceptance or handwriting accuracy.',
  filteredRequiredCases,
  coverage: traceability?.coverage,
  traceability: 'feature-traceability.json',
  counts: {
    executedPassed: steps.reduce(
      (sum, step) => sum + (step.counts?.passed ?? 0),
      0,
    ),
    failed: steps.reduce((sum, step) => sum + (step.counts?.failed ?? 0), 0),
    skipped: steps.reduce((sum, step) => sum + (step.counts?.skipped ?? 0), 0),
    blockedRequiredCases: filteredRequiredCases.length,
    diagnosticCases: diagnosticCases.length,
  },
  blockers,
  status: failed
    ? 'FAIL'
    : track === 'release'
      ? 'BLOCKED_WITH_EVIDENCE'
      : 'PASS',
  scope:
    'Available executable checks only; this report does not accept a complete V2 phase or claim human accuracy.',
};
writeFileSync(
  resolve(output, 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
writeFileSync(
  resolve(output, 'summary.md'),
  `# ${track} tester report\n\nCommit: \`${commit}\`; source SHA-256: \`${sourceHash}\`.\n\nResult: **${report.status}**.\n\n${steps.map((s) => `- ${s.id}: exit ${s.exitCode}${s.counts ? `; ${JSON.stringify(s.counts)}` : ''}`).join('\n')}\n\nPending external evidence:\n\n${blockers.map((b) => `- ${b.id}: ${b.reason}`).join('\n')}\n`,
);
process.stdout.write(`\nReport: ${output}/report.json\n`);
process.exitCode = failed ? 1 : track === 'release' ? 2 : 0;
