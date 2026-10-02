import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { cpus, platform, release, totalmem, arch } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const startedAt = new Date().toISOString();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const branch = execFileSync('git', ['branch', '--show-current'], {
  encoding: 'utf8',
}).trim();
const nodeBuild = await build({
  entryPoints: ['benchmark/node.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { nodeBenchmark } = await import(
  `data:text/javascript;base64,${Buffer.from(nodeBuild.outputFiles[0].text).toString('base64')}`
);
console.log('Measuring Node store, geometry, serialization and grouping...');
const node = nodeBenchmark();
const browserBuild = await build({
  entryPoints: ['benchmark/browser.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
});
console.log('Measuring actual Chromium Canvas2D replay and preprocessing...');
const instance = await chromium.launch({
  headless: true,
  executablePath: process.env.CALCINK_BROWSER_EXECUTABLE,
});
let browser;
let browserVersion;
try {
  browserVersion = instance.version();
  const page = await instance.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.addScriptTag({ content: browserBuild.outputFiles[0].text });
  browser = await page.evaluate(() => globalThis.runCalcInkBenchmark());
} finally {
  await instance.close();
}
const report = {
  schemaVersion: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceCommit,
  branch,
  sourceState:
    'Benchmark imports current working-tree source; sourceCommit is the base commit, not a claim that uncommitted code is included in that commit.',
  fixture: {
    kind: 'synthetic-machine-generated',
    pointsPerStroke: 16,
    columns: 40,
    columnSpacing: 30,
    rowSpacing: 48,
    maskedFraction: 0.04,
  },
  environment: {
    cpuModel: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    memoryBytes: totalmem(),
    platform: platform(),
    osRelease: release(),
    architecture: arch(),
    nodeVersion: process.version,
    browserVersion,
    headless: true,
    cpuThrottling: 'none',
    concurrentWork:
      'Other implementation/build tasks may have run concurrently; results are local observations, not isolated hardware certification.',
  },
  methodology: {
    warmupsPerOperation: 1,
    nodeRepetitions: 7,
    browserRepetitions: 5,
    p95: 'nearest rank; with 5/7 samples p95 equals maximum',
    addStroke:
      'One two-point stroke appended to an existing document. Store preparation excluded.',
    undoRedo: 'One undo followed by one redo; prepared append excluded.',
    hitTesting: 'Full-document swept-radius segment hit query.',
    replay:
      'Full replay without viewport culling into 1280x900 OffscreenCanvas. Ink beyond viewport is clipped. CPU command submission measured; GPU/display completion excluded.',
    preprocessing:
      'All synthetic symbol groups rasterized to real 50x50 RGB tensors, with persisted masks; no ONNX inference.',
    memory:
      'No heap leak, peak-memory or long-task measurements were performed.',
  },
  node,
  browser,
};
const output =
  process.argv[2] ?? 'benchmark-data/local-synthetic-2026-10-02.json';
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Saved actual measurements: ${output}`);
for (const row of node)
  console.log(
    `${row.strokeCount}: append p50 ${row.measurements.addStroke.p50Ms.toFixed(2)}ms; grouping p50 ${row.measurements.equationGrouping.p50Ms.toFixed(2)}ms`,
  );
for (const row of browser.sizes)
  console.log(
    `${row.strokeCount}: masked replay p50 ${row.measurements.replayMasked.p50Ms.toFixed(2)}ms; preprocess p50 ${row.measurements.preprocessing.p50Ms.toFixed(2)}ms`,
  );
