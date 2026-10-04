import { rasterizeSymbol } from '../../src/recognition/preprocess';
import { pointBounds } from '../../src/ink/geometry';
import { unionBounds } from '../../src/recognition/grouping';
import type { Bounds, Erasure, Stroke } from '../../src/shared/types';

const stroke = (
  id: string,
  coordinates: [number, number][],
  width = 3,
  color = '#000000',
): Stroke => {
  const points = coordinates.map(([x, y], timestamp) => ({
    x,
    y,
    timestamp,
    pressure: 0.5,
  }));
  return { id, points, width, color, bounds: pointBounds(points, width / 2) };
};
function crop(
  strokes: Stroke[],
  erasures: Erasure[] = [],
  lineBounds = unionBounds(strokes),
) {
  const raster = rasterizeSymbol(
    { strokes, bounds: unionBounds(strokes) },
    erasures,
    lineBounds,
  );
  return { visible: raster.visible, data: Array.from(raster.data) };
}
export function runPreprocessingProbe() {
  const source = [
    stroke('angle', [
      [10, 10],
      [12, 40],
      [25, 35],
    ]),
  ];
  const originalSource = JSON.stringify(source);
  const baseline = crop(source);
  const cosmetic = ['#FFFFFF', '#E4E7EB', '#5275AE', '#ff0000'].map((color) =>
    crop(source.map((s) => ({ ...s, color }))),
  );
  const translated = source.map((s) => {
    const points = s.points.map((p) => ({
      ...p,
      x: p.x + 999000,
      y: p.y - 999000,
    }));
    return { ...s, points, bounds: pointBounds(points, s.width / 2) };
  });
  const dot = crop([stroke('dot', [[25, 39]], 3)], [], {
    minX: 0,
    minY: 0,
    maxX: 80,
    maxY: 40,
  });
  const mask: Erasure = {
    id: 'erase',
    targetStrokeIds: ['angle'],
    radius: 100,
    path: [{ x: 15, y: 25, timestamp: 0 }],
  };
  const erased = crop(source, [mask]);
  const partialMask: Erasure = {
    id: 'partial',
    targetStrokeIds: ['angle'],
    radius: 3,
    path: [{ x: 12, y: 30, timestamp: 0 }],
  };
  const partial = crop(source, [partialMask]);
  const translatedPartial = crop(translated, [
    {
      ...partialMask,
      path: partialMask.path.map((point) => ({
        ...point,
        x: point.x + 999000,
        y: point.y - 999000,
      })),
    },
  ]);
  const nonTargetMask = crop(source, [
    { ...mask, targetStrokeIds: ['another-stroke'] },
  ]);
  const thick = crop([
    stroke(
      'angle',
      [
        [10, 10],
        [12, 40],
        [25, 35],
      ],
      8,
    ),
  ]);
  const pressureChanged = crop(
    source.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ ...p, pressure: 1 })),
    })),
  );
  const empty = rasterizeSymbol(
    { strokes: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    [],
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  );
  const tallContext = crop(source, [], {
    minX: 0,
    minY: 0,
    maxX: 80,
    maxY: 400,
  });
  const dark = (data: number[]) =>
    data.filter((value, index) => index % 3 === 0 && value < 0.96).length;
  const maxDeviation = (a: number[], b: number[]) =>
    Math.max(...a.map((value, index) => Math.abs(value - b[index])));
  return {
    checks: {
      float32ShapeRange:
        baseline.data.length === 7500 &&
        baseline.data.every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
      rgbChannels: baseline.data.every(
        (v, i, data) => i % 3 === 0 || v === data[i - (i % 3)],
      ),
      cosmeticColorInvariant: cosmetic.every(
        (candidate) => maxDeviation(baseline.data, candidate.data) === 0,
      ),
      worldTranslationInvariant:
        maxDeviation(baseline.data, crop(translated).data) <= 1 / 255,
      translatedPartialMaskInvariant:
        maxDeviation(partial.data, translatedPartial.data) <= 1 / 255,
      authoritativeGeometryUnchanged:
        JSON.stringify(source) === originalSource &&
        partialMask.path[0].x === 12 &&
        partialMask.path[0].y === 30,
      dotPreserved:
        dot.visible &&
        dark(dot.data) > 0 &&
        dark(dot.data) < dark(baseline.data),
      emptyWhite:
        !empty.visible && Array.from(empty.data).every((value) => value === 1),
      erasedWhite: !erased.visible && erased.data.every((value) => value === 1),
      nonTargetEraseInvariant:
        maxDeviation(baseline.data, nonTargetMask.data) === 0,
      widthAffectsRaster: dark(thick.data) > dark(baseline.data),
      baselinePressureIgnored:
        maxDeviation(baseline.data, pressureChanged.data) === 0,
      antialiasingPresent: baseline.data.some(
        (value) => value > 0 && value < 1,
      ),
      whitePadding: baseline.data
        .slice(0, 50 * 3)
        .every((value) => value === 1),
    },
    defects: {
      tallEquationShrinksUnrelatedSymbol: {
        baselineDarkPixels: dark(baseline.data),
        tallContextDarkPixels: dark(tallContext.data),
        reproduced: dark(tallContext.data) < dark(baseline.data) / 4,
      },
      erasedTransparency: {
        visible: erased.visible,
        minimum: Math.min(...erased.data),
        reproduced: erased.visible || erased.data.some((value) => value !== 1),
      },
    },
    tensorStatistics: {
      minimum: Math.min(...baseline.data),
      maximum: Math.max(...baseline.data),
      darkPixels: dark(baseline.data),
      dotDarkPixels: dark(dot.data),
      translatedMaximumDeviation: maxDeviation(
        baseline.data,
        crop(translated).data,
      ),
      translatedPartialMaskMaximumDeviation: maxDeviation(
        partial.data,
        translatedPartial.data,
      ),
    },
    note: 'Synthetic geometry invariance/contract probe. Baseline renders constant width and ignores pressure; pressure-sensitive V2 must update this contract. Camera/DPR invariance follows only where the caller passes unchanged world geometry. No human handwriting accuracy is measured.',
  };
}
export function rasterizeGroundTruth(
  strokes: Stroke[],
  erasures: Erasure[],
  bounds: Bounds,
) {
  return crop(strokes, erasures, bounds);
}
Object.assign(globalThis, {
  runCalcInkPreprocessingProbe: runPreprocessingProbe,
  rasterizeCalcInkGroundTruth: rasterizeGroundTruth,
});
