import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drawDocument,
  drawStroke,
  distanceToSegment,
  pointBounds,
} from '../../src/ink/geometry';
import type { InkDocument, Point, Stroke } from '../../src/shared/types';

const point = (x: number, y: number): Point => ({ x, y, timestamp: 1 });
const stroke = (id: string, points: Point[], width = 2): Stroke => ({
  id,
  points,
  width,
  color: '#000',
  bounds: pointBounds(points, width / 2),
});

/** Binary test rasterizer: checks geometry/compositing; browser QA covers antialiasing. */
class GridCanvas {
  ctx: GridContext;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.ctx = new GridContext(this);
  }
  getContext(): GridContext {
    return this.ctx;
  }
}
class GridContext {
  pixels: number[];
  lineWidth = 1;
  globalCompositeOperation = 'source-over';
  private path: Point[] = [];
  private circle: { x: number; y: number; radius: number } | undefined;
  private transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private saved: {
    width: number;
    composite: string;
    transform: {
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
    };
  }[] = [];
  constructor(public canvas: GridCanvas) {
    this.pixels = Array(canvas.width * canvas.height).fill(0);
  }
  save(): void {
    this.saved.push({
      width: this.lineWidth,
      composite: this.globalCompositeOperation,
      transform: { ...this.transform },
    });
  }
  restore(): void {
    const value = this.saved.pop()!;
    this.lineWidth = value.width;
    this.globalCompositeOperation = value.composite;
    this.transform = value.transform;
  }
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.transform = { a, b, c, d, e, f };
  }
  getTransform() {
    return { ...this.transform };
  }
  clearRect(
    x = 0,
    y = 0,
    width = this.canvas.width,
    height = this.canvas.height,
  ): void {
    if (this.pixels.length !== this.canvas.width * this.canvas.height)
      this.pixels = Array(this.canvas.width * this.canvas.height).fill(0);
    for (let row = y; row < Math.min(y + height, this.canvas.height); row++)
      this.pixels.fill(
        0,
        row * this.canvas.width + x,
        row * this.canvas.width + Math.min(x + width, this.canvas.width),
      );
  }
  private transformed(x: number, y: number): Point {
    const t = this.transform;
    return point(t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f);
  }
  beginPath(): void {
    this.path = [];
    this.circle = undefined;
  }
  moveTo(x: number, y: number): void {
    this.path.push(this.transformed(x, y));
  }
  lineTo(x: number, y: number): void {
    this.path.push(this.transformed(x, y));
  }
  arc(x: number, y: number, radius: number): void {
    this.circle = {
      ...this.transformed(x, y),
      radius: radius * this.transform.a,
    };
  }
  private paint(hit: (p: Point) => boolean): void {
    for (let y = 0; y < this.canvas.height; y++) {
      for (let x = 0; x < this.canvas.width; x++) {
        if (hit(point(x, y)))
          this.pixels[y * this.canvas.width + x] =
            this.globalCompositeOperation === 'destination-out' ? 0 : 1;
      }
    }
  }
  fill(): void {
    const circle = this.circle!;
    this.paint(
      (p) => Math.hypot(p.x - circle.x, p.y - circle.y) <= circle.radius,
    );
  }
  stroke(): void {
    this.paint((p) =>
      this.path
        .slice(1)
        .some(
          (end, index) =>
            distanceToSegment(p, this.path[index], end) <=
            (this.lineWidth * this.transform.a) / 2,
        ),
    );
  }
  drawImage(
    source: GridCanvas,
    sx: number,
    sy: number,
    width: number,
    height: number,
    dx: number,
    dy: number,
    _dw: number,
    _dh: number,
  ): void {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const value = source.ctx.pixels[(sy + y) * source.width + sx + x];
        if (
          value &&
          dx + x >= 0 &&
          dx + x < this.canvas.width &&
          dy + y >= 0 &&
          dy + y < this.canvas.height
        )
          this.pixels[(dy + y) * this.canvas.width + dx + x] = value;
      }
  }
  at(x: number, y: number): number {
    return this.pixels[y * this.canvas.width + x];
  }
  asContext(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }
}
afterEach(() => vi.unstubAllGlobals());

