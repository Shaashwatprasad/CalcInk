import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  drawDocument,
  drawStroke,
  distanceToSegment,
  pointBounds,
  pressureWidth,
  resolveInkColor,
  strokeIntersectsPath,
} from '../../src/ink/geometry';
import { InkStore, createInkDocument } from '../../src/document/InkStore';
import { validateDocument } from '../../src/persistence/document';
import {
  groupEquations,
  groupSymbols,
  unionBounds,
} from '../../src/recognition/grouping';
import { rasterizeSymbol } from '../../src/recognition/preprocess';
import { isWorkerRequest } from '../../src/recognition/protocol';
import type { InkDocument, Point, Stroke } from '../../src/shared/types';

const point = (x: number, y: number, pressure?: number): Point => ({
  x,
  y,
  timestamp: 1,
  pressure,
});
const stroke = (id: string, style: Partial<Stroke> = {}): Stroke => {
  const points = style.points ?? [point(3, 10), point(27, 10)];
  const width = style.width ?? 4;
  return {
    id,
    color: '#2F6FED',
    width,
    points,
    bounds: pointBounds(points, width / 2),
    ...style,
  };
};
const document = (strokes: Stroke[]): InkDocument => ({
  ...createInkDocument(),
  version: 1,
  documentId: 'fixture',
  strokes,
});

/** Deterministic coverage/compositing fixture, not a model mock or browser-AA claim.
 * Every paint blends source alpha into the target, exposing repeated join blends. */
class AlphaCanvas {
  static instances = 0;
  ctx: AlphaContext;
  constructor(
    public width: number,
    public height: number,
  ) {
    AlphaCanvas.instances++;
    this.ctx = new AlphaContext(this);
  }
  getContext() {
    return this.ctx;
  }
}
class AlphaContext {
  pixels: number[];
  lineWidth = 1;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  strokeStyle = '#000000';
  fillStyle = '#000000';
  lineCap = 'round';
  lineJoin = 'round';
  private transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private path: Point[] = [];
  private circle?: { x: number; y: number; radius: number };
  private states: {
    width: number;
    alpha: number;
    composite: string;
    stroke: string;
    fill: string;
    transform: {
      a: number;
      b: number;
      c: number;
      d: number;
      e: number;
      f: number;
    };
  }[] = [];
  constructor(public canvas: AlphaCanvas) {
    this.pixels = Array(canvas.width * canvas.height * 4).fill(0);
  }
  asContext() {
    return this as unknown as CanvasRenderingContext2D;
  }
  save() {
    this.states.push({
      width: this.lineWidth,
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      stroke: this.strokeStyle,
      fill: this.fillStyle,
      transform: { ...this.transform },
    });
  }
  restore() {
    const s = this.states.pop()!;
    this.lineWidth = s.width;
    this.globalAlpha = s.alpha;
    this.globalCompositeOperation = s.composite;
    this.strokeStyle = s.stroke;
    this.fillStyle = s.fill;
    this.transform = s.transform;
  }
  setTransform(
    a: number | typeof this.transform,
    b?: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number,
  ) {
    this.transform =
      typeof a === 'object'
        ? { ...a }
        : { a, b: b!, c: c!, d: d!, e: e!, f: f! };
  }
  getTransform() {
    return { ...this.transform };
  }
  clearRect(
    x = 0,
    y = 0,
    width = this.canvas.width,
    height = this.canvas.height,
  ) {
    if (this.pixels.length !== this.canvas.width * this.canvas.height * 4)
      this.pixels = Array(this.canvas.width * this.canvas.height * 4).fill(0);
    for (let row = y; row < Math.min(y + height, this.canvas.height); row++)
      this.pixels.fill(
        0,
        (row * this.canvas.width + x) * 4,
        (row * this.canvas.width + Math.min(x + width, this.canvas.width)) * 4,
      );
  }
  beginPath() {
    this.path = [];
    this.circle = undefined;
  }
  private transformed(x: number, y: number) {
    const t = this.transform;
    return point(x * t.a + y * t.c + t.e, x * t.b + y * t.d + t.f);
  }
  moveTo(x: number, y: number) {
    this.path.push(this.transformed(x, y));
  }
  lineTo(x: number, y: number) {
    this.path.push(this.transformed(x, y));
  }
  arc(x: number, y: number, radius: number) {
    this.circle = {
      ...this.transformed(x, y),
      radius: radius * this.transform.a,
    };
  }
  private blend(index: number, rgb: number[], alpha: number) {
    const targetAlpha = this.pixels[index + 3];
    if (this.globalCompositeOperation === 'destination-out') {
      this.pixels[index + 3] *= 1 - alpha;
      return;
    }
    const outAlpha = alpha + targetAlpha * (1 - alpha);
    for (let c = 0; c < 3; c++)
      this.pixels[index + c] = outAlpha
        ? (rgb[c] * alpha +
            this.pixels[index + c] * targetAlpha * (1 - alpha)) /
          outAlpha
        : 0;
    this.pixels[index + 3] = outAlpha;
  }
  private rgb(color: string) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
    return [0, 2, 4].map(
      (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
    );
  }
  private paint(hit: (p: Point) => boolean, color: string) {
    for (let y = 0; y < this.canvas.height; y++)
      for (let x = 0; x < this.canvas.width; x++)
        if (hit(point(x, y)))
          this.blend(
            (y * this.canvas.width + x) * 4,
            this.rgb(color),
            this.globalAlpha,
          );
  }
  fill() {
    const circle = this.circle!;
    this.paint(
      (p) => Math.hypot(p.x - circle.x, p.y - circle.y) <= circle.radius,
      this.fillStyle,
    );
  }
  fillRect() {
    this.paint(() => true, this.fillStyle);
  }
  stroke() {
    this.paint(
      (p) =>
        this.path
          .slice(1)
          .some(
            (end, i) =>
              distanceToSegment(p, this.path[i], end) <=
              (this.lineWidth * this.transform.a) / 2,
          ),
      this.strokeStyle,
    );
  }
  drawImage(
    source: AlphaCanvas,
    sx: number,
    sy: number,
    width: number,
    height: number,
    dx: number,
    dy: number,
  ) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (
          dx + x < 0 ||
          dx + x >= this.canvas.width ||
          dy + y < 0 ||
          dy + y >= this.canvas.height
        )
          continue;
        const sourceIndex = ((sy + y) * source.width + sx + x) * 4;
        this.blend(
          ((dy + y) * this.canvas.width + dx + x) * 4,
          source.ctx.pixels.slice(sourceIndex, sourceIndex + 3),
          source.ctx.pixels[sourceIndex + 3] * this.globalAlpha,
        );
      }
  }
  getImageData() {
    return { data: new Uint8ClampedArray(this.pixels.map((p) => p * 255)) };
  }
  rgba(x: number, y: number) {
    const i = (y * this.canvas.width + x) * 4;
    return this.pixels.slice(i, i + 4);
  }
}
afterEach(() => vi.unstubAllGlobals());

