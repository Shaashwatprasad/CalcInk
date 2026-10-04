import { chooseTool } from '../ui-tools';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
async function draw(page: Page, points: [number, number][]) {
  const bounds = (await page.getByLabel('Drawing canvas').boundingBox())!;
  await page.mouse.move(bounds.x + points[0][0], bounds.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1))
    await page.mouse.move(bounds.x + x, bounds.y + y);
  await page.mouse.up();
}
async function pixels(page: Page, x: number, y: number) {
  return page.locator('.ink-layer').evaluate(
    (canvas, p) => {
      const c = canvas as HTMLCanvasElement;
      const dpr = devicePixelRatio;
      return c
        .getContext('2d')!
        .getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1)
        .data[3];
    },
    { x, y },
  );
}
test('drawing, partial erase, undo/redo, persistence and newer ink', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  await expect.poll(() => pixels(page, 200, 150)).toBeGreaterThan(0);
  await chooseTool(page, 'Pixel eraser');
  await draw(page, [[200, 150]]);
  await expect.poll(() => pixels(page, 200, 150)).toBe(0);
  expect(await pixels(page, 140, 150)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => pixels(page, 200, 150)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => pixels(page, 200, 150)).toBe(0);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect.poll(() => pixels(page, 200, 150)).toBe(0);
  expect(await pixels(page, 140, 150)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await draw(page, [[200, 150]]);
  await expect.poll(() => pixels(page, 200, 150)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Clear paper', exact: true }).click();
  await expect.poll(() => pixels(page, 140, 150)).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => pixels(page, 140, 150)).toBeGreaterThan(0);
});
test('high-DPI backing store and rapid pointer up retain endpoints', async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1100, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await draw(page, [
    [100, 160],
    [300, 160],
  ]);
  await expect.poll(() => pixels(page, 299, 160)).toBeGreaterThan(0);
  const size = await page.locator('.ink-layer').evaluate((c) => ({
    width: (c as HTMLCanvasElement).width,
    css: c.getBoundingClientRect().width,
  }));
  expect(size.width).toBe(Math.round(size.css * 2));
  await page.setViewportSize({ width: 950, height: 900 });
  await expect.poll(() => pixels(page, 299, 160)).toBeGreaterThan(0);
  await context.close();
});
test('production shell reloads offline and preserves ink without external requests', async ({
  page,
  context,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (
      !r.url().startsWith('http://127.0.0.1:4173') &&
      !r.url().startsWith('data:') &&
      !r.url().startsWith('blob:')
    )
      external.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page.locator('.offline-badge')).toHaveText(/Offline ready/, {
    timeout: 60000,
  });
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect.poll(() => pixels(page, 200, 150)).toBeGreaterThan(0);
  await chooseTool(page, 'Pixel eraser');
  await draw(page, [[200, 150]]);
  await expect.poll(() => pixels(page, 200, 150)).toBe(0);
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect.poll(() => pixels(page, 200, 150)).toBe(0);
  expect(external).toEqual([]);
});
