import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkStore } from '../../src/document/InkStore';
import { mountInk, type InkTool } from '../../src/render/mountInk';

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

function setup() {
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
  const cleanup = mountInk(
    committed as unknown as HTMLCanvasElement,
    active as unknown as HTMLCanvasElement,
    store,
    () => tool,
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
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('pointer input and rendering lifecycle', () => {
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
