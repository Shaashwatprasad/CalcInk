import { chooseTool } from '../ui-tools';
import type { CDPSession, Page } from '@playwright/test';
import {
  alpha,
  attachJson,
  draw,
  drawArithmetic,
  expect,
  exportNotebook,
  ensureOptions,
  geometry,
  openNotebook,
  test,
} from './support';

// Read-only CSS/pixel observations. No application state is called to perform navigation.
async function camera(page: Page) {
  return page.locator('.paper').evaluate((paper) => {
    const style = getComputedStyle(paper);
    const [offsetX, offsetY] = style.backgroundPosition
      .split(' ')
      .map(parseFloat);
    return { offsetX, offsetY, zoom: parseFloat(style.backgroundSize) / 22 };
  });
}
async function canvasRect(page: Page) {
  const rect = await page
    .getByLabel('Drawing canvas', { exact: true })
    .boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}
function screen(
  point: readonly [number, number],
  view: { offsetX: number; offsetY: number; zoom: number },
): [number, number] {
  return [
    point[0] * view.zoom + view.offsetX,
    point[1] * view.zoom + view.offsetY,
  ];
}
async function touch(
  session: CDPSession,
  rect: { x: number; y: number },
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  points: readonly (readonly [number, number])[],
) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], index) => ({
      x: rect.x + x,
      y: rect.y + y,
      id: index + 1,
      radiusX: 1,
      radiusY: 1,
      force: 0.5,
    })),
  });
}
async function observeInput(page: Page) {
  await page.addInitScript(() => {
    const observation = {
      trustedTouchDowns: 0,
      trustedPenDowns: 0,
      trustedCancels: 0,
      blurs: 0,
    };
    Object.assign(window, { navigationInputEvidence: observation });
    window.addEventListener('pointerdown', (event) => {
      if (event.isTrusted && event.pointerType === 'touch')
        observation.trustedTouchDowns++;
      if (event.isTrusted && event.pointerType === 'pen')
        observation.trustedPenDowns++;
    });
    window.addEventListener('pointercancel', (event) => {
      if (event.isTrusted) observation.trustedCancels++;
    });
    window.addEventListener('blur', () => {
      observation.blurs++;
    });
  });
}
async function inputEvidence(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          navigationInputEvidence: {
            trustedTouchDowns: number;
            trustedPenDowns: number;
            trustedCancels: number;
            blurs: number;
          };
        }
      ).navigationInputEvidence,
  );
}
async function projectionBounds(page: Page) {
  return page.locator('.projection-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const { data } = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    return Number.isFinite(minX)
      ? {
          minX: minX / devicePixelRatio,
          minY: minY / devicePixelRatio,
          maxX: maxX / devicePixelRatio,
          maxY: maxY / devicePixelRatio,
        }
      : null;
  });
}

test('PROD-N01 Hand camera controls preserve world ink revision and zoom anchor with fitted bounds', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [120, 180],
    [320, 240],
  ]);
  const original = await exportNotebook(page);
  await page.getByRole('button', { name: 'Hand', exact: true }).click();
  await page.getByRole('radio', { name: 'Free pan', exact: true }).check();
  await draw(page, [
    [400, 350],
    [460, 390],
  ]);
  await expect
    .poll(() => camera(page))
    .toEqual({ offsetX: 60, offsetY: 40, zoom: 1 });
  await ensureOptions(page, 'Hand', 'Hand options');
  await page
    .getByRole('radio', { name: 'Vertical scroll', exact: true })
    .check();
  await draw(page, [
    [400, 350],
    [490, 370],
  ]);
  await expect
    .poll(() => camera(page))
    .toEqual({ offsetX: 60, offsetY: 60, zoom: 1 });
  const rect = await canvasRect(page);
  const anchor = { x: rect.width / 2, y: rect.height / 2 };
  const beforeZoom = await camera(page);
  const anchoredWorld = {
    x: (anchor.x - beforeZoom.offsetX) / beforeZoom.zoom,
    y: (anchor.y - beforeZoom.offsetY) / beforeZoom.zoom,
  };
  await ensureOptions(page, 'Hand', 'Hand options');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1.2, 5);
  const afterIn = await camera(page);
  expect((anchor.x - afterIn.offsetX) / afterIn.zoom).toBeCloseTo(
    anchoredWorld.x,
    3,
  );
  expect((anchor.y - afterIn.offsetY) / afterIn.zoom).toBeCloseTo(
    anchoredWorld.y,
    3,
  );
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(() => camera(page)).toEqual(beforeZoom);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: '100%', exact: true }).click();
  await expect.poll(() => camera(page)).toEqual(beforeZoom);
  await ensureOptions(page, 'Hand', 'Hand options');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect
    .poll(() => camera(page))
    .toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
  await expect.poll(() => alpha(page, 120, 180)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Fit content', exact: true }).click();
  const fitted = await camera(page);
  const bounds = original.strokes[0].bounds;
  const expectedZoom = Math.min(
    4,
    Math.max(
      0.25,
      Math.min(
        (rect.width - 48) / (bounds.maxX - bounds.minX),
        (rect.height - 48) / (bounds.maxY - bounds.minY),
      ),
    ),
  );
  expect(fitted.zoom).toBeCloseTo(expectedZoom, 4);
  expect(
    ((bounds.minX + bounds.maxX) / 2) * fitted.zoom + fitted.offsetX,
  ).toBeCloseTo(rect.width / 2, 3);
  expect(
    ((bounds.minY + bounds.maxY) / 2) * fitted.zoom + fitted.offsetY,
  ).toBeCloseTo(rect.height / 2, 3);
  expect(await exportNotebook(page)).toEqual(original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await exportNotebook(page)).strokes).toHaveLength(0);
});

