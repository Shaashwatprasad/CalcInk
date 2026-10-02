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
  private saved: { width: number; composite: string }[] = [];
  constructor(public canvas: GridCanvas) {
    this.pixels = Array(canvas.width * canvas.height).fill(0);
  }
  save(): void {
    this.saved.push({
      width: this.lineWidth,
      composite: this.globalCompositeOperation,
    });
  }
  restore(): void {
    const value = this.saved.pop()!;
    this.lineWidth = value.width;
    this.globalCompositeOperation = value.composite;
  }
  setTransform(): void {
    /* Identity coordinates in this geometry fixture. */
  }
  getTransform(): object {
    return {};
  }
  clearRect(): void {
    this.pixels.fill(0);
  }
  beginPath(): void {
    this.path = [];
    this.circle = undefined;
  }
  moveTo(x: number, y: number): void {
    this.path.push(point(x, y));
  }
  lineTo(x: number, y: number): void {
    this.path.push(point(x, y));
  }
  arc(x: number, y: number, radius: number): void {
    this.circle = { x, y, radius };
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
            distanceToSegment(p, this.path[index], end) <= this.lineWidth / 2,
        ),
    );
  }
  drawImage(source: GridCanvas): void {
    source.ctx.pixels.forEach((value, index) => {
      if (value) this.pixels[index] = value;
    });
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
