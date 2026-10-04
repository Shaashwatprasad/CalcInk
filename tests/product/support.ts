import { expect, test as base } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { InkDocument } from '../../src/shared/types';

type BrowserIssue = { kind: string; message: string };
type Guard = { issues: BrowserIssue[]; expected: RegExp[] };

/** Observation only: UI operations go through the browser's actual controls. */
export const test = base.extend<{ browserGuard: Guard }>({
  browserGuard: [
    async ({ page }, use, testInfo) => {
      const guard: Guard = { issues: [], expected: [] };
      page.on('pageerror', (error) =>
        guard.issues.push({ kind: 'pageerror', message: error.message }),
      );
      page.on('console', (message) => {
        if (message.type() === 'error')
          guard.issues.push({ kind: 'console', message: message.text() });
      });
      page.on('requestfailed', (request) => {
        if (/\.(?:js|mjs|wasm|onnx|json)(?:\?|$)/u.test(request.url()))
          guard.issues.push({
            kind: 'required-asset',
            message: `${request.url()}: ${request.failure()?.errorText}`,
          });
      });
      page.on('response', (response) => {
        if (
          response.status() >= 400 &&
          /\.(?:js|mjs|wasm|onnx|json)(?:\?|$)/u.test(response.url())
        )
          guard.issues.push({
            kind: 'required-asset',
            message: `${response.status()} ${response.url()}`,
          });
      });
      await use(guard);
      await attachJson(testInfo, 'browser-issues', guard.issues);
      const unexpected = guard.issues.filter(
        (issue) =>
          !guard.expected.some((pattern) => pattern.test(issue.message)),
      );
      expect(
        unexpected,
        'Unexpected browser errors or required asset failures',
      ).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function attachJson(info: TestInfo, name: string, value: unknown) {
  await info.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: 'application/json',
  });
}

export async function openNotebook(page: Page) {
  await page.goto('/');
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
}

export async function draw(
  page: Page,
  points: readonly (readonly [number, number])[],
) {
  const bounds = await page
    .getByLabel('Drawing canvas', { exact: true })
    .boundingBox();
  expect(bounds).not.toBeNull();
  const [firstX, firstY] = points[0];
  await page.mouse.move(bounds!.x + firstX, bounds!.y + firstY);
  await page.mouse.down();
  for (const [x, y] of points.slice(1))
    await page.mouse.move(bounds!.x + x, bounds!.y + y);
  await page.mouse.up();
}

export async function alpha(page: Page, x: number, y: number) {
  return page.locator('.ink-layer').evaluate(
    (element, point) => {
      const canvas = element as HTMLCanvasElement;
      return canvas
        .getContext('2d')!
        .getImageData(
          Math.round(point.x * devicePixelRatio),
          Math.round(point.y * devicePixelRatio),
          1,
          1,
        ).data[3];
    },
    { x, y },
  );
}

export async function exportNotebook(page: Page): Promise<InkDocument> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ink', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/u);
  const path = await download.path();
  expect(path).not.toBeNull();
  const value: InkDocument = JSON.parse(await readFile(path!, 'utf8'));
  expect(value.format).toBe('calcink-document');
  expect(Array.isArray(value.strokes)).toBe(true);
  expect(Array.isArray(value.erasures)).toBe(true);
  return value;
}
/** Ordinary popovers close on paper/export clicks; reopen through the real UI. */
export async function ensureOptions(
  page: Page,
  button: string,
  dialog: string,
): Promise<void> {
  if (
    !(await page.getByRole('dialog', { name: dialog, exact: true }).isVisible())
  )
    await page.getByRole('button', { name: button, exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: dialog, exact: true }),
  ).toBeVisible();
}

export async function importNotebook(
  page: Page,
  value: unknown,
  name = 'fixture.json',
) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import ink', exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(
      typeof value === 'string' ? value : JSON.stringify(value),
    ),
  });
}

/** Independently specified legacy schema fixture, not a screenshot or a model mock. */
export const legacyNotebook = {
  format: 'calcink-document',
  version: 1,
  documentId: 'product-legacy-v1',
  generation: 0,
  revision: 7,
  strokes: [
    {
      id: 'legacy-blue',
      width: 4,
      color: '#2F6FED',
      points: [
        { x: 90, y: 120, timestamp: 1, pressure: 0.4 },
        { x: 280, y: 120, timestamp: 2, pressure: 0.7 },
      ],
      bounds: { minX: 88, minY: 118, maxX: 282, maxY: 122 },
    },
  ],
  erasures: [
    {
      id: 'legacy-cut',
      targetStrokeIds: ['legacy-blue'],
      radius: 10,
      path: [{ x: 180, y: 120, timestamp: 3, pressure: 0.5 }],
    },
  ],
} as const;

/** Synthetic geometry regression only. This is not collected human handwriting. */
export const onePlusOne: readonly (readonly (readonly [number, number])[])[] = [
  [
    [100, 150],
    [100, 200],
  ],
  [
    [145, 175],
    [175, 175],
  ],
  [
    [160, 160],
    [160, 190],
  ],
  [
    [215, 150],
    [215, 200],
  ],
  [
    [250, 169],
    [275, 169],
  ],
  [
    [250, 182],
    [275, 182],
  ],
];

export async function drawArithmetic(page: Page) {
  for (const shape of onePlusOne) await draw(page, shape);
  await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
    timeout: 30000,
  });
}

export const geometry = (document: InkDocument) => ({
  strokes: document.strokes,
  erasures: document.erasures,
});
