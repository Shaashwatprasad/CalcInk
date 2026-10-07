import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// node scripts/benchmark/evaluation.mjs [baseline-ref] [output-json]
// Recognition-result fixtures measure math/projection work, excluding inference.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const baselineRef =
  process.argv[2] ??
  process.env.CALCINK_BASELINE_REF ??
  '3a598928019d48737a6978cb602bf6ec532af8ab';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'calcink-evaluation-'));

function result(index, revision = 1) {
  const expression = `${index}+${revision}=`;
  const bounds = {
    minX: 0,
    maxX: 100,
    minY: index * 50,
    maxY: index * 50 + 24,
  };
  return {
    protocolVersion: 1,
    documentId: 'doc',
    generation: 0,
    equationId: `line-${index}`,
    equationRevision: revision,
    requestId: `${index}-${revision}`,
    modelVersion: 'benchmark-fixture',
    preprocessingVersion: 'benchmark-fixture',
    type: 'RESULT',
    status: 'recognized',
    expression,
    bounds,
    symbols: [...expression].map((label, position) => ({
      label,
      score: 1,
      topK: [{ label, score: 1 }],
      bounds: { ...bounds, minX: position * 10, maxX: position * 10 + 8 },
    })),
    backend: 'wasm',
    timings: { preprocessingMs: 0, inferenceMs: 0, totalMs: 0 },
  };
}

function run(module) {
  const store = new module.ProjectionStore();
  store.reset('doc', 0);
  const rows = Array.from({ length: 200 }, (_, index) => result(index));
  const start = performance.now();
  for (const row of rows) {
    store.expect(row);
    store.accept(row);
  }
  const initializationMs = performance.now() - start;
  const initializationCounts = { ...(module.benchCounts ?? store.metrics) };
  if (module.benchCounts) {
    module.benchCounts.parseCount = 0;
    module.benchCounts.evaluationCount = 0;
  } else store.resetMetrics();
  const original = store.all();
  const edit = result(100, 2);
  const editStart = performance.now();
  store.expect(edit);
  store.accept(edit);
  return {
    initializationCounts,
    editCounts: { ...(module.benchCounts ?? store.metrics) },
    unchangedReferenceCount: original.filter(
      (row) =>
        row.equationId !== 'line-100' && store.get(row.equationId) === row,
    ).length,
    initializationMs,
    editMs: performance.now() - editStart,
  };
}

try {
  const beforeDir = path.join(temporary, 'before');
  await mkdir(path.join(beforeDir, 'math'), { recursive: true });
  await mkdir(path.join(beforeDir, 'projection'), { recursive: true });
  const original = (file) =>
    execFileSync('git', ['show', `${baselineRef}:${file}`], {
      cwd: root,
      encoding: 'utf8',
    });
  const parseSignature =
    'export function parseMath(text: string, variables = true): ParseOutcome {';
  const evaluationSignature = '): MathEvaluation {';
  let math = original('src/math/index.ts');
  if (!math.includes(parseSignature) || !math.includes(evaluationSignature))
    throw new Error(
      'Baseline math signatures changed; instrumentation needs updating.',
    );
  math =
    'export const benchCounts = { parseCount: 0, evaluationCount: 0 };\n' +
    math
      .replace(parseSignature, `${parseSignature} benchCounts.parseCount++;`)
      .replace(
        evaluationSignature,
        `${evaluationSignature} benchCounts.evaluationCount++;`,
      );
  await writeFile(path.join(beforeDir, 'math/index.ts'), math);
  await writeFile(
    path.join(beforeDir, 'projection/index.ts'),
    original('src/projection/index.ts'),
  );
  await writeFile(
    path.join(beforeDir, 'entry.ts'),
    "export {ProjectionStore} from './projection'; export {benchCounts} from './math';\n",
  );
  const beforeBundle = path.join(temporary, 'before.mjs');
  const afterBundle = path.join(temporary, 'after.mjs');
  await build({
    entryPoints: [path.join(beforeDir, 'entry.ts')],
    bundle: true,
    format: 'esm',
    outfile: beforeBundle,
  });
  await build({
    entryPoints: [path.join(root, 'src/projection/index.ts')],
    bundle: true,
    format: 'esm',
    outfile: afterBundle,
  });
  const before = await import(pathToFileURL(beforeBundle).href);
  const after = await import(pathToFileURL(afterBundle).href);
  const report = {
    workload:
      '200 independent cached recognition-result fixtures, expect+accept each; edit line-100 with revision 2',
    baseline: baselineRef,
    environment: {
      runtime: process.version,
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
    },
    before: run(before),
    after: run(after),
    limitation:
      'Node measurement of projection/parser/evaluator only; fixtures do not benchmark model inference, grouping, drawing or browser frames. Single-run times are observations, not performance guarantees.',
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (process.argv[3]) await writeFile(path.resolve(process.argv[3]), json);
  process.stdout.write(json);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
