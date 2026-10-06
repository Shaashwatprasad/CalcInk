/** Synthetic vector fixtures exercise the real model, geometry and parser together.
 * They are regression examples, not a measured handwriting validation dataset. */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
type Path = [number, number][];
const ellipse = (x: number, y: number, rx: number, ry: number): Path =>
  Array.from({ length: 33 }, (_, i) => [
    x + rx * Math.cos((i * Math.PI) / 16),
    y + ry * Math.sin((i * Math.PI) / 16),
  ]);
const glyphs: Record<string, Path[]> = {
  '0': [ellipse(13, 25, 13, 25)],
  '8': [[...ellipse(13, 12, 12, 12), ...ellipse(13, 37, 13, 13)]],
  '2': [
    [
      [0, 8],
      [5, 2],
      [12, 0],
      [20, 2],
      [26, 9],
      [26, 16],
      [21, 23],
      [0, 50],
      [27, 50],
    ],
  ],
  '4': [
    [
      [20, 0],
      [0, 32],
      [27, 32],
    ],
    [
      [21, 0],
      [21, 50],
    ],
  ],
  '5': [
    [
      [26, 0],
      [0, 0],
      [0, 22],
      [8, 18],
      [17, 18],
      [25, 24],
      [28, 35],
      [25, 44],
      [18, 50],
      [8, 50],
      [0, 46],
    ],
  ],
  '7': [
    [
      [0, 0],
      [27, 0],
      [6, 50],
    ],
  ],
  '×': [
    [
      [0, 10],
      [25, 40],
    ],
    [
      [0, 40],
      [25, 10],
    ],
  ],
  '÷': [
    [
      [0, 25],
      [27, 25],
    ],
    [[13, 9]],
    [[13, 41]],
  ],
  '−': [
    [
      [0, 25],
      [27, 25],
    ],
  ],
  '.': [[[0, 48]]],
  '=': [
    [
      [0, 19],
      [27, 19],
    ],
    [
      [0, 32],
      [27, 32],
    ],
  ],
};
async function drawExpression(page: Page, expression: string) {
  const bounds = (await page
    .getByLabel('Drawing canvas', { exact: true })
    .boundingBox())!;
  let offset = 100;
  for (const label of expression) {
    for (const path of glyphs[label]) {
      await page.mouse.move(
        bounds.x + offset + path[0][0],
        bounds.y + 150 + path[0][1],
      );
      await page.mouse.down();
      for (const [x, y] of path.slice(1))
        await page.mouse.move(bounds.x + offset + x, bounds.y + 150 + y);
      await page.mouse.up();
    }
    offset += label === '.' ? 15 : 45;
  }
}
for (const [expression, answer] of [
  ['8÷2×4=', '16'],
  ['0.25×4=', '1'],
  ['5.75−2.25=', '3.5'],
])
  test(`actual pretrained worker recognizes ${expression} and evaluates ${answer}`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByText('Ready for handwriting', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await drawExpression(page, expression);
    await expect(page.locator('.recognized-expression')).toHaveText(
      expression,
      { timeout: 30000 },
    );
    const result = page.locator('.recognized-lines > [data-state="valid"]');
    await expect(result.locator(':scope > span').nth(1)).toHaveText(answer, {
      timeout: 30000,
    });
  });
