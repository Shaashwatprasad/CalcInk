/** Real-only frozen corpus runner. Production worker + actual browser raster + reference WASM. */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import * as ort from 'onnxruntime-web/wasm';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, release, platform } from 'node:os';
const [lockPath, outputPath] = process.argv.slice(2);
if (!lockPath || !outputPath)
  throw new Error(
    'Usage: node benchmark/corpus/replay.mjs FROZEN_CORPUS NEW_REPORT (requires npm run build)',
  );
async function moduleFrom(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
}
const { validateCorpus, canonicalJson, corpusCounts, BASELINE_LABELS } =
  await moduleFrom('benchmark/corpus/schema.ts');
const { classifierMetrics, groupingMetrics, expressionMetrics } =
  await moduleFrom('benchmark/corpus/metrics.ts');
const { evaluateExpression } = await moduleFrom('src/math/index.ts');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const corpus = validateCorpus(lock.corpus);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (
  lock.format !== 'calcink-frozen-corpus' ||
  lock.version !== 1 ||
  lock.corpusSha256 !== digest(canonicalJson(corpus))
)
  throw new Error('Frozen corpus verification failed');
const samples = corpus.samples.filter(
  (sample) => sample.split === 'evaluation',
);
if (!samples.length)
  throw new Error('BLOCKED_WITH_EVIDENCE: no frozen real evaluation samples');
const manifest = JSON.parse(
  await readFile('dist/models/manifest.json', 'utf8'),
);
const model = await readFile('dist/models/symbols.onnx');
if (
  digest(model) !== manifest.onnx.sha256 ||
  model.length !== manifest.onnx.bytes
)
  throw new Error('Deployed model integrity failure');
const workerFile = (await readdir('dist/assets')).find((file) =>
  /^recognition\.worker-.*\.js$/.test(file),
);
if (!workerFile)
  throw new Error('Production recognition worker missing; build first');
const browserBundle = await build({
  entryPoints: ['benchmark/corpus/browser-probe.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
});
const directory = resolve('dist');
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/__corpus.html') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Isolated corpus replay</title>');
    return;
  }
  const path = resolve(directory, `.${decodeURIComponent(pathname)}`);
  if (!path.startsWith(directory + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(path);
    response.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
        '.onnx': 'application/octet-stream',
      }[extname(path)] ?? 'application/octet-stream',
    );
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser, reference;
const observations = [],
  expressions = [],
  predictions = [],
  groups = [];
