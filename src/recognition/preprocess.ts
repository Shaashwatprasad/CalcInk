import { drawDocument } from '../ink/geometry';
import type { Bounds, Erasure } from '../shared/types';
import type { SymbolGroup } from './grouping';

export const PREPROCESSING_VERSION = 'rgb-white-baseline-v1';
export interface RasterizedSymbol {
  data: Float32Array;
  visible: boolean;
}
/** Matches audited RGB /255 NHWC polarity; baseline scale preserves decimal dots.
 * Canvas bilinear resizing approximates OpenCV INTER_LINEAR; live accuracy is unvalidated. */
export function rasterizeSymbol(
  group: SymbolGroup,
  erasures: Erasure[],
  lineBounds: Bounds,
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
  const b = group.bounds;
  const size =
    Math.max(20, lineBounds.maxY - lineBounds.minY, b.maxX - b.minX) / 0.8;
  const scale = 50 / size;
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    25 - ((b.minX + b.maxX) / 2) * scale,
    25 - ((b.minY + b.maxY) / 2) * scale,
  );
  // Source colors are UI ink; recognition uses canonical black, retaining widths and masks.
  drawDocument(ctx, {
    strokes: group.strokes.map((s) => ({ ...s, color: '#000' })),
    erasures,
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
