import { drawDocument } from '../src/ink/geometry';
import { groupEquations, groupSymbols } from '../src/recognition/grouping';
import { rasterizeSymbol } from '../src/recognition/preprocess';
import { syntheticDocument, measure } from './fixtures';

function runBrowserBenchmark() {
  const canvas = new OffscreenCanvas(1280, 900);
  const ctx = canvas.getContext('2d')!;
  const sizes = [500, 1000, 5000].map((strokeCount) => {
    const document = syntheticDocument(strokeCount);
    const masked = syntheticDocument(strokeCount, true);
    const replay = (input: typeof document) => {
      ctx.clearRect(0, 0, 1280, 900);
      drawDocument(ctx, input);
    };
    const replayUnmasked = measure(() => replay(document), 5);
    const replayMasked = measure(() => replay(masked), 5);
    const groups = groupEquations(masked).flatMap((line) =>
      groupSymbols(line.strokes).map((symbol) => ({
        symbol,
        lineBounds: line.bounds,
      })),
    );
    let visibleCount = 0;
    const preprocessing = measure(() => {
      visibleCount = 0;
      for (const { symbol, lineBounds } of groups) {
        const raster = rasterizeSymbol(symbol, masked.erasures, lineBounds);
        if (raster.visible) visibleCount++;
      }
    }, 5);
    return {
      strokeCount,
      symbolCount: groups.length,
      visibleCount,
      erasureCount: masked.erasures.length,
      measurements: { replayUnmasked, replayMasked, preprocessing },
    };
  });
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio,
    viewport: { width: 1280, height: 900 },
    canvas: 'OffscreenCanvas2D',
    note: 'Canvas replay measures CPU command submission; asynchronous GPU completion and display frame timing are not included.',
    sizes,
  };
}
(
  globalThis as unknown as { runCalcInkBenchmark: typeof runBrowserBenchmark }
).runCalcInkBenchmark = runBrowserBenchmark;
