import type { EquationProjection } from '../projection';
import type { ViewportStore } from '../viewport';

export interface ProjectionRenderer {
  invalidate(): void;
  dispose(): void;
}

/** Owns projection pixels for the canvas lifetime, independently of React/results. */
export function mountProjection(
  canvas: HTMLCanvasElement,
  getProjections: () => readonly EquationProjection[],
  viewport?: ViewportStore,
  getAnswerColor?: () => string,
): ProjectionRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D is required for mathematical feedback.');
  let frame = 0;
  let disposed = false;
  let dpr = 0;
  function render(): void {
    frame = 0;
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const nextDpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * nextDpr));
    const height = Math.max(1, Math.round(rect.height * nextDpr));
    // Assigning an unchanged dimension clears pixels and resets Canvas state.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    dpr = nextDpr;
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    const camera = viewport?.getSnapshot() ?? {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    };
    ctx!.setTransform(
      dpr * camera.zoom,
      0,
      0,
      dpr * camera.zoom,
      dpr * camera.offsetX,
      dpr * camera.offsetY,
    );
    for (const projection of getProjections()) {
      if (
        !projection.answerText ||
        !projection.answerBounds ||
        !projection.equalsBounds
      )
        continue;
      const height =
        projection.answerFontSize ??
        Math.max(12, projection.bounds.maxY - projection.bounds.minY);
      ctx!.font = `500 ${height}px "DM Sans", sans-serif`;
      ctx!.fillStyle = getAnswerColor?.() ?? '#287568';
      ctx!.textBaseline = 'middle';
      const x = projection.answerBounds.minX;
      const y =
        (projection.equalsBounds.minY + projection.equalsBounds.maxY) / 2;
      ctx!.fillText(
        projection.answerText,
        x,
        y,
        Math.max(1, (rect.width - camera.offsetX) / camera.zoom - x - 8),
      );
    }
  }
  function invalidate(): void {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  }
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(invalidate);
  observer?.observe(canvas);
  window.addEventListener('resize', invalidate);
  const stopCamera = viewport?.subscribe(invalidate);
  invalidate();
  return {
    invalidate,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      stopCamera?.();
      window.removeEventListener('resize', invalidate);
    },
  };
}
