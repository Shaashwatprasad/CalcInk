import { InkStore } from '../document/InkStore';
import { drawDocument, drawStroke, pointBounds } from '../ink/geometry';
import type { Point, Stroke } from '../shared/types';

export interface InkTool {
  mode: 'pen' | 'stroke-eraser' | 'pixel-eraser';
  width: number;
  color: string;
  eraserRadius: number;
}

interface Gesture {
  pointerId: number;
  tool: InkTool;
  stroke: Stroke;
  drawnPoints: number;
}

/** Mounts imperative pointer input. No component update, pixels reads, or ML runs here. */
export function mountInk(
  committedCanvas: HTMLCanvasElement,
  activeCanvas: HTMLCanvasElement,
  store: InkStore,
  getTool: () => InkTool,
): () => void {
  const committed = committedCanvas.getContext('2d');
  const active = activeCanvas.getContext('2d');
  if (!committed || !active)
    throw new Error('Canvas2D is required for drawing.');
  let gesture: Gesture | undefined;
  let frameId = 0;
  let committedDirty = true;
  let sizeDirty = true;
  let disposed = false;
  let rect = activeCanvas.getBoundingClientRect();
  let currentDpr = 0;
  const previousTouchAction = activeCanvas.style.touchAction;
  activeCanvas.style.touchAction = 'none';

  function schedule(): void {
    if (!frameId && !disposed) frameId = requestAnimationFrame(render);
  }

  function clear(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  function resize(): void {
    rect = activeCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    let changed = dpr !== currentDpr;
    for (const canvas of [committedCanvas, activeCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        changed = true;
      }
    }
    currentDpr = dpr;
    committed!.setTransform(dpr, 0, 0, dpr, 0, 0);
    active!.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (changed) {
      committedDirty = true;
      if (gesture) gesture.drawnPoints = 0;
    }
    sizeDirty = false;
  }

  function render(): void {
    frameId = 0;
    if (disposed) return;
    if (sizeDirty || currentDpr !== (window.devicePixelRatio || 1)) resize();
    if (committedDirty) {
      clear(committed!);
      drawDocument(committed!, store.getSnapshot());
      committedDirty = false;
    }
    if (!gesture) {
      clear(active!);
      return;
    }
    if (gesture.drawnPoints >= gesture.stroke.points.length) return;
    if (gesture.tool.mode === 'pen') {
      if (!gesture.drawnPoints) clear(active!);
      drawStroke(active!, gesture.stroke, gesture.drawnPoints);
    } else {
      // Preview the gesture; the persistent erasure is one transaction at pen-up.
      clear(active!);
      active!.save();
      active!.globalAlpha = 0.25;
      drawStroke(active!, {
        ...gesture.stroke,
        width: gesture.tool.eraserRadius * 2,
        color: '#818cf8',
      });
      active!.restore();
    }
    gesture.drawnPoints = gesture.stroke.points.length;
  }

  function append(event: PointerEvent): void {
    if (!gesture) return;
    const events =
      typeof event.getCoalescedEvents === 'function'
        ? event.getCoalescedEvents()
        : [];
    for (const sample of [...events, event]) {
      const point: Point = {
        x: sample.clientX - rect.left,
        y: sample.clientY - rect.top,
        timestamp: sample.timeStamp,
        pressure: sample.pressure,
      };
      const previous = gesture.stroke.points.at(-1);
      if (previous && previous.x === point.x && previous.y === point.y)
        continue;
      gesture.stroke.points.push(point);
    }
    schedule();
  }

  function down(event: PointerEvent): void {
    if (gesture || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    rect = activeCanvas.getBoundingClientRect();
    const tool = { ...getTool() };
    gesture = {
      pointerId: event.pointerId,
      tool,
      drawnPoints: 0,
      stroke: {
        id: crypto.randomUUID(),
        points: [],
        bounds: pointBounds([]),
        width: tool.width,
        color: tool.color,
      },
    };
    activeCanvas.setPointerCapture(event.pointerId);
    append(event);
  }

  function move(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    append(event);
  }

  function finish(event: PointerEvent, includeEndpoint: boolean): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (includeEndpoint) append(event);
    const completed = gesture;
    gesture = undefined;
    const { stroke, tool } = completed;
    if (stroke.points.length) {
      if (tool.mode === 'pen') store.addStroke(stroke);
      else if (tool.mode === 'stroke-eraser')
        store.eraseStrokes(stroke.points, tool.eraserRadius);
      else store.eraseRegion(stroke.points, tool.eraserRadius);
    }
    if (activeCanvas.hasPointerCapture(event.pointerId))
      activeCanvas.releasePointerCapture(event.pointerId);
    schedule();
  }

  const up = (event: PointerEvent): void => {
    finish(event, true);
  };
  const cancel = (event: PointerEvent): void => {
    finish(event, false);
  };
  const resized = (): void => {
    sizeDirty = true;
    schedule();
  };
  const scrolled = (): void => {
    rect = activeCanvas.getBoundingClientRect();
  };
  activeCanvas.addEventListener('pointerdown', down);
  activeCanvas.addEventListener('pointermove', move);
  activeCanvas.addEventListener('pointerup', up);
  activeCanvas.addEventListener('pointercancel', cancel);
  activeCanvas.addEventListener('lostpointercapture', cancel);
  window.addEventListener('resize', resized);
  window.addEventListener('scroll', scrolled, true);
  const observer =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(resized)
      : undefined;
  observer?.observe(activeCanvas);
  const unsubscribe = store.subscribe((change) => {
    if (gesture && (change.reason === 'clear' || change.reason === 'replace')) {
      const pointerId = gesture.pointerId;
      gesture = undefined;
      if (activeCanvas.hasPointerCapture(pointerId))
        activeCanvas.releasePointerCapture(pointerId);
    }
    committedDirty = true;
    schedule();
  });
  schedule();

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    observer?.disconnect();
    unsubscribe();
    activeCanvas.removeEventListener('pointerdown', down);
    activeCanvas.removeEventListener('pointermove', move);
    activeCanvas.removeEventListener('pointerup', up);
    activeCanvas.removeEventListener('pointercancel', cancel);
    activeCanvas.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('resize', resized);
    window.removeEventListener('scroll', scrolled, true);
    if (gesture && activeCanvas.hasPointerCapture(gesture.pointerId))
      activeCanvas.releasePointerCapture(gesture.pointerId);
    gesture = undefined;
    activeCanvas.style.touchAction = previousTouchAction;
  };
}
