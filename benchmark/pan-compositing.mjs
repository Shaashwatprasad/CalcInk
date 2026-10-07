/** Native browser regression + synthetic pan workload. Run from repo root:
 * node benchmark/pan-compositing.mjs [original-ref, default bdcd47c]
 * CALCINK_BROWSER_EXECUTABLE optionally selects a local Chromium executable.
 * Timing is descriptive; pixel parity and scratch pixel budgets are assertions.
 */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir, cpus, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const baselineRef = execFileSync(
  'git',
  ['rev-parse', process.argv[2] ?? 'bdcd47c'],
  { encoding: 'utf8' },
).trim();
const originalGeometry = execFileSync(
  'git',
  ['show', `${baselineRef}:src/ink/geometry.ts`],
  { encoding: 'utf8' },
);
const candidateGeometry = await readFile(
  resolve(root, 'src/ink/geometry.ts'),
  'utf8',
);
const originalRenderer = execFileSync(
  'git',
  ['show', `${baselineRef}:src/render/mountInk.ts`],
  { encoding: 'utf8' },
);
const candidateRenderer = await readFile(
  resolve(root, 'src/render/mountInk.ts'),
  'utf8',
);
const directory = await mkdtemp(join(tmpdir(), 'calcink-pan-'));
const hash = (source) => createHash('sha256').update(source).digest('hex');
let browser;
let server;
try {
  for (const variant of ['baseline', 'candidate']) {
    await build({
      stdin: {
        contents: `export { mountInk } from './src/render/mountInk';
          export { InkStore, createInkDocument } from './src/document/InkStore';
          export { ViewportStore } from './src/viewport';
          export { drawDocument, drawStroke, resolveInkColor } from './src/ink/geometry';`,
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      target: 'es2022',
      outfile: join(directory, `${variant}.js`),
      plugins: [
        {
          name: 'isolated-renderer-and-geometry-snapshots',
          setup(api) {
            // Intercept EVERY geometry import, including mountInk/InkStore's
            // relative imports. Comparing only renderer entrypoints accidentally
            // links both variants to working-tree geometry.
            api.onResolve({ filter: /(?:^|\/)geometry(?:\.ts)?$/ }, () => ({
              path: 'geometry',
              namespace: 'snapshot',
            }));
            api.onResolve({ filter: /(?:^|\/)mountInk(?:\.ts)?$/ }, () => ({
              path: 'renderer',
              namespace: 'snapshot',
            }));
            api.onLoad({ filter: /.*/, namespace: 'snapshot' }, (args) => ({
              contents:
                args.path === 'geometry'
                  ? variant === 'baseline'
                    ? originalGeometry
                    : candidateGeometry
                  : variant === 'baseline'
                    ? originalRenderer
                    : candidateRenderer,
              loader: 'ts',
              resolveDir: resolve(
                root,
                args.path === 'geometry' ? 'src/ink' : 'src/render',
              ),
            }));
          },
        },
      ],
    });
  }
  server = createServer(async (request, response) => {
    if (request.url === '/baseline.js' || request.url === '/candidate.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(join(directory, request.url.slice(1))));
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><style>body{margin:0}canvas{position:absolute;left:0;top:0}</style>',
      );
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const browserExecutable =
    process.env.CALCINK_BROWSER_EXECUTABLE ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: true,
  });
  const browserErrors = [];
  browser.on('page', (page) =>
    page.on('pageerror', (error) => browserErrors.push(error.message)),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const parity = [];
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({
      viewport: { width: 360, height: 240 },
      deviceScaleFactor: dpr,
    });
    await page.goto(origin);
    parity.push(
      await page.evaluate(async (dpr) => {
        const baseline = await import('/baseline.js');
        const candidate = await import('/candidate.js');
        const flush = () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          );
        const settle = async () => {
          await new Promise((done) => setTimeout(done, 140));
          await flush();
        };
        const point = (x, y, pressure = 0.6) => ({
          x,
          y,
          pressure,
          timestamp: 1,
        });
        const stroke = (id, y, extra = {}) => ({
          id,
          width: 8,
          color: '#335577',
          points: [
            point(-3.3, y, 0),
            point(72.3, y + 13.7, 0.8),
            point(205.2, y - 12.2, 1),
          ],
          bounds: { minX: -3.3, minY: y - 12.2, maxX: 205.2, maxY: y + 13.7 },
          ...extra,
        });
        const compare = (name, left, right) => {
          if (left.width !== right.width || left.height !== right.height)
            throw new Error(`Canvas dimensions differ: ${name}`);
          const a = left
            .getContext('2d')
            .getImageData(0, 0, left.width, left.height).data;
          const b = right
            .getContext('2d')
            .getImageData(0, 0, right.width, right.height).data;
          let maxAlphaDifference = 0,
            maxPremultipliedDifference = 0,
            differingPixels = 0;
          const examples = [];
          for (let i = 0; i < a.length; i += 4) {
            const alpha = Math.abs(a[i + 3] - b[i + 3]);
            maxAlphaDifference = Math.max(maxAlphaDifference, alpha);
            let premultiplied = 0;
            for (let channel = 0; channel < 3; channel++)
              premultiplied = Math.max(
                premultiplied,
                Math.abs(
                  (a[i + channel] * a[i + 3]) / 255 -
                    (b[i + channel] * b[i + 3]) / 255,
                ),
              );
            maxPremultipliedDifference = Math.max(
              maxPremultipliedDifference,
              premultiplied,
            );
            if (alpha > 2 || premultiplied > 2) {
              differingPixels++;
              if (examples.length < 4)
                examples.push({
                  x: (i / 4) % left.width,
                  y: Math.floor(i / 4 / left.width),
                  baseline: Array.from(a.slice(i, i + 4)),
                  candidate: Array.from(b.slice(i, i + 4)),
                });
            }
          }
          return {
            name,
            maxAlphaDifference,
            maxPremultipliedDifference,
            differingPixels,
            examples,
          };
        };
        const canvases = () => {
          const canvas = document.createElement('canvas');
          canvas.style.width = '360px';
          canvas.style.height = '240px';
          document.body.append(canvas);
          canvas.setPointerCapture = () => {};
          canvas.hasPointerCapture = () => false;
          return canvas;
        };
        let theme = 'light';
        const states = [baseline, candidate].map((api) => {
          const committed = canvases(),
            active = canvases();
          const store = new api.InkStore(),
            viewport = new api.ViewportStore();
          const tool = {
            mode: 'pen',
            width: 10,
            color: '#335577',
            eraserRadius: 12,
          };
          const dispose = api.mountInk(committed, active, store, () => tool, {
            viewport,
            getPanMode: () => 'free',
            getInkColor: (s) => api.resolveInkColor(s, theme),
          });
          return { committed, active, store, viewport, tool, dispose };
        });
        const cases = [];
        const verify = async (name) => {
          await flush();
          for (const layer of ['committed', 'active'])
            cases.push(
              compare(`${name}: ${layer}`, states[0][layer], states[1][layer]),
            );
        };
        const each = (apply) => states.forEach(apply);
        await verify('initial empty');
        each(({ store }) =>
          store.addStroke(
            stroke('pressure', 45.3, {
              pressureEnabled: true,
              colorMode: 'auto',
            }),
          ),
        );
        await verify('pressure touching left edge');
        each(({ store }) =>
          store.addStroke(
            stroke('pencil', 48.7, {
              pressureEnabled: true,
              kind: 'pencil',
              opacity: 0.42,
            }),
          ),
        );
        await verify('translucent pressure overlap');
        each(({ store }) =>
          store.addStroke(
            stroke('marker', 52.1, {
              kind: 'highlighter',
              width: 22,
              color: '#ffbb00',
              opacity: 0.3,
            }),
          ),
        );
        await verify('later highlighter below math');
        each(({ store }) =>
          store.eraseRegion([point(68.8, 20), point(68.8, 80)], 4.7, [
            'pressure',
          ]),
        );
        await verify('target-scoped mask preserves overlap');
        each(({ store }) => store.undo());
        await verify('mask undo');
        each(({ store }) => store.redo());
        await verify('mask redo');
        each(({ store }) =>
          store.addStroke({
            ...stroke('dot', 0),
            points: [point(358.7, 238.9)],
            width: 13,
            opacity: 0.3,
          }),
        );
        await verify('translucent dot at bottom right');
        each(({ store }) =>
          store.addStroke({
            ...stroke('right-edge', 0),
            points: [point(354.7, -20), point(354.7, 270)],
            opacity: 0.42,
            pressureEnabled: true,
          }),
        );
        each(({ store }) =>
          store.addStroke({
            ...stroke('bottom-edge', 0),
            points: [point(-20, 235.7), point(390, 235.7)],
            opacity: 0.42,
          }),
        );
        await verify('edge crossing geometry');
        each(({ viewport }) => viewport.reset());
        await settle();
        let painted = { zoom: 1, offsetX: 0, offsetY: 0 };
        const reference = canvases();
        const moving = states[1];
        reference.width = moving.committed.width;
        reference.height = moving.committed.height;
        const refContext = reference.getContext('2d');
        const motion = [
          [0.35, 0.2],
          [1.7, 0],
          [-2.4, 0],
          [0, 2.3],
          [0, -3.6],
          [2.7, 1.7],
          [-2.7, -1.7],
          [16.3, -11.2],
          [-16.3, 11.2],
          [0.1, 0.1],
          [0.1, 0.1],
          [0.1, 0.1],
          [400, 280],
          [-400, -280],
          [15.7, 18.3],
          [-31.4, -36.6],
          [15.7, 18.3],
        ];
        for (const [i, [x, y]] of motion.entries()) {
          each(({ viewport }) => viewport.panBy({ x, y }));
          const requested = moving.viewport.getSnapshot();
          const dx = Math.round((requested.offsetX - painted.offsetX) * dpr);
          const dy = Math.round((requested.offsetY - painted.offsetY) * dpr);
          painted =
            Math.abs(dx) < reference.width && Math.abs(dy) < reference.height
              ? {
                  ...requested,
                  offsetX: painted.offsetX + dx / dpr,
                  offsetY: painted.offsetY + dy / dpr,
                }
              : { ...requested };
          await flush();
          refContext.setTransform(1, 0, 0, 1, 0, 0);
          refContext.clearRect(0, 0, reference.width, reference.height);
          refContext.setTransform(
            dpr * painted.zoom,
            0,
            0,
            dpr * painted.zoom,
            dpr * painted.offsetX,
            dpr * painted.offsetY,
          );
          candidate.drawDocument(refContext, moving.store.getSnapshot(), (s) =>
            candidate.resolveInkColor(s, theme),
          );
          cases.push(
            compare(
              `motion ${i} ${x},${y} against independently snapped canonical`,
              reference,
              moving.committed,
            ),
          );
        }
        await settle();
        await verify('motion exact fractional settlement');
        each(({ viewport }) => viewport.panBy({ x: 0.35, y: -0.45 }));
        await flush();
        each(({ store }) =>
          store.addStroke(stroke('edit-during-pan', 95.7, { opacity: 0.55 })),
        );
        await verify('immediate edit cancels pan cache');
        each(({ viewport }) => viewport.panBy({ x: 0.35, y: -0.45 }));
        await flush();
        theme = 'dark';
        window.dispatchEvent(new Event('calcink-appearance'));
        await verify('immediate appearance change cancels pan cache');
        for (const zoom of [0.25, 1.75, 4]) {
          each(({ viewport }) => {
            viewport.zoomToAt(zoom, { x: 120.3, y: 80.7 });
            viewport.panBy({ x: 0.35, y: -0.45 });
          });
          await settle();
          await verify(`fractional pan zoom ${zoom}`);
        }
        each(({ viewport }) => {
          viewport.reset();
          viewport.zoomToAt(1.75, { x: 0, y: 0 });
          viewport.panBy({ x: 0.35, y: -0.45 });
        });
        await settle();
        theme = 'dark';
        window.dispatchEvent(new Event('calcink-appearance'));
        await verify('dark theme auto color');
        each(({ store }) =>
          store.transformSelection(
            { strokeIds: ['pressure'], objectIds: [] },
            { x: 9.3, y: 20.2 },
            1.1,
            { x: 0, y: 0 },
          ),
        );
        await verify('masked selection transform');
        each(({ store }) => store.eraseStrokes([point(25.2, 50)], 12));
        await verify('whole erase');
        each(({ store }) => store.undo());
        await verify('whole erase undo');
        each(({ committed, active }) => {
          committed.style.width = '311px';
          active.style.width = '311px';
          committed.style.height = '199px';
          active.style.height = '199px';
        });
        window.dispatchEvent(new Event('resize'));
        await verify('resize with masks');
        each(({ store }) => store.clear());
        await verify('clear');
        each(({ store }) => store.undo());
        await verify('clear undo');
        each(({ store }) => store.clear());
        for (const [name, settings] of [
          [
            'pressure preview',
            { mode: 'pen', kind: 'pen', pressureEnabled: true, opacity: 1 },
          ],
          [
            'translucent preview',
            {
              mode: 'pen',
              kind: 'pencil',
              pressureEnabled: true,
              opacity: 0.42,
            },
          ],
          [
            'highlighter preview',
            {
              mode: 'pen',
              kind: 'highlighter',
              pressureEnabled: false,
              opacity: 0.3,
            },
          ],
          ['eraser preview', { mode: 'pixel-eraser' }],
        ]) {
          each(({ store }) =>
            store.addStroke(
              stroke('preview-background', 28.3, {
                opacity: 0.55,
                colorMode: 'auto',
              }),
            ),
          );
          await verify(`${name} committed background`);
          each(({ tool }) => Object.assign(tool, settings));
          each(({ viewport }) => viewport.panBy({ x: 0.35, y: -0.45 }));
          await flush();
          for (let i = 0; i < 7; i++) {
            each(({ active, viewport }) => {
              const camera = viewport.getSnapshot(),
                rect = active.getBoundingClientRect();
              active.dispatchEvent(
                new PointerEvent(i ? 'pointermove' : 'pointerdown', {
                  clientX:
                    rect.x + (1.3 + i * 15.1) * camera.zoom + camera.offsetX,
                  clientY:
                    rect.y +
                    (20.7 + Math.sin(i / 2) * 18) * camera.zoom +
                    camera.offsetY,
                  pressure: i / 7,
                  pointerId: 1,
                  pointerType: 'pen',
                  isPrimary: true,
                  button: 0,
                }),
              );
            });
            await verify(`${name} point ${i}`);
          }
          each(({ active }) =>
            active.dispatchEvent(
              new PointerEvent('pointercancel', {
                pointerId: 1,
                pointerType: 'pen',
              }),
            ),
          );
          await verify(`${name} completed`);
          each(({ store }) => store.clear());
        }
        each(({ store }) =>
          store.addStroke(stroke('dispose-ink', 70.3, { opacity: 0.55 })),
        );
        await verify('dispose fixture');
        each(({ viewport }) => viewport.panBy({ x: 0.35, y: -0.45 }));
        await flush();
        let disposedClearCalls = 0;
        const disposingContext = moving.committed.getContext('2d');
        const disposedClear = disposingContext.clearRect.bind(disposingContext);
        disposingContext.clearRect = (...args) => {
          disposedClearCalls++;
          return disposedClear(...args);
        };
        each(({ dispose }) => dispose());
        const disposedPixels = moving.committed
          .getContext('2d')
          .getImageData(0, 0, moving.committed.width, moving.committed.height)
          .data.slice();
        await settle();
        const laterPixels = moving.committed
          .getContext('2d')
          .getImageData(
            0,
            0,
            moving.committed.width,
            moving.committed.height,
          ).data;
        if (disposedPixels.some((value, index) => value !== laterPixels[index]))
          throw new Error(
            'Disposed renderer painted from pending settle timer',
          );
        if (disposedClearCalls)
          throw new Error('Disposed renderer ran pending drawing callback');
        // Direct geometry handles empty strokes, unlike the document validator.
        for (const transform of [
          [dpr, 0, 0, dpr, 0.35, -0.45],
          [dpr * 1.75, 0, 0, dpr * 1.75, -103.65, -21.85],
        ]) {
          const pair = [baseline, candidate].map((api) => {
            const c = canvases();
            c.width = 360 * dpr;
            c.height = 240 * dpr;
            const ctx = c.getContext('2d');
            ctx.setTransform(...transform);
            api.drawDocument(ctx, {
              strokes: [
                stroke('empty', 0, { points: [], opacity: 0.5 }),
                stroke('top', -1.3, { opacity: 0.6 }),
                stroke('bottom', 240.7, { opacity: 0.4 }),
                stroke('right', 100, {
                  points: [point(358.7, 30), point(362.2, 200)],
                  opacity: 0.5,
                }),
              ],
              erasures: [],
            });
            return c;
          });
          cases.push(
            compare(
              `empty and all viewport edges ${transform.join(',')}`,
              ...pair,
            ),
          );
        }
        return { dpr, tolerance: { alpha: 2, premultipliedColor: 2 }, cases };
      }, dpr),
    );
    await page.close();
  }
  const reports = {};
  for (const [size, viewport] of Object.entries({
    preview: { width: 700, height: 436 },
    fullscreen: { width: 1680, height: 838 },
  })) {
    reports[size] = {};
    for (const variant of ['baseline', 'candidate']) {
      console.log(`Running ${size} ${variant} pan workload`);
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      await page.goto(origin);
      reports[size][variant] = await page.evaluate(
        async ({ variant, viewport }) => {
          const api = await import(`/${variant}.js`);
          const main = new WeakSet();
          const counts = {
            scratchClearCalls: 0,
            scratchClearedPixels: 0,
            scratchCopyCalls: 0,
            scratchCopiedPixels: 0,
            maxScratchClearPixels: 0,
            maxScratchCopyPixels: 0,
            sceneCopyCalls: 0,
            sceneCopiedPixels: 0,
            mainFullClearCalls: 0,
            mainFullClearedPixels: 0,
            exposedRepaintClearCalls: 0,
            exposedRepaintPixels: 0,
            nativeStrokeCalls: 0,
            nativeFillCalls: 0,
          };
          for (const prototype of [
            CanvasRenderingContext2D.prototype,
            OffscreenCanvasRenderingContext2D.prototype,
          ]) {
            const clear = prototype.clearRect;
            prototype.clearRect = function (...args) {
              if (!main.has(this.canvas)) {
                const pixels = Math.abs(args[2] * args[3]);
                counts.scratchClearCalls++;
                counts.scratchClearedPixels += pixels;
                counts.maxScratchClearPixels = Math.max(
                  counts.maxScratchClearPixels,
                  pixels,
                );
              } else if (
                args[0] === 0 &&
                args[1] === 0 &&
                args[2] === this.canvas.width &&
                args[3] === this.canvas.height
              ) {
                counts.mainFullClearCalls++;
                counts.mainFullClearedPixels += Math.abs(args[2] * args[3]);
              } else {
                counts.exposedRepaintClearCalls++;
                counts.exposedRepaintPixels += Math.abs(args[2] * args[3]);
              }
              return clear.apply(this, args);
            };
            const draw = prototype.drawImage;
            prototype.drawImage = function (...args) {
              if (args[0] === this.canvas && main.has(this.canvas)) {
                counts.sceneCopyCalls++;
                counts.sceneCopiedPixels +=
                  this.canvas.width * this.canvas.height;
              }
              if (main.has(this.canvas) && args[0] && !main.has(args[0])) {
                const pixels =
                  args.length === 9
                    ? Math.abs(args[3] * args[4])
                    : args[0].width * args[0].height;
                counts.scratchCopyCalls++;
                counts.scratchCopiedPixels += pixels;
                counts.maxScratchCopyPixels = Math.max(
                  counts.maxScratchCopyPixels,
                  pixels,
                );
              }
              return draw.apply(this, args);
            };
            for (const [method, counter] of [
              ['stroke', 'nativeStrokeCalls'],
              ['fill', 'nativeFillCalls'],
            ]) {
              const original = prototype[method];
              prototype[method] = function (...args) {
                counts[counter]++;
                return original.apply(this, args);
              };
            }
          }
          const point = (x, y, n = 0) => ({
            x,
            y,
            timestamp: n,
            pressure: (n % 11) / 10,
          });
          const documentData = api.createInkDocument();
          for (let equation = 0; equation < 200; equation++) {
            const x = 24 + (equation % 8) * 166,
              y = 24 + Math.floor(equation / 8) * 72;
            for (let symbol = 0; symbol < 6; symbol++) {
              const sx = x + symbol * 22;
              const id = `e${equation}-s${symbol}`;
              documentData.strokes.push({
                id,
                width: symbol === 5 ? 14 : 4,
                color: symbol === 5 ? '#ffaa00' : '#335577',
                points: Array.from({ length: 20 }, (_, n) =>
                  point(sx + n * 0.8, y + Math.sin(n / 3) * 11, n),
                ),
                bounds: { minX: sx, minY: y - 11, maxX: sx + 16, maxY: y + 11 },
                pressureEnabled: symbol === 1 || symbol === 2,
                ...(symbol === 2 ? { kind: 'pencil', opacity: 0.42 } : {}),
                ...(symbol === 5 ? { kind: 'highlighter', opacity: 0.3 } : {}),
              });
              if (symbol === 0 || symbol === 2)
                documentData.erasures.push({
                  id: `mask-${id}`,
                  path: [point(sx + 7, y - 14), point(sx + 7, y + 14)],
                  radius: 2.5,
                  targetStrokeIds: [id],
                });
            }
          }
          const store = new api.InkStore(documentData),
            camera = new api.ViewportStore();
          const canvas = () => {
            const c = document.createElement('canvas');
            c.style.width = `${viewport.width}px`;
            c.style.height = `${viewport.height}px`;
            document.body.append(c);
            main.add(c);
            return c;
          };
          const committed = canvas(),
            active = canvas();
          const stop = api.mountInk(
            committed,
            active,
            store,
            () => ({
              mode: 'hand',
              width: 3,
              color: '#335577',
              eraserRadius: 8,
            }),
            { viewport: camera, getPanMode: () => 'free' },
          );
          const nextFrame = () =>
            new Promise((done) => requestAnimationFrame(done));
          await nextFrame();
          await nextFrame();
          // Warm up both size/layout and the drawing path outside the sample.
          for (let n = 0; n < 8; n++) {
            camera.panBy({ x: 0.35, y: -0.7 });
            await nextFrame();
          }
          for (const key of Object.keys(counts)) counts[key] = 0;
          const frameIntervalsMs = [],
            inputIssuingMs = [];
          let previousTime = await nextFrame();
          for (let n = 0; n < 90; n++) {
            const begin = performance.now();
            camera.panBy({ x: Math.sin(n / 8) * 1.7, y: -1.25 });
            inputIssuingMs.push(performance.now() - begin);
            const time = await nextFrame();
            frameIntervalsMs.push(time - previousTime);
            previousTime = time;
          }
          stop();
          const summarize = (values) => {
            const sorted = [...values].sort((a, b) => a - b);
            return {
              count: values.length,
              p50: sorted[Math.floor(sorted.length * 0.5)],
              p95: sorted[Math.floor(sorted.length * 0.95)],
              max: sorted.at(-1),
              intervalsOver25ms: values.filter((v) => v > 25).length,
            };
          };
          return {
            dpr: devicePixelRatio,
            cssViewport: viewport,
            devicePixels: committed.width * committed.height,
            counts,
            frameIntervalsMs: summarize(frameIntervalsMs),
            raw: { frameIntervalsMs, inputIssuingMs },
            userAgent: navigator.userAgent,
          };
        },
        { variant, viewport },
      );
      await page.close();
    }
  }
  const report = {
    capturedAt: new Date().toISOString(),
    baselineRef,
    sourceHashes: {
      baselineGeometry: hash(originalGeometry),
      candidateGeometry: hash(candidateGeometry),
      baselineRenderer: hash(originalRenderer),
      candidateRenderer: hash(candidateRenderer),
    },
    browserVersion: browser.version(),
    browserExecutable,
    headless: true,
    hardware: {
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      platform: platform(),
      release: release(),
    },
    workload:
      'Synthetic 200 equations / 1200 strokes, mixed opaque pressure pen, translucent pressure pencil, highlighter and target-scoped erasure. 20 points per stroke; 90 viewport pan frames after 8 warmup frames. Baseline snapshots both mountInk and geometry from baselineRef; candidate snapshots working source. Native motion tests compare to independently computed snapped camera and exact replay after 140ms settlement. No ML or human-input validation. rAF intervals include browser scheduling; headless timing does not establish interactive fullscreen FPS. Cleared/copied pixels count native API rectangle areas, not measured GPU work. exposedRepaintPixels counts partial clear rectangle areas including antialias padding; nativeStrokeCalls counts Canvas stroke calls, not logical stroke objects.',
    parity,
    reports,
    browserErrors,
  };
  const file = resolve(root, 'benchmark-data/pan-compositing.json');
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  if (browserErrors.length)
    throw new Error(`Browser errors: ${browserErrors.join('; ')}`);
  if (parity.some((entry) => entry.cases.some((test) => test.differingPixels)))
    throw new Error(`Native pixel parity regression; inspect ${file}`);
  const before = reports.fullscreen.baseline.counts,
    after = reports.fullscreen.candidate.counts;
  if (
    !before.scratchClearCalls ||
    after.scratchClearedPixels > before.scratchClearedPixels * 0.1 ||
    after.scratchCopiedPixels > before.scratchCopiedPixels * 0.1 ||
    after.maxScratchClearPixels >= reports.fullscreen.candidate.devicePixels ||
    after.maxScratchCopyPixels >= reports.fullscreen.candidate.devicePixels
  )
    throw new Error(
      `Fullscreen scratch pixel budget regression; inspect ${file}`,
    );
  if (
    !after.sceneCopyCalls ||
    after.mainFullClearCalls ||
    after.nativeStrokeCalls >= before.nativeStrokeCalls * 0.1
  )
    throw new Error(`Pan scene retention regression; inspect ${file}`);
  console.log(
    JSON.stringify(
      {
        file,
        parityCases: parity.reduce((sum, entry) => sum + entry.cases.length, 0),
        reports: Object.fromEntries(
          Object.entries(reports).map(([size, variants]) => [
            size,
            Object.fromEntries(
              Object.entries(variants).map(([variant, value]) => [
                variant,
                { ...value, raw: undefined },
              ]),
            ),
          ]),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
}
