import { afterEach, describe, expect, it, vi } from 'vitest';
import { InkStore } from '../../src/document/InkStore';
import { mountObjects, type ObjectsTool } from '../../src/render/mountObjects';
import { ViewportStore } from '../../src/viewport';
import type { Annotation } from '../../src/shared/types';

class Canvas extends EventTarget {
  width = 1;
  height = 1;
  style = { touchAction: 'pan-y' };
  captures = new Set<number>();
  rect = { left: 50, top: 80, width: 500, height: 400 };
  ctx = {
    canvas: this,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
  };
  getContext() {
    return this.ctx;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  setPointerCapture(id: number) {
    this.captures.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captures.has(id);
  }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
  }
  focus() {
    (document as unknown as { activeElement: unknown }).activeElement = this;
  }
  pointer(
    type: string,
    x: number,
    y: number,
    props: Record<string, unknown> = {},
  ) {
    this.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        clientX: this.rect.left + x,
        clientY: this.rect.top + y,
        pointerId: 1,
        isPrimary: true,
        pointerType: 'mouse',
        button: 0,
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
  const fonts = new EventTarget();
  vi.stubGlobal('document', { activeElement: null, fonts });
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((cb) => cb(0));
  };
  const canvas = new Canvas(),
    store = new InkStore(),
    viewport = new ViewportStore();
  const tool: ObjectsTool = {
    mode: 'shape',
    shape: 'rectangle',
    color: '#5275AE',
    colorMode: 'auto',
    strokeWidth: 2,
    fontSize: 16,
  };
  const onSelection = vi.fn(),
    onText = vi.fn(),
    onError = vi.fn();
  const api = mountObjects({
    canvas: canvas as unknown as HTMLCanvasElement,
    store,
    viewport,
    getTool: () => tool,
    getTheme: () => 'dark',
    onSelection,
    onText,
    onError,
  });
  function key(key: string, props: Record<string, unknown> = {}) {
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      key,
      code: key === ' ' ? 'Space' : key,
      ...props,
    });
    windowTarget.dispatchEvent(event);
    return event;
  }
  return {
    canvas,
    store,
    viewport,
    tool,
    api,
    frames,
    flush,
    onSelection,
    onText,
    onError,
    windowTarget,
    fonts,
    key,
  };
}
const shape = (id = 'box'): Annotation => ({
  id,
  kind: 'shape',
  shape: 'rectangle',
  x: 10,
  y: 10,
  width: 20,
  height: 10,
  color: '#5275AE',
  colorMode: 'explicit',
  strokeWidth: 2,
  opacity: 1,
  recognitionEligible: false,
});
afterEach(() => vi.unstubAllGlobals());
describe('annotation pointer router', () => {
  it('records camera-correct coordinates in one creation transaction, batches preview and keeps inactive annotation pixels', () => {
    const s = setup();
    s.viewport.zoomToAt(2, { x: 0, y: 0 });
    s.viewport.panBy({ x: 20, y: 40 });
    s.canvas.pointer('pointerdown', 30, 50);
    s.canvas.pointer('pointermove', 100, 150);
    s.canvas.pointer('pointermove', 120, 170);
    expect(s.store.getSnapshot().objects).toEqual([]);
    expect(s.frames.size).toBe(1);
    expect(s.onSelection).not.toHaveBeenCalled();
    expect(s.viewport.isCameraLocked()).toBe(true);
    s.canvas.pointer('pointerup', 100, 150);
    expect(s.store.getSnapshot().revision).toBe(1);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({
      x: 5,
      y: 5,
      width: 35,
      height: 50,
      recognitionEligible: false,
    });
    expect(s.onSelection).toHaveBeenCalledTimes(1);
    s.tool.mode = 'inactive';
    s.flush();
    expect(s.canvas.width).toBe(1000);
    expect(s.canvas.height).toBe(800);
    expect(s.canvas.ctx.setTransform).toHaveBeenLastCalledWith(
      4,
      0,
      0,
      4,
      40,
      80,
    );
    expect(s.canvas.ctx.rect).toHaveBeenCalledWith(5, 5, 35, 50);
    expect(s.viewport.isCameraLocked()).toBe(false);
    s.api.dispose();
    expect(s.canvas.style.touchAction).toBe('pan-y');
    expect(s.frames.size).toBe(0);
  });
  it('moves and resizes selected objects only on up and restores each gesture with one undo', () => {
    const s = setup();
    s.store.addObject(shape());
    s.tool.mode = 'select';
    s.canvas.pointer('pointerdown', 20, 15);
    s.canvas.pointer('pointermove', 40, 35);
    expect(s.store.getSnapshot().objects![0]).toEqual(shape());
    expect(s.onSelection).not.toHaveBeenCalled();
    s.canvas.pointer('pointerup', 40, 35);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({ x: 30, y: 30 });
    s.store.undo();
    expect(s.store.getSnapshot().objects![0]).toEqual(shape());
    s.api.setSelection({ strokeIds: [], objectIds: ['box'] });
    const before = s.store.getSnapshot().revision;
    s.canvas.pointer('pointerdown', 31, 21);
    s.canvas.pointer('pointermove', 53, 33);
    expect(s.store.getSnapshot().revision).toBe(before);
    s.canvas.pointer('pointerup', 53, 33);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({
      x: 11,
      y: 11,
      width: 40,
      height: 20,
      strokeWidth: 4,
    });
    s.store.undo();
    expect(s.store.getSnapshot().objects![0]).toEqual(shape());
    s.api.dispose();
  });
  it('supports reverse-direction line/arrow creation and polygon selection with callbacks only after completion', () => {
    const s = setup();
    s.tool.shape = 'line';
    s.canvas.pointer('pointerdown', 100, 100);
    s.canvas.pointer('pointerup', 50, 70);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({
      kind: 'shape',
      shape: 'line',
      x1: 100,
      y1: 100,
      x2: 50,
      y2: 70,
    });
    s.tool.mode = 'arrow';
    s.canvas.pointer('pointerdown', 200, 200);
    s.canvas.pointer('pointerup', 170, 160);
    expect(s.store.getSnapshot().objects![1]).toMatchObject({
      kind: 'arrow',
      x1: 200,
      y1: 200,
      x2: 170,
      y2: 160,
    });
    s.tool.mode = 'region'; // A previously selected line variant must not change region semantics.
    s.canvas.pointer('pointerdown', 300, 250);
    s.canvas.pointer('pointerup', 350, 280);
    expect(s.store.getSnapshot().objects![2]).toMatchObject({
      kind: 'region',
      x: 300,
      y: 250,
      width: 50,
      height: 30,
    });
    s.tool.mode = 'lasso';
    s.onSelection.mockClear();
    s.canvas.pointer('pointerdown', 40, 60);
    s.canvas.pointer('pointermove', 110, 60);
    s.canvas.pointer('pointermove', 110, 110);
    s.canvas.pointer('pointermove', 40, 110);
    expect(s.onSelection).not.toHaveBeenCalled();
    s.canvas.pointer('pointerup', 40, 60);
    expect(s.api.getSelection().objectIds).toEqual([
      s.store.getSnapshot().objects![0].id,
    ]);
    s.api.dispose();
  });
  it('cancels capture loss, tool changes, blur and clear without committing unfinished annotations', () => {
    const s = setup();
    for (const type of ['pointercancel', 'lostpointercapture']) {
      s.canvas.pointer('pointerdown', 20, 20);
      s.canvas.pointer('pointermove', 40, 40);
      s.canvas.pointer(type, 40, 40);
      expect(s.store.getSnapshot().objects).toEqual([]);
      expect(s.canvas.captures.size).toBe(0);
    }
    s.canvas.pointer('pointerdown', 20, 20);
    s.tool.mode = 'inactive';
    s.canvas.pointer('pointerup', 40, 40);
    expect(s.store.getSnapshot().objects).toEqual([]);
    s.tool.mode = 'shape';
    s.canvas.pointer('pointerdown', 20, 20);
    s.windowTarget.dispatchEvent(new Event('blur'));
    expect(s.viewport.isCameraLocked()).toBe(false);
    expect(s.canvas.captures.size).toBe(0);
    s.canvas.pointer('pointerdown', 20, 20);
    s.store.clear();
    s.canvas.pointer('pointerup', 40, 40);
    expect(s.store.getSnapshot().objects).toEqual([]);
    s.api.dispose();
  });
  it('hands text creation and editing to accessible UI without saving phantom text', () => {
    const s = setup();
    s.tool.mode = 'text';
    s.canvas.pointer('pointerdown', 50, 60);
    expect(s.onText).toHaveBeenLastCalledWith({ x: 50, y: 60 }, undefined);
    expect(s.store.getSnapshot().objects).toEqual([]);
    const text: Annotation = {
      ...shape(),
      kind: 'text',
      x: 10,
      y: 10,
      text: 'notes',
      fontSize: 16,
    };
    s.store.addObject(text);
    s.canvas.pointer('pointerdown', 20, 15);
    expect(s.onText).toHaveBeenLastCalledWith(
      { x: 20, y: 15 },
      expect.objectContaining({ kind: 'text', text: 'notes' }),
    );
    s.tool.mode = 'select';
    s.canvas.dispatchEvent(
      Object.assign(new Event('dblclick', { cancelable: true }), {
        clientX: 70,
        clientY: 95,
      }),
    );
    expect(s.onText).toHaveBeenCalledTimes(3);
    s.api.dispose();
  });
  it('text and off-page touches cannot leak into a later phantom pinch without pointerup', () => {
    const s = setup();
    s.tool.mode = 'text';
    s.canvas.pointer('pointerdown', 50, 60, { pointerType: 'touch' });
    // A modal takes pointerup; the next tap still opens the text editor.
    s.canvas.pointer('pointerdown', 60, 70, {
      pointerId: 2,
      pointerType: 'touch',
    });
    expect(s.onText).toHaveBeenCalledTimes(2);
    expect(s.viewport.getSnapshot().zoom).toBe(1);
    s.tool.mode = 'shape';
    s.viewport.setFinitePage({ width: 200, height: 100 });
    s.canvas.pointer('pointerdown', -5, 10, {
      pointerId: 3,
      pointerType: 'touch',
    });
    s.canvas.pointer('pointerdown', 25, 25, {
      pointerId: 4,
      pointerType: 'touch',
    });
    s.canvas.pointer('pointerup', 75, 65, {
      pointerId: 4,
      pointerType: 'touch',
    });
    expect(s.store.getSnapshot().objects).toHaveLength(1);
    s.api.dispose();
  });
  it('retires text and rejected touch starts when their pointer-up never returns to the canvas', () => {
    const s = setup();
    s.tool.mode = 'text';
    // Opening/canceling a modal can consume pointer-up on a different surface.
    s.canvas.pointer('pointerdown', 50, 60, {
      pointerType: 'touch',
      pointerId: 7,
    });
    s.canvas.pointer('pointerdown', 80, 70, {
      pointerType: 'touch',
      pointerId: 8,
    });
    expect(s.onText).toHaveBeenCalledTimes(2);
    expect(s.canvas.captures.size).toBe(0);
    expect(s.viewport.getSnapshot()).toEqual({
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
    });
    s.tool.mode = 'shape';
    s.viewport.setFinitePage({ width: 200, height: 100 });
    s.canvas.pointer('pointerdown', -5, 20, {
      pointerType: 'touch',
      pointerId: 9,
    });
    s.canvas.pointer('pointerdown', 20, 20, {
      pointerType: 'touch',
      pointerId: 10,
    });
    s.canvas.pointer('pointerup', 60, 40, {
      pointerType: 'touch',
      pointerId: 10,
    });
    expect(s.store.getSnapshot().objects).toHaveLength(1);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({
      x: 20,
      y: 20,
      width: 40,
      height: 20,
    });
    expect(s.onError).not.toHaveBeenCalled();
    s.api.dispose();
  });
  it('drags an existing multiple selection from the gap inside its displayed bounds', () => {
    const s = setup();
    s.store.addObject(shape('left'));
    const right = shape('right');
    if (right.kind !== 'shape' || right.shape !== 'rectangle')
      throw new Error('Expected rectangle');
    s.store.addObject({ ...right, x: 80 });
    s.tool.mode = 'select';
    s.api.setSelection({ strokeIds: [], objectIds: ['left', 'right'] });
    s.canvas.pointer('pointerdown', 55, 15);
    s.canvas.pointer('pointerup', 65, 25);
    expect(
      s.store
        .getSnapshot()
        .objects!.map((o) =>
          o.kind === 'shape' && o.shape === 'rectangle' ? o.x : NaN,
        ),
    ).toEqual([20, 90]);
    expect(s.api.getSelection().objectIds).toEqual(['left', 'right']);
    s.api.dispose();
  });
  it('keeps lasso selection movable and resizable until a new outside lasso starts', () => {
    const s = setup();
    s.store.addObject(shape());
    s.tool.mode = 'lasso';
    s.canvas.pointer('pointerdown', 0, 0);
    s.canvas.pointer('pointermove', 40, 0);
    s.canvas.pointer('pointermove', 40, 30);
    s.canvas.pointer('pointermove', 0, 30);
    s.canvas.pointer('pointerup', 0, 0);
    expect(s.api.getSelection().objectIds).toEqual(['box']);
    s.canvas.pointer('pointerdown', 20, 15);
    s.canvas.pointer('pointerup', 40, 35);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({ x: 30, y: 30 });
    s.store.undo();
    s.canvas.pointer('pointerdown', 31, 21);
    s.canvas.pointer('pointerup', 53, 33);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({
      width: 40,
      height: 20,
    });
    s.store.undo();
    expect(s.store.getSnapshot().objects![0]).toEqual(shape());
    s.canvas.pointer('pointerdown', 200, 200);
    s.canvas.pointer('pointerup', 200, 200);
    expect(s.api.getSelection().objectIds).toEqual([]);
    s.api.dispose();
  });
  it('edits text beneath overlapping shapes and exposes selected-text editing', () => {
    const s = setup();
    s.store.addObject({
      ...shape('note'),
      kind: 'text',
      x: 10,
      y: 10,
      text: 'math note',
      fontSize: 16,
    });
    s.store.addObject(shape('cover'));
    s.tool.mode = 'text';
    s.canvas.pointer('pointerdown', 20, 15);
    expect(s.onText).toHaveBeenLastCalledWith(
      { x: 20, y: 15 },
      expect.objectContaining({ id: 'note', kind: 'text' }),
    );
    s.api.setSelection({ strokeIds: [], objectIds: ['cover'] });
    expect(s.api.editSelection()).toBe(false);
    s.api.setSelection({ strokeIds: [], objectIds: ['note'] });
    expect(s.api.editSelection()).toBe(true);
    expect(s.onText).toHaveBeenLastCalledWith(
      { x: 10, y: 10 },
      expect.objectContaining({ id: 'note' }),
    );
    s.api.dispose();
  });
  it('retains annotation pixels and culls unaffected objects during local edits', () => {
    const s = setup();
    const right = shape('right');
    s.store.addObject(shape());
    s.store.addObject({ ...right, x: 350 } as Annotation);
    s.store.addObject({ ...right, id: 'outside', x: 2000 } as Annotation);
    s.tool.mode = 'inactive';
    s.flush();
    expect(s.canvas.ctx.stroke).toHaveBeenCalledTimes(2);
    s.canvas.ctx.stroke.mockClear();
    s.canvas.ctx.clearRect.mockClear();
    s.api.invalidate();
    s.flush();
    expect(s.canvas.ctx.clearRect).not.toHaveBeenCalled();
    s.store.updateObject('box', { ...shape(), x: 20 } as Annotation);
    s.flush();
    expect(s.canvas.ctx.stroke).toHaveBeenCalledTimes(1);
    const cleared = s.canvas.ctx.clearRect.mock.calls[0];
    expect(cleared[2]).toBeLessThan(s.canvas.width / 4);
    s.api.dispose();
  });
  it('repaints retained text when the local font loads and removes its listener on disposal', () => {
    const s = setup();
    s.store.addObject({
      ...shape('note'),
      kind: 'text',
      x: 10,
      y: 10,
      text: 'notes',
      fontSize: 16,
    });
    s.tool.mode = 'inactive';
    s.flush();
    expect(s.canvas.ctx.fillText).toHaveBeenCalledTimes(1);
    s.fonts.dispatchEvent(new Event('loadingdone'));
    s.flush();
    expect(s.canvas.ctx.fillText).toHaveBeenCalledTimes(2);
    s.api.dispose();
    s.fonts.dispatchEvent(new Event('loadingdone'));
    expect(s.frames.size).toBe(0);
  });
  it('restricts destructive shortcuts to canvas focus and supports duplicate/delete undo', () => {
    const s = setup();
    s.store.addObject(shape());
    s.tool.mode = 'select';
    s.api.setSelection({ strokeIds: [], objectIds: ['box'] });
    expect(s.key('Delete').defaultPrevented).toBe(false);
    expect(s.store.getSnapshot().objects).toHaveLength(1);
    s.canvas.focus();
    expect(s.key('d', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(s.store.getSnapshot().objects).toHaveLength(2);
    expect(s.api.getSelection().objectIds).not.toContain('box');
    s.key('Backspace');
    expect(s.store.getSnapshot().objects).toHaveLength(1);
    s.store.undo();
    expect(s.store.getSnapshot().objects).toHaveLength(2);
    s.key('Escape');
    expect(s.api.getSelection()).toEqual({ strokeIds: [], objectIds: [] });
    s.api.dispose();
  });
  it('clips finite-page creation and promotes two touches to navigation without committing the first preview', () => {
    const s = setup();
    s.viewport.setFinitePage({ width: 200, height: 100 });
    s.canvas.pointer('pointerdown', -5, 10);
    s.canvas.pointer('pointerup', 20, 20);
    expect(s.store.getSnapshot().objects).toEqual([]);
    s.canvas.pointer('pointerdown', 25, 25);
    s.canvas.pointer('pointerup', 500, 500);
    expect(s.store.getSnapshot().objects![0]).toMatchObject({
      x: 25,
      y: 25,
      width: 175,
      height: 75,
    });
    s.viewport.setFinitePage();
    const before = s.store.getSnapshot().revision;
    s.canvas.pointer('pointerdown', 50, 50, { pointerType: 'touch' });
    s.canvas.pointer('pointerdown', 100, 50, {
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: false,
    });
    expect(s.canvas.captures).toEqual(new Set([1, 2]));
    expect(s.viewport.isCameraLocked()).toBe(false);
    s.canvas.pointer('pointermove', 150, 50, {
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: false,
    });
    expect(s.viewport.getSnapshot().zoom).toBe(2);
    s.canvas.pointer('pointerup', 50, 50, { pointerType: 'touch' });
    s.canvas.pointer('pointerup', 150, 50, {
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: false,
    });
    expect(s.store.getSnapshot().revision).toBe(before);
    expect(s.canvas.captures.size).toBe(0);
    s.api.dispose();
  });
});
