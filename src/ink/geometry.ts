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
        radius + stroke.width / 2
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

/** startIndex appends only new segments; replay and worker rasterization use index 0. */
export function drawStroke(
  ctx: InkContext,
  stroke: Stroke,
  startIndex = 0,
): void {
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  drawPath(ctx, stroke.points, stroke.width, startIndex);
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

/** Masks are applied in an isolated layer per stroke: they never erase other ink. */
export function drawDocument(
  ctx: InkContext,
  document: Pick<InkDocument, 'strokes' | 'erasures'>,
): void {
  let layer: InkContext | undefined;
  for (const stroke of document.strokes) {
    const erasures = document.erasures.filter((mask) =>
      mask.targetStrokeIds.includes(stroke.id),
    );
    if (!erasures.length) {
      drawStroke(ctx, stroke);
      continue;
    }
    layer ??= createLayer(ctx);
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.setTransform(ctx.getTransform());
    drawStroke(layer, stroke);
    for (const mask of erasures) drawErasure(layer, mask);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }
}
