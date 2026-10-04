import type { InkStore } from '../document/InkStore';
import {
  annotationBounds,
  drawAnnotations,
  selectAtPoint,
  selectInPolygon,
  transformAnnotation,
  validCoordinate,
} from '../document/annotations';
import { drawDocument } from '../ink/geometry';
import type { Annotation, Bounds, Selection, XY } from '../shared/types';
import { screenToWorld, type ViewportStore } from '../viewport';

export interface ObjectsTool {
  mode: 'select' | 'lasso' | 'text' | 'shape' | 'region' | 'arrow' | 'inactive';
  shape?: 'rectangle' | 'ellipse' | 'line';
  color: string;
  colorMode: 'auto' | 'explicit';
  strokeWidth: number;
  fontSize: number;
  opacity?: number;
}
export interface ObjectsRenderer {
  invalidate(): void;
  dispose(): void;
  getSelection(): Selection;
  setSelection(selection: Selection): void;
}
type TextAnnotation = Extract<Annotation, { kind: 'text' }>;
interface Options {
  canvas: HTMLCanvasElement;
  store: InkStore;
  viewport: ViewportStore;
  getTool: () => ObjectsTool;
  getTheme: () => 'light' | 'dark';
  onText: (point: XY, existing?: TextAnnotation) => void;
  onSelection: (selection: Selection) => void;
  onError?: (message: string) => void;
  getPanMode?: () => 'free' | 'vertical';
}
interface Gesture {
  id: string;
  pointerId: number;
  kind: 'move' | 'resize' | 'lasso' | 'create';
  start: XY;
  current: XY;
  before: Selection;
  selection: Selection;
  tool: ObjectsTool;
  bounds?: Bounds;
  anchor?: XY;
  corner?: XY;
  path: XY[];
}
const empty = (): Selection => ({ strokeIds: [], objectIds: [] });
const cloneSelection = (s: Selection): Selection => ({
  strokeIds: [...s.strokeIds],
  objectIds: [...s.objectIds],
});
const corners = (b: Bounds): XY[] => [
  { x: b.minX, y: b.minY },
  { x: b.maxX, y: b.minY },
  { x: b.maxX, y: b.maxY },
  { x: b.minX, y: b.maxY },
];

/** Annotation input and display share the existing vector store/camera; pointermove only
 * records coordinates and requests a frame. Completed gestures commit once. */
