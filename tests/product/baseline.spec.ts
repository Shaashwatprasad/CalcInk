import { chooseTool } from '../ui-tools';
import {
  alpha,
  attachJson,
  draw,
  drawArithmetic,
  expect,
  exportNotebook,
  geometry,
  importNotebook,
  legacyNotebook,
  openNotebook,
  test,
} from './support';
import { readFileSync } from 'node:fs';

test('PROD-B01 @baseline drawing width affects exported ink and reload', async ({
  page,
}) => {
  await openNotebook(page);
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Redo', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Pen', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const width = page.getByRole('slider', { name: 'Stroke width', exact: true });
  await width.focus();
  await width.press('End');
  await expect(width).toHaveValue('8');
  await draw(page, [
    [100, 160],
    [300, 160],
  ]);
  await expect.poll(() => alpha(page, 200, 163)).toBeGreaterThan(0);
  const document = await exportNotebook(page);
  expect(document.strokes).toHaveLength(1);
  expect(document.strokes[0].width).toBe(8);
  expect(document.strokes[0].points[0]).toMatchObject({ x: 100, y: 160 });
  expect(document.strokes[0].points.at(-1)).toMatchObject({ x: 300, y: 160 });
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(document));
});

test('PROD-B02 @baseline stroke eraser removes only the hit stroke and history restores it', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 120],
    [300, 120],
  ]);
  await draw(page, [
    [100, 200],
    [300, 200],
  ]);
  const original = await exportNotebook(page);
  await chooseTool(page, 'Stroke eraser');
  await expect(
    page.getByRole('button', { name: 'Eraser', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await draw(page, [[200, 120]]);
  await expect.poll(() => alpha(page, 200, 120)).toBe(0);
  expect(await alpha(page, 200, 200)).toBeGreaterThan(0);
  const erased = await exportNotebook(page);
  expect(erased.strokes.map((stroke) => stroke.id)).toEqual([
    original.strokes[1].id,
  ]);
  expect(erased.erasures).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(erased));
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(erased));
});

test('PROD-B03 @baseline partial erase persists a targeted mask and later ink survives', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  const original = await exportNotebook(page);
  await chooseTool(page, 'Pixel eraser');
  await draw(page, [[200, 150]]);
  await expect.poll(() => alpha(page, 200, 150)).toBe(0);
  expect(await alpha(page, 130, 150)).toBeGreaterThan(0);
  expect(await alpha(page, 270, 150)).toBeGreaterThan(0);
  const erased = await exportNotebook(page);
  expect(erased.strokes).toEqual(original.strokes);
  expect(erased.erasures).toHaveLength(1);
  expect(erased.erasures[0].targetStrokeIds).toEqual([original.strokes[0].id]);
  expect(erased.erasures[0].radius).toBe(12);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(erased));
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await draw(page, [[200, 150]]);
  await expect.poll(() => alpha(page, 200, 150)).toBeGreaterThan(0);
  const newer = await exportNotebook(page);
  expect(newer.erasures[0].targetStrokeIds).not.toContain(newer.strokes[1].id);
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(newer));
  expect(await alpha(page, 200, 150)).toBeGreaterThan(0);
});

