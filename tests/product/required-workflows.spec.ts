import { chooseTool } from '../ui-tools';
/**
 * Required V2 product gates. Phase 0 explicitly excludes @v2-required;
 * CALCINK_PRODUCT_REQUIRED=1 executes them at release. No skips/expected failures.
 * Accessible names below are the proposed test contract, not evidence of an implemented UI.
 */
import {
  alpha,
  draw,
  drawArithmetic,
  expect,
  exportNotebook,
  ensureOptions,
  geometry,
  importNotebook,
  legacyNotebook,
  openNotebook,
  test,
} from './support';

test.describe('V2 requirements (pending until implementation and exact-source reports)', () => {
  test.setTimeout(15000);

  test('PROD-V01 @v2-required pen pencil and highlighter colour and width change real ink and survive reload', async ({
    page,
  }) => {
    await openNotebook(page);
    for (const [index, mode] of ['Pen', 'Pencil', 'Highlighter'].entries()) {
      await chooseTool(page, mode);
      const width = page.getByRole('slider', {
        name: 'Stroke width',
        exact: true,
      });
      await width.focus();
      await width.press('End');
      const selectedWidth = Number(await width.inputValue());
      if (mode === 'Highlighter') {
        await page.getByRole('button', { name: 'Yellow', exact: true }).click();
        const opacity = page.getByRole('slider', {
          name: 'Opacity',
          exact: true,
        });
        await opacity.focus();
        await opacity.press('Home');
        await opacity.press('ArrowRight');
      } else {
        await page.getByRole('button', { name: 'Blue', exact: true }).click();
        const pressure = page.getByRole('checkbox', {
          name: 'Pressure',
          exact: true,
        });
        // Checkbox wiring only: variable-pressure ink remains an uncovered action.
        await pressure.check();
        await expect(pressure).toBeChecked();
        await pressure.uncheck();
      }
      await draw(page, [
        [100, 240 + index * 70],
        [300, 240 + index * 70],
      ]);
      const document = await exportNotebook(page);
      expect(document.strokes).toHaveLength(index + 1);
      expect(document.strokes[index].width).toBe(selectedWidth);
      if (mode !== 'Highlighter')
        expect(document.strokes[index].color.toLowerCase()).toBe('#5275ae');
    }
    const original = await exportNotebook(page);
    await expect(
      page.getByText('Saved on this device', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Saved on this device', { exact: true }),
    ).toBeVisible();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
  });

  test('PROD-V02 @v2-required adaptive and explicit pen presets preserve their saved identities', async ({
    page,
  }) => {
    await openNotebook(page);
    for (const [index, colour] of [
      'Auto',
      'Black',
      'Soft white',
      'Blue',
      'Red',
    ].entries()) {
      await page.getByRole('button', { name: 'Pen', exact: true }).click();
      await page.getByRole('button', { name: colour, exact: true }).click();
      await draw(page, [
        [80 + index * 70, 150],
        [80 + index * 70, 200],
      ]);
    }
    const document = await exportNotebook(page);
    expect(document.strokes).toHaveLength(5);
    expect(document.strokes[2].color.toLowerCase()).toBe('#e4e7eb');
    expect(document.strokes[3].color.toLowerCase()).toBe('#5275ae');
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(document));
    await importNotebook(page, legacyNotebook);
    const imported = await exportNotebook(page);
    expect(imported.strokes[0].color).toBe('#2F6FED');
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    expect((await exportNotebook(page)).strokes[0].color).toBe('#2F6FED');
  });

  test('PROD-V03 @v2-required highlighter swatches preserve arithmetic and reversible stroke history', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await openNotebook(page);
    await expect(
      page.getByText('Ready for handwriting', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await drawArithmetic(page);
    const before = await exportNotebook(page);
    for (const [index, colour] of [
      'Yellow',
      'Green',
      'Blue',
      'Pink',
      'Orange',
      'Purple',
    ].entries()) {
      await chooseTool(page, 'Highlighter');
      await page.getByRole('button', { name: colour, exact: true }).click();
      const opacity = page.getByRole('slider', {
        name: 'Opacity',
        exact: true,
      });
      await opacity.focus();
      await opacity.press('End');
      await draw(page, [
        [95, 160 + index * 5],
        [280, 160 + index * 5],
      ]);
    }
    const after = await exportNotebook(page);
    expect(after.strokes).toHaveLength(before.strokes.length + 6);
    expect(
      new Set(after.strokes.slice(-6).map((stroke) => stroke.color)).size,
    ).toBe(6);
    await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
      timeout: 30000,
    });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exportNotebook(page)).strokes).toHaveLength(
      before.strokes.length + 5,
    );
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(after));
  });

  test('PROD-V04 @v2-required eraser mode and radius affect a persistent partial cut', async ({
    page,
  }) => {
    await openNotebook(page);
    await draw(page, [
      [80, 150],
      [300, 150],
    ]);
    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    await page
      .getByRole('radio', { name: 'Partial erase', exact: true })
      .check();
    const radius = page.getByRole('slider', {
      name: 'Eraser radius',
      exact: true,
    });
    await radius.focus();
    await radius.press('Home');
    await radius.press('ArrowRight');
    const selectedRadius = Number(await radius.inputValue());
    await draw(page, [[190, 150]]);
    const erased = await exportNotebook(page);
    expect(erased.strokes).toHaveLength(1);
    expect(erased.erasures).toHaveLength(1);
    expect(erased.erasures[0].radius).toBe(selectedRadius);
    expect(await alpha(page, 190, 150)).toBe(0);
    expect(await alpha(page, 100, 150)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exportNotebook(page)).erasures).toHaveLength(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(erased));
    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    await page
      .getByRole('radio', { name: 'Whole stroke', exact: true })
      .check();
    await draw(page, [[100, 150]]);
    expect((await exportNotebook(page)).strokes).toHaveLength(0);
  });

  test('PROD-V05 @v2-required one open tool panel toggles replaces dismisses and restores focus', async ({
    page,
  }) => {
    await openNotebook(page);
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Pen options', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Pen options', exact: true }),
    ).not.toBeVisible();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await page.getByRole('button', { name: 'Eraser', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Pen options', exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Eraser options', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Eraser options', exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Eraser', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    await expect(
      page.getByRole('dialog', { name: 'Pen options', exact: true }),
    ).not.toBeVisible();
    expect((await exportNotebook(page)).strokes[0].points[0]).toMatchObject({
      x: 100,
      y: 150,
    });
  });

  test('PROD-V06 @v2-required Clear cancel confirmation and undo preserve ink', async ({
    page,
  }) => {
    await openNotebook(page);
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    const original = await exportNotebook(page);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Clear paper', exact: true }),
    ).toBeVisible();
    // Modal background is inert; inspect retained pixels before Cancel instead
    // of attempting to activate Export behind the confirmation dialog.
    expect(await alpha(page, 200, 150)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page
      .getByRole('button', { name: 'Clear paper', exact: true })
      .click();
    expect((await exportNotebook(page)).strokes).toHaveLength(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
  });

  test('PROD-V07 @v2-required Hand free pan and zoom controls preserve coordinates and Space restores Pen', async ({
    page,
  }) => {
    await openNotebook(page);
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    const original = await exportNotebook(page);
    await page.getByRole('button', { name: 'Hand', exact: true }).click();
    await page.getByRole('radio', { name: 'Free pan', exact: true }).check();
    await draw(page, [
      [200, 200],
      [260, 240],
    ]);
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await expect.poll(() => alpha(page, 200, 190)).toBeGreaterThan(0);
    await ensureOptions(page, 'Hand', 'Hand options');
    await page
      .getByRole('radio', { name: 'Vertical scroll', exact: true })
      .check();
    await draw(page, [
      [200, 200],
      [240, 240],
    ]);
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await expect.poll(() => alpha(page, 200, 230)).toBeGreaterThan(0);
    await ensureOptions(page, 'Hand', 'Hand options');
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.getByRole('button', { name: '100%', exact: true }).click();
    await ensureOptions(page, 'Hand', 'Hand options');
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expect.poll(() => alpha(page, 200, 150)).toBeGreaterThan(0);
    await page
      .getByRole('button', { name: 'Fit content', exact: true })
      .click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await page.keyboard.down('Space');
    await draw(page, [
      [200, 200],
      [240, 240],
    ]);
    await page.keyboard.up('Space');
    await expect(
      page.getByRole('button', { name: 'Pen', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await draw(page, [
      [320, 150],
      [340, 150],
    ]);
    expect((await exportNotebook(page)).strokes).toHaveLength(2);
  });

  test('PROD-V08 @v2-required wheel zoom changes viewport without changing ink or history', async ({
    page,
  }) => {
    await openNotebook(page);
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    const original = await exportNotebook(page);
    const canvas = (await page
      .getByLabel('Drawing canvas', { exact: true })
      .boundingBox())!;
    await page.mouse.move(canvas.x + 200, canvas.y + 150);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect(
      page.getByRole('button', { name: '100%', exact: true }),
    ).not.toHaveText('100%');
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exportNotebook(page)).strokes).toHaveLength(0);
  });

  test('PROD-V09 @v2-required paper choices spacing intensity infinite setting preserve ink and history', async ({
    page,
  }) => {
    await openNotebook(page);
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    const original = await exportNotebook(page);
    await page
      .getByRole('button', { name: 'Canvas settings', exact: true })
      .click();
    const backgrounds = new Set<string>();
    for (const name of ['None', 'Dots', 'Grid', 'Ruled', 'Ruled wide']) {
      await ensureOptions(page, 'Canvas settings', 'Canvas settings');
      await page.getByRole('radio', { name, exact: true }).check();
      await expect(
        page.getByRole('radio', { name, exact: true }),
      ).toBeChecked();
      backgrounds.add(
        await page.locator('.paper').evaluate((paper) => {
          const style = getComputedStyle(paper);
          return style.backgroundImage + ';' + style.backgroundSize;
        }),
      );
      expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    }
    expect(backgrounds.size).toBe(5);
    for (const name of ['Spacing', 'Intensity']) {
      await ensureOptions(page, 'Canvas settings', 'Canvas settings');
      const slider = page.getByRole('slider', { name, exact: true });
      const previous = await slider.inputValue();
      await slider.focus();
      await slider.press('End');
      await slider.press('Home');
      expect(await slider.inputValue()).not.toBe(previous);
    }
    const infinite = page.getByRole('checkbox', {
      name: 'Infinite canvas',
      exact: true,
    });
    await infinite.check();
    await expect(infinite).toBeChecked();
    await infinite.uncheck();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exportNotebook(page)).strokes).toHaveLength(0);
  });

  test('PROD-V10 @v2-required text shapes region arrow create annotation objects with undo', async ({
    page,
  }) => {
    await openNotebook(page);
    for (const [index, name] of [
      'Text',
      'Shapes',
      'Box Region',
      'Arrow',
    ].entries()) {
      await page.getByRole('button', { name, exact: true }).click();
      await draw(page, [
        [100 + index * 70, 150],
        [150 + index * 70, 210],
      ]);
      if (name === 'Text') {
        await page
          .getByRole('textbox', { name: 'Text annotation', exact: true })
          .fill('A note, not an operand');
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        const textObject = (await exportNotebook(page)).objects?.find(
          (o) => o.kind === 'text',
        );
        expect(textObject).toMatchObject({
          kind: 'text',
          text: 'A note, not an operand',
          recognitionEligible: false,
        });
        expect(
          await page.locator('.objects-layer').evaluate((element) => {
            const c = element as HTMLCanvasElement;
            return c
              .getContext('2d')!
              .getImageData(0, 0, c.width, c.height)
              .data.some((v, i) => i % 4 === 3 && v > 0);
          }),
        ).toBe(true);
      }
    }
    const document = (await exportNotebook(page)) as unknown as {
      objects?: { kind: string; recognitionEligible: boolean }[];
    };
    expect(document.objects?.map((object) => object.kind).sort()).toEqual([
      'arrow',
      'region',
      'shape',
      'text',
    ]);
    expect(
      document.objects?.every((object) => object.recognitionEligible === false),
    ).toBe(true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(
      ((await exportNotebook(page)) as unknown as { objects: unknown[] })
        .objects,
    ).toHaveLength(3);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(
      ((await exportNotebook(page)) as unknown as { objects: unknown[] })
        .objects,
    ).toHaveLength(4);
  });

  test('PROD-V11 @v2-required Select and Lasso move duplicate delete with reversible history', async ({
    page,
  }) => {
    await openNotebook(page);
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    const original = await exportNotebook(page);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await draw(page, [[180, 150]]);
    await expect(
      page.getByRole('button', { name: 'Duplicate selection', exact: true }),
    ).toBeVisible();
    await draw(page, [
      [200, 150],
      [230, 190],
    ]);
    const moved = await exportNotebook(page);
    expect(moved.strokes[0].points[0].x).toBe(130);
    expect(moved.strokes[0].points[0].y).toBe(190);
    await page
      .getByRole('button', { name: 'Duplicate selection', exact: true })
      .click();
    expect((await exportNotebook(page)).strokes).toHaveLength(2);
    await page
      .getByRole('button', { name: 'Delete selection', exact: true })
      .click();
    expect((await exportNotebook(page)).strokes).toHaveLength(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await exportNotebook(page)).strokes).toHaveLength(2);
    await page.getByRole('button', { name: 'Lasso', exact: true }).click();
    await draw(page, [
      [80, 120],
      [360, 120],
      [360, 240],
      [80, 240],
      [80, 120],
    ]);
    await page
      .getByRole('button', { name: 'Delete selection', exact: true })
      .click();
    expect((await exportNotebook(page)).strokes).toHaveLength(0);
    expect(original.strokes).toHaveLength(1);
  });

  test('PROD-V12 @v2-required real crossing ink assignment and variable use remain distinct from multiplication', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await openNotebook(page);
    await expect(
      page.getByText('Ready for handwriting', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    for (const points of [
      [
        [80, 150],
        [110, 190],
      ],
      [
        [110, 150],
        [80, 190],
      ],
      [
        [135, 164],
        [160, 164],
      ],
      [
        [135, 177],
        [160, 177],
      ],
      [
        [190, 158],
        [202, 150],
        [218, 154],
        [220, 164],
        [190, 195],
        [223, 195],
      ],
    ] as [number, number][][])
      await draw(page, points);
    const correction = page
      .getByRole('button', {
        name: 'Variable x',
        exact: true,
      })
      .last();
    await expect(page.locator('.recognized-expression').last()).toContainText(
      /x\s*=\s*2/u,
      { timeout: 30000 },
    );
    await expect(correction).toBeVisible();
    await correction.click();
    await expect(
      page.getByRole('region', { name: 'Recognition feedback', exact: true }),
    ).toContainText('Defined in this notebook');
    await expect(page.locator('.recognized-expression')).toContainText(
      /x\s*=\s*2/u,
    );
    for (const points of [
      [
        [80, 270],
        [110, 310],
      ],
      [
        [110, 270],
        [80, 310],
      ],
      [
        [135, 290],
        [165, 290],
      ],
      [
        [150, 275],
        [150, 305],
      ],
      [
        [220, 275],
        [210, 270],
        [195, 283],
        [193, 302],
        [205, 312],
        [220, 308],
        [221, 294],
        [208, 288],
        [194, 295],
      ],
      [
        [250, 284],
        [275, 284],
      ],
      [
        [250, 297],
        [275, 297],
      ],
    ] as [number, number][][])
      await draw(page, points);
    await expect(page.locator('.recognized-expression').last()).toContainText(
      /x\s*\+\s*6\s*=/u,
      { timeout: 30000 },
    );
    await expect(correction).toBeVisible();
    await correction.click();
    await expect(
      page.getByRole('region', { name: 'Recognition feedback', exact: true }),
    ).toContainText(/x\s*\+\s*6\s*=\s*8/u);
    await expect(
      page.getByRole('region', { name: 'Recognition feedback', exact: true }),
    ).not.toContainText(/AST|parser/iu);
  });

  test('PROD-V13 @v2-required notebook naming create switch and isolation preserve old ink', async ({
    page,
  }) => {
    await openNotebook(page);
    await page
      .getByRole('textbox', { name: 'Notebook name', exact: true })
      .fill('First notebook');
    await page
      .getByRole('textbox', { name: 'Notebook name', exact: true })
      .press('Enter');
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    const first = await exportNotebook(page);
    await page
      .getByRole('button', { name: 'Open notebook', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'First notebook', exact: true })
      .click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(first));
    await page
      .getByRole('button', { name: 'New notebook', exact: true })
      .click();
    const second = await exportNotebook(page);
    expect(second.documentId).not.toBe(first.documentId);
    expect(second.strokes).toHaveLength(0);
    await page
      .getByRole('button', { name: 'Open notebook', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'First notebook', exact: true })
      .click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(first));
    await page
      .getByRole('button', { name: 'Delete notebook', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: 'Delete notebook',
      exact: true,
    });
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(first));
    await page
      .getByRole('button', { name: 'Delete notebook', exact: true })
      .click();
    await confirmation
      .getByRole('button', { name: 'Delete notebook', exact: true })
      .click();
    expect((await exportNotebook(page)).documentId).toBe(second.documentId);
    await page.reload();
    await expect(
      page.getByText('Saved on this device', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Open notebook', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'First notebook', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Untitled notebook', exact: true }),
    ).toBeVisible();
  });

  test('PROD-V14 @v2-required hide show copy expression and copy answer operate on computed state', async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openNotebook(page);
    await expect(
      page.getByText('Ready for handwriting', { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await drawArithmetic(page);
    const original = await exportNotebook(page);
    await page
      .getByRole('button', { name: 'Copy expression', exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '1+1=',
    );
    await page
      .getByRole('button', { name: 'Copy answer', exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('2');
    await page
      .getByRole('checkbox', { name: 'Show results', exact: true })
      .uncheck();
    await expect
      .poll(() =>
        page.locator('.projection-layer').evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          return canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, i) => i % 4 === 3 && value > 0);
        }),
      )
      .toBe(false);
    await page
      .getByRole('checkbox', { name: 'Show results', exact: true })
      .check();
    await expect
      .poll(() =>
        page.locator('.projection-layer').evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          return canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, i) => i % 4 === 3 && value > 0);
        }),
      )
      .toBe(true);
    expect(geometry(await exportNotebook(page))).toEqual(geometry(original));
  });

  test('PROD-V15 @v2-required conservative scratch erase is undoable and ordinary handwriting survives', async ({
    page,
  }) => {
    await openNotebook(page);
    await draw(page, [
      [100, 150],
      [300, 150],
    ]);
    const before = await exportNotebook(page);
    const scratch: [number, number][] = Array.from(
      { length: 40 },
      (_, index) => [index % 2 ? 240 : 170, 130 + (index % 8) * 5],
    );
    await draw(page, scratch);
    const erased = await exportNotebook(page);
    expect(
      erased.strokes.length < before.strokes.length ||
        erased.erasures.length > before.erasures.length,
    ).toBe(true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(geometry(await exportNotebook(page))).toEqual(geometry(before));
    await draw(page, [
      [330, 150],
      [340, 160],
      [345, 155],
    ]);
    expect((await exportNotebook(page)).strokes).toHaveLength(2);
  });

  test('PROD-V16 @v2-required responsive tools and modal clear stay reachable at every specified width', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await openNotebook(page);
    for (const width of [1440, 1024, 834, 768, 600, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 600)
        await page
          .getByRole('button', { name: 'All tools', exact: true })
          .click();
      for (const name of [
        'Select',
        'Lasso',
        'Pen',
        'Eraser',
        'Text',
        'Shapes',
        'Box Region',
        'Arrow',
        'Hand',
        'Canvas settings',
        'Help',
      ])
        await expect(
          page.getByRole('button', { name, exact: true }),
        ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width < 600) {
        const sizes = await page
          .getByRole('dialog', { name: 'All tools', exact: true })
          .getByRole('button')
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const rect = button.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            }),
          );
        expect(
          sizes.every((size) => size.width >= 44 && size.height >= 44),
        ).toBe(true);
        await page.keyboard.press('Escape');
        await expect(
          page.getByRole('dialog', { name: 'All tools', exact: true }),
        ).not.toBeVisible();
      }
    }
  });
});