function render(strokes: Stroke[], erasures: InkDocument['erasures'] = []) {
  vi.stubGlobal('OffscreenCanvas', AlphaCanvas);
  const canvas = new AlphaCanvas(32, 24);
  drawDocument(canvas.ctx.asContext(), { strokes, erasures });
  return canvas.ctx;
}

describe('V2 migration and worker boundary', () => {
  it('clones V1 to V2 preserving legacy blue identity and opaque pen defaults', () => {
    const legacy = document([stroke('legacy')]);
    const migrated = validateDocument(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.strokes[0]).toMatchObject({
      color: '#2F6FED',
      kind: 'pen',
      colorMode: 'explicit',
      opacity: 1,
      pressureEnabled: false,
      recognitionEligible: true,
    });
    expect(resolveInkColor(migrated.strokes[0], 'dark')).toBe('#2F6FED');
    expect(legacy.version).toBe(1);
    expect(legacy.strokes[0].kind).toBeUndefined();
    const polluted = {
      ...legacy,
      arbitrary: 'discard',
      strokes: [{ ...legacy.strokes[0], arbitrary: 'discard' }],
    };
    expect(validateDocument(polluted)).not.toHaveProperty('arbitrary');
    expect(validateDocument(polluted).strokes[0]).not.toHaveProperty(
      'arbitrary',
    );
    expect(migrated.strokes[0].points).not.toBe(legacy.strokes[0].points);
    expect(createInkDocument().version).toBe(2);
    expect(isWorkerRequest({ type: 'GROUP', document: legacy })).toBe(true);
    expect(isWorkerRequest({ type: 'GROUP', document: migrated })).toBe(true);
  });
  it('rejects malformed style and pressure at import, store and worker boundaries', () => {
    for (const style of [
      { kind: 'annotation' },
      { colorMode: 'theme' },
      { opacity: NaN },
      { opacity: -0.1 },
      { opacity: 1.1 },
      { pressureEnabled: 'yes' },
      { recognitionEligible: 1 },
      { points: [point(1, 1, -0.1)] },
    ]) {
      const malformed = stroke('bad', style as Partial<Stroke>);
      expect(() => validateDocument(document([malformed]))).toThrow();
      expect(() => new InkStore().addStroke(malformed)).toThrow();
      expect(
        isWorkerRequest({ type: 'GROUP', document: document([malformed]) }),
      ).toBe(false);
    }
    expect(() => validateDocument({ ...document([]), version: 3 })).toThrow();
  });
  it('retains tool semantics and masks across serialization, erasure, undo and redo', () => {
    const store = new InkStore();
    store.addStroke(
      stroke('pencil', {
        kind: 'pencil',
        colorMode: 'auto',
        opacity: 0.7,
        pressureEnabled: true,
        points: [point(3, 10, 0.2), point(27, 10, 0.2)],
      }),
    );
    store.addStroke(
      stroke('highlight', {
        kind: 'highlighter',
        opacity: 0.3,
        recognitionEligible: false,
      }),
    );
    store.eraseRegion([point(15, 10)], 2);
    const saved = validateDocument(
      JSON.parse(JSON.stringify(store.getSnapshot())),
    );
    const recovered = new InkStore(saved);
    expect(recovered.getSnapshot().strokes).toEqual(
      store.getSnapshot().strokes,
    );
    expect(recovered.getSnapshot().erasures).toEqual(
      store.getSnapshot().erasures,
    );
    store.eraseStrokes([point(15, 10)], 1);
    expect(store.getSnapshot().strokes).toEqual([]);
    store.undo();
    expect(store.getSnapshot().erasures).toEqual(saved.erasures);
    store.redo();
    expect(store.getSnapshot().erasures).toEqual([]);
    store.undo();
    store.undo();
    expect(store.getSnapshot().erasures).toEqual([]);
    store.redo();
    expect(store.getSnapshot().erasures).toEqual(saved.erasures);
  });
});