test('PROD-B04 @baseline P E and history shortcuts perform their advertised operations', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  await page.keyboard.press('e');
  await expect(
    page.getByRole('button', { name: 'Eraser', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await draw(page, [[200, 150]]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => alpha(page, 200, 150)).toBeGreaterThan(0);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => alpha(page, 200, 150)).toBe(0);
  await page.keyboard.press('Meta+z');
  await expect.poll(() => alpha(page, 200, 150)).toBeGreaterThan(0);
  await page.keyboard.press('Meta+y');
  await expect.poll(() => alpha(page, 200, 150)).toBe(0);
  await page.keyboard.press('p');
  await expect(
    page.getByRole('button', { name: 'Pen', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await draw(page, [[200, 150]]);
  await expect.poll(() => alpha(page, 200, 150)).toBeGreaterThan(0);
  await expect(
    page.getByRole('button', { name: 'Redo', exact: true }),
  ).toBeDisabled();
});

test('PROD-B05 @baseline legacy JSON import/export preserves geometry masks and exact explicit blue', async ({
  page,
}) => {
  await openNotebook(page);
  await importNotebook(page, legacyNotebook);
  await expect(page.locator('.notice')).toContainText('Notebook imported');
  const exported = await exportNotebook(page);
  expect(exported.documentId).toBe(legacyNotebook.documentId);
  expect(exported.version).toBe(2);
  expect(exported.strokes).toEqual(
    legacyNotebook.strokes.map((stroke) => ({
      ...stroke,
      kind: 'pen',
      colorMode: 'explicit',
      opacity: 1,
      pressureEnabled: false,
      recognitionEligible: true,
    })),
  );
  expect(exported.erasures).toEqual(legacyNotebook.erasures);
  await expect.poll(() => alpha(page, 180, 120)).toBe(0);
  expect(await alpha(page, 110, 120)).toBeGreaterThan(0);
  await page
    .getByRole('button', { name: 'Dismiss notification', exact: true })
    .click();
  await expect(page.locator('.notice')).not.toBeVisible();
  await importNotebook(page, exported);
  await expect(page.locator('.notice')).toContainText('Notebook imported');
  expect(geometry(await exportNotebook(page))).toEqual(geometry(exported));
});

test('PROD-B06 @baseline malformed and unsupported imports cannot overwrite the saved notebook', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  const original = await exportNotebook(page);
  for (const value of [
    '{ malformed',
    { ...legacyNotebook, version: 99 },
    {
      ...legacyNotebook,
      strokes: [{ ...legacyNotebook.strokes[0], width: -1 }],
    },
  ]) {
    await importNotebook(page, value);
    await expect(page.locator('.notice')).toBeVisible();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await page
      .getByRole('button', { name: 'Dismiss notification', exact: true })
      .click();
  }
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
});

test('PROD-B07 @baseline Help toggle and home navigation preserve the notebook', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  const original = await exportNotebook(page);
  await page.getByRole('button', { name: /How it works/u }).click();
  await expect(
    page.getByText('Start with a simple expression', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /How it works/u }).click();
  await expect(
    page.getByText('Start with a simple expression', { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'CalcInk home', exact: true }).click();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
});

test('PROD-B08 @baseline DPR resize preserves exported geometry and rapid endpoint', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 160],
    [299, 160],
  ]);
  await expect.poll(() => alpha(page, 299, 160)).toBeGreaterThan(0);
  const original = await exportNotebook(page);
  for (const width of [1440, 1024, 834, 768, 600, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const sizing = await page.locator('.ink-layer').evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return {
        width: canvas.width,
        expected: Math.round(
          canvas.getBoundingClientRect().width * devicePixelRatio,
        ),
      };
    });
    await expect
      .poll(async () =>
        page
          .locator('.ink-layer')
          .evaluate(
            (element) =>
              (element as HTMLCanvasElement).width ===
              Math.round(
                element.getBoundingClientRect().width * devicePixelRatio,
              ),
          ),
      )
      .toBe(true);
    expect(sizing.width).toBeGreaterThan(0);
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await expect(
      page.getByRole('button', { name: 'Pen', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect.poll(() => alpha(page, 299, 160)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => alpha(page, 200, 160)).toBe(0);
});

test('PROD-B09 @baseline real worker computes then equals erase retires answer and undo restores it', async ({
  page,
}) => {
  await openNotebook(page);
  await expect(
    page.getByText('Ready for handwriting', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await drawArithmetic(page);
  const before = await exportNotebook(page);
  expect(before.strokes).toHaveLength(6);
  expect(JSON.stringify(before)).not.toContain('answerText');
  const answerPixels = await page
    .locator('.projection-layer')
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((alpha, index) => index % 4 === 3 && alpha > 0);
    });
  expect(answerPixels).toBe(true);
  await chooseTool(page, 'Stroke eraser');
  await draw(page, [
    [260, 170],
    [260, 182],
  ]);
  await expect(page.locator('.recognized-lines')).not.toHaveText('1+1= 2');
  await expect
    .poll(() =>
      page.locator('.projection-layer').evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return canvas
          .getContext('2d')!
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((alpha, index) => index % 4 === 3 && alpha > 0);
      }),
    )
    .toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
    timeout: 30000,
  });
  expect(geometry(await exportNotebook(page))).toEqual(geometry(before));
});

test('PROD-B10 @baseline cached offline reload allows real inference editing and saving', async ({
  page,
  context,
}, info) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (
      !request
        .url()
        .startsWith(
          `http://127.0.0.1:${process.env.CALCINK_TEST_PORT ?? 4173}`,
        ) &&
      !/^(?:blob:|data:)/u.test(request.url())
    )
      remote.push(request.url());
  });
  await openNotebook(page);
  await expect(page.locator('.offline-badge')).toHaveText(/Offline ready/u, {
    timeout: 60000,
  });
  await drawArithmetic(page);
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  const original = await exportNotebook(page);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText('Ready for handwriting', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
    timeout: 30000,
  });
  expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
  await chooseTool(page, 'Pixel eraser');
  await draw(page, [[100, 175]]);
  await expect.poll(() => alpha(page, 100, 175)).toBe(0);
  const edited = await exportNotebook(page);
  expect(edited.erasures).toHaveLength(1);
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Saved on this device', { exact: true }),
  ).toBeVisible();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(edited));
  expect(remote).toEqual([]);
  await attachJson(info, 'network-external', remote);
});

