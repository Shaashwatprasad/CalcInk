import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const repo = '/Users/shaashwatprasad/.codex/worktrees/a340/CalcInk';
const require = createRequire(`${repo}/package.json`);
const ts = require('typescript');
const { chromium } = require('playwright');
const load = async (path) => {
  const source = await readFile(`${repo}/${path}`, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
  );
};
const { groupEquations, groupSymbols } = await load(
  'src/recognition/grouping.ts',
);
const { evaluateExpression } = await load('src/math/index.ts');
const stroke = (id, x, y, w, h) => ({
  id,
  color: '#252d38',
  width: 3,
  points: [
    { x, y, timestamp: 1 },
    { x: x + w, y: y + h, timestamp: 2 },
  ],
  bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h },
});
const doc = (strokes) => ({
  format: 'calcink-document',
  version: 1,
  documentId: 'p0-audit',
  generation: 0,
  revision: 0,
  strokes,
  erasures: [],
});
const groupSummary = (strokes) =>
  groupEquations(doc(strokes)).map((g) => ({
    members: g.strokes.map((s) => s.id),
    symbols: groupSymbols(g.strokes).map((s) => s.strokes.map((t) => t.id)),
  }));
const scaleStrokes = (strokes, scale) =>
  strokes.map((s) => ({
    ...s,
    width: s.width * scale,
    points: s.points.map((p) => ({ ...p, x: p.x * scale, y: p.y * scale })),
    bounds: Object.fromEntries(
      Object.entries(s.bounds).map(([key, value]) => [key, value * scale]),
    ),
  }));
const report = {
  syntheticGeometry: {
    sameRow: groupSummary([
      stroke('left', 0, 0, 20, 30),
      stroke('right', 500, 0, 20, 30),
    ]),
    fraction: groupSummary([
      stroke('numerator', 10, 0, 10, 20),
      stroke('fraction-bar', 0, 35, 30, 0),
      stroke('denominator', 10, 50, 10, 20),
    ]),
    scale: [1, 0.1].map((scale) => ({
      scale,
      groups: groupSummary(
        scaleStrokes(
          [stroke('upper', 0, 0, 20, 20), stroke('lower', 0, 40, 20, 20)],
          scale,
        ),
      ),
    })),
    touchingDigits: groupSymbols([
      stroke('digit-a', 0, 0, 10, 30),
      stroke('digit-b', 9, 0, 10, 30),
    ]).map((g) => g.strokes.map((s) => s.id)),
  },
  math: Object.fromEntries(
    ['x=2', 'x+6=', '2×3=', '5+', '2÷0='].map((input) => [
      input,
      evaluateExpression(input),
    ]),
  ),
};
const browser = await chromium.launch({
  headless: true,
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.addInitScript(() => {
  window.__audit = { dimensions: [], errors: [] };
  for (const property of ['width', 'height']) {
    const original = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      property,
    );
    Object.defineProperty(HTMLCanvasElement.prototype, property, {
      ...original,
      set(value) {
        window.__audit.dimensions.push({
          property,
          value,
          before: original.get.call(this),
          className: this.className,
          time: performance.now(),
        });
        original.set.call(this, value);
      },
    });
  }
  window.addEventListener('error', (e) =>
    window.__audit.errors.push(e.message),
  );
  window.addEventListener('unhandledrejection', (e) =>
    window.__audit.errors.push(String(e.reason)),
  );
});
await page.goto('http://127.0.0.1:4175/');
await page.getByText('Saved on this device', { exact: true }).waitFor();
await page.waitForFunction(() =>
  document
    .querySelector('.recognition-status')
    ?.textContent.includes('Ready for handwriting'),
);
await page.evaluate(() => (window.__audit.dimensions = []));
const canvas = await page.getByLabel('Drawing canvas').boundingBox();
await page.mouse.move(canvas.x + 100, canvas.y + 100);
await page.mouse.down();
await page.mouse.move(canvas.x + 100, canvas.y + 150);
await page.mouse.up();
await page.waitForFunction(() =>
  document.querySelector('.recognition-feedback'),
);
report.browser = {
  version: browser.version(),
  ...(await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    dimensions: window.__audit.dimensions,
    errors: window.__audit.errors,
  }))),
};
const geometrySource = await readFile(`${repo}/src/ink/geometry.ts`, 'utf8');
const geometryJs = ts.transpileModule(geometrySource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const geometryUrl = `data:text/javascript;base64,${Buffer.from(geometryJs).toString('base64')}`;
report.antialias = await page.evaluate(async (url) => {
  const { drawStroke } = await import(url);
  const points = [
    { x: 12.3, y: 12.7, timestamp: 0 },
    { x: 31.8, y: 25.2, timestamp: 1 },
    { x: 48.9, y: 10.6, timestamp: 2 },
    { x: 63.1, y: 42.9, timestamp: 3 },
  ];
  const stroke = {
    id: 'synthetic',
    points,
    width: 3,
    color: '#252d38',
    bounds: { minX: 0, minY: 0, maxX: 70, maxY: 50 },
  };
  return [1, 2].map((dpr) => {
    const contexts = [0, 1].map(() => {
      const c = document.createElement('canvas');
      c.width = 80 * dpr;
      c.height = 60 * dpr;
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    });
    for (let i = 1; i <= 4; i++)
      drawStroke(contexts[0], { ...stroke, points: points.slice(0, i) }, i - 1);
    drawStroke(contexts[1], stroke);
    const [p, q] = contexts.map(
      (c) => c.getImageData(0, 0, 80 * dpr, 60 * dpr).data,
    );
    let unequalPixels = 0,
      maxAlphaDifference = 0,
      totalAlphaDifference = 0;
    for (let i = 0; i < p.length; i += 4) {
      if ([0, 1, 2, 3].some((c) => p[i + c] !== q[i + c])) unequalPixels++;
      const delta = Math.abs(p[i + 3] - q[i + 3]);
      maxAlphaDifference = Math.max(maxAlphaDifference, delta);
      totalAlphaDifference += delta;
    }
    return { dpr, unequalPixels, maxAlphaDifference, totalAlphaDifference };
  });
}, geometryUrl);
await browser.close();
await writeFile(
  '/private/tmp/calcink-p0-audit.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
