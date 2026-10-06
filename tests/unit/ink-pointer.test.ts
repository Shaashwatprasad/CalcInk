import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkStore } from '../../src/document/InkStore';
import { mountInk, type InkTool } from '../../src/render/mountInk';
import { ViewportStore } from '../../src/viewport';

class TestCanvas extends EventTarget {
  width = 1;
  height = 1;
  style = { touchAction: '' };
  captures = new Set<number>();
  rect = { left: 50, top: 80, width: 200, height: 100 };
  ctx = {
    canvas: this,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  };
  getContext(): unknown {
    return this.ctx;
  }
  getBoundingClientRect(): unknown {
    return this.rect;
  }
  setPointerCapture(id: number): void {
    this.captures.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captures.delete(id);
  }
  hasPointerCapture(id: number): boolean {
    return this.captures.has(id);
  }
  focus(): void {}
  pointer(type: string, props: Record<string, unknown> = {}): void {
    this.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        clientX: 60,
        clientY: 90,
        pressure: 0.5,
        ...props,
      }),
    );
  }
}

function setup(navigation = false) {
  const windowTarget = Object.assign(new EventTarget(), {
    devicePixelRatio: 2,
  });
  vi.stubGlobal('window', windowTarget);
  let sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = () => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach((callback) => callback(0));
  };
  const committed = new TestCanvas();
  const active = new TestCanvas();
  const store = new InkStore();
  const tool: InkTool = {
    mode: 'pen',
    width: 4,
    color: '#000',
    eraserRadius: 5,
  };
  const viewport = new ViewportStore();
  const cleanup = mountInk(
    committed as unknown as HTMLCanvasElement,
    active as unknown as HTMLCanvasElement,
    store,
    () => tool,
    navigation ? { viewport, getPanMode: () => 'free' } : undefined,
  );
  return {
    committed,
    active,
    store,
    flush,
    cleanup,
    windowTarget,
    tool,
    frames,
    viewport,
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('pointer input and rendering lifecycle', () => {
  it('retains committed pixels, culls a large offscreen notebook, and repaints local damage only', () => {
    const s = setup(true);
    for (let i = 0; i < 300; i++)
      s.store.addStroke({
        id: `s${i}`,
        color: '#000000',
        width: 2,
        points: [{ x: 20 + i * 100, y: 50, timestamp: 1 }],
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      });
    s.flush();
    expect(s.committed.ctx.arc).toHaveBeenCalledTimes(2);
    s.committed.ctx.arc.mockClear();
    s.committed.ctx.clearRect.mockClear();
    s.active.pointer('pointerdown', { clientX: 70, clientY: 100 });
    s.flush();
    s.active.pointer('pointermove', { clientX: 80, clientY: 100 });
    s.flush();
    expect(s.committed.ctx.arc).not.toHaveBeenCalled();
    expect(s.committed.ctx.clearRect).not.toHaveBeenCalled();
    s.active.pointer('pointerup', { clientX: 80, clientY: 100 });
    s.flush();
    expect(s.committed.ctx.arc).not.toHaveBeenCalled();
    expect(s.committed.ctx.stroke).toHaveBeenCalledTimes(1);
    const cleared = s.committed.ctx.clearRect.mock.calls[0];
    expect(cleared[2]).toBeLessThan(s.committed.width / 4);
    expect(cleared[3]).toBeLessThan(s.committed.height / 4);
    // Annotation-only transactions never replay ink.
    s.committed.ctx.clearRect.mockClear();
    s.store.addObject({
      id: 'note',
      kind: 'text',
      x: 10,
      y: 10,
      text: 'notes',
      fontSize: 16,
      color: '#000000',
      colorMode: 'explicit',
      strokeWidth: 2,
      opacity: 1,
      recognitionEligible: false,
    });
    s.flush();
    expect(s.committed.ctx.clearRect).not.toHaveBeenCalled();
    s.cleanup();
  });
  it('records real zero stylus pressure and leaves mouse pressure absent when pressure rendering is enabled', () => {
    const { active, store, tool, cleanup } = setup(true);
    tool.pressureEnabled = true;
    active.pointer('pointerdown', { pointerType: 'pen', pressure: 0 });
    active.pointer('pointerup', {
      pointerType: 'pen',
      pressure: 0.1,
      clientX: 100,
    });
    expect(
      store.getSnapshot().strokes[0].points.map((p) => p.pressure),
    ).toEqual([0, 0.1]);
    active.pointer('pointerdown', { pointerType: 'mouse', pressure: 0.5 });
    active.pointer('pointerup', { pointerType: 'mouse', clientX: 100 });
    expect(
      store
        .getSnapshot()
        .strokes[1].points.every((p) => p.pressure === undefined),
    ).toBe(true);
    cleanup();
  });
  it('finite paper ignores margin input and retains valid world samples', () => {
    const { active, store, viewport, cleanup } = setup(true);
    viewport.setFinitePage({ width: 200, height: 100 });
    viewport.zoomToAt(0.5, { x: 100, y: 50 });
    active.pointer('pointerdown', { clientX: 55, clientY: 90 });
    active.pointer('pointermove', { clientX: 125, clientY: 130 });
    active.pointer('pointerup', { clientX: 220, clientY: 180 });
    expect(store.getSnapshot().strokes).toHaveLength(0);
    active.pointer('pointerdown', { clientX: 125, clientY: 130 });
    active.pointer('pointerup', { clientX: 125, clientY: 130 });
    expect(store.getSnapshot().strokes).toHaveLength(1);
    expect(store.getSnapshot().strokes[0].points).toHaveLength(1);
    expect(store.getSnapshot().strokes[0].points[0]).toMatchObject({
      x: 50,
      y: 50,
    });
    cleanup();
  });
  it.each(['pen', 'stroke-eraser', 'pixel-eraser'] as const)(
    'finite-page %s ends at first boundary exit without a phantom reentry chord',
    (mode) => {
      const { active, store, viewport, tool, cleanup } = setup(true);
      store.addStroke({
        id: 'untouched-middle',
        points: [{ x: 190, y: 50, timestamp: 1 }],
        bounds: { minX: 189, minY: 49, maxX: 191, maxY: 51 },
        width: 2,
        color: '#000000',
      });
      viewport.setFinitePage({ width: 200, height: 100 });
      tool.mode = mode;
      active.pointer('pointerdown', { clientX: 240, clientY: 90 });
      active.pointer('pointermove', {
        clientX: 240,
        clientY: 170,
        getCoalescedEvents: () => [
          { clientX: 260, clientY: 90, timeStamp: 2, pressure: 0.5 },
          { clientX: 260, clientY: 170, timeStamp: 3, pressure: 0.5 },
        ],
      });
      active.pointer('pointerup', { clientX: 240, clientY: 170 });
      expect(store.getSnapshot().strokes[0].id).toBe('untouched-middle');
      expect(store.getSnapshot().erasures).toHaveLength(0);
      if (mode === 'pen')
        expect(
          store.getSnapshot().strokes[1].points.map(({ x, y }) => [x, y]),
        ).toEqual([
          [190, 10],
          [200, 10],
        ]);
      else expect(store.getSnapshot().revision).toBe(1);
      cleanup();
    },
  );
  it.each(['pen', 'mouse'])(
    'preserves active %s ink when secondary touches arrive',
    (pointerType) => {
      const { active, store, viewport, cleanup } = setup(true);
      active.pointer('pointerdown', { pointerType });
      active.pointer('pointermove', { pointerType, clientX: 75 });
      for (const pointerId of [2, 3])
        active.pointer('pointerdown', {
          pointerType: 'touch',
          pointerId,
          isPrimary: false,
        });
      expect(viewport.isCameraLocked()).toBe(true);
      active.pointer('pointermove', {
        pointerType: 'touch',
        pointerId: 3,
        clientX: 150,
      });
      expect(viewport.getSnapshot()).toEqual({
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      });
      active.pointer('pointerup', { pointerType, clientX: 100 });
      expect(store.getSnapshot().strokes[0].points.map(({ x }) => x)).toEqual([
        10, 25, 50,
      ]);
      expect(store.getSnapshot().revision).toBe(1);
      expect(viewport.isCameraLocked()).toBe(false);
      cleanup();
    },
  );
  it('discards provisional touch ink on two-finger promotion without history', () => {
    const { active, store, viewport, cleanup } = setup(true);
    active.pointer('pointerdown', { pointerType: 'touch' });
    active.pointer('pointermove', { pointerType: 'touch', clientX: 75 });
    active.pointer('pointerdown', {
      pointerType: 'touch',
      pointerId: 2,
      isPrimary: false,
      clientX: 100,
    });
    expect(viewport.isCameraLocked()).toBe(false);
    active.pointer('pointermove', {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 150,
    });
    expect(viewport.getSnapshot().zoom).toBeGreaterThan(1);
    active.pointer('pointerup', { pointerType: 'touch' });
    active.pointer('pointerup', {
      pointerType: 'touch',
      pointerId: 2,
      isPrimary: false,
    });
    expect(store.getSnapshot().strokes).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    cleanup();
  });
  it('retires an active gesture on clear or document replacement', () => {
    const { active, store, cleanup } = setup();
    active.pointer('pointerdown');
    active.pointer('pointermove', { clientX: 75 });
    store.clear();
    active.pointer('pointerup', { clientX: 100 });
    expect(store.getSnapshot().strokes).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    active.pointer('pointerdown');
    active.pointer('pointerup');
    active.pointer('pointerdown');
    active.pointer('pointermove', { clientX: 75 });
    store.clear();
    active.pointer('pointerup', { clientX: 100 });
    expect(store.getSnapshot().strokes).toHaveLength(0);
    expect(active.captures.size).toBe(0);
    active.pointer('pointerdown');
    active.pointer('pointermove', { clientX: 75 });
    store.replaceDocument(store.getSnapshot());
    active.pointer('pointerup', { clientX: 100 });
    expect(store.getSnapshot().strokes).toHaveLength(0);
    expect(active.captures.size).toBe(0);
    cleanup();
  });
  it('preserves a rapid stroke, all coalesced samples and the pen-up endpoint before the first frame', () => {
    const { active, store, flush, committed, cleanup } = setup();
    active.pointer('pointerdown');
    active.pointer('pointermove', {
      clientX: 90,
      clientY: 95,
      getCoalescedEvents: () => [
        { clientX: 70, clientY: 92, timeStamp: 2, pressure: 0.6 },
        { clientX: 80, clientY: 93, timeStamp: 3, pressure: 0.7 },
      ],
    });
    active.pointer('pointerup', { clientX: 100, clientY: 100 });
    expect(
      store.getSnapshot().strokes[0].points.map((p) => [p.x, p.y]),
    ).toEqual([
      [10, 10],
      [20, 12],
      [30, 13],
      [40, 15],
      [50, 20],
    ]);
    flush();
    expect(committed.width).toBe(400);
    expect(committed.height).toBe(200);
    expect(committed.ctx.lineTo).toHaveBeenLastCalledWith(50, 20);
    expect(active.captures.size).toBe(0);
    cleanup();
  });
  it('renders and commits dots and ignores secondary pointers', () => {
    const { active, committed, store, flush, cleanup } = setup();
    active.pointer('pointerdown');
    active.pointer('pointerdown', {
      pointerId: 2,
      isPrimary: false,
      clientX: 150,
    });
    active.pointer('pointermove', { pointerId: 2, clientX: 160 });
    active.pointer('pointerup');
    expect(store.getSnapshot().strokes).toHaveLength(1);
    expect(store.getSnapshot().strokes[0].points).toHaveLength(1);
    flush();
    expect(committed.ctx.arc).toHaveBeenCalledWith(10, 10, 2, 0, Math.PI * 2);
    cleanup();
  });
  it('keeps pending geometry across resize and scroll, and retains partial ink on cancellation', () => {
    const { active, store, flush, windowTarget, cleanup } = setup();
    active.pointer('pointerdown');
    flush();
    active.pointer('pointermove', { clientX: 75 });
    active.rect.width = 300;
    windowTarget.dispatchEvent(new Event('resize'));
    flush();
    expect(active.width).toBe(600);
    expect(active.ctx.lineTo).toHaveBeenCalledWith(25, 10);
    active.rect.top = 70;
    windowTarget.dispatchEvent(new Event('scroll'));
    active.pointer('pointermove', { clientX: 80 });
    active.pointer('pointercancel', { clientX: 0, clientY: 0 });
    expect(store.getSnapshot().strokes[0].points.at(-1)).toMatchObject({
      x: 30,
      y: 20,
    });
    cleanup();
  });
  it('commits one eraser transaction per gesture and removes listeners and frames on cleanup', () => {
    const { active, store, tool, cleanup, frames } = setup();
    active.pointer('pointerdown');
    active.pointer('pointerup', { clientX: 100 });
    tool.mode = 'stroke-eraser';
    active.pointer('pointerdown');
    active.pointer('pointermove', { clientX: 75 });
    expect(store.getSnapshot().revision).toBe(1);
    active.pointer('pointerup', { clientX: 100 });
    expect(store.getSnapshot().revision).toBe(2);
    expect(store.getSnapshot().strokes).toHaveLength(0);
    store.undo();
    expect(store.getSnapshot().strokes).toHaveLength(1);
    cleanup();
    expect(frames.size).toBe(0);
    active.pointer('pointerdown');
    active.pointer('pointerup');
    expect(store.getSnapshot().strokes).toHaveLength(1);
  });
});
