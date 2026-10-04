/** Camera coordinates are local CSS pixels. DPR belongs only to rendering. */
export interface Coordinate {
  readonly x: number;
  readonly y: number;
}
export interface CameraSnapshot {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
}
export interface ContentBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const finiteCoordinate = (point: Coordinate) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

export function worldToScreen(
  point: Coordinate,
  camera: CameraSnapshot,
): Coordinate {
  const result = {
    x: point.x * camera.zoom + camera.offsetX,
    y: point.y * camera.zoom + camera.offsetY,
  };
  if (!finiteCoordinate(point) || !finiteCoordinate(result))
    throw new RangeError('Camera transform requires finite coordinates');
  return result;
}
export function screenToWorld(
  point: Coordinate,
  camera: CameraSnapshot,
): Coordinate {
  const result = {
    x: (point.x - camera.offsetX) / camera.zoom,
    y: (point.y - camera.offsetY) / camera.zoom,
  };
  if (!finiteCoordinate(point) || !finiteCoordinate(result))
    throw new RangeError('Camera transform requires finite coordinates');
  return result;
}

/** Navigation is derived display state, independent of document/history/recognition. */
export class ViewportStore {
  private snapshot: CameraSnapshot = Object.freeze({
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
  });
  private readonly listeners = new Set<() => void>();
  private locked = false;
  private finitePage: ViewportSize | undefined;
  private pendingPageResize: ViewportSize | undefined;

  // Arrow properties provide stable callbacks for useSyncExternalStore.
  getSnapshot = (): CameraSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  isCameraLocked = (): boolean => this.locked;
  setCameraLocked(locked: boolean): void {
    this.locked = locked;
    if (!locked && this.pendingPageResize) {
      const size = this.pendingPageResize;
      this.pendingPageResize = undefined;
      this.setFinitePage(size);
    }
  }
  getFinitePage = (): ViewportSize | undefined => this.finitePage;
  /** Resize may wait for pen-up; user navigation commands are never deferred. */
  resizeFinitePage(size: ViewportSize): boolean {
    if (
      !this.finitePage ||
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0
    )
      return false;
    if (this.locked) {
      this.pendingPageResize = Object.freeze({ ...size });
      return true;
    }
    return this.setFinitePage(size);
  }
  /** Finite paper is view state. Existing out-of-page ink is retained. */
  setFinitePage(size?: ViewportSize): boolean {
    if (
      this.locked ||
      (size &&
        (!Number.isFinite(size.width) ||
          !Number.isFinite(size.height) ||
          size.width <= 0 ||
          size.height <= 0))
    )
      return false;
    this.finitePage = size ? Object.freeze({ ...size }) : undefined;
    this.pendingPageResize = undefined;
    this.update(this.snapshot);
    return true;
  }

  private update(next: CameraSnapshot): boolean {
    if (
      this.locked ||
      !Number.isFinite(next.offsetX) ||
      !Number.isFinite(next.offsetY) ||
      !Number.isFinite(next.zoom) ||
      next.zoom < MIN_ZOOM ||
      next.zoom > MAX_ZOOM
    )
      return false;
    if (this.finitePage) {
      const limit = (offset: number, size: number) =>
        next.zoom < 1
          ? (size * (1 - next.zoom)) / 2
          : Math.max(size * (1 - next.zoom), Math.min(0, offset));
      next = {
        ...next,
        offsetX: limit(next.offsetX, this.finitePage.width),
        offsetY: limit(next.offsetY, this.finitePage.height),
      };
    }
    const previous = this.snapshot;
    if (
      next.offsetX === previous.offsetX &&
      next.offsetY === previous.offsetY &&
      next.zoom === previous.zoom
    )
      return false;
    this.snapshot = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
    return true;
  }

  /** CSS deltas pan the camera; vertical mode retains the current horizontal offset. */
  panBy(delta: Coordinate, mode: 'free' | 'vertical' = 'free'): boolean {
    if (!finiteCoordinate(delta)) return false;
    return this.update({
      ...this.snapshot,
      offsetX: this.snapshot.offsetX + (mode === 'vertical' ? 0 : delta.x),
      offsetY: this.snapshot.offsetY + delta.y,
    });
  }

  /** Positive multiplicative zoom retains the world point beneath the CSS anchor. */
  zoomAt(factor: number, anchor: Coordinate): boolean {
    if (!Number.isFinite(factor) || factor <= 0) return false;
    return this.zoomToAt(clampZoom(this.snapshot.zoom * factor), anchor);
  }

  zoomToAt(zoom: number, anchor: Coordinate): boolean {
    if (!Number.isFinite(zoom) || zoom <= 0 || !finiteCoordinate(anchor))
      return false;
    const nextZoom = clampZoom(zoom);
    const ratio = nextZoom / this.snapshot.zoom;
    return this.update({
      offsetX: anchor.x - (anchor.x - this.snapshot.offsetX) * ratio,
      offsetY: anchor.y - (anchor.y - this.snapshot.offsetY) * ratio,
      zoom: nextZoom,
    });
  }

  setZoom100At(anchor: Coordinate): boolean {
    return this.zoomToAt(1, anchor);
  }
  reset(): boolean {
    return this.update({ offsetX: 0, offsetY: 0, zoom: 1 });
  }

  /** Fits and centers nondegenerate content, subject to the supported zoom range. */
  fitContent(bounds: ContentBounds, size: ViewportSize, padding = 24): boolean {
    const values = [
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      size.width,
      size.height,
      padding,
    ];
    if (
      !values.every(Number.isFinite) ||
      padding < 0 ||
      size.width <= padding * 2 ||
      size.height <= padding * 2
    )
      return false;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return false;
    const zoom = clampZoom(
      Math.min(
        (size.width - padding * 2) / width,
        (size.height - padding * 2) / height,
      ),
    );
    const centerX = bounds.minX + width / 2;
    const centerY = bounds.minY + height / 2;
    return this.update({
      offsetX: size.width / 2 - centerX * zoom,
      offsetY: size.height / 2 - centerY * zoom,
      zoom,
    });
  }
}