test('PROD-N02 transformed drawing and pixel erase export exact world points masks and reversible geometry', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 200],
    [300, 200],
  ]);
  await page.getByRole('button', { name: 'Hand', exact: true }).click();
  await draw(page, [
    [400, 350],
    [460, 390],
  ]);
  await ensureOptions(page, 'Hand', 'Hand options');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const view = await camera(page);
  await draw(page, [screen([160, 300], view), screen([260, 300], view)]);
  const drawn = await exportNotebook(page);
  expect(drawn.strokes).toHaveLength(2);
  expect(drawn.strokes[1].points[0].x).toBeCloseTo(160, 3);
  expect(drawn.strokes[1].points[0].y).toBeCloseTo(300, 3);
  expect(drawn.strokes[1].points.at(-1)!.x).toBeCloseTo(260, 3);
  expect(drawn.strokes[1].points.at(-1)!.y).toBeCloseTo(300, 3);
  await chooseTool(page, 'Pixel eraser');
  await draw(page, [screen([200, 200], view)]);
  const erased = await exportNotebook(page);
  expect(erased.strokes).toEqual(drawn.strokes);
  expect(erased.erasures).toHaveLength(1);
  expect(erased.erasures[0].targetStrokeIds).toEqual([drawn.strokes[0].id]);
  expect(erased.erasures[0].path[0].x).toBeCloseTo(200, 3);
  expect(erased.erasures[0].path[0].y).toBeCloseTo(200, 3);
  expect(erased.erasures[0].radius).toBeCloseTo(12 / view.zoom, 5);
  const [hitX, hitY] = screen([200, 200], view);
  await expect.poll(() => alpha(page, hitX, hitY)).toBe(0);
  const [outsideX, outsideY] = screen([130, 200], view);
  expect(await alpha(page, outsideX, outsideY)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(geometry(await exportNotebook(page))).toEqual(geometry(drawn));
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

test('PROD-N03 trusted two-touch promotion discards pen and erase previews and pinch pan adds no history', async ({
  page,
  context,
}, info) => {
  await observeInput(page);
  await openNotebook(page);
  await draw(page, [
    [100, 200],
    [350, 200],
  ]);
  const original = await exportNotebook(page);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  try {
    for (const mode of ['Pen', 'Pixel eraser']) {
      await page.getByRole('button', { name: 'Hand', exact: true }).click();
      await page
        .getByRole('button', { name: 'Reset view', exact: true })
        .click();
      await chooseTool(page, mode);
      const rect = await canvasRect(page);
      await touch(session, rect, 'touchStart', [[150, 200]]);
      await touch(session, rect, 'touchMove', [[160, 200]]);
      await touch(session, rect, 'touchStart', [
        [160, 200],
        [260, 200],
      ]);
      await touch(session, rect, 'touchMove', [
        [120, 220],
        [320, 220],
      ]);
      await touch(session, rect, 'touchEnd', []);
      const view = await camera(page);
      expect(view.zoom).toBeCloseTo(2, 3);
      expect(view.offsetX).toBeCloseTo(-200, 2);
      expect(view.offsetY).toBeCloseTo(-180, 2);
      expect(await exportNotebook(page)).toEqual(original);
      await expect(
        page.getByRole('button', { name: 'Redo', exact: true }),
      ).toBeDisabled();
    }
    await page.getByRole('button', { name: 'Hand', exact: true }).click();
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.getByRole('radio', { name: 'Free pan', exact: true }).check();
    const rect = await canvasRect(page);
    await touch(session, rect, 'touchStart', [[400, 300]]);
    await touch(session, rect, 'touchMove', [[440, 320]]);
    await touch(session, rect, 'touchEnd', []);
    await expect
      .poll(() => camera(page))
      .toEqual({ offsetX: 40, offsetY: 20, zoom: 1 });
    expect(await exportNotebook(page)).toEqual(original);
    const observed = await inputEvidence(page);
    expect(observed.trustedTouchDowns).toBeGreaterThanOrEqual(5);
    await attachJson(info, 'trusted-emulated-touch', {
      observed,
      physicalDeviceEvidence: false,
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exportNotebook(page)).strokes).toHaveLength(0);
  } finally {
    await session.detach();
  }
});

test('PROD-N04 trusted pointer cancellation retains ordinary samples and releases camera lock', async ({
  page,
  context,
}, info) => {
  await observeInput(page);
  await openNotebook(page);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  try {
    const rect = await canvasRect(page);
    await touch(session, rect, 'touchStart', [[100, 200]]);
    await touch(session, rect, 'touchMove', [[180, 230]]);
    await touch(session, rect, 'touchCancel', []);
    const cancelled = await exportNotebook(page);
    expect(cancelled.strokes).toHaveLength(1);
    expect(cancelled.strokes[0].points[0]).toMatchObject({ x: 100, y: 200 });
    expect(cancelled.strokes[0].points.at(-1)).toMatchObject({
      x: 180,
      y: 230,
    });
    const observed = await inputEvidence(page);
    expect(observed.trustedCancels).toBeGreaterThan(0);
    await attachJson(info, 'trusted-cancel', {
      observed,
      physicalDeviceEvidence: false,
    });
    await page.getByRole('button', { name: 'Hand', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect
      .poll(async () => (await camera(page)).zoom)
      .toBeCloseTo(1.2, 5);
    expect(await exportNotebook(page)).toEqual(cancelled);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exportNotebook(page)).strokes).toHaveLength(0);
  } finally {
    await session.detach();
  }
});

test('PROD-N05 controlled window blur restores ordinary Pen after Space pan without phantom strokes or camera history', async ({
  page,
}, info) => {
  await observeInput(page);
  await openNotebook(page);
  await draw(page, [
    [100, 200],
    [300, 200],
  ]);
  const original = await exportNotebook(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  await canvas.focus();
  await page.keyboard.down('Space');
  const rect = await canvasRect(page);
  await page.mouse.move(rect.x + 400, rect.y + 300);
  await page.mouse.down();
  await page.mouse.move(rect.x + 430, rect.y + 320);
  await expect
    .poll(() => camera(page))
    .toEqual({ offsetX: 30, offsetY: 20, zoom: 1 });
  const beforeBlur = (await inputEvidence(page)).blurs;
  try {
    // Headless Chromium does not dispatch OS focus loss on bringToFront.
    // Exercise the real registered blur handler with a controlled browser event;
    // native window/device focus evidence remains a separate gate.
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
    await expect
      .poll(async () => (await inputEvidence(page)).blurs)
      .toBeGreaterThan(beforeBlur);
    await page.mouse.up();
    await expect(
      page.getByRole('button', { name: 'Pen', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(await exportNotebook(page)).toEqual(original);
    // No keyup yet: blur itself must retire temporary Space pan.
    await draw(page, [
      [230, 320],
      [330, 320],
    ]);
    const resumed = await exportNotebook(page);
    expect(resumed.strokes).toHaveLength(2);
    expect(resumed.revision).toBe(original.revision + 1);
    expect(resumed.strokes[1].points[0]).toMatchObject({ x: 200, y: 300 });
    expect(resumed.strokes[1].points.at(-1)).toMatchObject({ x: 300, y: 300 });
    await attachJson(info, 'controlled-focus-loss', {
      observed: await inputEvidence(page),
      nativeFocusEvidence: false,
    });
  } finally {
    await page.keyboard.up('Space');
  }
});

test('PROD-N06 actual model projection follows pan and anchored zoom without document revisions', async ({
  page,
}, info) => {
  await openNotebook(page);
  await expect(
    page.getByText('Ready for handwriting', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await drawArithmetic(page);
  const original = await exportNotebook(page);
  await page.getByRole('button', { name: 'Hand', exact: true }).click();
  await expect.poll(() => projectionBounds(page)).not.toBeNull();
  const before = (await projectionBounds(page))!;
  await draw(page, [
    [400, 350],
    [470, 380],
  ]);
  await expect
    .poll(async () => (await projectionBounds(page))?.minX)
    .toBeCloseTo(before.minX + 70, 0);
  const panned = (await projectionBounds(page))!;
  expect(panned.maxX).toBeCloseTo(before.maxX + 70, 0);
  expect(panned.minY).toBeCloseTo(before.minY + 30, 0);
  expect(panned.maxY).toBeCloseTo(before.maxY + 30, 0);
  const rect = await canvasRect(page);
  await ensureOptions(page, 'Hand', 'Hand options');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect
    .poll(async () => {
      const bounds = await projectionBounds(page);
      return bounds
        ? Math.abs(
            bounds.minX -
              ((panned.minX - rect.width / 2) * 1.2 + rect.width / 2),
          )
        : Infinity;
    })
    .toBeLessThanOrEqual(1.5);
  const zoomed = (await projectionBounds(page))!;
  expect(
    Math.abs(
      zoomed.minY - ((panned.minY - rect.height / 2) * 1.2 + rect.height / 2),
    ),
  ).toBeLessThanOrEqual(1.5);
  expect(
    Math.abs(zoomed.maxX - zoomed.minX - (panned.maxX - panned.minX) * 1.2),
  ).toBeLessThanOrEqual(2);
  await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2');
  expect(await exportNotebook(page)).toEqual(original);
  await attachJson(info, 'real-model-camera-projection', {
    before,
    panned,
    zoomed,
  });
});

test('PROD-N07 wheel pan and Control wheel retain anchored world position and document revision', async ({
  page,
}) => {
  await openNotebook(page);
  await draw(page, [
    [100, 200],
    [300, 200],
  ]);
  const original = await exportNotebook(page);
  const rect = await canvasRect(page);
  const anchor = { x: 230, y: 260 };
  await page.mouse.move(rect.x + anchor.x, rect.y + anchor.y);
  await page.mouse.wheel(20, 40);
  await expect
    .poll(() => camera(page))
    .toEqual({ offsetX: -20, offsetY: -40, zoom: 1 });
  await page.keyboard.down('Control');
  try {
    await page.mouse.wheel(0, -300);
  } finally {
    await page.keyboard.up('Control');
  }
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(1);
  const view = await camera(page);
  expect((anchor.x - view.offsetX) / view.zoom).toBeCloseTo(250, 2);
  expect((anchor.y - view.offsetY) / view.zoom).toBeCloseTo(300, 2);
  expect(await exportNotebook(page)).toEqual(original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await exportNotebook(page)).strokes).toHaveLength(0);
});

test('PROD-N08 trusted pen and eraser gestures survive secondary two-touch navigation attempts', async ({
  page,
  context,
}, info) => {
  await observeInput(page);
  await openNotebook(page);
  const initial = await exportNotebook(page);
  expect(initial.strokes).toHaveLength(0);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  try {
    for (const mode of ['Pen', 'Pixel eraser']) {
      await chooseTool(page, mode);
      const rect = await canvasRect(page);
      const start = mode === 'Pen' ? 100 : 200;
      await session.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: rect.x + start,
        y: rect.y + 200,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        pointerType: 'pen',
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rect.x + (mode === 'Pen' ? 180 : 200),
        y: rect.y + 200,
        buttons: 1,
        pointerType: 'pen',
      });
      await touch(session, rect, 'touchStart', [[150, 320]]);
      await touch(session, rect, 'touchStart', [
        [150, 320],
        [250, 320],
      ]);
      await touch(session, rect, 'touchMove', [
        [100, 340],
        [300, 340],
      ]);
      expect(await camera(page)).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rect.x + (mode === 'Pen' ? 300 : 200),
        y: rect.y + 200,
        buttons: 1,
        pointerType: 'pen',
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x + (mode === 'Pen' ? 300 : 200),
        y: rect.y + 200,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        pointerType: 'pen',
      });
      await touch(session, rect, 'touchEnd', []);
      const document = await exportNotebook(page);
      expect(document.strokes).toHaveLength(1);
      expect(document.strokes[0].points[0]).toMatchObject({ x: 100, y: 200 });
      expect(document.strokes[0].points.at(-1)).toMatchObject({
        x: 300,
        y: 200,
      });
      expect(document.revision).toBe(
        initial.revision + (mode === 'Pen' ? 1 : 2),
      );
      expect(document.erasures).toHaveLength(mode === 'Pen' ? 0 : 1);
      if (mode === 'Pixel eraser') {
        expect(document.erasures[0].targetStrokeIds).toEqual([
          document.strokes[0].id,
        ]);
        expect(document.erasures[0].path[0]).toMatchObject({ x: 200, y: 200 });
        await expect.poll(() => alpha(page, 200, 200)).toBe(0);
        expect(await alpha(page, 130, 200)).toBeGreaterThan(0);
      }
    }
    const observed = await inputEvidence(page);
    expect(observed.trustedPenDowns).toBe(2);
    expect(observed.trustedTouchDowns).toBeGreaterThanOrEqual(4);
    await attachJson(info, 'trusted-mixed-pointer', {
      observed,
      physicalDeviceEvidence: false,
    });
  } finally {
    await session.detach();
  }
});
