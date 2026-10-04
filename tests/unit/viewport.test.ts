import { describe, expect, it, vi } from 'vitest';
import {
  ViewportStore,
  worldToScreen,
  screenToWorld,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../../src/viewport';

describe('world camera', () => {
  it('applies only the latest finite-page resize after pen-up while user commands remain locked', () => {
    const viewport = new ViewportStore();
    viewport.setFinitePage({ width: 400, height: 300 });
    viewport.zoomAt(2, { x: 200, y: 150 });
    viewport.setCameraLocked(true);
    const locked = viewport.getSnapshot();
    viewport.resizeFinitePage({ width: 200, height: 150 });
    viewport.resizeFinitePage({ width: 100, height: 100 });
    expect(viewport.getSnapshot()).toBe(locked);
    expect(viewport.getFinitePage()).toEqual({ width: 400, height: 300 });
    viewport.panBy({ x: 100, y: 100 });
    viewport.setCameraLocked(false);
    expect(viewport.getFinitePage()).toEqual({ width: 100, height: 100 });
    expect(viewport.getSnapshot()).toEqual({
      offsetX: -100,
      offsetY: -100,
      zoom: 2,
    });
  });
  it('finite paper clamps pan and zoom without changing ink; infinite mode restores free navigation', () => {
    const viewport = new ViewportStore();
    viewport.panBy({ x: 90, y: -40 });
    expect(viewport.setFinitePage({ width: 400, height: 300 })).toBe(true);
    expect(viewport.getSnapshot()).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
    viewport.zoomAt(2, { x: 200, y: 150 });
    viewport.panBy({ x: -1000, y: 1000 });
    expect(viewport.getSnapshot()).toEqual({
      offsetX: -400,
      offsetY: 0,
      zoom: 2,
    });
    viewport.zoomToAt(0.5, { x: 100, y: 100 });
    expect(viewport.getSnapshot()).toEqual({
      offsetX: 100,
      offsetY: 75,
      zoom: 0.5,
    });
    expect(Object.isFrozen(viewport.getFinitePage())).toBe(true);
    viewport.setFinitePage();
    viewport.panBy({ x: 500, y: -500 });
    expect(viewport.getSnapshot()).toEqual({
      offsetX: 600,
      offsetY: -425,
      zoom: 0.5,
    });
  });
  it('rejects invalid or ink-locked finite-page changes without deferred camera changes', () => {
    const viewport = new ViewportStore();
    expect(viewport.setFinitePage({ width: Infinity, height: 300 })).toBe(
      false,
    );
    viewport.setCameraLocked(true);
    expect(viewport.setFinitePage({ width: 400, height: 300 })).toBe(false);
    viewport.setCameraLocked(false);
    expect(viewport.getFinitePage()).toBeUndefined();
    viewport.panBy({ x: 20, y: 20 });
    expect(viewport.getSnapshot().offsetX).toBe(20);
  });
  it('starts at legacy CSS coordinate identity and never changes source points', () => {
    const viewport = new ViewportStore();
    const original = Object.freeze({ x: -23, y: 900 });
    expect(worldToScreen(original, viewport.getSnapshot())).toEqual(original);
    expect(screenToWorld(original, viewport.getSnapshot())).toEqual(original);
    viewport.panBy({ x: 77, y: -11 });
    viewport.zoomAt(2, { x: 200, y: 100 });
    expect(original).toEqual({ x: -23, y: 900 });
    expect(worldToScreen(original, viewport.getSnapshot())).not.toEqual(
      original,
    );
  });

  it.each([
    { x: 0, y: 0 },
    { x: -25.125, y: -4096.5 },
    { x: 1e12, y: -1e12 },
    { x: 0.00001, y: -0.00002 },
  ])('round trips finite world and CSS coordinates %j', (point) => {
    const viewport = new ViewportStore();
    viewport.panBy({ x: -375.5, y: 220.25 });
    viewport.zoomAt(0.3, { x: 17.25, y: -51 });
    const camera = viewport.getSnapshot();
    const world = screenToWorld(worldToScreen(point, camera), camera);
    expect(world.x).toBeCloseTo(point.x, 3);
    expect(world.y).toBeCloseTo(point.y, 3);
    const screen = worldToScreen(screenToWorld(point, camera), camera);
    expect(screen.x).toBeCloseTo(point.x, 3);
    expect(screen.y).toBeCloseTo(point.y, 3);
  });

  it('pans by CSS delta regardless of zoom and vertical mode locks horizontal movement', () => {
    const viewport = new ViewportStore();
    viewport.zoomAt(3, { x: 0, y: 0 });
    expect(viewport.panBy({ x: 25, y: -40 })).toBe(true);
    expect(worldToScreen({ x: 5, y: 5 }, viewport.getSnapshot())).toEqual({
      x: 40,
      y: -25,
    });
    viewport.panBy({ x: 500, y: 10 }, 'vertical');
    expect(viewport.getSnapshot()).toEqual({
      offsetX: 25,
      offsetY: -30,
      zoom: 3,
    });
  });

  it('preserves the exact anchored world location across zoom and both clamps', () => {
    const viewport = new ViewportStore();
    viewport.panBy({ x: -50, y: 30 });
    const anchor = { x: 230, y: -80 };
    const beneath = screenToWorld(anchor, viewport.getSnapshot());
    for (const factor of [2, 1e300, 0.00001, 3]) {
      viewport.zoomAt(factor, anchor);
      const current = screenToWorld(anchor, viewport.getSnapshot());
      expect(current.x).toBeCloseTo(beneath.x, 10);
      expect(current.y).toBeCloseTo(beneath.y, 10);
      expect(worldToScreen(beneath, viewport.getSnapshot())).toEqual(anchor);
      expect(viewport.getSnapshot().zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(viewport.getSnapshot().zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it('100 percent preserves its anchor while reset restores the original camera', () => {
    const viewport = new ViewportStore();
    viewport.panBy({ x: 20, y: -80 });
    const anchor = { x: 50, y: 100 };
    viewport.zoomAt(3, anchor);
    const beneath = screenToWorld(anchor, viewport.getSnapshot());
    expect(viewport.setZoom100At(anchor)).toBe(true);
    expect(viewport.getSnapshot().zoom).toBe(1);
    expect(screenToWorld(anchor, viewport.getSnapshot())).toEqual(beneath);
    expect(viewport.reset()).toBe(true);
    expect(viewport.getSnapshot()).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
    expect(viewport.reset()).toBe(false);
  });

  it('fits negative-offset content to the available padded viewport and centers it', () => {
    const viewport = new ViewportStore();
    const bounds = { minX: -100, minY: -50, maxX: 300, maxY: 150 };
    expect(viewport.fitContent(bounds, { width: 600, height: 400 }, 50)).toBe(
      true,
    );
    expect(viewport.getSnapshot()).toEqual({
      zoom: 1.25,
      offsetX: 175,
      offsetY: 137.5,
    });
    expect(
      worldToScreen({ x: bounds.minX, y: bounds.minY }, viewport.getSnapshot()),
    ).toEqual({ x: 50, y: 75 });
    expect(
      worldToScreen({ x: bounds.maxX, y: bounds.maxY }, viewport.getSnapshot()),
    ).toEqual({ x: 550, y: 325 });
    expect(worldToScreen({ x: 100, y: 50 }, viewport.getSnapshot())).toEqual({
      x: 300,
      y: 200,
    });
  });

  it('fit clamps large and tiny positive content while retaining its center', () => {
    const viewport = new ViewportStore();
    for (const [length, zoom] of [
      [10000, MIN_ZOOM],
      [0.001, MAX_ZOOM],
    ]) {
      viewport.fitContent(
        { minX: 0, minY: 0, maxX: length, maxY: length },
        { width: 500, height: 300 },
      );
      expect(viewport.getSnapshot().zoom).toBe(zoom);
      expect(
        worldToScreen({ x: length / 2, y: length / 2 }, viewport.getSnapshot()),
      ).toEqual({ x: 250, y: 150 });
    }
  });

  it('rejects nonfinite/overflow deltas, anchors and zoom factors without notification', () => {
    const viewport = new ViewportStore();
    const listener = vi.fn();
    viewport.subscribe(listener);
    const original = viewport.getSnapshot();
    for (const factor of [0, -1, Infinity, NaN])
      expect(viewport.zoomAt(factor, { x: 5, y: 8 })).toBe(false);
    expect(viewport.zoomAt(2, { x: NaN, y: 8 })).toBe(false);
    expect(viewport.panBy({ x: Infinity, y: 0 })).toBe(false);
    expect(viewport.zoomToAt(-1, { x: 0, y: 0 })).toBe(false);
    expect(viewport.getSnapshot()).toBe(original);
    expect(listener).not.toHaveBeenCalled();
    viewport.panBy({ x: Number.MAX_VALUE, y: 0 });
    const extreme = viewport.getSnapshot();
    expect(viewport.panBy({ x: Number.MAX_VALUE, y: 0 })).toBe(false);
    expect(viewport.getSnapshot()).toBe(extreme);
    expect(() => worldToScreen({ x: Number.MAX_VALUE, y: 0 }, extreme)).toThrow(
      RangeError,
    );
  });

  it('rejects malformed fit bounds, invalid viewport and padding without camera change', () => {
    const viewport = new ViewportStore();
    const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 20 };
    const original = viewport.getSnapshot();
    for (const bad of [
      { ...bounds, maxX: 0 },
      { ...bounds, maxY: -1 },
      { ...bounds, maxX: Infinity },
      { ...bounds, minX: -Number.MAX_VALUE, maxX: Number.MAX_VALUE },
    ])
      expect(viewport.fitContent(bad, { width: 400, height: 300 })).toBe(false);
    for (const size of [
      { width: 0, height: 200 },
      { width: 40, height: 300 },
      { width: NaN, height: 300 },
    ])
      expect(viewport.fitContent(bounds, size)).toBe(false);
    for (const padding of [-1, Infinity, NaN, 500])
      expect(
        viewport.fitContent(bounds, { width: 400, height: 300 }, padding),
      ).toBe(false);
    expect(viewport.getSnapshot()).toBe(original);
  });

  it('camera lock rejects every navigation action and never replays it after unlock', () => {
    const viewport = new ViewportStore();
    const listener = vi.fn();
    viewport.subscribe(listener);
    viewport.panBy({ x: 20, y: 30 });
    const original = viewport.getSnapshot();
    listener.mockClear();
    viewport.setCameraLocked(true);
    expect(viewport.isCameraLocked()).toBe(true);
    expect(viewport.panBy({ x: 10, y: 10 })).toBe(false);
    expect(viewport.zoomAt(2, { x: 0, y: 0 })).toBe(false);
    expect(viewport.setZoom100At({ x: 0, y: 0 })).toBe(false);
    expect(viewport.reset()).toBe(false);
    expect(
      viewport.fitContent(
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        { width: 500, height: 500 },
      ),
    ).toBe(false);
    expect(viewport.getSnapshot()).toBe(original);
    viewport.setCameraLocked(false);
    expect(viewport.getSnapshot()).toBe(original);
    expect(listener).not.toHaveBeenCalled();
    expect(viewport.panBy({ x: 1, y: 2 })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('provides frozen stable snapshots and subscribes only to actual camera changes', () => {
    const viewport = new ViewportStore();
    const original = viewport.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = viewport.subscribe(listener);
    expect(viewport.getSnapshot()).toBe(original);
    expect(Object.isFrozen(original)).toBe(true);
    expect(viewport.panBy({ x: 0, y: 0 })).toBe(false);
    expect(viewport.zoomAt(1, { x: 1, y: 1 })).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    viewport.panBy({ x: 10, y: 20 });
    expect(viewport.getSnapshot()).not.toBe(original);
    expect(original).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
    expect(Object.isFrozen(viewport.getSnapshot())).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    viewport.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
