/** Synthetic editing workload: real model jobs and transfers, no handwriting accuracy claim.
 * Run against npm run dev; source imports deliberately keep this diagnostic out of the product. */
import { chromium } from '@playwright/test';
import os from 'node:os';
import { writeFile } from 'node:fs/promises';
const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const output = process.argv[3];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CALCINK_BROWSER_EXECUTABLE
    ? { executablePath: process.env.CALCINK_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage();
  await page.route(`${base}/grouping-benchmark`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>CalcInk grouping benchmark</title>',
    }),
  );
  await page.goto(`${base}/grouping-benchmark`);
  const measurement = await page.evaluate(async () => {
    const { InkStore } = await import('/src/document/InkStore.ts');
    const { startRecognizer } = await import('/src/app/recognizer.ts');
    const { pointBounds, boundsIntersect } = await import(
      '/src/ink/geometry.ts'
    );
    const { groupEquations } = await import('/src/recognition/grouping.ts');
    const paths = [
      [
        [10, 0],
        [10, 50],
      ],
      [
        [55, 25],
        [85, 25],
      ],
      [
        [70, 10],
        [70, 40],
      ],
      [
        [125, 0],
        [125, 50],
      ],
      [
        [160, 19],
        [185, 19],
      ],
      [
        [160, 32],
        [185, 32],
      ],
    ];
    const strokes = Array.from({ length: 200 }, (_, row) =>
      paths.map((path, index) => {
        const points = path.map(([x, y], timestamp) => ({
          x,
          y: y + 100 + row * 60,
          timestamp,
        }));
        return {
          id: `row-${row}-${index}`,
          points,
          width: 2,
          color: '#000',
          bounds: pointBounds(points, 1),
        };
      }),
    ).flat();
    const store = new InkStore({
      format: 'calcink-document',
      version: 2,
      documentId: 'benchmark',
      generation: 0,
      revision: 0,
      strokes,
      erasures: [],
    });
    const oldGroups = groupEquations(store.getSnapshot());
    if (oldGroups.length !== 200)
      throw new Error(`Expected 200 rows, received ${oldGroups.length}`);
    const groupRequests = [],
      recognitionRequests = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...options) {
        if (message.type === 'GROUP')
          groupRequests.push({
            strokes: message.document.strokes.length,
            bytes: new TextEncoder().encode(JSON.stringify(message)).length,
          });
        if (message.type === 'RECOGNIZE')
          recognitionRequests.push(message.equationId);
        return super.postMessage(message, ...options);
      }
    };
    let state;
    const start = performance.now();
    const stop = startRecognizer(store, (value) => {
      state = value;
    });
    const until = async (predicate) => {
      const deadline = performance.now() + 120000;
      while (!predicate()) {
        if (state?.status === 'error') throw new Error(state.message);
        if (performance.now() > deadline)
          throw new Error('Benchmark timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    await until(
      () =>
        state?.status === 'ready' &&
        state.queued === 0 &&
        state.projections.length === 200,
    );
    const bootstrapMs = performance.now() - start;
    const originals = new Map(
      state.projections.map((projection) => [
        projection.equationId,
        projection,
      ]),
    );
    const bootstrapRecognitionJobs = recognitionRequests.length;
    const bootstrapGroup = groupRequests[0];
    let event;
    const unsubscribe = store.subscribe((value) => {
      event = value;
    });
    const editStart = performance.now();
    store.eraseRegion([{ x: 10, y: 100 + 100 * 60 + 25, timestamp: 3 }], 3);
    unsubscribe();
    const immediatelyPending = state.projections.filter(
      (p) => p.status === 'pending',
    ).length;
    await until(() => state?.status === 'ready' && state.queued === 0);
    const editMs = performance.now() - editStart;
    // Replay the former invalidation algorithm exactly over the identical rectangles.
    // These legacy counts are algorithmic, not a second deployed app measurement.
    const changed = new Set([
      ...event.changedStrokeIds,
      ...event.deletedStrokeIds,
    ]);
    const regions = [...event.oldBounds, ...event.newBounds];
    for (const group of oldGroups)
      if (group.strokes.some((s) => changed.has(s.id)))
        regions.push(group.bounds);
    const retired = new Set();
    for (const initial of regions) {
      let region = { ...initial },
        expanded = true;
      const absorbed = new Set();
      while (expanded) {
        expanded = false;
        for (const group of oldGroups) {
          if (absorbed.has(group.id)) continue;
          const height = Math.max(
            24,
            group.bounds.maxY - group.bounds.minY,
            region.maxY - region.minY,
          );
          if (
            !boundsIntersect(
              {
                ...group.bounds,
                minX: -Infinity,
                maxX: Infinity,
                minY: group.bounds.minY - height * 0.6,
                maxY: group.bounds.maxY + height * 0.6,
              },
              region,
            )
          )
            continue;
          absorbed.add(group.id);
          retired.add(group.id);
          expanded = true;
          region = {
            minX: Math.min(region.minX, group.bounds.minX),
            minY: Math.min(region.minY, group.bounds.minY),
            maxX: Math.max(region.maxX, group.bounds.maxX),
            maxY: Math.max(region.maxY, group.bounds.maxY),
          };
        }
      }
    }
    const unchanged = state.projections.filter(
      (projection) => projection === originals.get(projection.equationId),
    ).length;
    const data = {
      workload:
        '200 synthetic 1+1= rows at 60 document-unit spacing; partial erase in row100',
      browser: navigator.userAgent,
      documentEquations: oldGroups.length,
      bootstrap: {
        recognitionJobs: bootstrapRecognitionJobs,
        grouping: bootstrapGroup,
        elapsedMs: bootstrapMs,
      },
      legacyAlgorithm: {
        invalidatedEquations: retired.size,
        recognitionJobsAfterInvalidation: retired.size,
        groupingStrokeCount: strokes.length,
        groupingJsonBytes: new TextEncoder().encode(
          JSON.stringify({ type: 'GROUP', document: store.getSnapshot() }),
        ).length,
      },
      current: {
        immediatelyPending,
        recognitionJobsForEdit:
          recognitionRequests.length - bootstrapRecognitionJobs,
        grouping: groupRequests.at(-1),
        unchangedProjectionReferences: unchanged,
        finalEquationCount: state.projections.length,
        validAnswers: state.projections.filter((p) => p.answerText === '2')
          .length,
        elapsedMs: editMs,
      },
      limitation:
        'Synthetic geometry regression and one workload sample; legacy counts replay the former algorithm. Elapsed time includes debounce/model work and is not a universal latency or accuracy claim.',
    };
    stop();
    window.Worker = NativeWorker;
    if (
      data.current.recognitionJobsForEdit !== 1 ||
      unchanged !== 199 ||
      data.current.finalEquationCount !== 200
    )
      throw new Error(JSON.stringify(data));
    return data;
  });
  const result = {
    measuredAt: new Date().toISOString(),
    hardware: {
      platform: os.platform(),
      architecture: os.arch(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    ...measurement,
  };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (output) await writeFile(output, json);
  process.stdout.write(json);
} finally {
  await browser.close();
}