describe('shared drawing geometry', () => {
  it('bounds scratch clearing and copying to stroke pixels independently of fullscreen size', () => {
    vi.stubGlobal('OffscreenCanvas', GridCanvas);
    const ctx = new GridCanvas(320, 200).ctx;
    const copy = vi.spyOn(ctx, 'drawImage').mockImplementation(() => {});
    const clear = vi.spyOn(GridContext.prototype, 'clearRect');
    const ink = stroke('small', [point(20, 30), point(45, 35)], 4);
    ink.opacity = 0.4;
    // Even inaccurate stored bounds must not clip an active or worker-local path.
    ink.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const areas: number[] = [];
    for (const [width, height, offset] of [
      [1280, 950, 0],
      [2830, 1990, 200],
    ]) {
      ctx.canvas.width = width;
      ctx.canvas.height = height;
      ctx.setTransform(2, 0, 0, 2, offset + 0.25, 0.75);
      drawStroke(ctx.asContext(), ink);
      const [layer, sx, sy, w, h, x, y, dw, dh] = copy.mock.lastCall!;
      expect([sx, sy, dw, dh]).toEqual([0, 0, w, h]);
      expect(layer.width * layer.height).toBeLessThan(2000);
      expect(x).toBe(34 + offset);
      expect(y).toBe(54);
      expect(clear.mock.lastCall).toEqual([0, 0, w, h]);
      areas.push(w * h);
    }
    expect(areas[0]).toBe(areas[1]);
    copy.mockRestore();
    clear.mockRestore();
  });

  it('reuses a larger scratch buffer while clearing and copying only the next smaller stroke', () => {
    vi.stubGlobal('OffscreenCanvas', GridCanvas);
    const ctx = new GridCanvas(320, 200).ctx;
    const copy = vi.spyOn(ctx, 'drawImage').mockImplementation(() => {});
    const large = {
      ...stroke('large', [point(20, 30), point(250, 100)]),
      opacity: 0.4,
    };
    drawStroke(ctx.asContext(), large);
    const first = copy.mock.lastCall![0];
    drawStroke(ctx.asContext(), {
      ...stroke('dot', [point(25, 45)]),
      opacity: 0.4,
    });
    const [layer, , , width, height] = copy.mock.lastCall!;
    expect(layer).toBe(first);
    expect(width * height).toBeLessThan((layer.width * layer.height) / 100);
    copy.mockRestore();
  });

  it('skips scratch work for empty and wholly offscreen translucent strokes', () => {
    vi.stubGlobal('OffscreenCanvas', GridCanvas);
    const ctx = new GridCanvas(32, 20).ctx;
    const copy = vi.spyOn(ctx, 'drawImage');
    const clear = vi.spyOn(GridContext.prototype, 'clearRect');
    drawStroke(ctx.asContext(), { ...stroke('empty', []), opacity: 0.4 });
    drawStroke(ctx.asContext(), {
      ...stroke('offscreen', [point(-100, -100)]),
      opacity: 0.4,
    });
    expect(copy).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    copy.mockRestore();
    clear.mockRestore();
  });

  it('cuts a partial hole, keeps both ends, and replays serialized masks identically', () => {
    vi.stubGlobal('OffscreenCanvas', GridCanvas);
    const document: InkDocument = {
      format: 'calcink-document',
      version: 1,
      documentId: 'test',
      generation: 0,
      revision: 2,
      strokes: [stroke('a', [point(2, 10), point(28, 10)])],
      erasures: [
        {
          id: 'mask',
          targetStrokeIds: ['a'],
          path: [point(15, 5), point(15, 15)],
          radius: 3,
        },
      ],
    };
    const ctx = new GridCanvas(32, 20).ctx;
    drawDocument(ctx.asContext(), document);
    expect(ctx.at(15, 10)).toBe(0);
    expect(ctx.at(5, 10)).toBe(1);
    expect(ctx.at(25, 10)).toBe(1);
    const restored = new GridCanvas(32, 20).ctx;
    drawDocument(restored.asContext(), JSON.parse(JSON.stringify(document)));
    expect(restored.pixels).toEqual(ctx.pixels);
  });
  it('does not erase other strokes below or above a targeted stroke', () => {
    vi.stubGlobal('OffscreenCanvas', GridCanvas);
    const masked = stroke('masked', [point(2, 10), point(28, 10)]);
    const crossing = stroke('unmasked', [point(15, 2), point(15, 18)]);
    for (const strokes of [
      [masked, crossing],
      [crossing, masked],
    ]) {
      const ctx = new GridCanvas(32, 20).ctx;
      drawDocument(ctx.asContext(), {
        strokes,
        erasures: [
          {
            id: 'mask',
            targetStrokeIds: ['masked'],
            path: [point(15, 10)],
            radius: 3,
          },
        ],
      });
      expect(ctx.at(15, 10)).toBe(1);
      expect(ctx.at(13, 10)).toBe(0);
    }
  });
  it('uses equivalent capsule geometry for incremental rendering, full replay and dots', () => {
    const points = [point(2, 2), point(7, 8), point(15, 10), point(25, 4)];
    const incremental = new GridCanvas(32, 20).ctx;
    drawStroke(incremental.asContext(), stroke('a', points.slice(0, 1), 4));
    drawStroke(incremental.asContext(), stroke('a', points.slice(0, 3), 4), 1);
    drawStroke(incremental.asContext(), stroke('a', points, 4), 3);
    const replay = new GridCanvas(32, 20).ctx;
    drawStroke(replay.asContext(), stroke('a', points, 4));
    expect(incremental.pixels).toEqual(replay.pixels);
  });
});