test('PROD-B11 @baseline real model load failure keeps drawing and Retry recovers', async ({
  page,
  browserGuard,
}) => {
  // Only the requested fault is exempt; any unrelated error still fails this case.
  browserGuard.expected.push(
    /symbols\.onnx.*(?:503|ERR_FAILED)|503.*symbols\.onnx|Failed to load resource.*503/u,
  );
  await page.route('**/models/symbols.onnx', (route) =>
    route.fulfill({
      status: 503,
      body: 'Injected model asset failure for error recovery test',
    }),
  );
  await openNotebook(page);
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  await expect.poll(() => alpha(page, 200, 150)).toBeGreaterThan(0);
  const original = await exportNotebook(page);
  await page.unroute('**/models/symbols.onnx');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  // Recovery may finish with an uncertainty message for the retained stroke.
  // Require the completed worker state and a newly processed result instead.
  await expect(page.locator('.recognized-lines > [data-state]')).toHaveCount(
    1,
    { timeout: 60000 },
  );
  await expect(page.locator('.recognition-status i')).toHaveClass('ready', {
    timeout: 60000,
  });
  expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
});

test('PROD-B12 @baseline Clear is undoable and history disabled states are truthful', async ({
  page,
}) => {
  await openNotebook(page);
  await expect(
    page.getByRole('button', { name: 'Clear', exact: true }),
  ).toBeDisabled();
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  const before = await exportNotebook(page);
  await expect(
    page.getByRole('button', { name: 'Clear', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  // Preserve the working V1 operation; PROD-V06 separately enforces mandatory confirmation.
  if (
    await page
      .getByRole('dialog', { name: 'Clear paper', exact: true })
      .isVisible()
  )
    await page
      .getByRole('button', { name: 'Clear paper', exact: true })
      .click();
  expect((await exportNotebook(page)).strokes).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: 'Clear', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(before));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await exportNotebook(page)).strokes).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: 'Redo', exact: true }),
  ).toBeDisabled();
});

test('PROD-B13 @baseline visible controls are declared in the action registry', async ({
  page,
}, info) => {
  const registry = JSON.parse(
    readFileSync(
      new URL('../registry/feature-actions.json', import.meta.url),
      'utf8',
    ),
  ) as {
    actions: { id: string; locator: { role: string; name: string } }[];
  };
  await openNotebook(page);
  await importNotebook(page, legacyNotebook);
  await expect(page.locator('.notice')).toContainText('Notebook imported');
  const observed: { role: string; name: string }[] = [];
  for (const role of ['button', 'link', 'slider'] as const) {
    for (const locator of await page.getByRole(role).all()) {
      if (!(await locator.isVisible())) continue;
      const name = await locator.evaluate((element) =>
        (element.getAttribute('aria-label') || element.textContent || '')
          .replace(/\s+/gu, ' ')
          .trim(),
      );
      observed.push({ role, name });
    }
  }
  const unknown = observed.filter(
    (control) =>
      !registry.actions.some(
        (action) =>
          action.locator.role === control.role &&
          action.locator.name === control.name,
      ),
  );
  await attachJson(info, 'discovered-controls', { observed, unknown });
  expect(
    unknown,
    'New exposed actions must enter the version-controlled registry with meaningful acceptance tests',
  ).toEqual([]);
});

test('PROD-B14 @baseline projection renderer failure keeps ink export and useful notice', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...argumentsList
    ) {
      if (this.classList.contains('projection-layer')) return null;
      return original.apply(this, argumentsList as Parameters<typeof original>);
    } as typeof original;
  });
  await openNotebook(page);
  await expect(page.locator('.notice')).toContainText(
    /projection|answer|Canvas2D|2D/iu,
  );
  await draw(page, [
    [100, 150],
    [300, 150],
  ]);
  await expect.poll(() => alpha(page, 200, 150)).toBeGreaterThan(0);
  expect((await exportNotebook(page)).strokes).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await exportNotebook(page)).strokes).toHaveLength(0);
});
