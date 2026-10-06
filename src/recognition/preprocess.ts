import { drawDocument, isRecognitionEligible } from '../ink/geometry';
import type { Bounds, Erasure } from '../shared/types';
import { unionBounds, type SymbolGroup } from './grouping';

export const PREPROCESSING_VERSION = 'rgb-white-local-median-v4';
export interface RasterizedSymbol {
  data: Float32Array;
  visible: boolean;
}
/** Matches audited RGB /255 NHWC polarity; baseline scale preserves decimal dots.
 * Canvas bilinear resizing approximates OpenCV INTER_LINEAR; live accuracy is unvalidated. */
export function rasterizeSymbol(
  group: SymbolGroup,
  erasures: Erasure[],
  lineBounds: Bounds | number,
): RasterizedSymbol {
  if (typeof OffscreenCanvas === 'undefined')
    throw new Error(
      'Worker OffscreenCanvas is required for recognition in this browser. Drawing remains available.',
    );
  const canvas = new OffscreenCanvas(50, 50);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Worker Canvas2D unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 50, 50);
  const eligibleStrokes = group.strokes.filter(isRecognitionEligible);
  if (!eligibleStrokes.length)
    return { data: new Float32Array(7500).fill(1), visible: false };
  const b = unionBounds(eligibleStrokes);
  const size =
    Math.max(
      20,
      typeof lineBounds === 'number'
        ? lineBounds
        : lineBounds.maxY - lineBounds.minY,
      b.maxX - b.minX,
      b.maxY - b.minY,
    ) / 0.8;
  const scale = 50 / size;
  const centerX = (b.minX + b.maxX) / 2;
  const centerY = (b.minY + b.maxY) / 2;
  ctx.setTransform(scale, 0, 0, scale, 25, 25);
  // Source colors are UI ink; recognition uses canonical black, retaining widths and masks.
  drawDocument(ctx, {
    // Crop in local coordinates before Canvas conversion. Huge camera/world
    // offsets otherwise lose subpixel precision inside the rasterizer.
    strokes: eligibleStrokes.map((s) => ({
      ...s,
      color: '#000',
      colorMode: 'explicit',
      opacity: 1,
      points: s.points.map((p) => ({
        ...p,
        x: p.x - centerX,
        y: p.y - centerY,
      })),
    })),
    erasures: erasures.map((mask) => ({
      ...mask,
      path: mask.path.map((p) => ({
        ...p,
        x: p.x - centerX,
        y: p.y - centerY,
      })),
    })),
  });
  const pixels = ctx.getImageData(0, 0, 50, 50).data;
  const data = new Float32Array(50 * 50 * 3);
  let darkPixels = 0;
  for (let i = 0; i < 2500; i++) {
    for (let c = 0; c < 3; c++) data[i * 3 + c] = pixels[i * 4 + c] / 255;
    if (pixels[i * 4] < 245) darkPixels++;
  }
  return { data, visible: darkPixels > 0 };
}
