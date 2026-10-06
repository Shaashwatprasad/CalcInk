import { scratchTargets } from '../ink/scratch';
import { InkStore } from '../document/InkStore';
import {
  boundsIntersect,
  drawDocument,
  drawStroke,
  pointBounds,
} from '../ink/geometry';
import type { InkColorResolver } from '../ink/geometry';
import type { Bounds, Point, Stroke } from '../shared/types';
import { screenToWorld, type ViewportStore } from '../viewport';

export interface InkTool {
  mode: 'pen' | 'stroke-eraser' | 'pixel-eraser' | 'hand';
  width: number;
  color: string;
  eraserRadius: number;
  kind?: Stroke['kind'];
  colorMode?: Stroke['colorMode'];
  opacity?: number;
  pressureEnabled?: boolean;
  recognitionEligible?: boolean;
}

interface Gesture {
  pointerId: number;
  pointerType: string;
  tool: InkTool;
  stroke: Stroke;
  drawnPoints: number;
  limitReported?: boolean;
  pageEnded?: boolean;
}

/** Mounts imperative pointer input. No component update, pixels reads, or ML runs here. */
export function mountInk(
  committedCanvas: HTMLCanvasElement,
  activeCanvas: HTMLCanvasElement,
  store: InkStore,
  getTool: () => InkTool,
  navigation?: {
    viewport: ViewportStore;
    getPanMode: () => 'free' | 'vertical';
    onInputError?: (message: string) => void;
    getInkColor?: InkColorResolver;
  },
): () => void {
  const committed = committedCanvas.getContext('2d');
  const active = activeCanvas.getContext('2d');
  if (!committed || !active)
    throw new Error('Canvas2D is required for drawing.');
  let gesture: Gesture | undefined;
  let frameId = 0;
  let committedDirty = true;
  let sizeDirty = true;
  let damage: Bounds[] = [];
  let disposed = false;
  let rect = activeCanvas.getBoundingClientRect();
  let currentDpr = 0;
  let spaceHeld = false;
  let pan: { pointerId: number; x: number; y: number } | undefined;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { x: number; y: number; distance: number } | undefined;
  let touchNavigation = false;
  const previousTouchAction = activeCanvas.style.touchAction;
  activeCanvas.style.touchAction = 'none';

  function transform(): void {
    const camera = navigation?.viewport.getSnapshot();
    for (const ctx of [committed!, active!])
      ctx.setTransform(
        currentDpr * (camera?.zoom ?? 1),
        0,
        0,
        currentDpr * (camera?.zoom ?? 1),
        currentDpr * (camera?.offsetX ?? 0),
        currentDpr * (camera?.offsetY ?? 0),
      );
  }
  const local = (event: PointerEvent) => ({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  function touchFrame() {
    const pair = [...touches.values()].slice(0, 2);
    if (pair.length < 2) return undefined;
    return {
      x: (pair[0].x + pair[1].x) / 2,
      y: (pair[0].y + pair[1].y) / 2,
      distance: Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y),
    };
  }
  function retireGesture(): void {
    gesture = undefined;
    navigation?.viewport.setCameraLocked(false);
    schedule();
  }

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
    transform();
    if (changed) {
      committedDirty = true;
      damage = [];
      if (gesture) gesture.drawnPoints = 0;
    }
    sizeDirty = false;
  }

  function render(): void {
    frameId = 0;
    if (disposed) return;
    if (sizeDirty || currentDpr !== (window.devicePixelRatio || 1)) resize();
    if (committedDirty) {
      // The canvas retains unchanged pixels. Repaint only damaged device-pixel
      // rectangles, clipping every intersecting stroke (including alpha/masks).
      const camera = navigation?.viewport.getSnapshot();
      const zoom = camera?.zoom ?? 1;
      const offsetX = camera?.offsetX ?? 0,
        offsetY = camera?.offsetY ?? 0;
      const regions = damage.length
        ? [
            damage.reduce(
              (region, b) => ({
                minX: Math.min(region.minX, b.minX),
                minY: Math.min(region.minY, b.minY),
                maxX: Math.max(region.maxX, b.maxX),
                maxY: Math.max(region.maxY, b.maxY),
              }),
              { ...damage[0] },
            ),
          ]
        : [
            {
              minX: -offsetX / zoom,
              minY: -offsetY / zoom,
              maxX: (rect.width - offsetX) / zoom,
              maxY: (rect.height - offsetY) / zoom,
            },
          ];
      const doc = store.getSnapshot();
      if (damage.length) {
        // Canvas stroke antialiasing can differ when a round capsule is cut by
        // the clip. Include complete intersecting geometry before repainting.
        const region = regions[0];
        const included = new Set<string>();
        const margin = 3 / (currentDpr * zoom);
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const stroke of doc.strokes) {
            if (
              included.has(stroke.id) ||
              !boundsIntersect(stroke.bounds, {
                minX: region.minX - margin,
                minY: region.minY - margin,
                maxX: region.maxX + margin,
                maxY: region.maxY + margin,
              })
            )
              continue;
            included.add(stroke.id);
            const next = {
              minX: Math.min(region.minX, stroke.bounds.minX),
              minY: Math.min(region.minY, stroke.bounds.minY),
              maxX: Math.max(region.maxX, stroke.bounds.maxX),
              maxY: Math.max(region.maxY, stroke.bounds.maxY),
            };
            expanded ||=
              next.minX !== region.minX ||
              next.minY !== region.minY ||
              next.maxX !== region.maxX ||
              next.maxY !== region.maxY;
            Object.assign(region, next);
          }
        }
      }
      for (const bounds of regions) {
        const padding = 2 / (currentDpr * zoom);
        const x = Math.max(
          0,
          Math.floor((bounds.minX * zoom + offsetX) * currentDpr - 2),
        );
        const y = Math.max(
          0,
          Math.floor((bounds.minY * zoom + offsetY) * currentDpr - 2),
        );
        const right = Math.min(
          committedCanvas.width,
          Math.ceil((bounds.maxX * zoom + offsetX) * currentDpr + 2),
        );
        const bottom = Math.min(
          committedCanvas.height,
          Math.ceil((bounds.maxY * zoom + offsetY) * currentDpr + 2),
        );
        if (right <= x || bottom <= y) continue;
        committed!.save();
        committed!.setTransform(1, 0, 0, 1, 0, 0);
        committed!.clearRect(x, y, right - x, bottom - y);
        committed!.beginPath();
        committed!.rect(x, y, right - x, bottom - y);
        committed!.clip();
        transform();
        const visible = {
          minX: (x / currentDpr - offsetX) / zoom - padding,
          minY: (y / currentDpr - offsetY) / zoom - padding,
          maxX: (right / currentDpr - offsetX) / zoom + padding,
          maxY: (bottom / currentDpr - offsetY) / zoom + padding,
        };
        drawDocument(
          committed!,
          {
            strokes: doc.strokes.filter((stroke) =>
              boundsIntersect(stroke.bounds, visible),
            ),
            erasures: doc.erasures,
          },
          navigation?.getInkColor,
        );
        committed!.restore();
      }
      damage = [];
      committedDirty = false;
    }
    if (!gesture) {
      clear(active!);
      return;
    }
    if (gesture.drawnPoints >= gesture.stroke.points.length) return;
    if (gesture.tool.mode === 'pen') {
      // Replay only this active gesture as one joined path. Appending separately
      // capped segments changes antialiasing (and compounds translucent ink).
      // This never replays the committed notebook on the pointer drawing path.
      clear(active!);
      drawStroke(active!, gesture.stroke, 0, navigation?.getInkColor);
    } else {
      // Preview the gesture; the persistent erasure is one transaction at pen-up.
      clear(active!);
      active!.save();
      active!.globalAlpha = 0.25;
      drawStroke(active!, {
        ...gesture.stroke,
        width: gesture.tool.eraserRadius * 2,
        color: '#818cf8',
        kind: 'pen',
        colorMode: 'explicit',
        opacity: 1,
        pressureEnabled: false,
      });
      active!.restore();
    }
    gesture.drawnPoints = gesture.stroke.points.length;
  }

  function append(event: PointerEvent): void {
    if (!gesture || gesture.pageEnded) return;
    const events =
      typeof event.getCoalescedEvents === 'function'
        ? event.getCoalescedEvents()
        : [];
    for (const sample of [...events, event]) {
      let position = navigation
        ? screenToWorld(local(sample), navigation.viewport.getSnapshot())
        : local(sample);
      let clippedFraction: number | undefined;
      const page = navigation?.viewport.getFinitePage();
      if (
        page &&
        (position.x < 0 ||
          position.y < 0 ||
          position.x > page.width ||
          position.y > page.height)
      ) {
        const previous = gesture.stroke.points.at(-1);
        if (!previous) return;
        let fraction = 1;
        if (position.x < 0)
          fraction = Math.min(
            fraction,
            -previous.x / (position.x - previous.x),
          );
        if (position.x > page.width)
          fraction = Math.min(
            fraction,
            (page.width - previous.x) / (position.x - previous.x),
          );
        if (position.y < 0)
          fraction = Math.min(
            fraction,
            -previous.y / (position.y - previous.y),
          );
        if (position.y > page.height)
          fraction = Math.min(
            fraction,
            (page.height - previous.y) / (position.y - previous.y),
          );
        position = {
          x: previous.x + (position.x - previous.x) * fraction,
          y: previous.y + (position.y - previous.y) * fraction,
        };
        clippedFraction = fraction;
        gesture.pageEnded = true;
      }
      // Match the existing persisted-document coordinate limit; never save ink
      // that would be rejected on reload after panning far from the origin.
      if (Math.abs(position.x) > 1e6 || Math.abs(position.y) > 1e6) {
        if (!gesture.limitReported) {
          gesture.limitReported = true;
          navigation?.onInputError?.(
            'Canvas coordinate limit reached. Reset or pan back to continue drawing.',
          );
        }
        continue;
      }
      const previous = gesture.stroke.points.at(-1);
      let pressure =
        gesture.tool.pressureEnabled && event.pointerType !== 'pen'
          ? undefined
          : sample.pressure;
      if (
        clippedFraction !== undefined &&
        pressure !== undefined &&
        previous?.pressure !== undefined
      )
        pressure =
          previous.pressure + (pressure - previous.pressure) * clippedFraction;
      const point: Point = {
        ...position,
        timestamp:
          clippedFraction !== undefined && previous
            ? previous.timestamp +
              (sample.timeStamp - previous.timestamp) * clippedFraction
            : sample.timeStamp,
        pressure,
      };
      if (previous && previous.x === point.x && previous.y === point.y) {
        if (gesture.pageEnded) break;
        continue;
      }
      gesture.stroke.points.push(point);
      if (gesture.pageEnded) break;
    }
    schedule();
  }

  function down(event: PointerEvent): void {
    if (!navigation && getTool().mode === 'hand') return;
    rect = activeCanvas.getBoundingClientRect();
    if (navigation && event.pointerType === 'touch') {
      // Palm/secondary touches must not retire an active pen or mouse stroke.
      if (gesture && gesture.pointerType !== 'touch') return;
      touches.set(event.pointerId, local(event));
      if (touches.size >= 2 || touchNavigation) {
        event.preventDefault();
        touchNavigation = true;
        retireGesture(); // Promotion never commits the first touch's ink/eraser preview.
        pan = undefined;
        pinch = touchFrame();
        activeCanvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (
      navigation &&
      (getTool().mode === 'hand' || spaceHeld) &&
      event.button === 0 &&
      !gesture &&
      !pan
    ) {
      event.preventDefault();
      pan = { pointerId: event.pointerId, ...local(event) };
      activeCanvas.setPointerCapture(event.pointerId);
      activeCanvas.focus({ preventScroll: true });
      return;
    }
    if (gesture || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    rect = activeCanvas.getBoundingClientRect();
    const tool = { ...getTool() };
    const page = navigation?.viewport.getFinitePage();
    if (page && navigation) {
      const position = screenToWorld(
        local(event),
        navigation.viewport.getSnapshot(),
      );
      if (
        position.x < 0 ||
        position.y < 0 ||
        position.x > page.width ||
        position.y > page.height
      ) {
        touches.delete(event.pointerId);
        return;
      }
    }
    if (navigation) tool.eraserRadius /= navigation.viewport.getSnapshot().zoom;
    gesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      tool,
      drawnPoints: 0,
      stroke: {
        id: crypto.randomUUID(),
        points: [],
        bounds: pointBounds([]),
        width: tool.width,
        color: tool.color,
        kind: tool.kind,
        colorMode: tool.colorMode,
        opacity: tool.opacity,
        pressureEnabled: tool.pressureEnabled,
        recognitionEligible: tool.recognitionEligible,
      },
    };
    activeCanvas.setPointerCapture(event.pointerId);
    if (navigation) activeCanvas.focus({ preventScroll: true });
    navigation?.viewport.setCameraLocked(true);
    append(event);
  }

  function move(event: PointerEvent): void {
    if (navigation && touches.has(event.pointerId)) {
      touches.set(event.pointerId, local(event));
      if (touchNavigation) {
        event.preventDefault();
        const next = touchFrame();
        if (pinch && next) {
          if (pinch.distance > 2 && next.distance > 2)
            navigation.viewport.zoomAt(next.distance / pinch.distance, pinch);
          navigation.viewport.panBy(
            { x: next.x - pinch.x, y: next.y - pinch.y },
            navigation.getPanMode(),
          );
        }
        pinch = next;
        return;
      }
    }
    if (navigation && pan?.pointerId === event.pointerId) {
      event.preventDefault();
      const next = local(event);
      navigation.viewport.panBy(
        { x: next.x - pan.x, y: next.y - pan.y },
        navigation.getPanMode(),
      );
      pan = { pointerId: event.pointerId, ...next };
      return;
    }
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    append(event);
  }

  function finish(event: PointerEvent, includeEndpoint: boolean): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (includeEndpoint) append(event);
    const completed = gesture;
    gesture = undefined;
    navigation?.viewport.setCameraLocked(false);
    const { stroke, tool } = completed;
    if (stroke.points.length) {
      if (tool.mode === 'pen') {
        const targets =
          stroke.kind === 'highlighter'
            ? []
            : scratchTargets(stroke.points, store.getSnapshot().strokes);
        if (targets.length) store.eraseRegion(stroke.points, 3, targets);
        else store.addStroke(stroke);
      } else if (tool.mode === 'stroke-eraser')
        store.eraseStrokes(stroke.points, tool.eraserRadius);
      else store.eraseRegion(stroke.points, tool.eraserRadius);
    }
    if (activeCanvas.hasPointerCapture(event.pointerId))
      activeCanvas.releasePointerCapture(event.pointerId);
    schedule();
  }

  const up = (event: PointerEvent): void => {
    if (endNavigation(event)) return;
    finish(event, true);
  };
  const cancel = (event: PointerEvent): void => {
    if (endNavigation(event)) return;
    finish(event, false);
  };
  function endNavigation(event: PointerEvent): boolean {
    touches.delete(event.pointerId);
    pinch = touchFrame();
    const navigated = touchNavigation || pan?.pointerId === event.pointerId;
    if (pan?.pointerId === event.pointerId) pan = undefined;
    if (!touches.size) touchNavigation = false;
    if (navigated && activeCanvas.hasPointerCapture(event.pointerId))
      activeCanvas.releasePointerCapture(event.pointerId);
    return navigated;
  }
  const editable = (target: EventTarget | null) =>
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    Boolean(
      target.closest('input,textarea,select,button,a,[contenteditable="true"]'),
    );
  const keydown = (event: KeyboardEvent) => {
    if (navigation && event.code === 'Space' && !editable(event.target)) {
      event.preventDefault();
      spaceHeld = true;
    }
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.code === 'Space') spaceHeld = false;
  };
  const blur = () => {
    const captured = [...touches.keys(), ...(pan ? [pan.pointerId] : [])];
    spaceHeld = false;
    pan = undefined;
    pinch = undefined;
    touches.clear();
    touchNavigation = false;
    // Retain sampled ordinary ink on focus loss, as on V1 cancellation.
    if (gesture)
      finish({ pointerId: gesture.pointerId } as PointerEvent, false);
    for (const id of captured)
      if (activeCanvas.hasPointerCapture(id))
        activeCanvas.releasePointerCapture(id);
  };
  const wheel = (event: WheelEvent) => {
    if (!navigation || navigation.viewport.isCameraLocked()) return;
    event.preventDefault();
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    if (event.ctrlKey || event.metaKey)
      navigation.viewport.zoomAt(Math.exp(-event.deltaY * unit * 0.0015), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    else
      navigation.viewport.panBy(
        { x: -event.deltaX * unit, y: -event.deltaY * unit },
        navigation.getPanMode(),
      );
  };
  const resized = (): void => {
    sizeDirty = true;
    schedule();
  };
  const appearanceChanged = (): void => {
    committedDirty = true;
    damage = [];
    if (gesture) gesture.drawnPoints = 0;
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
  window.addEventListener('calcink-appearance', appearanceChanged);
  window.addEventListener('scroll', scrolled, true);
  if (navigation) {
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    activeCanvas.addEventListener('wheel', wheel, { passive: false });
  }
  const stopCamera = navigation?.viewport.subscribe(() => {
    transform();
    committedDirty = true;
    damage = [];
    if (gesture) gesture.drawnPoints = 0;
    schedule();
  });
  const observer =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(resized)
      : undefined;
  observer?.observe(activeCanvas);
  const unsubscribe = store.subscribe((change) => {
    if (gesture && (change.reason === 'clear' || change.reason === 'replace')) {
      const pointerId = gesture.pointerId;
      gesture = undefined;
      navigation?.viewport.setCameraLocked(false);
      if (activeCanvas.hasPointerCapture(pointerId))
        activeCanvas.releasePointerCapture(pointerId);
    }
    if (change.reason === 'clear' || change.reason === 'replace') {
      committedDirty = true;
      damage = [];
    } else if (
      change.changedStrokeIds.length ||
      change.deletedStrokeIds.length
    ) {
      // Keep a pending full repaint full; combine successive document changes.
      if (!committedDirty || damage.length)
        damage = damage.concat(change.oldBounds, change.newBounds);
      committedDirty = true;
    }
    schedule();
  });
  schedule();

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    observer?.disconnect();
    unsubscribe();
    stopCamera?.();
    navigation?.viewport.setCameraLocked(false);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
    window.removeEventListener('blur', blur);
    activeCanvas.removeEventListener('wheel', wheel);
    const navigationPointers = [
      ...touches.keys(),
      ...(pan ? [pan.pointerId] : []),
    ];
    touches.clear();
    pan = undefined;
    pinch = undefined;
    touchNavigation = false;
    for (const id of navigationPointers)
      if (activeCanvas.hasPointerCapture(id))
        activeCanvas.releasePointerCapture(id);
    activeCanvas.removeEventListener('pointerdown', down);
    activeCanvas.removeEventListener('pointermove', move);
    activeCanvas.removeEventListener('pointerup', up);
    activeCanvas.removeEventListener('pointercancel', cancel);
    activeCanvas.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('resize', resized);
    window.removeEventListener('calcink-appearance', appearanceChanged);
    window.removeEventListener('scroll', scrolled, true);
    if (gesture && activeCanvas.hasPointerCapture(gesture.pointerId))
      activeCanvas.releasePointerCapture(gesture.pointerId);
    gesture = undefined;
    activeCanvas.style.touchAction = previousTouchAction;
  };
}
