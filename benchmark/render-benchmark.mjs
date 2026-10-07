/** Synthetic native-Canvas workload. Run: node benchmark/render-benchmark.mjs [baseline-ref]. */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir, cpus, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const baselineRef = execFileSync(
  'git',
  ['rev-parse', process.argv[2] ?? 'HEAD'],
  { encoding: 'utf8' },
).trim();
const directory = await mkdtemp(join(tmpdir(), 'calcink-render-'));
const root = process.cwd();
const modules = ['mountInk', 'mountProjection'];
try {
  for (const variant of ['baseline', 'candidate']) {
    await build({
      stdin: {
        contents: `${modules.map((name) => `export { ${name} } from "renderer-${name}";`).join('\n')}\nexport { drawStroke } from ${JSON.stringify(resolve(root, 'src/ink/geometry.ts'))};\nexport { InkStore } from ${JSON.stringify(resolve(root, 'src/document/InkStore.ts'))};\nexport { ViewportStore } from ${JSON.stringify(resolve(root, 'src/viewport/index.ts'))};`,
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      target: 'es2022',
      outfile: join(directory, `${variant}.js`),
      plugins: [
        {
          name: 'renderer-snapshot',
          setup(api) {
            api.onResolve({ filter: /^renderer-/ }, (args) => ({
              path: args.path.replace('renderer-', ''),
              namespace: 'renderer',
            }));
            api.onLoad(
              { filter: /.*/, namespace: 'renderer' },
              async (args) => ({
                contents:
                  variant === 'baseline'
                    ? execFileSync(
                        'git',
                        ['show', `${baselineRef}:src/render/${args.path}.ts`],
                        { encoding: 'utf8' },
                      )
                    : await readFile(
                        resolve(root, `src/render/${args.path}.ts`),
                        'utf8',
                      ),
                loader: 'ts',
                resolveDir: resolve(root, 'src/render'),
              }),
            );
          },
        },
      ],
    });
  }
  const server = createServer(async (request, response) => {
    if (request.url === '/baseline.js' || request.url === '/candidate.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(join(directory, request.url.slice(1))));
    } else
      response.end(
        '<!doctype html><style>body{margin:0}canvas{position:absolute;width:1000px;height:650px}</style>',
      );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath:
      process.env.CALCINK_BROWSER_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const reports = {};
  const browserErrors = [];
  browser.on('page', (page) =>
    page.on('pageerror', (error) => browserErrors.push(error.message)),
  );
  try {
    for (const variant of ['baseline', 'candidate']) {
      const page = await browser.newPage({
        viewport: { width: 1000, height: 650 },
        deviceScaleFactor: 2,
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      console.log(`Running ${variant} native renderer workload`);
      reports[variant] = await page.evaluate(async (variant) => {
        const { mountInk, mountProjection, InkStore, ViewportStore } =
          await import(`/${variant}.js`);
        const nativeRaf = window.requestAnimationFrame.bind(window);
        const callbackMs = [];
        window.requestAnimationFrame = (callback) =>
          nativeRaf((time) => {
            const start = performance.now();
            callback(time);
            callbackMs.push(performance.now() - start);
          });
        const frames = [],
          durations = [],
          counts = {};
        let previousTime;
        const canvas = (label) => {
          const c = document.createElement('canvas');
          document.body.append(c);
          c.setPointerCapture = () => {};
          c.hasPointerCapture = () => false;
          const ctx = c.getContext('2d');
          counts[label] = {
            stroke: 0,
            lineTo: 0,
            fillText: 0,
            clearRect: 0,
            clearedPixels: 0,
            fullClear: 0,
          };
          for (const method of ['stroke', 'lineTo', 'fillText', 'clearRect']) {
            const original = ctx[method].bind(ctx);
            ctx[method] = (...args) => {
              counts[label][method]++;
              if (method === 'clearRect')
                counts[label].clearedPixels += args[2] * args[3];
              if (
                method === 'clearRect' &&
                args[0] === 0 &&
                args[1] === 0 &&
                args[2] === c.width &&
                args[3] === c.height
              )
                counts[label].fullClear++;
              return original(...args);
            };
          }
          return c;
        };
        const store = new InkStore(),
          viewport = new ViewportStore();
        const point = (x, y, timestamp = 1) => ({ x, y, timestamp });
        // 200 six-stroke equations: 40 equations visible, 160 offscreen.
        for (let row = 0; row < 50; row++)
          for (let column = 0; column < 4; column++)
            for (let symbol = 0; symbol < 6; symbol++) {
              const x = 20 + column * 240 + symbol * 22,
                y = 20 + row * 65;
              const points = Array.from({ length: 20 }, (_, n) =>
                point(x + n * 0.7, y + Math.sin(n / 3) * 10),
              );
              store.addStroke({
                id: `s-${row}-${column}-${symbol}`,
                points,
                width: 3,
                color: '#222222',
                bounds: { minX: x, minY: y - 12, maxX: x + 15, maxY: y + 12 },
              });
            }
        let projections = Array.from({ length: 200 }, (_, i) => {
          const x = 20 + (i % 4) * 240 + 132,
            y = 20 + Math.floor(i / 4) * 65;
          const bounds = { minX: x, minY: y - 12, maxX: x + 30, maxY: y + 12 };
          return {
            equationId: `e${i}`,
            equationRevision: 1,
            expression: '1+2=',
            status: 'valid',
            answerText: '3',
            answerBounds: bounds,
            equalsBounds: bounds,
            bounds,
          };
        });
        const committed = canvas('committed'),
          active = canvas('active'),
          projection = canvas('projection');
        const disposeInk = mountInk(
          committed,
          active,
          store,
          () => ({ mode: 'pen', width: 3, color: '#222222', eraserRadius: 8 }),
          { viewport, getPanMode: () => 'free' },
        );
        const renderer = mountProjection(
          projection,
          () => projections,
          viewport,
        );
        const nextFrame = () =>
          new Promise((resolve) =>
            nativeRaf((time) => {
              if (previousTime !== undefined) frames.push(time - previousTime);
              previousTime = time;
              resolve();
            }),
          );
        await nextFrame();
        await nextFrame();
        const initial = JSON.parse(JSON.stringify(counts));
        for (const group of Object.values(counts))
          for (const key of Object.keys(group)) group[key] = 0;
        callbackMs.length = 0;
        const pointer = (type, x, y) =>
          active.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              button: 0,
              bubbles: true,
            }),
          );
        pointer('pointerdown', 15, 200);
        for (let n = 0; n < 90; n++) {
          const start = performance.now();
          pointer('pointermove', 15 + n * 1.5, 200 + Math.sin(n / 4) * 8);
          if (n % 3 === 0) {
            const x = 20 + (n % 4) * 240;
            store.addStroke({
              id: `edit${n}`,
              width: 3,
              color: '#222222',
              points: [point(x, 60), point(x + 12, 72)],
              bounds: { minX: x, minY: 60, maxX: x + 12, maxY: 72 },
            });
          }
          // Unchanged result emissions dominate; one answer changes every 15 frames.
          projections = projections.map((p, i) => ({
            ...p,
            ...(i === 0 && n % 15 === 0
              ? { answerText: String(3 + n / 15) }
              : {}),
          }));
          renderer.invalidate();
          if (n === 45) viewport.panBy({ x: 0, y: -10 });
          durations.push(performance.now() - start);
          await nextFrame();
        }
        pointer('pointerup', 150, 200);
        await nextFrame();
        renderer.dispose();
        disposeInk();
        const summarize = (values) => {
          const sorted = [...values].sort((a, b) => a - b);
          return {
            count: values.length,
            p50: sorted[Math.floor(sorted.length * 0.5)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            max: sorted.at(-1),
          };
        };
        return {
          initial,
          counts,
          frameIntervalsMs: summarize(frames),
          rendererCallbacksMs: summarize(callbackMs),
          inputAndStoreMs: summarize(durations),
          raw: { frameIntervalsMs: frames, rendererCallbacksMs: callbackMs },
          dpr: devicePixelRatio,
          userAgent: navigator.userAgent,
        };
      }, variant);
      await page.close();
    }
    const parity = [];
    for (const dpr of [1, 2]) {
      const page = await browser.newPage({
        viewport: { width: 360, height: 240 },
        deviceScaleFactor: dpr,
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      parity.push(
        await page.evaluate(async (dpr) => {
          const { mountInk, InkStore, ViewportStore, drawStroke } =
            await import('/candidate.js');
          const c = document.createElement('canvas'),
            active = document.createElement('canvas');
          document.body.append(c, active);
          for (const canvas of [c, active]) {
            canvas.style.width = '360px';
            canvas.style.height = '240px';
          }
          const store = new InkStore(),
            viewport = new ViewportStore();
          viewport.zoomToAt(1.75, { x: 0, y: 0 });
          viewport.panBy({ x: 0.35, y: -0.45 });
          const dispose = mountInk(
            c,
            active,
            store,
            () => ({
              mode: 'pen',
              width: 3,
              color: '#222222',
              eraserRadius: 4,
            }),
            { viewport, getPanMode: () => 'free' },
          );
          const flush = () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          const cases = [];
          const verify = async (name) => {
            await flush();
            const before = c
              .getContext('2d')
              .getImageData(0, 0, c.width, c.height).data;
            window.dispatchEvent(new Event('calcink-appearance'));
            await flush();
            const after = c
              .getContext('2d')
              .getImageData(0, 0, c.width, c.height).data;
            let maxDifference = 0,
              differingChannels = 0,
              maxAlphaDifference = 0,
              maxPremultipliedDifference = 0;
            const examples = [];
            for (let n = 0; n < before.length; n++) {
              const difference = Math.abs(before[n] - after[n]);
              maxDifference = Math.max(maxDifference, difference);
              if (difference > 2) differingChannels++;
              if (n % 4 === 3) {
                maxAlphaDifference = Math.max(maxAlphaDifference, difference);
                for (let channel = 0; channel < 3; channel++)
                  maxPremultipliedDifference = Math.max(
                    maxPremultipliedDifference,
                    Math.abs(
                      (before[n - 3 + channel] * before[n]) / 255 -
                        (after[n - 3 + channel] * after[n]) / 255,
                    ),
                  );
                if (difference > 2 && examples.length < 5)
                  examples.push({
                    x: ((n - 3) / 4) % c.width,
                    y: Math.floor((n - 3) / 4 / c.width),
                    before: Array.from(before.slice(n - 3, n + 1)),
                    after: Array.from(after.slice(n - 3, n + 1)),
                  });
              }
            }
            cases.push({
              name,
              maxDifference,
              differingChannels,
              maxAlphaDifference,
              maxPremultipliedDifference,
              examples,
            });
          };
          const stroke = (id, y, extra = {}) => ({
            id,
            color: '#335577',
            width: 6,
            points: [
              { x: 12.3, y, timestamp: 1, pressure: 0 },
              { x: 80.3, y: y + 10.7, timestamp: 2, pressure: 0.8 },
              { x: 140.2, y: y - 8.2, timestamp: 3, pressure: 1 },
            ],
            bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
            ...extra,
          });
          await flush();
          store.addStroke(stroke('pressure', 50.3, { pressureEnabled: true }));
          await verify('pressure add');
          store.addStroke(
            stroke('pencil', 53.7, {
              opacity: 0.42,
              kind: 'pencil',
              pressureEnabled: true,
            }),
          );
          await verify('translucent pencil overlap');
          store.addStroke(
            stroke('marker', 57.1, {
              kind: 'highlighter',
              width: 16,
              opacity: 0.3,
              color: '#ffff00',
            }),
          );
          await verify('highlighter below earlier ink');
          store.eraseRegion(
            [
              { x: 70.8, y: 40, timestamp: 4 },
              { x: 70.8, y: 80, timestamp: 5 },
            ],
            4.7,
          );
          await verify('targeted partial erasure');
          store.undo();
          await verify('erase undo');
          store.redo();
          await verify('erase redo');
          store.transformSelection(
            { strokeIds: ['pressure'], objectIds: [] },
            { x: 9.3, y: 20.2 },
            1.1,
            { x: 0, y: 0 },
          );
          await verify('masked pressure stroke transform');
          store.eraseStrokes([{ x: 25.2, y: 50, timestamp: 4 }], 12);
          await verify('whole stroke erasure');
          store.undo();
          await verify('whole erase undo');
          viewport.panBy({ x: -3.65, y: 5.85 });
          await verify('fractional camera pan');
          store.addStroke(stroke('last', 62.2, { width: 2 }));
          await verify('local add after fractional pan');
          store.clear();
          await verify('clear');
          store.undo();
          await verify('clear undo');
          dispose();
          // Compare every active frame with a fresh canonical replay. This catches
          // missed edge pixels, alpha buildup, pressure caps and old preview trails.
          const reference = document.createElement('canvas');
          reference.width = active.width;
          reference.height = active.height;
          const ref = reference.getContext('2d');
          active.setPointerCapture = () => {};
          active.hasPointerCapture = () => false;
          const tool = {
            mode: 'pen',
            width: 10,
            color: '#335577',
            eraserRadius: 12,
          };
          const freshStore = new InkStore();
          const stop = mountInk(c, active, freshStore, () => tool, {
            viewport,
            getPanMode: () => 'free',
          });
          const activeCases = [];
          const rect = active.getBoundingClientRect();
          const camera = viewport.getSnapshot();
          const event = (type, p) =>
            active.dispatchEvent(
              new PointerEvent(type, {
                clientX: rect.x + p.x * camera.zoom + camera.offsetX,
                clientY: rect.y + p.y * camera.zoom + camera.offsetY,
                pressure: p.pressure,
                pointerId: 1,
                pointerType: 'pen',
                isPrimary: true,
                button: 0,
              }),
            );
          await flush();
          for (const [name, settings] of [
            [
              'pressure',
              { kind: 'pen', pressureEnabled: true, opacity: 1, mode: 'pen' },
            ],
            [
              'pencil',
              {
                kind: 'pencil',
                pressureEnabled: true,
                opacity: 0.42,
                mode: 'pen',
              },
            ],
            [
              'highlighter',
              {
                kind: 'highlighter',
                pressureEnabled: false,
                opacity: 0.3,
                mode: 'pen',
              },
            ],
            ['eraser preview', { mode: 'pixel-eraser' }],
          ]) {
            Object.assign(tool, settings);
            const points = [];
            let differingChannels = 0;
            for (let i = 0; i < 14; i++) {
              const p = {
                x: 1.3 + i * 9.1,
                y: 20.7 + Math.sin(i / 2) * 18,
                pressure: i / 14,
                timestamp: i,
              };
              points.push(p);
              event(i === 0 ? 'pointerdown' : 'pointermove', p);
              await flush();
              ref.setTransform(1, 0, 0, 1, 0, 0);
              ref.clearRect(0, 0, reference.width, reference.height);
              ref.setTransform(
                dpr * camera.zoom,
                0,
                0,
                dpr * camera.zoom,
                dpr * camera.offsetX,
                dpr * camera.offsetY,
              );
              ref.save();
              if (tool.mode !== 'pen') ref.globalAlpha = 0.25;
              drawStroke(ref, {
                id: 'reference',
                points,
                bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
                ...tool,
                ...(tool.mode !== 'pen'
                  ? {
                      width: (tool.eraserRadius * 2) / camera.zoom,
                      color: '#818cf8',
                      opacity: 1,
                      kind: 'pen',
                      pressureEnabled: false,
                    }
                  : {}),
              });
              ref.restore();
              const actual = active
                .getContext('2d')
                .getImageData(0, 0, active.width, active.height).data;
              const expected = ref.getImageData(
                0,
                0,
                reference.width,
                reference.height,
              ).data;
              for (let n = 0; n < actual.length; n++)
                if (Math.abs(actual[n] - expected[n]) > 2) differingChannels++;
            }
            event('pointerup', points.at(-1));
            await flush();
            const remainingAlpha = active
              .getContext('2d')
              .getImageData(0, 0, active.width, active.height)
              .data.filter((_, i) => i % 4 === 3)
              .some((value) => value !== 0);
            activeCases.push({ name, differingChannels, remainingAlpha });
          }
          stop();
          return { dpr, zoom: 1.75, cases, activeCases };
        }, dpr),
      );
      await page.close();
    }
    const sourceHashes = Object.fromEntries(
      await Promise.all(
        modules.map(async (name) => [
          name,
          createHash('sha256')
            .update(await readFile(resolve(root, `src/render/${name}.ts`)))
            .digest('hex'),
        ]),
      ),
    );
    const report = {
      capturedAt: new Date().toISOString(),
      sourceHashes,
      parity,
      browserErrors,
      baselineRef,
      browserVersion: browser.version(),
      hardware: {
        cpu: cpus()[0]?.model,
        platform: platform(),
        release: release(),
      },
      workload:
        'Synthetic 200 equations / 1200 opaque pen strokes; 20 points per stroke; 1000×650 CSS canvas at DPR2; 90 input frames, 30 local stroke additions, 6 changed answers; unchanged projection emissions every frame. No model running; not human/device recognition evidence.',
      reports,
    };
    await writeFile(
      resolve(root, 'benchmark-data/render-retention.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    if (browserErrors.length)
      throw new Error(
        `Native benchmark browser errors: ${browserErrors.join('; ')}`,
      );
    if (
      parity.some((entry) =>
        entry.activeCases.some(
          (test) => test.differingChannels || test.remainingAlpha,
        ),
      )
    )
      throw new Error('Active preview differs from canonical replay');
    if (
      parity.some((entry) =>
        entry.cases.some(
          (test) =>
            test.maxAlphaDifference > 2 || test.maxPremultipliedDifference > 2,
        ),
      )
    )
      throw new Error(
        'Retained pixels differ from full replay; inspect benchmark-data/render-retention.json',
      );
    console.log(
      JSON.stringify(
        {
          file: 'benchmark-data/render-retention.json',
          reports: Object.fromEntries(
            Object.entries(reports).map(([key, value]) => [
              key,
              { ...value, raw: undefined },
            ]),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