describe('eligibility and canonical ink', () => {
  it('annotation additions/erasures and cosmetic changes preserve math group identity and revision', () => {
    const math = stroke('math');
    const baseline = groupEquations(document([math]))[0];
    const highlighted = document([
      math,
      stroke('highlight', { kind: 'highlighter', recognitionEligible: true }),
      stroke('note', { recognitionEligible: false }),
    ]);
    highlighted.erasures.push({
      id: 'note-mask',
      targetStrokeIds: ['highlight', 'note'],
      path: [point(10, 10)],
      radius: 2,
    });
    expect(groupEquations(highlighted)[0]).toEqual(baseline);
    expect(groupSymbols(highlighted.strokes)).toHaveLength(1);
    const cosmetic = {
      ...math,
      kind: 'pencil' as const,
      colorMode: 'auto' as const,
      color: '#ffffff',
      opacity: 0.2,
    };
    expect(groupEquations(document([cosmetic]))[0].revision).toBe(
      baseline.revision,
    );
    highlighted.erasures[0].targetStrokeIds.push('math');
    expect(groupEquations(highlighted)[0].revision).not.toBe(baseline.revision);
  });
  it('resolves Auto at paint time and keeps canonical tensors invariant across colors, opacity and annotations', () => {
    vi.stubGlobal('OffscreenCanvas', AlphaCanvas);
    const math = stroke('math', {
      kind: 'pencil',
      pressureEnabled: true,
      points: [point(3, 10, 0.2), point(27, 10, 0.8)],
    });
    const auto = { ...math, colorMode: 'auto' as const, opacity: 0.25 };
    expect(resolveInkColor(auto)).toBe('#252D38');
    expect(resolveInkColor(auto, 'dark')).toBe('#E4E7EB');
    const bounds = unionBounds([math]);
    const tensor = (strokes: Stroke[]) =>
      rasterizeSymbol({ strokes, bounds }, [], bounds).data;
    const baseline = tensor([math]);
    expect(baseline.some((v) => v === 0)).toBe(true);
    expect(tensor([auto])).toEqual(baseline);
    expect(tensor([{ ...math, color: '#ffffff', opacity: 0 }])).toEqual(
      baseline,
    );
    expect(
      tensor([math, stroke('annotation', { kind: 'highlighter', width: 20 })]),
    ).toEqual(baseline);
    expect(
      rasterizeSymbol(
        {
          strokes: [stroke('annotation', { recognitionEligible: false })],
          bounds,
        },
        [],
        bounds,
      ).visible,
    ).toBe(false);
    expect(tensor([{ ...math, pressureEnabled: false }])).not.toEqual(baseline);
  });
});

