import type {
  Bounds,
  Erasure,
  InkDocument,
  Point,
  Stroke,
} from '../shared/types';

export type InkContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export type InkColorResolver = (stroke: Stroke) => string;

/** Appearance resolves at paint time; stored explicit colors are never recolored. */
export function resolveInkColor(
  stroke: Stroke,
  theme: 'light' | 'dark' = 'light',
): string {
  return stroke.colorMode === 'auto'
    ? theme === 'dark'
      ? '#E4E7EB'
      : '#252D38'
    : stroke.color;
}

export function validStrokeSemantics(stroke: Stroke): boolean {
  return (
    (stroke.kind === undefined ||
      ['pen', 'pencil', 'highlighter'].includes(stroke.kind)) &&
    (stroke.colorMode === undefined ||
      ['auto', 'explicit'].includes(stroke.colorMode)) &&
    (stroke.opacity === undefined ||
      (Number.isFinite(stroke.opacity) &&
        stroke.opacity >= 0 &&
        stroke.opacity <= 1)) &&
    (stroke.pressureEnabled === undefined ||
      typeof stroke.pressureEnabled === 'boolean') &&
    (stroke.recognitionEligible === undefined ||
      typeof stroke.recognitionEligible === 'boolean')
  );
}

export function normalizedStrokeSemantics(stroke: Stroke) {
  if (!validStrokeSemantics(stroke))
    throw new Error('Invalid stroke semantics');
  return {
    kind: stroke.kind ?? 'pen',
    colorMode: stroke.colorMode ?? 'explicit',
    opacity: stroke.opacity ?? 1,
    pressureEnabled: stroke.pressureEnabled ?? false,
    recognitionEligible:
      stroke.kind !== 'highlighter' && (stroke.recognitionEligible ?? true),
  };
}

export function isRecognitionEligible(stroke: Stroke): boolean {
  return stroke.kind !== 'highlighter' && stroke.recognitionEligible !== false;
}

/** Absent pressure means no hardware signal (mouse), preserving full width.
 * Real pen pressure 0 is valid and uses the minimum quarter-width.
 * Each segment is a round capsule at the mean of its endpoint widths. This same
 * discrete geometry is used in display, whole-stroke erasure and canonical ML. */
export function pressureWidth(stroke: Stroke, point: Point): number {
  if (
    !stroke.pressureEnabled ||
    stroke.kind === 'highlighter' ||
    point.pressure === undefined
  )
    return stroke.width;
  return stroke.width * (0.25 + 0.75 * point.pressure);
}

function segmentWidth(stroke: Stroke, a: Point, b: Point): number {
  return (pressureWidth(stroke, a) + pressureWidth(stroke, b)) / 2;
}

export function pointBounds(points: readonly Point[], padding = 0): Bounds {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const divisor = dx * dx + dy * dy;
  const t = divisor
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / divisor))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (
    boundsIntersect(pointBounds([a, b]), pointBounds([c, d])) &&
    orientation(a, b, c) * orientation(a, b, d) <= 0 &&
    orientation(c, d, a) * orientation(c, d, b) <= 0
  )
    return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

/** Capsule intersection tests the entire swept eraser path, including sparse samples. */
export function strokeIntersectsPath(
  stroke: Stroke,
  path: readonly Point[],
  radius: number,
): boolean {
  if (
    !path.length ||
    !stroke.points.length ||
    !boundsIntersect(stroke.bounds, pointBounds(path, radius))
  )
    return false;
  for (let i = 0; i < Math.max(1, stroke.points.length - 1); i++) {
    const a = stroke.points[i];
    const b = stroke.points[Math.min(i + 1, stroke.points.length - 1)];
    for (let j = 0; j < Math.max(1, path.length - 1); j++) {
      if (
        segmentsDistance(
          a,
          b,
          path[j],
          path[Math.min(j + 1, path.length - 1)],
        ) <=
        radius + segmentWidth(stroke, a, b) / 2
      )
        return true;
    }
  }
  return false;
}

