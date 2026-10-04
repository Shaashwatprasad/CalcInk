import type {
  Annotation,
  Bounds,
  Erasure,
  InkDocument,
  Point,
  Selection,
  Stroke,
  XY,
} from '../shared/types';
import {
  boundsIntersect,
  distanceToSegment,
  pointBounds,
  pressureWidth,
} from '../ink/geometry';
import type { InkContext } from '../ink/geometry';

export const MAX_COORDINATE = 1e6;
export const MAX_TEXT_LENGTH = 10000;
export function validCoordinate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_COORDINATE
  );
}
function size(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

/** Copies only the schema; imported bounds and executable/unknown properties are discarded. */
export function copyAnnotation(value: unknown): Annotation {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid annotation');
  const o = value as Annotation;
  if (
    typeof o.id !== 'string' ||
    !o.id ||
    o.id.length > 200 ||
    o.recognitionEligible !== false ||
    typeof o.color !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(o.color) ||
    !['auto', 'explicit'].includes(o.colorMode) ||
    !size(o.strokeWidth, 0.1, 100) ||
    !size(o.opacity, 0, 1)
  )
    throw new Error('Invalid annotation style');
  const style = {
    id: o.id,
    recognitionEligible: false as const,
    color: o.color,
    colorMode: o.colorMode,
    strokeWidth: o.strokeWidth,
    opacity: o.opacity,
  };
  if (o.kind === 'text') {
    if (
      !validCoordinate(o.x) ||
      !validCoordinate(o.y) ||
      !size(o.fontSize, 4, 512) ||
      typeof o.text !== 'string' ||
      o.text.length > MAX_TEXT_LENGTH ||
      !o.text.trim()
    )
      throw new Error('Invalid text annotation');
    return {
      ...style,
      kind: 'text',
      x: o.x,
      y: o.y,
      fontSize: o.fontSize,
      text: o.text,
    };
  }
  if (o.kind === 'arrow' || (o.kind === 'shape' && o.shape === 'line')) {
    if (![o.x1, o.y1, o.x2, o.y2].every(validCoordinate))
      throw new Error('Invalid line annotation');
    const endpoints = { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 };
    return o.kind === 'arrow'
      ? { ...style, kind: 'arrow', ...endpoints }
      : { ...style, kind: 'shape', shape: 'line', ...endpoints };
  }
  if (
    o.kind === 'region' ||
    (o.kind === 'shape' && (o.shape === 'rectangle' || o.shape === 'ellipse'))
  ) {
    if (
      !validCoordinate(o.x) ||
      !validCoordinate(o.y) ||
      !size(o.width, 0, MAX_COORDINATE * 2) ||
      !size(o.height, 0, MAX_COORDINATE * 2) ||
      !validCoordinate(o.x + o.width) ||
      !validCoordinate(o.y + o.height)
    )
      throw new Error('Invalid box annotation');
    const box = { x: o.x, y: o.y, width: o.width, height: o.height };
    return o.kind === 'region'
      ? { ...style, kind: 'region', ...box }
      : { ...style, kind: 'shape', shape: o.shape, ...box };
  }
  throw new Error('Unsupported annotation');
}
function arrowHead(o: Extract<Annotation, { kind: 'arrow' }>): XY[] {
  const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
  const length = o.strokeWidth * 5;
  return [-Math.PI / 6, Math.PI / 6].map((offset) => ({
    x: o.x2 - length * Math.cos(angle + offset),
    y: o.y2 - length * Math.sin(angle + offset),
  }));
}
/** Text uses a deterministic conservative em-cell box, independent of browser/font readiness.
 * DM Sans glyphs are painted normally; selection may include whitespace in this box. */
export function annotationBounds(o: Annotation): Bounds {
  const padding = o.strokeWidth / 2;
  if (o.kind === 'text') {
    const lines = o.text.split('\n');
    const width =
      Math.max(...lines.map((line) => Array.from(line).length)) * o.fontSize;
    return {
      minX: o.x,
      minY: o.y,
      maxX: o.x + width,
      maxY: o.y + lines.length * o.fontSize * 1.25,
    };
  }
  if (o.kind === 'arrow' || (o.kind === 'shape' && o.shape === 'line')) {
    return pointBounds(
      [
        { x: o.x1, y: o.y1, timestamp: 0 },
        { x: o.x2, y: o.y2, timestamp: 0 },
        ...(o.kind === 'arrow'
          ? arrowHead(o).map((p) => ({ ...p, timestamp: 0 }))
          : []),
      ],
      padding,
    );
  }
  return {
    minX: o.x - padding,
    minY: o.y - padding,
    maxX: o.x + o.width + padding,
    maxY: o.y + o.height + padding,
  };
}
export function transformAnnotation(
  o: Annotation,
  delta: XY,
  scale: number,
  anchor: XY,
): Annotation {
  const x = (v: number) => anchor.x + (v - anchor.x) * scale + delta.x;
  const y = (v: number) => anchor.y + (v - anchor.y) * scale + delta.y;
  const style = { ...o, strokeWidth: o.strokeWidth * scale };
  if (o.kind === 'text')
    return copyAnnotation({
      ...style,
      x: x(o.x),
      y: y(o.y),
      fontSize: o.fontSize * scale,
    });
  if (o.kind === 'arrow' || (o.kind === 'shape' && o.shape === 'line'))
    return copyAnnotation({
      ...style,
      x1: x(o.x1),
      y1: y(o.y1),
      x2: x(o.x2),
      y2: y(o.y2),
    });
  return copyAnnotation({
    ...style,
    x: x(o.x),
    y: y(o.y),
    width: o.width * scale,
    height: o.height * scale,
  });
}
export function drawAnnotations(
  ctx: InkContext,
  objects: readonly Annotation[],
  theme: 'light' | 'dark' = 'light',
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const o of objects) {
    ctx.save();
    ctx.globalAlpha *= o.opacity;
    ctx.strokeStyle =
      o.colorMode === 'auto'
        ? theme === 'dark'
          ? '#E4E7EB'
          : '#252D38'
        : o.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = o.strokeWidth;
    ctx.setLineDash(o.kind === 'region' ? [6, 4] : []);
    if (o.kind === 'text') {
      ctx.font = `${o.fontSize}px "DM Sans", sans-serif`;
      ctx.textBaseline = 'top';
      o.text
        .split('\n')
        .forEach((line, i) =>
          ctx.fillText(line, o.x, o.y + i * o.fontSize * 1.25),
        );
    } else {
      ctx.beginPath();
      if (o.kind === 'arrow' || (o.kind === 'shape' && o.shape === 'line')) {
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        if (o.kind === 'arrow')
          for (const head of arrowHead(o)) {
            ctx.moveTo(head.x, head.y);
            ctx.lineTo(o.x2, o.y2);
          }
      } else if (o.kind === 'shape' && o.shape === 'ellipse') {
        ctx.ellipse(
          o.x + o.width / 2,
          o.y + o.height / 2,
          o.width / 2,
          o.height / 2,
          0,
          0,
          Math.PI * 2,
        );
      } else ctx.rect(o.x, o.y, o.width, o.height);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

const asPoint = (p: XY): Point => ({ ...p, timestamp: 0 });
function onSegment(p: XY, a: XY, b: XY): boolean {
  return distanceToSegment(asPoint(p), asPoint(a), asPoint(b)) < 1e-8;
}
function insidePolygon(p: XY, polygon: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (onSegment(p, a, b)) return true;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function masked(p: XY, masks: readonly Erasure[]): boolean {
  return masks.some((mask) => {
    for (let i = 0; i < Math.max(1, mask.path.length - 1); i++)
      if (
        distanceToSegment(
          asPoint(p),
          mask.path[i],
          mask.path[Math.min(i + 1, mask.path.length - 1)],
        ) <= mask.radius
      )
        return true;
    return false;
  });
}
function insideStroke(p: XY, stroke: Stroke): boolean {
  for (let i = 0; i < Math.max(1, stroke.points.length - 1); i++) {
    const a = stroke.points[i],
      b = stroke.points[Math.min(i + 1, stroke.points.length - 1)];
    if (
      distanceToSegment(asPoint(p), a, b) <=
      (pressureWidth(stroke, a) + pressureWidth(stroke, b)) / 4
    )
      return true;
  }
  return false;
}

type Primitive =
  | { type: 'circle'; center: XY; radius: number }
  | { type: 'polygon'; points: readonly XY[] };
type Edge =
  | { type: 'line'; a: XY; b: XY }
  | { type: 'circle'; center: XY; radius: number };
function capsule(a: XY, b: XY, radius: number): Primitive[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const circles: Primitive[] = [{ type: 'circle', center: a, radius }];
  if (!length) return circles;
  const dx = (-(b.y - a.y) / length) * radius,
    dy = ((b.x - a.x) / length) * radius;
  return [
    ...circles,
    { type: 'circle', center: b, radius },
    {
      type: 'polygon',
      points: [
        { x: a.x + dx, y: a.y + dy },
        { x: b.x + dx, y: b.y + dy },
        { x: b.x - dx, y: b.y - dy },
        { x: a.x - dx, y: a.y - dy },
      ],
    },
  ];
}
function contains(p: XY, primitive: Primitive): boolean {
  return primitive.type === 'circle'
    ? Math.hypot(p.x - primitive.center.x, p.y - primitive.center.y) <=
        primitive.radius
    : insidePolygon(p, primitive.points);
}
function edges(primitive: Primitive): Edge[] {
  return primitive.type === 'circle'
    ? [primitive]
    : primitive.points.map((a, i) => ({
        type: 'line',
        a,
        b: primitive.points[(i + 1) % primitive.points.length],
      }));
}
function primitiveBounds(p: Primitive): Bounds {
  return p.type === 'circle'
    ? {
        minX: p.center.x - p.radius,
        minY: p.center.y - p.radius,
        maxX: p.center.x + p.radius,
        maxY: p.center.y + p.radius,
      }
    : pointBounds(p.points.map(asPoint));
}
function crossings(a: Edge, b: Edge): XY[] {
  if (a.type === 'circle' && b.type === 'line') return crossings(b, a);
  if (a.type === 'line' && b.type === 'circle') {
    const dx = a.b.x - a.a.x,
      dy = a.b.y - a.a.y,
      fx = a.a.x - b.center.x,
      fy = a.a.y - b.center.y;
    const A = dx * dx + dy * dy,
      B = 2 * (fx * dx + fy * dy),
      C = fx * fx + fy * fy - b.radius * b.radius;
    const discriminant = B * B - 4 * A * C;
    if (!A || discriminant < 0) return [];
    return [
      (-B - Math.sqrt(discriminant)) / (2 * A),
      (-B + Math.sqrt(discriminant)) / (2 * A),
    ]
      .filter((t) => t >= 0 && t <= 1)
      .map((t) => ({ x: a.a.x + dx * t, y: a.a.y + dy * t }));
  }
  if (a.type === 'circle' && b.type === 'circle') {
    const dx = b.center.x - a.center.x,
      dy = b.center.y - a.center.y,
      d = Math.hypot(dx, dy);
    if (!d || d > a.radius + b.radius || d < Math.abs(a.radius - b.radius))
      return [];
    const along = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d),
      height = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
    return [-1, 1].map((sign) => ({
      x: a.center.x + (dx / d) * along - ((sign * dy) / d) * height,
      y: a.center.y + (dy / d) * along + ((sign * dx) / d) * height,
    }));
  }
  if (a.type !== 'line' || b.type !== 'line') return [];
  const dx = a.b.x - a.a.x,
    dy = a.b.y - a.a.y,
    ex = b.b.x - b.a.x,
    ey = b.b.y - b.a.y,
    divisor = dx * ey - dy * ex;
  if (!divisor)
    return [a.a, a.b, b.a, b.b].filter(
      (p) => onSegment(p, a.a, a.b) && onSegment(p, b.a, b.b),
    );
  const t = ((b.a.x - a.a.x) * ey - (b.a.y - a.a.y) * ex) / divisor,
    u = ((b.a.x - a.a.x) * dy - (b.a.y - a.a.y) * dx) / divisor;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
    ? [{ x: a.a.x + t * dx, y: a.a.y + t * dy }]
    : [];
}
/** Boundary arrangement tests actual geometry. Mask interiors are removed before selection;
 * subdividing edges at all intersections also finds visible slivers between overlapping masks. */
function visibleOverlap(
  ink: Primitive,
  query: Primitive,
  masks: readonly Erasure[],
): boolean {
  if (!boundsIntersect(primitiveBounds(ink), primitiveBounds(query)))
    return false;
  const relevant = masks.filter(
    (m) =>
      boundsIntersect(pointBounds(m.path, m.radius), primitiveBounds(ink)) &&
      boundsIntersect(pointBounds(m.path, m.radius), primitiveBounds(query)),
  );
  const maskedShapes = relevant.flatMap((mask) => {
    const result: Primitive[] = [];
    for (let i = 0; i < Math.max(1, mask.path.length - 1); i++)
      result.push(
        ...capsule(
          mask.path[i],
          mask.path[Math.min(i + 1, mask.path.length - 1)],
          mask.radius,
        ),
      );
    return result;
  });
  const boundaries = [ink, query, ...maskedShapes].flatMap(edges);
  const accept = (p: XY) =>
    contains(p, ink) && contains(p, query) && !masked(p, relevant);
  for (const shape of [ink, query]) {
    if (shape.type === 'circle' && accept(shape.center)) return true;
    if (shape.type === 'polygon' && shape.points.some(accept)) return true;
  }
  for (let i = 0; i < boundaries.length; i++) {
    const edge = boundaries[i];
    const cuts = boundaries.flatMap((other, j) =>
      j === i ? [] : crossings(edge, other),
    );
    if (edge.type === 'line') {
      cuts.push(edge.a, edge.b);
      cuts.sort(
        (p, q) =>
          (p.x - q.x) * (edge.b.x - edge.a.x) +
          (p.y - q.y) * (edge.b.y - edge.a.y),
      );
      const ordered = [...cuts];
      for (let j = 0; j + 1 < ordered.length; j++)
        cuts.push({
          x: (ordered[j].x + ordered[j + 1].x) / 2,
          y: (ordered[j].y + ordered[j + 1].y) / 2,
        });
    } else {
      const angles = cuts
        .map((p) => Math.atan2(p.y - edge.center.y, p.x - edge.center.x))
        .sort((a, b) => a - b);
      if (!angles.length) angles.push(0);
      for (let j = 0; j < angles.length; j++) {
        const angle =
          (angles[j] +
            (angles[(j + 1) % angles.length] +
              (j + 1 === angles.length ? Math.PI * 2 : 0))) /
          2;
        cuts.push({
          x: edge.center.x + edge.radius * Math.cos(angle),
          y: edge.center.y + edge.radius * Math.sin(angle),
        });
      }
    }
    for (const p of cuts) {
      if (accept(p)) return true;
      // Boundary points of a mask are erased. Check adjacent arrangement faces.
      const epsilon = 1e-7;
      for (let n = 0; n < 8; n++)
        if (
          accept({
            x: p.x + epsilon * Math.cos((n * Math.PI) / 4),
            y: p.y + epsilon * Math.sin((n * Math.PI) / 4),
          })
        )
          return true;
    }
  }
  return false;
}
function visibleStrokeIntersects(
  stroke: Stroke,
  query: Primitive,
  masks: readonly Erasure[],
): boolean {
  if (
    (stroke.opacity ?? 1) === 0 ||
    !boundsIntersect(stroke.bounds, primitiveBounds(query))
  )
    return false;
  for (let i = 0; i < Math.max(1, stroke.points.length - 1); i++) {
    const a = stroke.points[i],
      b = stroke.points[Math.min(i + 1, stroke.points.length - 1)];
    const radius = (pressureWidth(stroke, a) + pressureWidth(stroke, b)) / 4;
    if (capsule(a, b, radius).some((ink) => visibleOverlap(ink, query, masks)))
      return true;
  }
  return false;
}
function boxPolygon(b: Bounds): XY[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}
function validQuery(p: XY): void {
  if (!validCoordinate(p.x) || !validCoordinate(p.y))
    throw new Error('Invalid selection geometry');
}
/** Returns all hits in document order; UI decides its selection stacking policy. */
export function selectAtPoint(
  document: InkDocument,
  p: XY,
  tolerance = 0,
): Selection {
  validQuery(p);
  if (!size(tolerance, 0, 100)) throw new Error('Invalid selection tolerance');
  const strokeIds = document.strokes
    .filter((stroke) => {
      if ((stroke.opacity ?? 1) === 0) return false;
      const masks = document.erasures.filter((m) =>
        m.targetStrokeIds.includes(stroke.id),
      );
      return tolerance === 0
        ? insideStroke(p, stroke) && !masked(p, masks)
        : visibleStrokeIntersects(
            stroke,
            { type: 'circle', center: p, radius: tolerance },
            masks,
          );
    })
    .map((s) => s.id);
  const objectIds = (document.objects ?? [])
    .filter((o) => {
      const b = annotationBounds(o);
      return (
        o.opacity > 0 &&
        p.x >= b.minX - tolerance &&
        p.x <= b.maxX + tolerance &&
        p.y >= b.minY - tolerance &&
        p.y <= b.maxY + tolerance
      );
    })
    .map((o) => o.id);
  return { strokeIds, objectIds };
}
/** A lasso selects visible intersection, including crossed segments and fully enclosed objects. */
export function selectInPolygon(
  document: InkDocument,
  polygon: readonly XY[],
): Selection {
  if (polygon.length < 3 || polygon.length > 10000)
    throw new Error('Invalid selection polygon');
  polygon.forEach(validQuery);
  const query: Primitive = { type: 'polygon', points: polygon };
  return {
    strokeIds: document.strokes
      .filter((stroke) =>
        visibleStrokeIntersects(
          stroke,
          query,
          document.erasures.filter((m) =>
            m.targetStrokeIds.includes(stroke.id),
          ),
        ),
      )
      .map((s) => s.id),
    objectIds: (document.objects ?? [])
      .filter(
        (o) =>
          o.opacity > 0 &&
          visibleOverlap(
            { type: 'polygon', points: boxPolygon(annotationBounds(o)) },
            query,
            [],
          ),
      )
      .map((o) => o.id),
  };
}