describe('shared pressure and alpha geometry', () => {
  it('uses actual pressure capsules in render/hit and minimum width for zero and full width for missing pressure', () => {
    const pencil = stroke('pencil', {
      kind: 'pencil',
      width: 8,
      pressureEnabled: true,
      points: [point(3, 10, 0.2), point(27, 10, 0.2)],
    });
    expect(pressureWidth(pencil, pencil.points[0])).toBeCloseTo(3.2);
    expect(pressureWidth(pencil, point(0, 0, 0))).toBe(2);
    expect(pressureWidth(pencil, point(0, 0))).toBe(8);
    const narrow = render([pencil]);
    expect(narrow.rgba(15, 11)[3]).toBe(1);
    expect(narrow.rgba(15, 13)[3]).toBe(0);
    expect(strokeIntersectsPath(pencil, [point(15, 13)], 0.1)).toBe(false);
    const constant = { ...pencil, pressureEnabled: false };
    expect(render([constant]).rgba(15, 13)[3]).toBe(1);
    expect(strokeIntersectsPath(constant, [point(15, 13)], 0.1)).toBe(true);
    const masked = render(
      [pencil],
      [
        {
          id: 'cut',
          targetStrokeIds: ['pencil'],
          path: [point(15, 10)],
          radius: 2,
        },
      ],
    );
    expect(masked.rgba(15, 10)[3]).toBe(0);
    expect(masked.rgba(5, 10)[3]).toBe(1);
  });
  it('rejects pressure append before painting, then clears changed start-dot geometry on full replay', () => {
    vi.stubGlobal('OffscreenCanvas', AlphaCanvas);
    const active = new AlphaCanvas(32, 24).ctx;
    const initial = stroke('ramp', {
      width: 8,
      pressureEnabled: true,
      points: [point(3, 10, 1)],
    });
    drawStroke(active.asContext(), initial);
    expect(active.rgba(0, 10)[3]).toBe(1);
    const final = { ...initial, points: [point(3, 10, 1), point(27, 10, 0)] };
    const before = [...active.pixels];
    expect(() => drawStroke(active.asContext(), final, 1)).toThrow(
      'full replay',
    );
    expect(active.pixels).toEqual(before);
    active.clearRect();
    drawStroke(active.asContext(), final);
    expect(active.rgba(0, 10)[3]).toBe(0);
    expect(active.pixels).toEqual(render([final]).pixels);
    const zeroDot = stroke('zero', {
      width: 8,
      pressureEnabled: true,
      points: [point(15, 10, 0)],
    });
    expect(render([zeroDot]).rgba(17, 10)[3]).toBe(0);
    const mouseDot = { ...zeroDot, points: [point(15, 10)] };
    expect(render([mouseDot]).rgba(17, 10)[3]).toBe(1);
  });
  it('composites highlighter alpha once at joins, self crossings and replay, below pen ink', () => {
    const highlighter = stroke('highlight', {
      kind: 'highlighter',
      color: '#ffff00',
      opacity: 0.3,
      points: [point(3, 10), point(20, 10), point(8, 10), point(20, 10)],
    });
    const ctx = render([highlighter]);
    expect(ctx.rgba(12, 10)[3]).toBeCloseTo(0.3);
    expect(ctx.rgba(20, 10)[3]).toBeCloseTo(0.3);
    const allocated = AlphaCanvas.instances;
    ctx.clearRect();
    drawDocument(ctx.asContext(), { strokes: [highlighter], erasures: [] });
    expect(ctx.rgba(12, 10)[3]).toBeCloseTo(0.3);
    expect(AlphaCanvas.instances).toBe(allocated);
    const pen = stroke('pen', { color: '#000000' });
    expect(render([pen, highlighter]).rgba(12, 10)).toEqual([0, 0, 0, 1]);
    const active = new AlphaCanvas(32, 24).ctx;
    drawStroke(active.asContext(), highlighter);
    expect(active.rgba(12, 10)[3]).toBeCloseTo(0.3);
    const masked = render(
      [highlighter],
      [
        {
          id: 'cut',
          targetStrokeIds: ['highlight'],
          path: [point(15, 10)],
          radius: 2,
        },
      ],
    );
    expect(masked.rgba(15, 10)[3]).toBe(0);
    expect(masked.rgba(5, 10)[3]).toBeCloseTo(0.3);
  });
});