let browserVersion;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CALCINK_BROWSER_EXECUTABLE,
  });
  ort.env.wasm.numThreads = 1;
  reference = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
  });
  browserVersion = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.goto(`${origin}/__corpus.html`);
  await page.addScriptTag({ content: browserBundle.outputFiles[0].text });
  for (const sample of samples) {
    const result = await page.evaluate(
      async ({ sample, workerFile, manifest }) => {
        const worker = new Worker(`/assets/${workerFile}`, { type: 'module' });
        const exchange = (request, type) =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error('Real-worker replay timeout'));
            }, 60000);
            const cleanup = () => {
              clearTimeout(timeout);
              worker.removeEventListener('message', receive);
              worker.removeEventListener('error', failed);
            };
            const failed = (event) => {
              cleanup();
              reject(new Error(event.message));
            };
            const receive = (event) => {
              if (event.data.type === 'ERROR') {
                cleanup();
                reject(new Error(event.data.error));
              } else if (event.data.type === type) {
                cleanup();
                resolve(event.data);
              }
            };
            worker.addEventListener('message', receive);
            worker.addEventListener('error', failed);
            worker.postMessage(request);
          });
        const bounds = (strokes) => ({
          minX: Math.min(...strokes.map((stroke) => stroke.bounds.minX)),
          minY: Math.min(...strokes.map((stroke) => stroke.bounds.minY)),
          maxX: Math.max(...strokes.map((stroke) => stroke.bounds.maxX)),
          maxY: Math.max(...strokes.map((stroke) => stroke.bounds.maxY)),
        });
        try {
          const ready = await exchange({ type: 'INIT' }, 'READY');
          if (
            ready.modelVersion !== manifest.modelVersion ||
            ready.preprocessingVersion !== manifest.preprocessingVersion ||
            ready.backend !== 'wasm'
          )
            throw new Error('Worker READY identity mismatch');
          const grouping = await exchange(
            { type: 'GROUP', document: sample.document },
            'GROUPS',
          );
          const endToEnd = [];
          for (const group of grouping.groups) {
            const start = performance.now();
            const job = {
              type: 'RECOGNIZE',
              protocolVersion: 1,
              documentId: sample.document.documentId,
              generation: sample.document.generation,
              equationId: group.id,
              equationRevision: group.revision,
              requestId: crypto.randomUUID(),
              modelVersion: manifest.modelVersion,
              preprocessingVersion: manifest.preprocessingVersion,
              strokes: group.strokes,
              erasures: group.erasures,
              bounds: group.bounds,
            };
            const recognized = await exchange(job, 'RESULT');
            endToEnd.push({
              strokeIds: group.strokes.map((stroke) => stroke.id),
              recognized,
              workerRoundtripMs: performance.now() - start,
            });
          }
          const groundTruth = sample.symbols.map((symbol) => {
            const strokes = sample.document.strokes.filter((stroke) =>
              symbol.strokeIds.includes(stroke.id),
            );
            const expression = sample.expressions.find((expression) =>
              symbol.strokeIds.every((id) => expression.strokeIds.includes(id)),
            );
            const context = expression
              ? sample.document.strokes.filter((stroke) =>
                  expression.strokeIds.includes(stroke.id),
                )
              : strokes;
            return {
              id: symbol.id,
              label: symbol.label,
              ...globalThis.rasterizeCalcInkGroundTruth(
                strokes,
                sample.document.erasures,
                bounds(context),
              ),
            };
          });
          return { endToEnd, groundTruth };
        } finally {
          worker.terminate();
        }
      },
      { sample, workerFile, manifest },
    );
    for (const truth of result.groundTruth) {
      if (!BASELINE_LABELS.includes(truth.label)) {
        predictions.push({
          sampleId: sample.id,
          symbolId: truth.id,
          expected: truth.label,
          status: 'unsupported-baseline-class',
        });
        continue;
      }
      let topK = [];
      if (truth.visible) {
        const input = new ort.Tensor(
          'float32',
          new Float32Array(truth.data),
          manifest.input.shape,
        );
        let outputs;
        try {
          outputs = await reference.run({ [manifest.input.name]: input });
          const output = outputs[manifest.output.name];
          if (output.type !== 'float32' || output.dims.join(',') !== '1,16')
            throw new Error('Reference output contract failure');
          const values = Array.from(output.data);
          if (
            values.some(
              (value) => !Number.isFinite(value) || value < 0 || value > 1,
            ) ||
            Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.01
          )
            throw new Error('Invalid reference probabilities');
          topK = values
            .map((score, index) => ({
              label: manifest.output.canonicalLabels[index],
              score,
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
        } finally {
          input.dispose();
          if (outputs)
            Object.values(outputs).forEach((output) => output.dispose());
        }
      }
      observations.push({ expected: truth.label, topK });
      predictions.push({
        sampleId: sample.id,
        symbolId: truth.id,
        expected: truth.label,
        topK,
        runtime: 'reference ORT Web WASM with actual Chrome canonical raster',
      });
    }
    groups.push({
      sampleId: sample.id,
      ...groupingMetrics(
        sample.expressions.map((expression) => expression.strokeIds),
        result.endToEnd.map((group) => group.strokeIds),
      ),
    });
    for (const truth of sample.expressions) {
      const predicted = result.endToEnd.find(
        (group) =>
          canonicalJson([...group.strokeIds].sort()) ===
          canonicalJson([...truth.strokeIds].sort()),
      );
      const recognition = predicted?.recognized;
      const evaluation =
        recognition?.status === 'recognized' &&
        recognition.expression.endsWith('=')
          ? evaluateExpression(recognition.expression)
          : { status: 'incomplete' };
      const answer = evaluation.status === 'valid' ? evaluation.value : null;
      if (truth.ast && truth.expected.status === 'valid')
        expressions.push({
          expectedAst: truth.ast,
          predictedAst: null,
          expectedAnswer: truth.expected.value,
          predictedAnswer: answer,
          accepted: evaluation.status === 'valid',
          userCorrected: false,
        });
      predictions.push({
        sampleId: sample.id,
        expressionId: truth.id,
        expectedText: truth.text,
        expectedAst: truth.ast,
        expectedOutcome: truth.expected,
        recognition,
        evaluation,
        workerRoundtripMs: predicted?.workerRoundtripMs,
        astEvidence:
          'pending: baseline evaluator does not expose AST; null is not a successful exact match',
      });
    }
  }
  const report = {
    schemaVersion: 1,
    status: 'BLOCKED_WITH_EVIDENCE',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    bundleSha256: digest(browserBundle.outputFiles[0].text),
    productionWorkerSha256: digest(await readFile(`dist/assets/${workerFile}`)),
    createdAt: new Date().toISOString(),
    corpusSha256: lock.corpusSha256,
    counts: corpusCounts(corpus),
    modelSha256: manifest.onnx.sha256,
    modelVersion: manifest.modelVersion,
    preprocessingVersion: manifest.preprocessingVersion,
    command: 'node benchmark/corpus/replay.mjs FROZEN_CORPUS NEW_REPORT',
    environment: {
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
      os: platform(),
      osRelease: release(),
      browserVersion,
      node: process.version,
      dpr: 1,
      provider: 'wasm',
      ortVersion: '1.22.0',
      threads: 1,
    },
    classifier: classifierMetrics(observations, BASELINE_LABELS),
    equationGrouping: groups,
    expressions: expressionMetrics(expressions),
    predictions,
    limitations: [
      'Corpus provenance relies on annotator attestations.',
      'Wilson intervals ignore writer clustering; small writer counts limit generalization.',
      'AST extraction and variable-sequence outcome metrics pending baseline architecture; no exact-match pass claimed.',
      'No 100-repetition timing benchmark, debounce/visible-feedback latency, physical input, secondary-device or memory evidence.',
      'Ground-truth classifier reference and production-worker end-to-end outputs are separate. No cross-provider numeric parity gate implemented here.',
    ],
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  console.log(
    `Measured real corpus predictions written to ${outputPath}; complete ML acceptance remains blocked as recorded.`,
  );
  process.exitCode = 2;
} finally {
  try {
    await reference?.release();
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((done) => server.close(done));
    }
  }
}
