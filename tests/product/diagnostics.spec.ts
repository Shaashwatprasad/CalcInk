import { attachJson, draw, expect, openNotebook, test } from './support';

test('PROD-D01 @baseline active replay alpha parity and long-stroke frame samples', async ({
  page,
}, info) => {
  await openNotebook(page);
  const bounds = (await page
    .getByLabel('Drawing canvas', { exact: true })
    .boundingBox())!;
  const points: [number, number][] = Array.from({ length: 240 }, (_, index) => [
    100 + index * 2,
    150 + Math.sin(index / 5) * 25,
  ]);
  // A transparent observer records rAF deltas. Mouse events still drive real input.
  await page.evaluate(() => {
    const samples: number[] = [];
    let previous = performance.now();
    let running = true;
    const frame = (now: number) => {
      if (!running) return;
      samples.push(now - previous);
      previous = now;
      requestAnimationFrame(frame);
    };
    (
      window as unknown as {
        productFrames: { samples: number[]; stop: () => void };
      }
    ).productFrames = {
      samples,
      stop: () => {
        running = false;
      },
    };
    requestAnimationFrame(frame);
  });
  await page.mouse.move(bounds.x + points[0][0], bounds.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1))
    await page.mouse.move(bounds.x + x, bounds.y + y);
  const active = await page
    .locator('.active-layer')
    .evaluate(async (element) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const canvas = element as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
        alpha: Array.from(
          canvas
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height).data,
        ).filter((_, i) => i % 4 === 3),
      };
    });
  await page.mouse.up();
  const parity = await page
    .locator('.ink-layer')
    .evaluate(async (element, before) => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const canvas = element as HTMLCanvasElement;
      const after = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let maxAlphaDifference = 0;
      let differingPixels = 0;
      let activePixels = 0;
      for (let index = 0; index < before.alpha.length; index++) {
        const difference = Math.abs(before.alpha[index] - after[index * 4 + 3]);
        maxAlphaDifference = Math.max(maxAlphaDifference, difference);
        if (difference > 2) differingPixels++;
        if (before.alpha[index]) activePixels++;
      }
      return {
        dpr: devicePixelRatio,
        width: canvas.width,
        height: canvas.height,
        maxAlphaDifference,
        differingPixels,
        activePixels,
      };
    }, active);
  const frames = await page.evaluate(() => {
    const monitor = (
      window as unknown as {
        productFrames: { samples: number[]; stop: () => void };
      }
    ).productFrames;
    monitor.stop();
    return {
      intervalsMs: monitor.samples,
      browser: navigator.userAgent,
      dpr: devicePixelRatio,
    };
  });
  await attachJson(info, 'active-replay-parity', parity);
  await attachJson(info, 'long-single-stroke-frames', frames);
  expect(parity.activePixels).toBeGreaterThan(0);
  expect(parity.width).toBe(active.width);
  expect(parity.height).toBe(active.height);
  expect(
    parity.differingPixels,
    'Pixels differing by >2 alpha levels between active joined stroke and committed replay',
  ).toBe(0);
  expect(frames.intervalsMs.length).toBeGreaterThan(0);
  // Raw samples are retained, with no universal 60-FPS/physical-input claim or noisy timing gate.
});

test('PROD-D02 @baseline recognition never blanks existing ink or resets unchanged projection dimensions', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const events: { kind: string; time: number; layer: string }[] = [];
    for (const property of ['width', 'height'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        property,
      )!;
      Object.defineProperty(HTMLCanvasElement.prototype, property, {
        ...descriptor,
        set(value: number) {
          const canvas = this as HTMLCanvasElement;
          if (
            canvas.classList.contains('projection-layer') &&
            descriptor.get!.call(canvas) === value
          )
            events.push({
              kind: `unchanged-${property}`,
              time: performance.now(),
              layer: canvas.className,
            });
          descriptor.set!.call(canvas, value);
        },
      });
    }
    (
      window as unknown as { productDimensionEvents: unknown[] }
    ).productDimensionEvents = events;
  });
  await openNotebook(page);
  await expect(
    page.getByText('Ready for handwriting', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await draw(page, [
    [100, 150],
    [100, 200],
  ]);
  await expect(page.locator('.recognized-expression')).toHaveText('1', {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const samples: { time: number; alpha: number }[] = [];
    let running = true;
    const sample = () => {
      if (!running) return;
      const canvas = document.querySelector<HTMLCanvasElement>('.ink-layer')!;
      const alpha = canvas
        .getContext('2d')!
        .getImageData(
          Math.round(100 * devicePixelRatio),
          Math.round(175 * devicePixelRatio),
          1,
          1,
        ).data[3];
      samples.push({ time: performance.now(), alpha });
      requestAnimationFrame(sample);
    };
    (
      window as unknown as {
        productInkSamples: { samples: typeof samples; stop: () => void };
      }
    ).productInkSamples = {
      samples,
      stop: () => {
        running = false;
      },
    };
    requestAnimationFrame(sample);
  });
  for (const points of [
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
  ] as [number, number][][])
    await draw(page, points);
  await expect(page.locator('.recognized-lines')).toHaveText('1+1= 2', {
    timeout: 30000,
  });
  const observation = await page.evaluate(() => {
    const state = window as unknown as {
      productInkSamples: {
        samples: { time: number; alpha: number }[];
        stop: () => void;
      };
      productDimensionEvents: unknown[];
    };
    state.productInkSamples.stop();
    return {
      samples: state.productInkSamples.samples,
      unchangedDimensions: state.productDimensionEvents,
    };
  });
  await attachJson(info, 'real-recognition-ink-frame-observation', observation);
  expect(observation.samples.length).toBeGreaterThan(0);
  expect(observation.samples.filter((sample) => sample.alpha === 0)).toEqual(
    [],
  );
  expect(observation.unchangedDimensions).toEqual([]);
});

test('PROD-D03 @baseline layout waste and breakpoint availability observation', async ({
  page,
}, info) => {
  await openNotebook(page);
  const observations = [];
  for (const width of [1440, 1024, 834, 768, 600, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    observations.push(
      await page.evaluate(() => {
        const paper = document.querySelector('.paper')!.getBoundingClientRect();
        const help = document.querySelector('.help-button') as HTMLElement;
        return {
          width: innerWidth,
          height: innerHeight,
          paper: {
            x: paper.x,
            y: paper.y,
            width: paper.width,
            height: paper.height,
          },
          paperAreaFraction:
            (paper.width * paper.height) / (innerWidth * innerHeight),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          helpVisible: Boolean(help?.getClientRects().length),
          browser: navigator.userAgent,
          dpr: devicePixelRatio,
        };
      }),
    );
  }
  await attachJson(
    info,
    'layout-and-controls-baseline-observations',
    observations,
  );
  expect(observations).toHaveLength(8);
  // This observation test does not accept the paper-shell/responsive requirement.
});
