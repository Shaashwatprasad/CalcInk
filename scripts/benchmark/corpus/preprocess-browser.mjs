import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, platform, release } from 'node:os';
const probe = await build({
  entryPoints: ['scripts/benchmark/corpus/browser-probe.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CALCINK_BROWSER_EXECUTABLE,
});
let result;
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.addScriptTag({ content: probe.outputFiles[0].text });
  result = await page.evaluate(() => globalThis.runCalcInkPreprocessingProbe());
  const model = await readFile('public/models/symbols.onnx');
  const report = {
    schemaVersion: 1,
    track: 'ML_IMPLEMENTATION_TESTER',
    createdAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    sourceHash: createHash('sha256')
      .update(probe.outputFiles[0].text)
      .digest('hex'),
    modelSha256: createHash('sha256').update(model).digest('hex'),
    command: 'node scripts/benchmark/corpus/preprocess-browser.mjs OUTPUT',
    environment: {
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
      os: platform(),
      osRelease: release(),
      browser: browser.version(),
      node: process.version,
      dpr: 1,
      pointer: 'synthetic vectors',
      concurrentWork: 'not isolated',
    },
    fixtureKind: 'deterministic-synthetic-regression',
    status: Object.values(result.checks).every(Boolean) ? 'PASS' : 'FAIL',
    passed: Object.values(result.checks).filter(Boolean).length,
    failed: Object.values(result.checks).filter((value) => !value).length,
    ...result,
  };
  if (process.argv[2])
    await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
    });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
} finally {
  await browser.close();
}