export function mountObjects(options: Options): ObjectsRenderer {
  const { canvas, store, viewport } = options;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D is required for annotations.');
  let selection = empty(),
    gesture: Gesture | undefined;
  let frame = 0,
    disposed = false,
    dpr = 0;
  let rect = canvas.getBoundingClientRect();
  let space = false;
  let pan: { pointerId: number; point: XY } | undefined;
  const touches = new Map<number, XY>();
  let pinch: { point: XY; distance: number } | undefined;
  let navigating = false;
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  const error = (e: unknown) =>
    options.onError?.(
      e instanceof Error ? e.message : 'Annotation could not be changed.',
    );
  function invalidate() {
    if (!frame && !disposed) frame = requestAnimationFrame(render);
  }
  function emit() {
    options.onSelection(cloneSelection(selection));
    invalidate();
  }
  function normalized(s: Selection): Selection {
    const doc = store.getSnapshot();
    return {
      strokeIds: [...new Set(s.strokeIds)].filter((id) =>
        doc.strokes.some((stroke) => stroke.id === id),
      ),
      objectIds: [...new Set(s.objectIds)].filter((id) =>
        doc.objects?.some((o) => o.id === id),
      ),
    };
  }
  function setSelection(s: Selection) {
    selection = normalized(s);
    emit();
  }
  function bounds(s = selection): Bounds | undefined {
    const doc = store.getSnapshot();
    const boxes = [
      ...doc.strokes
        .filter((stroke) => s.strokeIds.includes(stroke.id))
        .map((stroke) => stroke.bounds),
      ...(doc.objects ?? [])
        .filter((o) => s.objectIds.includes(o.id))
        .map(annotationBounds),
    ];
    if (!boxes.length) return undefined;
    return {
      minX: Math.min(...boxes.map((b) => b.minX)),
      minY: Math.min(...boxes.map((b) => b.minY)),
      maxX: Math.max(...boxes.map((b) => b.maxX)),
      maxY: Math.max(...boxes.map((b) => b.maxY)),
    };
  }
  function local(event: PointerEvent | WheelEvent): XY {
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function world(event: PointerEvent): XY {
    const point = screenToWorld(local(event), viewport.getSnapshot());
    if (!validCoordinate(point.x) || !validCoordinate(point.y))
      throw new Error(
        'Canvas coordinate limit reached. Reset or pan back to continue.',
      );
    return point;
  }
  function clipped(p: XY): XY {
    const page = viewport.getFinitePage();
    return page
      ? {
          x: Math.max(0, Math.min(page.width, p.x)),
          y: Math.max(0, Math.min(page.height, p.y)),
        }
      : p;
  }
  function offPage(p: XY): boolean {
    const page = viewport.getFinitePage();
    return (
      !!page && (p.x < 0 || p.y < 0 || p.x > page.width || p.y > page.height)
    );
  }
  function parameters(g: Gesture): { delta: XY; scale: number; anchor: XY } {
    const anchor = g.anchor ?? { x: 0, y: 0 };
    if (g.kind === 'resize' && g.corner) {
      const dx = g.corner.x - anchor.x,
        dy = g.corner.y - anchor.y;
      const length = dx * dx + dy * dy;
      let scale = Math.max(
        0.01,
        length
          ? ((g.current.x - anchor.x) * dx + (g.current.y - anchor.y) * dy) /
              length
          : 1,
      );
      const page = viewport.getFinitePage();
      if (page && g.bounds) {
        const limits = corners(g.bounds).flatMap((p) =>
          [
            [p.x, anchor.x, page.width],
            [p.y, anchor.y, page.height],
          ].map(([value, origin, limit]) =>
            value > origin
              ? (limit - origin) / (value - origin)
              : value < origin
                ? origin / (origin - value)
                : Infinity,
          ),
        );
        const max = Math.min(...limits);
        if (max > 0) scale = Math.min(scale, max);
      }
      return { delta: { x: 0, y: 0 }, scale, anchor };
    }
    let delta = { x: g.current.x - g.start.x, y: g.current.y - g.start.y };
    const page = viewport.getFinitePage();
    if (page && g.bounds)
      delta = {
        x: Math.max(
          -g.bounds.minX,
          Math.min(page.width - g.bounds.maxX, delta.x),
        ),
        y: Math.max(
          -g.bounds.minY,
          Math.min(page.height - g.bounds.maxY, delta.y),
        ),
      };
    return { delta, scale: 1, anchor };
  }
  function created(g: Gesture): Annotation {
    const style = {
      id: g.id,
      recognitionEligible: false as const,
      color: g.tool.color,
      colorMode: g.tool.colorMode,
      strokeWidth: g.tool.strokeWidth,
      opacity: g.tool.opacity ?? 1,
    };
    if (
      g.tool.mode === 'arrow' ||
      (g.tool.mode === 'shape' && g.tool.shape === 'line')
    )
      return {
        ...style,
        kind: g.tool.mode === 'arrow' ? 'arrow' : 'shape',
        ...(g.tool.mode === 'arrow' ? {} : { shape: 'line' as const }),
        x1: g.start.x,
        y1: g.start.y,
        x2: g.current.x,
        y2: g.current.y,
      } as Annotation;
    const box = {
      x: Math.min(g.start.x, g.current.x),
      y: Math.min(g.start.y, g.current.y),
      width: Math.abs(g.current.x - g.start.x),
      height: Math.abs(g.current.y - g.start.y),
    };
    return g.tool.mode === 'region'
      ? { ...style, kind: 'region', ...box }
      : {
          ...style,
          kind: 'shape',
          shape: g.tool.shape === 'ellipse' ? 'ellipse' : 'rectangle',
          ...box,
        };
  }
  function render() {
    frame = 0;
    if (disposed) return;
    rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr)),
      height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const camera = viewport.getSnapshot();
    ctx!.setTransform(
      dpr * camera.zoom,
      0,
      0,
      dpr * camera.zoom,
      dpr * camera.offsetX,
      dpr * camera.offsetY,
    );
    const doc = store.getSnapshot();
    let objects = doc.objects ?? [];
    let selectedBounds = bounds();
    if (gesture?.kind === 'move' || gesture?.kind === 'resize') {
      const p = parameters(gesture);
      try {
        objects = objects.map((o) =>
          gesture!.selection.objectIds.includes(o.id)
            ? transformAnnotation(o, p.delta, p.scale, p.anchor)
            : o,
        );
      } catch {
        /* Invalid preview retains committed content; up reports once. */
      }
      if (gesture.bounds) {
        const b = gesture.bounds;
        selectedBounds = {
          minX: p.anchor.x + (b.minX - p.anchor.x) * p.scale + p.delta.x,
          minY: p.anchor.y + (b.minY - p.anchor.y) * p.scale + p.delta.y,
          maxX: p.anchor.x + (b.maxX - p.anchor.x) * p.scale + p.delta.x,
          maxY: p.anchor.y + (b.maxY - p.anchor.y) * p.scale + p.delta.y,
        };
      }
      // Ghost only; committed stroke pixels remain authoritative until pointerup.
      if (
        gesture.selection.strokeIds.length &&
        (p.scale !== 1 || p.delta.x !== 0 || p.delta.y !== 0)
      ) {
        ctx!.save();
        ctx!.globalAlpha = 0.35;
        ctx!.translate(p.delta.x + p.anchor.x, p.delta.y + p.anchor.y);
        ctx!.scale(p.scale, p.scale);
        ctx!.translate(-p.anchor.x, -p.anchor.y);
        drawDocument(
          ctx!,
          {
            strokes: doc.strokes.filter((s) =>
              gesture!.selection.strokeIds.includes(s.id),
            ),
            erasures: doc.erasures,
          },
          () => '#5275AE',
        );
        ctx!.restore();
      }
    }
    drawAnnotations(ctx!, objects, options.getTheme());
    if (gesture?.kind === 'create')
      drawAnnotations(ctx!, [created(gesture)], options.getTheme());
    ctx!.save();
    ctx!.strokeStyle = '#5275AE';
    ctx!.fillStyle = options.getTheme() === 'dark' ? '#10151C' : '#FFFFFF';
    ctx!.lineWidth = 1.5 / camera.zoom;
    if (gesture?.kind === 'lasso') {
      ctx!.setLineDash([4 / camera.zoom, 3 / camera.zoom]);
      ctx!.beginPath();
      gesture.path.forEach((p, i) =>
        i ? ctx!.lineTo(p.x, p.y) : ctx!.moveTo(p.x, p.y),
      );
      ctx!.closePath();
      ctx!.stroke();
    } else if (
      selectedBounds &&
      (options.getTool().mode === 'select' ||
        options.getTool().mode === 'lasso')
    ) {
      ctx!.setLineDash([4 / camera.zoom, 3 / camera.zoom]);
      ctx!.strokeRect(
        selectedBounds.minX,
        selectedBounds.minY,
        selectedBounds.maxX - selectedBounds.minX,
        selectedBounds.maxY - selectedBounds.minY,
      );
      ctx!.setLineDash([]);
      const radius = 4 / camera.zoom;
      for (const p of corners(selectedBounds)) {
        ctx!.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
        ctx!.strokeRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      }
    }
    ctx!.restore();
  }
  function release(id: number) {
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function abandon(releaseCapture = true) {
    const id = gesture?.pointerId;
    if (gesture) selection = gesture.before;
    gesture = undefined;
    viewport.setCameraLocked(false);
    if (id !== undefined && releaseCapture) release(id);
    invalidate();
  }
  function touchFrame() {
    const pair = [...touches.values()].slice(0, 2);
    return pair.length < 2
      ? undefined
      : {
          point: {
            x: (pair[0].x + pair[1].x) / 2,
            y: (pair[0].y + pair[1].y) / 2,
          },
          distance: Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y),
        };
  }
  function down(event: PointerEvent) {
    if (disposed || options.getTool().mode === 'inactive') return;
    rect = canvas.getBoundingClientRect();
    if (event.pointerType === 'touch') {
      if (gesture && !touches.has(gesture.pointerId)) return; // Pen palm rejection.
      touches.set(event.pointerId, local(event));
      if (touches.size > 1 || navigating) {
        event.preventDefault();
        navigating = true;
        abandon(false);
        pan = undefined;
        pinch = touchFrame();
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (event.button !== 0 || !event.isPrimary || gesture || pan) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    if (space) {
      pan = { pointerId: event.pointerId, point: local(event) };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    try {
      const start = world(event);
      if (offPage(start)) {
        touches.delete(event.pointerId);
        return;
      }
      const tool = { ...options.getTool() };
      if (tool.mode === 'text') {
        touches.delete(event.pointerId);
        const hit = selectAtPoint(store.getSnapshot(), start).objectIds.at(-1);
        const o = store
          .getSnapshot()
          .objects?.find((o) => o.id === hit && o.kind === 'text');
        options.onText(start, o?.kind === 'text' ? o : undefined);
        return;
      }
      const before = cloneSelection(selection),
        b = bounds();
      const base = {
        id: crypto.randomUUID(),
        pointerId: event.pointerId,
        start,
        current: start,
        before,
        selection: cloneSelection(selection),
        tool,
        path: [start],
      };
      if (tool.mode === 'select') {
        const handle = b
          ? corners(b).findIndex(
              (p) =>
                Math.hypot(p.x - start.x, p.y - start.y) <=
                7 / viewport.getSnapshot().zoom,
            )
          : -1;
        if (b && handle >= 0)
          gesture = {
            ...base,
            kind: 'resize',
            bounds: b,
            corner: corners(b)[handle],
            anchor: corners(b)[(handle + 2) % 4],
          };
        else {
          const hits = selectAtPoint(
            store.getSnapshot(),
            start,
            4 / viewport.getSnapshot().zoom,
          );
          const hitsSelected =
            hits.strokeIds.some((id) => selection.strokeIds.includes(id)) ||
            hits.objectIds.some((id) => selection.objectIds.includes(id)) ||
            Boolean(
              b &&
                start.x >= b.minX &&
                start.x <= b.maxX &&
                start.y >= b.minY &&
                start.y <= b.maxY,
            );
          if (!hitsSelected) {
            const next = hits.objectIds.length
              ? { strokeIds: [], objectIds: [hits.objectIds.at(-1)!] }
              : { strokeIds: hits.strokeIds.slice(-1), objectIds: [] };
            selection = event.shiftKey
              ? {
                  strokeIds: [
                    ...new Set([...selection.strokeIds, ...next.strokeIds]),
                  ],
                  objectIds: [
                    ...new Set([...selection.objectIds, ...next.objectIds]),
                  ],
                }
              : next;
          }
          gesture = {
            ...base,
            selection: cloneSelection(selection),
            kind: 'move',
            bounds: bounds(),
          };
        }
      } else
        gesture = { ...base, kind: tool.mode === 'lasso' ? 'lasso' : 'create' };
      canvas.setPointerCapture(event.pointerId);
      viewport.setCameraLocked(true);
      invalidate();
    } catch (e) {
      touches.delete(event.pointerId);
      abandon();
      error(e);
    }
  }
  function move(event: PointerEvent) {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, local(event));
      if (navigating) {
        event.preventDefault();
        const next = touchFrame();
        if (pinch && next) {
          if (pinch.distance > 2 && next.distance > 2)
            viewport.zoomAt(next.distance / pinch.distance, pinch.point);
          viewport.panBy(
            {
              x: next.point.x - pinch.point.x,
              y: next.point.y - pinch.point.y,
            },
            options.getPanMode?.(),
          );
        }
        pinch = next;
        return;
      }
    }
    if (pan?.pointerId === event.pointerId) {
      event.preventDefault();
      const next = local(event);
      viewport.panBy(
        { x: next.x - pan.point.x, y: next.y - pan.point.y },
        options.getPanMode?.(),
      );
      pan.point = next;
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (options.getTool().mode !== gesture.tool.mode) {
      abandon();
      emit();
      return;
    }
    event.preventDefault();
    try {
      gesture.current = clipped(world(event));
      if (gesture.kind === 'lasso' && gesture.path.length < 10000) {
        const last = gesture.path.at(-1)!;
        if (
          Math.hypot(last.x - gesture.current.x, last.y - gesture.current.y) >=
          2 / viewport.getSnapshot().zoom
        )
          gesture.path.push(gesture.current);
      }
      invalidate();
    } catch (e) {
      abandon();
      error(e);
    }
  }
  function endNavigation(event: PointerEvent): boolean {
    const wasNavigation = navigating || pan?.pointerId === event.pointerId;
    touches.delete(event.pointerId);
    pinch = touchFrame();
    if (!touches.size) navigating = false;
    if (pan?.pointerId === event.pointerId) pan = undefined;
    if (wasNavigation) release(event.pointerId);
    return wasNavigation;
  }
  function up(event: PointerEvent) {
    if (
      endNavigation(event) ||
      !gesture ||
      gesture.pointerId !== event.pointerId
    )
      return;
    move(event); // Include the final endpoint even when the browser omitted move.
    if (!gesture) return;
    const done = gesture;
    gesture = undefined;
    viewport.setCameraLocked(false);
    release(event.pointerId);
    try {
      const moved =
        Math.hypot(
          done.current.x - done.start.x,
          done.current.y - done.start.y,
        ) *
          viewport.getSnapshot().zoom >
        2;
      if (done.kind === 'lasso')
        selection =
          done.path.length >= 3
            ? selectInPolygon(store.getSnapshot(), done.path)
            : selectAtPoint(
                store.getSnapshot(),
                done.current,
                4 / viewport.getSnapshot().zoom,
              );
      else if (done.kind === 'create' && moved) {
        const o = created(done);
        store.addObject(o);
        selection = { strokeIds: [], objectIds: [o.id] };
      } else if (moved && done.bounds) {
        const p = parameters(done);
        store.transformSelection(done.selection, p.delta, p.scale, p.anchor);
      }
      selection = normalized(selection);
      emit();
    } catch (e) {
      selection = done.before;
      emit();
      error(e);
    }
    invalidate();
  }
  function cancel(event: PointerEvent) {
    if (endNavigation(event)) return;
    if (gesture?.pointerId === event.pointerId) {
      abandon();
      emit();
    }
  }
  function dblclick(event: MouseEvent) {
    if (options.getTool().mode !== 'select') return;
    try {
      rect = canvas.getBoundingClientRect();
      const p = screenToWorld(
        local(event as PointerEvent),
        viewport.getSnapshot(),
      );
      const ids = selectAtPoint(store.getSnapshot(), p).objectIds;
      const o = store.getSnapshot().objects?.find((o) => o.id === ids.at(-1));
      if (o?.kind === 'text') {
        event.preventDefault();
        options.onText(p, o);
      }
    } catch (e) {
      error(e);
    }
  }
  function keydown(event: KeyboardEvent) {
    if (
      document.activeElement !== canvas ||
      options.getTool().mode === 'inactive'
    )
      return;
    if (event.code === 'Space') {
      event.preventDefault();
      space = true;
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      abandon();
      selection = empty();
      emit();
      return;
    }
    if (gesture || pan) return;
    try {
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        store.deleteSelection(selection);
        selection = empty();
        emit();
      } else if (
        event.key.toLowerCase() === 'd' &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        selection = store.duplicateSelection(selection);
        emit();
      }
    } catch (e) {
      error(e);
    }
  }
  function keyup(event: KeyboardEvent) {
    if (event.code === 'Space') space = false;
  }
  function blur() {
    space = false;
    const ids = [...touches.keys(), ...(pan ? [pan.pointerId] : [])];
    pan = undefined;
    touches.clear();
    pinch = undefined;
    navigating = false;
    abandon();
    ids.forEach(release);
  }
  function wheel(event: WheelEvent) {
    if (options.getTool().mode === 'inactive' || viewport.isCameraLocked())
      return;
    event.preventDefault();
    rect = canvas.getBoundingClientRect();
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    if (event.ctrlKey || event.metaKey)
      viewport.zoomAt(Math.exp(-event.deltaY * unit * 0.0015), local(event));
    else
      viewport.panBy(
        { x: -event.deltaX * unit, y: -event.deltaY * unit },
        options.getPanMode?.(),
      );
  }
  const observer =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(invalidate)
      : undefined;
  observer?.observe(canvas);
  const unsubscribe = store.subscribe((change) => {
    if (change.reason === 'clear' || change.reason === 'replace') {
      abandon();
      selection = empty();
      emit();
    } else {
      const next = normalized(selection);
      if (JSON.stringify(next) !== JSON.stringify(selection)) {
        selection = next;
        emit();
      }
    }
    invalidate();
  });
  const stopCamera = viewport.subscribe(invalidate);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', cancel);
  canvas.addEventListener('dblclick', dblclick);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  window.addEventListener('resize', invalidate);
  window.addEventListener('calcink-appearance', invalidate);
  invalidate();
  return {
    invalidate,
    getSelection: () => cloneSelection(selection),
    setSelection,
    dispose() {
      if (disposed) return;
      disposed = true;
      blur();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      unsubscribe();
      stopCamera();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', cancel);
      canvas.removeEventListener('dblclick', dblclick);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('calcink-appearance', invalidate);
      canvas.style.touchAction = previousTouchAction;
    },
  };
}
