import type { EquationProjection } from '../projection';
import type { Bounds } from '../shared/types';
import { boundsIntersect } from '../ink/geometry';
import type { ViewportStore } from '../viewport';

export interface ProjectionRenderer {
  invalidate(): void;
  dispose(): void;
}
interface AnswerPixels {
  key: string;
  text: string;
  x: number;
  y: number;
  font: string;
  maxWidth: number;
  color: string;
  bounds: Bounds;
}

/** Retains answer pixels; revisions/status alone never repaint unchanged answers. */
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
  let previousCamera = '';
  let previous = new Map<string, AnswerPixels>();
  function render(): void {
    frame = 0;
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    let full = canvas.width !== width || canvas.height !== height;
    // Assigning an unchanged dimension clears pixels and resets Canvas state.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const camera = viewport?.getSnapshot() ?? {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    };
    const cameraKey = `${dpr}:${camera.zoom}:${camera.offsetX}:${camera.offsetY}:${width}:${height}`;
    full ||= cameraKey !== previousCamera;
    previousCamera = cameraKey;
    const color = getAnswerColor?.() ?? '#287568';
    const next = new Map<string, AnswerPixels>();
    const damage: Bounds[] = [];
    for (const p of getProjections()) {
      if (!p.answerText || !p.answerBounds || !p.equalsBounds) continue;
      const fontSize =
        p.answerFontSize ?? Math.max(12, p.bounds.maxY - p.bounds.minY);
      const font = `500 ${fontSize}px "DM Sans", sans-serif`;
      const x = p.answerBounds.minX;
      const y = (p.equalsBounds.minY + p.equalsBounds.maxY) / 2;
      const maxWidth = Math.max(
        1,
        (rect.width - camera.offsetX) / camera.zoom - x - 8,
      );
      const key = JSON.stringify([p.answerText, x, y, font, maxWidth, color]);
      const old = previous.get(p.equationId);
      if (old?.key === key) {
        next.set(p.equationId, old);
        continue;
      }
      ctx!.font = font;
      const textWidth = ctx!.measureText(p.answerText).width;
      const answer = {
        key,
        text: p.answerText,
        x,
        y,
        font,
        maxWidth,
        color,
        // Conservative vertical glyph box; horizontal extent is font-measured.
        bounds: {
          minX: x - fontSize * 0.2,
          minY: y - fontSize,
          maxX: x + Math.min(textWidth, maxWidth) + fontSize * 0.2,
          maxY: y + fontSize,
        },
      };
      next.set(p.equationId, answer);
      damage.push(answer.bounds);
      if (old) damage.push(old.bounds);
    }
    for (const [id, old] of previous)
      if (!next.has(id)) damage.push(old.bounds);
    previous = next;
    if (!full && !damage.length) return;
    const visible: Bounds = {
      minX: -camera.offsetX / camera.zoom,
      minY: -camera.offsetY / camera.zoom,
      maxX: (rect.width - camera.offsetX) / camera.zoom,
      maxY: (rect.height - camera.offsetY) / camera.zoom,
    };
    const region = full
      ? visible
      : damage.reduce((region, b) => ({
          minX: Math.min(region.minX, b.minX),
          minY: Math.min(region.minY, b.minY),
          maxX: Math.max(region.maxX, b.maxX),
          maxY: Math.max(region.maxY, b.maxY),
        }));
    const x = Math.max(
      0,
      Math.floor((region.minX * camera.zoom + camera.offsetX) * dpr - 2),
    );
    const y = Math.max(
      0,
      Math.floor((region.minY * camera.zoom + camera.offsetY) * dpr - 2),
    );
    const right = Math.min(
      width,
      Math.ceil((region.maxX * camera.zoom + camera.offsetX) * dpr + 2),
    );
    const bottom = Math.min(
      height,
      Math.ceil((region.maxY * camera.zoom + camera.offsetY) * dpr + 2),
    );
    if (right <= x || bottom <= y) return;
    ctx!.save();
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(x, y, right - x, bottom - y);
    ctx!.beginPath();
    ctx!.rect(x, y, right - x, bottom - y);
    ctx!.clip();
    ctx!.setTransform(
      dpr * camera.zoom,
      0,
      0,
      dpr * camera.zoom,
      dpr * camera.offsetX,
      dpr * camera.offsetY,
    );
    // Clip padding can include neighboring glyph antialiasing; replay all hits.
    const padding = 2 / (dpr * camera.zoom);
    const painted = {
      minX: (x / dpr - camera.offsetX) / camera.zoom - padding,
      minY: (y / dpr - camera.offsetY) / camera.zoom - padding,
      maxX: (right / dpr - camera.offsetX) / camera.zoom + padding,
      maxY: (bottom / dpr - camera.offsetY) / camera.zoom + padding,
    };
    for (const answer of next.values()) {
      if (
        !boundsIntersect(answer.bounds, painted) ||
        !boundsIntersect(answer.bounds, visible)
      )
        continue;
      ctx!.font = answer.font;
      ctx!.fillStyle = answer.color;
      ctx!.textBaseline = 'middle';
      ctx!.fillText(answer.text, answer.x, answer.y, answer.maxWidth);
    }
    ctx!.restore();
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
  window.addEventListener('calcink-appearance', invalidate);
  const fontChanged = () => {
    previous = new Map();
    previousCamera = '';
    invalidate();
  };
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  fonts?.addEventListener('loadingdone', fontChanged);
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
      window.removeEventListener('calcink-appearance', invalidate);
      fonts?.removeEventListener('loadingdone', fontChanged);
    },
  };
}
