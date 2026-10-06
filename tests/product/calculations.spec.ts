import {
  test,
  expect,
  openNotebook,
  importNotebook,
  exportNotebook,
} from './support';

const text = (id: string, content: string, y: number, math = true) => ({
  id,
  kind: 'text',
  recognitionEligible: false,
  color: '#252D38',
  colorMode: 'auto',
  strokeWidth: 2,
  opacity: 1,
  x: 120,
  y,
  fontSize: 20,
  text: content,
  math,
});
const notebook = (objects: ReturnType<typeof text>[]) => ({
  format: 'calcink-document',
  version: 2,
  documentId: 'typed-math-test',
  generation: 0,
  revision: 0,
  strokes: [],
  erasures: [],
  objects,
});

test('Typed math uses the shared evaluator and reports zero division beside the source', async ({
  page,
}) => {
  await openNotebook(page);
  await importNotebook(
    page,
    notebook([
      text('definition', 'total=5.75-2.25', 130),
      text('consumer', 'total×2=', 190),
      text('zero', '7÷0=', 250),
      text('note', '8÷2×4=', 310, false),
    ]),
  );
  await expect(page.locator('.recognized-lines')).toContainText(
    'Cannot divide by zero',
  );
  await page.getByRole('tab', { name: /History/ }).click();
  await expect(
    page.getByRole('tabpanel', { name: 'Calculation history' }),
  ).toContainText('total×2= 7');
  await expect(
    page.getByRole('tabpanel', { name: 'Calculation history' }),
  ).not.toContainText('8÷2×4=');
  await expect
    .poll(async () =>
      page.locator('.projection-layer').evaluate((element) => {
        const canvas = element as HTMLCanvasElement,
          context = canvas.getContext('2d')!;
        return [...context.getImageData(260, 250, 300, 25).data].filter(
          (v, i) => i % 4 === 3 && v > 0,
        ).length;
      }),
    )
    .toBeGreaterThan(0);
  const saved = await exportNotebook(page);
  expect(saved.objects?.find((o) => o.id === 'note')).toMatchObject({
    math: false,
  });
  await page.reload();
  await expect(page.locator('.recognized-lines')).toContainText(
    'Cannot divide by zero',
  );
});

test('Text editing toggles math, keeps its ID, and supports undo and clear history', async ({
  page,
}) => {
  await openNotebook(page);
  await importNotebook(
    page,
    notebook([text('editable', '0.25×4=', 170, false)]),
  );
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const canvas = await page
    .getByLabel('Annotation canvas', { exact: true })
    .boundingBox();
  await page.mouse.click(canvas!.x + 130, canvas!.y + 180);
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await page.getByLabel('Calculate as math', { exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.recognized-lines')).toHaveText('0.25×4= 1');
  expect((await exportNotebook(page)).objects?.[0]).toMatchObject({
    id: 'editable',
    math: true,
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Recognition feedback' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.recognized-lines')).toHaveText('0.25×4= 1');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Clear paper', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Recognition feedback' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.recognized-lines')).toHaveText('0.25×4= 1');
});

test('History shows five newest records with older records accessible and notebooks isolated', async ({
  page,
}) => {
  await openNotebook(page);
  await importNotebook(
    page,
    notebook(
      Array.from({ length: 7 }, (_, i) =>
        text(`record-${i}`, `${i}+1=`, 120 + i * 45),
      ),
    ),
  );
  await page.getByRole('tab', { name: /History \(7\)/ }).click();
  const history = page.getByRole('tabpanel', { name: 'Calculation history' });
  await expect(history.locator('[data-record-id]')).toHaveCount(5);
  await expect(history.locator('[data-record-id]').first()).toHaveAttribute(
    'data-record-id',
    'record-6',
  );
  await history
    .getByRole('button', { name: 'Show older calculations' })
    .click();
  await expect(history.locator('[data-record-id]')).toHaveCount(7);
  await page.getByRole('button', { name: 'New notebook', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Recognition feedback' }),
  ).toHaveCount(0);
  const header = await page.locator('.topbar').boundingBox();
  const title = await page
    .getByLabel('Notebook name', { exact: true })
    .boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(header!.y);
  expect(title!.y + title!.height).toBeLessThanOrEqual(
    header!.y + header!.height,
  );
});

test('Typed math stays available when the recognition model cannot load', async ({
  page,
  browserGuard,
}) => {
  browserGuard.expected.push(/503.*symbols\.onnx/u);
  await page.route('**/models/symbols.onnx', (route) =>
    route.fulfill({ status: 503, body: 'deliberate test-only failure' }),
  );
  await openNotebook(page);
  await importNotebook(page, notebook([text('available', '8÷2×4=', 170)]));
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.recognized-lines')).toHaveText('8÷2×4= 16');
});
