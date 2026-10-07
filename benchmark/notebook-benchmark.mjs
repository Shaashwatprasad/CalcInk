/** Full application synthetic workload, including real recognition and autosave.
 * Run against a production preview: node benchmark/notebook-benchmark.mjs URL report.json
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
const url = process.argv[2] ?? 'http://127.0.0.1:4176/';
const output = process.argv[3] ?? '/tmp/calcink-notebook-benchmark.json';
const browser = await chromium.launch({
  executablePath:
    process.env.CALCINK_BROWSER_EXECUTABLE ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page
    .getByText('Ready for handwriting', { exact: true })
    .waitFor({ timeout: 60000 });
  const strokes = [];
  const paths = [
    [
      [0, 0],
      [0, 40],
    ],
    [
      [0, 20],
      [24, 20],
    ],
    [
      [12, 8],
      [12, 32],
    ],
    [
      [0, 0],
      [0, 40],
    ],
    [
      [0, 14],
      [24, 14],
    ],
    [
      [0, 27],
      [24, 27],
    ],
  ];
  for (let row = 0; row < 10; row++)
    for (let column = 0; column < 2; column++) {
      for (let i = 0; i < paths.length; i++) {
        const x = 40 + column * 420 + [0, 45, 45, 90, 135, 135][i],
          y = 40 + row * 100;
        const [[ax, ay], [bx, by]] = paths[i];
        const points = Array.from({ length: 128 }, (_, n) => ({
          x: x + ax + ((bx - ax) * n) / 127,
          y: y + ay + ((by - ay) * n) / 127,
          timestamp: n,
        }));
        strokes.push({
          id: `s-${row}-${column}-${i}`,
          points,
          width: 3,
          color: '#222222',
          bounds: {
            minX: x + Math.min(ax, bx),
            minY: y + Math.min(ay, by),
            maxX: x + Math.max(ax, bx),
            maxY: y + Math.max(ay, by),
          },
        });
      }
    }
  const ink = {
    format: 'calcink-document',
    version: 1,
    documentId: 'synthetic-latency',
    generation: 0,
    revision: 1,
    strokes,
    erasures: [],
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(ink)),
  });
  // Allow the imported rows to settle before profiling continued writing.
  await page.waitForTimeout(1500);
  await page
    .getByText('Ready for handwriting', { exact: true })
    .waitFor({ timeout: 60000 });
  await page
    .getByText('Saved on this device', { exact: true })
    .waitFor({ timeout: 10000 });
  await page
    .getByRole('tab', { name: 'History (20)', exact: true })
    .waitFor({ timeout: 60000 });
  const measurements = await page.evaluate(async () => {
    const canvas = document.querySelector(
      'canvas[aria-label="Drawing canvas"]',
    );
    const rect = canvas.getBoundingClientRect();
    const nativeRaf = window.requestAnimationFrame.bind(window),
      frames = [],
      callbacks = [],
      inputs = [],
      penUps = [],
      clears = [],
      longTasks = [];
    window.requestAnimationFrame = (cb) =>
      nativeRaf((time) => {
        const start = performance.now();
        cb(time);
        callbacks.push(performance.now() - start);
      });
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) {
      if (this.canvas === canvas) clears.push(w * h);
      return original.call(this, x, y, w, h);
    };
    let drawing = false;
    const savesDuringDrawing = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (drawing && this.name === 'notebooks')
        savesDuringDrawing.push(performance.now());
      return put.apply(this, args);
    };
    const observer = new PerformanceObserver((list) =>
      longTasks.push(...list.getEntries().map((e) => e.duration)),
    );
    observer.observe({ type: 'longtask' });
    let previous;
    const frame = () =>
      new Promise((resolve) =>
        nativeRaf((time) => {
          if (previous !== undefined) frames.push(time - previous);
          previous = time;
          resolve();
        }),
      );
    const dispatch = (type, x, y) => {
      if (type === 'pointerdown') drawing = true;
      if (type === 'pointerup') drawing = false;
      const start = performance.now();
      canvas.dispatchEvent(
        new PointerEvent(type, {
          clientX: rect.x + x,
          clientY: rect.y + y,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          bubbles: true,
        }),
      );
      (type === 'pointerup' ? penUps : inputs).push(performance.now() - start);
    };
    // Simulate 10 short strokes while real recognition and autosave remain enabled.
    for (let stroke = 0; stroke < 10; stroke++) {
      const x = 250 + stroke * 30,
        y = 650;
      dispatch('pointerdown', x, y);
      for (let n = 0; n < 18; n++) {
        dispatch('pointermove', x + n, y + Math.sin(n / 3) * 10);
        await frame();
      }
      dispatch('pointerup', x + 18, y);
      await frame();
    }
    await frame();
    observer.disconnect();
    IDBObjectStore.prototype.put = put;
    window.requestAnimationFrame = nativeRaf;
    CanvasRenderingContext2D.prototype.clearRect = original;
    const summary = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        count: sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        max: sorted.at(-1) ?? 0,
      };
    };
    return {
      frameIntervalsMs: summary(frames),
      rafCallbacksMs: summary(callbacks),
      inputHandlersMs: summary(inputs),
      penUpMs: summary(penUps),
      longTasksMs: longTasks,
      savesDuringDrawing: savesDuringDrawing.length,
      activeClearedPixels: clears.reduce((a, b) => a + b, 0),
      activeCanvasPixels: canvas.width * canvas.height,
      userAgent: navigator.userAgent,
    };
  });
  await page
    .getByText('Saved on this device', { exact: true })
    .waitFor({ timeout: 10000 });
  const report = {
    capturedAt: new Date().toISOString(),
    solvedEquationsAtStart: 20,
    hardware: { cpu: cpus()[0]?.model, platform: platform() },
    browserVersion: browser.version(),
    workload:
      'Synthetic 20 equations, 120 strokes, 128 points/stroke, DPR2, 10 further 18-frame strokes; real on-device model and autosave enabled. Isolated browser context; not physical-stylus or writer accuracy evidence.',
    measurements,
    errors,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(errors.join('; '));
} finally {
  await browser.close();
}
