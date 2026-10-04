import { afterEach, expect, it, vi } from 'vitest';
import { mountProjection } from '../../src/render/mountProjection';
import type { EquationProjection } from '../../src/projection';

afterEach(() => vi.unstubAllGlobals());
it('coalesces result updates, retires answer pixels and keeps unchanged backing stores', () => {
  let callback: FrameRequestCallback | undefined;
  let width = 1,
    height = 1;
  const writes: string[] = [];
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn(), fillText: vi.fn() };
  const canvas = {
    get width() {
      return width;
    },
    set width(value) {
      width = value;
      writes.push('width');
    },
    get height() {
      return height;
    },
    set height(value) {
      height = value;
      writes.push('height');
    },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 50 }),
  };
  const listeners = new Map();
  const browser = {
    devicePixelRatio: 2,
    addEventListener: vi.fn((key, value) => listeners.set(key, value)),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', browser);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((fn) => {
      callback = fn;
      return 7;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', undefined);
  let projections: EquationProjection[] = [];
  const renderer = mountProjection(
    canvas as unknown as HTMLCanvasElement,
    () => projections,
  );
  callback!(0);
  expect(writes).toEqual(['width', 'height']);
  const b = { minX: 10, minY: 10, maxX: 25, maxY: 20 };
  projections = [
    {
      equationId: 'a',
      equationRevision: 1,
      expression: '1+1=',
      bounds: b,
      equalsBounds: b,
      answerBounds: b,
      answerText: '2',
      status: 'valid',
    },
  ];
  renderer.invalidate();
  renderer.invalidate();
  callback!(1);
  expect(ctx.fillText).toHaveBeenLastCalledWith('2', 10, 15, 82);
  expect(writes).toEqual(['width', 'height']);
  projections = [];
  renderer.invalidate();
  callback!(2);
  expect(ctx.clearRect).toHaveBeenCalledTimes(3);
  expect(ctx.fillText).toHaveBeenCalledTimes(1);
  browser.devicePixelRatio = 1;
  listeners.get('resize')();
  callback!(3);
  expect(writes).toEqual(['width', 'height', 'width', 'height']);
  expect(ctx.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
  renderer.dispose();
  const calls = vi.mocked(requestAnimationFrame).mock.calls.length;
  renderer.invalidate();
  expect(vi.mocked(requestAnimationFrame).mock.calls.length).toBe(calls);
  expect(browser.removeEventListener).toHaveBeenCalledWith(
    'resize',
    expect.any(Function),
  );
});
