import { chooseTool } from '../ui-tools';
/** Deterministic synthetic vector fixtures test the real worker wiring; no accuracy claim. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
const shapes: [number, number][][] = [
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
async function draw(page: Page, points: [number, number][]) {
  const bounds = (await page.getByLabel('Drawing canvas').boundingBox())!;
  await page.mouse.move(bounds.x + points[0][0], bounds.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1))
    await page.mouse.move(bounds.x + x, bounds.y + y);
  await page.mouse.up();
}
test('actual pretrained worker evaluates synthetic vector arithmetic and reloads offline', async ({
  page,
  context,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (
      !r
        .url()
        .startsWith(
          `http://127.0.0.1:${process.env.CALCINK_TEST_PORT ?? 4173}`,
        ) &&
      !r.url().startsWith('data:') &&
      !r.url().startsWith('blob:')
    )
      external.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByText('Ready for handwriting')).toBeVisible({
    timeout: 60000,
  });
  await draw(page, shapes[0]);
  await expect(
    page.getByRole('region', { name: 'Recognition feedback' }),
  ).toBeVisible();
  await expect(page.locator('.recognized-lines')).toHaveText(
    '1 Incomplete · finish the expression with =',
    {
      timeout: 30000,
    },
  );
  for (const shape of shapes.slice(1)) await draw(page, shape);
  await expect(page.getByText('Ready for handwriting')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
    timeout: 30000,
  });
  await expect(page.locator('.recognized-lines')).toBeVisible();
  await chooseTool(page, 'Pixel eraser');
  await draw(page, [
    [100, 145],
    [100, 205],
  ]);
  await expect(page.locator('.recognized-lines')).not.toHaveText('1+1= 2');
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await draw(page, [
    [100, 150],
    [100, 200],
  ]);
  await draw(page, [
    [125, 150],
    [125, 200],
  ]);
  await expect(page.locator('.recognized-lines')).toHaveText('11+1= 12', {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.recognized-lines')).toHaveText('11+1= 12', {
    timeout: 30000,
  });
  await expect(page.locator('.offline-badge')).toHaveText(
    /Offline ready|Assets cached/,
    { timeout: 60000 },
  );
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Ready for handwriting')).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator('.recognized-lines')).toHaveText('11+1= 12', {
    timeout: 30000,
  });
  await chooseTool(page, 'Pixel eraser');
  await draw(page, [
    [248, 169],
    [277, 169],
  ]);
  await draw(page, [
    [248, 182],
    [277, 182],
  ]);
  await expect(page.locator('.recognized-lines')).not.toContainText('12');
  expect(external).toEqual([]);
});

test('actual pretrained worker solves three rows, preserves other answers on edit, and reloads them', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.getByText('Ready for handwriting')).toBeVisible({
    timeout: 60000,
  });
  for (const offset of [0, 180, 360]) {
    for (const shape of shapes)
      await draw(
        page,
        shape.map(([x, y]): [number, number] => [x, y + offset]),
      );
    await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
      timeout: 30000,
    });
  }
  await page.getByRole('tab', { name: /History/ }).click();
  const records = page
    .getByRole('tabpanel', { name: 'Calculation history' })
    .locator('[data-record-id]');
  await expect(records).toHaveCount(3);
  await expect(records).toHaveText(['1+1= 2', '1+1= 2', '1+1= 2']);
  const unchanged = await records.evaluateAll((rows) =>
    [rows[0], rows[2]].map((row) => ({
      id: row.getAttribute('data-record-id')!,
      text: row.textContent,
    })),
  );

  await page.getByRole('tab', { name: 'Current', exact: true }).click();
  await draw(page, [
    [125, 330],
    [125, 380],
  ]);
  await expect(page.locator('.recognized-lines')).toHaveText('11+1= 12', {
    timeout: 30000,
  });
  await page.getByRole('tab', { name: /History/ }).click();
  await expect(records).toHaveCount(3);
  await expect(records).toHaveText(['11+1= 12', '1+1= 2', '1+1= 2']);
  for (const record of unchanged)
    await expect(page.locator(`[data-record-id="${record.id}"]`)).toHaveText(
      record.text!,
    );

  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Ready for handwriting')).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('tab', { name: /History/ }).click();
  await expect(records).toHaveCount(3, { timeout: 30000 });
  await expect(records.filter({ hasText: /^1\+1= 2$/ })).toHaveCount(2);
  await expect(records.filter({ hasText: /^11\+1= 12$/ })).toHaveCount(1);
  await page.screenshot({
    path: test.info().outputPath('multiple-equations.png'),
  });
});