function drawPath(
  ctx: InkContext,
  points: readonly Point[],
  width: number,
  startIndex = 0,
): void {
  if (!points.length) return;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  const start = Math.max(0, startIndex - 1);
  ctx.moveTo(points[start].x, points[start].y);
  for (let i = start + 1; i < points.length; i++)
    ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function drawStrokeGeometry(
  ctx: InkContext,
  stroke: Stroke,
  startIndex = 0,
): void {
  if (!stroke.pressureEnabled || stroke.kind === 'highlighter') {
    drawPath(ctx, stroke.points, stroke.width, startIndex);
    return;
  }
  if (stroke.points.length === 1) {
    drawPath(ctx, stroke.points, pressureWidth(stroke, stroke.points[0]));
    return;
  }
  for (let i = Math.max(0, startIndex - 1); i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    drawPath(ctx, [a, b], segmentWidth(stroke, a, b));
  }
}

/** Opaque constant-width segments may append. Pressure or translucent active
 * ink must clear/replay its own canvas with index 0: endpoint geometry can change
 * and alpha belongs to the entire stroke. Never clear unrelated ink here. */
export function drawStroke(
  ctx: InkContext,
  stroke: Stroke,
  startIndex = 0,
  colorResolver: InkColorResolver = resolveInkColor,
): void {
  if (startIndex > 0 && stroke.pressureEnabled && stroke.kind !== 'highlighter')
    throw new Error(
      'Pressure ink requires clearing its active canvas and full replay with startIndex 0.',
    );
  ctx.save();
  const opacity = stroke.opacity ?? 1;
  if (opacity < 1 || stroke.kind === 'highlighter') {
    const layer = prepareLayer(ctx);
    drawOpaqueStroke(layer, stroke, colorResolver);
    compositeLayer(ctx, layer, opacity);
  } else {
    ctx.strokeStyle = colorResolver(stroke);
    ctx.fillStyle = ctx.strokeStyle;
    drawStrokeGeometry(ctx, stroke, startIndex);
  }
  ctx.restore();
}

export function drawErasure(ctx: InkContext, erasure: Erasure): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  drawPath(ctx, erasure.path, erasure.radius * 2);
  ctx.restore();
}

function createLayer(ctx: InkContext): InkContext {
  const { width, height } = ctx.canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    const layer = new OffscreenCanvas(width, height).getContext('2d');
    if (layer) return layer;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const layer = canvas.getContext('2d');
    if (layer) return layer;
  }
  throw new Error(
    'A Canvas2D scratch layer is required for persistent pixel erasure.',
  );
}

// One scratch canvas per target context; reused across strokes and replays.
const scratchLayers = new WeakMap<InkContext, InkContext>();
function prepareLayer(ctx: InkContext): InkContext {
  let layer = scratchLayers.get(ctx);
  if (!layer) {
    layer = createLayer(ctx);
    scratchLayers.set(ctx, layer);
  }
  if (layer.canvas.width !== ctx.canvas.width)
    layer.canvas.width = ctx.canvas.width;
  if (layer.canvas.height !== ctx.canvas.height)
    layer.canvas.height = ctx.canvas.height;
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.globalAlpha = 1;
  layer.globalCompositeOperation = 'source-over';
  layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  layer.setTransform(ctx.getTransform());
  return layer;
}
function drawOpaqueStroke(
  ctx: InkContext,
  stroke: Stroke,
  colorResolver: InkColorResolver,
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colorResolver(stroke);
  ctx.fillStyle = ctx.strokeStyle;
  drawStrokeGeometry(ctx, stroke);
  ctx.restore();
}
function compositeLayer(
  ctx: InkContext,
  layer: InkContext,
  opacity: number,
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= opacity;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

/** Masks and translucent joins compose in one isolated layer per stroke. Paint
 * annotations first so later highlighters never cover earlier math pen ink. */
export function drawDocument(
  ctx: InkContext,
  document: Pick<InkDocument, 'strokes' | 'erasures'>,
  colorResolver: InkColorResolver = resolveInkColor,
): void {
  const strokes = [
    ...document.strokes.filter((s) => s.kind === 'highlighter'),
    ...document.strokes.filter((s) => s.kind !== 'highlighter'),
  ];
  for (const stroke of strokes) {
    const erasures = document.erasures.filter((mask) =>
      mask.targetStrokeIds.includes(stroke.id),
    );
    if (
      !erasures.length &&
      stroke.kind !== 'highlighter' &&
      (stroke.opacity ?? 1) === 1
    ) {
      drawStroke(ctx, stroke, 0, colorResolver);
      continue;
    }
    const layer = prepareLayer(ctx);
    drawOpaqueStroke(layer, stroke, colorResolver);
    for (const mask of erasures) drawErasure(layer, mask);
    compositeLayer(ctx, layer, stroke.opacity ?? 1);
  }
}
