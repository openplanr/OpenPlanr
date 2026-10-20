// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasController, CanvasOptions, ChromeSurface, Rect } from '../src/index.mjs';
import { createCanvas } from '../src/index.mjs';
import { computeSafeArea } from '../src/safe-area.mjs';

let controllers: CanvasController[];
let callbacks: Map<number, FrameRequestCallback>;
let sequence: number;
let time: number;
beforeEach(() => {
  controllers = [];
  callbacks = new Map();
  sequence = 0;
  time = 0;
  vi.spyOn(window.performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
});
afterEach(() => {
  for (const controller of controllers) controller.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function frame(step = 16) {
  time += step;
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(time);
}
function make(options: Partial<CanvasOptions> = {}) {
  const stage = document.createElement('div');
  const world = document.createElement('div');
  stage.append(world);
  document.body.append(stage);
  const bounds = vi
    .spyOn(stage, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, 200, 800, 600));
  const controller = createCanvas({ label: 'Safe area', motion: 'none', ...options });
  controllers.push(controller);
  controller.attach({ stage, world });
  frame();
  return { controller, stage, world, bounds };
}
function surface(edge: ChromeSurface['edge'], rect: Rect, open = true): ChromeSurface {
  return { id: edge, edge, rect, open };
}
const right = surface('right', { x: 600, y: 64, width: 200, height: 472 });
const left = surface('left', { x: 0, y: 64, width: 200, height: 472 });

for (const stage of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const surfaces = [
    surface('top', { x: 50, y: 8, width: 100, height: 48 }),
    surface('left', { x: 8, y: 64, width: 100, height: 100 }),
    surface('right', { x: stage.width - 120, y: 64, width: 100, height: 100 }),
    surface('bottom', { x: 50, y: stage.height - 64, width: 100, height: 48 }),
  ];
  const cases = Array.from({ length: 16 }, (_, mask) => ({
    mask,
    open: surfaces.filter((_, index) => mask & (1 << index)),
    expected: {
      x: mask & 2 ? 120 : 12,
      y: mask & 1 ? 68 : 12,
      width: stage.width - (mask & 2 ? 108 : 0) - (mask & 4 ? 120 : 0) - 24,
      height: stage.height - (mask & 1 ? 56 : 0) - (mask & 8 ? 64 : 0) - 24,
    },
  }));
  it.each(cases)(
    `composes bands at ${stage.width}x${stage.height}, mask $mask`,
    ({ open, expected }) => {
      expect(computeSafeArea(stage, open)).toEqual(expected);
    },
  );
}
it('ignores closed surfaces and unions overlapping bands instead of adding them', () => {
  expect(
    computeSafeArea({ width: 800, height: 600 }, [
      left,
      { ...left, id: 'overlap', rect: { x: 10, y: 90, width: 90, height: 20 } },
      { ...right, open: false },
    ]),
  ).toEqual({ x: 212, y: 12, width: 576, height: 576 });
});
it('clamps exhausted and tiny stages to nonnegative sizes', () => {
  expect(
    computeSafeArea({ width: 390, height: 844 }, [
      left,
      { ...right, rect: { x: 100, y: 0, width: 290, height: 844 } },
    ]),
  ).toEqual({ x: 212, y: 12, width: 0, height: 820 });
  expect(computeSafeArea({ width: 8, height: 0 }, [left])).toEqual({
    x: 8,
    y: 0,
    width: 0,
    height: 0,
  });
});

describe('chrome registry', () => {
  it('leaves an uncovered camera unchanged on opening, closing, shrinking and removal', () => {
    const { controller } = make();
    controller.setNodes([{ id: 'a', bounds: { x: 350, y: 200, width: 100, height: 100 } }]);
    controller.setSelection(['a']);
    const before = controller.getCamera();
    for (let index = 0; index < 16; index += 1) {
      controller.setChrome({ ...left, open: index % 2 === 0 });
      controller.setChrome({ ...right, open: index % 2 === 0 });
      expect(controller.getCamera()).toEqual(before);
    }
    controller.setChrome(left);
    controller.setChrome({ ...left, rect: { ...left.rect, width: 100 } });
    controller.removeChrome('left');
    expect(controller.getCamera()).toEqual(before);
  });
  it('enqueues changes after the transform write, ignores identical safe areas and copies geometry', () => {
    const { controller, world, bounds } = make();
    const events: Rect[] = [];
    controller.on('safe-area', (area) => {
      expect(world.style.transform).toBe('scale(1) translate(0px, 0px)');
      events.push(area);
    });
    const input = { ...left, rect: { ...left.rect } };
    controller.setChrome(input);
    input.rect.width = 400;
    expect(controller.getSafeArea()).toEqual({ x: 212, y: 12, width: 576, height: 576 });
    const copy = controller.getSafeArea() as { x: number };
    copy.x = 999;
    controller.setChrome(left);
    expect(events).toEqual([]);
    frame();
    expect(events).toEqual([{ x: 212, y: 12, width: 576, height: 576 }]);
    bounds.mockReturnValue(new DOMRect(100, 200, 900, 700));
    window.dispatchEvent(new Event('resize'));
    expect(events).toHaveLength(1);
    frame();
    expect(events.at(-1)).toEqual({ x: 212, y: 12, width: 676, height: 676 });
    window.dispatchEvent(new Event('resize'));
    frame();
    expect(events).toHaveLength(2);
    controller.removeChrome('left');
    frame();
    expect(events.at(-1)).toEqual({ x: 12, y: 12, width: 876, height: 676 });
  });
  it.each(['right', 'left', 'top', 'bottom'] as const)(
    'pans minimally away from %s without zooming',
    (edge) => {
      const { controller } = make();
      controller.setCamera({ x: 50, y: -20, zoom: 2 });
      controller.setNodes([{ id: 'a', bounds: { x: 150, y: 80, width: 100, height: 100 } }]);
      controller.setSelection(['a']);
      const panel = {
        right: surface('right', { x: 280, y: 0, width: 520, height: 600 }),
        left: surface('left', { x: 0, y: 0, width: 320, height: 600 }),
        top: surface('top', { x: 0, y: 0, width: 800, height: 320 }),
        bottom: surface('bottom', { x: 0, y: 280, width: 800, height: 320 }),
      }[edge];
      controller.setChrome(panel);
      expect(controller.getCamera()).toEqual({
        x: edge === 'right' ? 116 : edge === 'left' ? -16 : 50,
        y: edge === 'bottom' ? 46 : edge === 'top' ? -86 : -20,
        zoom: 2,
      });
      const before = controller.getCamera();
      controller.setChrome({ ...panel, open: false });
      controller.removeChrome(panel.id);
      expect(controller.getCamera()).toEqual(before);
    },
  );
  it('uses the union selection area and requires strictly more than half to be covered', () => {
    const { controller } = make();
    controller.setNodes([
      { id: 'a', bounds: { x: 200, y: 200, width: 50, height: 100 } },
      { id: 'b', bounds: { x: 350, y: 200, width: 50, height: 100 } },
    ]);
    controller.setSelection(['a', 'b']);
    controller.setChrome({ ...right, rect: { x: 300, y: 0, width: 500, height: 600 } });
    expect(controller.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
    controller.setChrome({ ...right, rect: { x: 299, y: 0, width: 501, height: 600 } });
    expect(controller.getCamera()).toEqual({ x: 113, y: 0, zoom: 1 });
  });
  it('centres oversized selections on each exhausted axis and handles zero-area selection', () => {
    const { controller } = make();
    controller.setNodes([{ id: 'a', bounds: { x: 200, y: 100, width: 500, height: 700 } }]);
    controller.setSelection(['a']);
    controller.setChrome({ ...right, rect: { x: 300, y: 0, width: 500, height: 600 } });
    expect(controller.getCamera()).toEqual({ x: 300, y: 150, zoom: 1 });
    controller.setNodes([{ id: 'a', bounds: { x: 650, y: 300, width: 0, height: 0 } }]);
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    controller.setChrome({ ...right, rect: { x: 299, y: 0, width: 501, height: 600 } });
    expect(controller.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
  });
  it('animates covering reveals over at most 200ms and respects reduced motion', () => {
    const { controller } = make({ motion: 'auto' });
    controller.setNodes([{ id: 'a', bounds: { x: 650, y: 200, width: 100, height: 100 } }]);
    controller.setSelection(['a']);
    controller.setChrome(right);
    expect(controller.getCamera().x).toBe(0);
    frame(100);
    expect(controller.getCamera().x).toBe(81);
    frame(100);
    expect(controller.getCamera()).toEqual({ x: 162, y: 0, zoom: 1 });
    controller.setChrome({ ...right, open: false });
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    controller.setChrome(right);
    expect(controller.getCamera()).toEqual({ x: 162, y: 0, zoom: 1 });
  });
  it('does not repeat reveals for unchanged or shrinking open surfaces', () => {
    const { controller } = make();
    controller.setNodes([{ id: 'a', bounds: { x: 650, y: 200, width: 100, height: 100 } }]);
    controller.setSelection(['a']);
    controller.setChrome(right);
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    controller.setChrome(right);
    controller.setChrome({ ...right, rect: { ...right.rect, x: 610, width: 190 } });
    expect(controller.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('safe-area camera targets', () => {
  it('fits all and selection, and reveals minimally or centrally into the safe area', () => {
    const { controller } = make();
    controller.setChrome(left);
    controller.setChrome(right);
    controller.setNodes([{ id: 'a', bounds: { x: 0, y: 0, width: 100, height: 100 } }]);
    controller.fit('all', { padding: 0 });
    expect(controller.getCamera()).toEqual({ x: 50 - 400 / 3.76, y: 50 - 300 / 3.76, zoom: 3.76 });
    controller.setSelection(['a']);
    controller.fit('selection', { padding: 0, maxZoom: 1 });
    expect(controller.getCamera()).toEqual({ x: -350, y: -250, zoom: 1 });
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    controller.reveal('a');
    expect(controller.getCamera()).toEqual({ x: -212, y: -12, zoom: 1 });
    controller.reveal('a', { mode: 'center' });
    expect(controller.getCamera()).toEqual({ x: -350, y: -250, zoom: 1 });
  });
  it.each(['+', '-', '0'])('anchors %s at the safe-area centre', (key) => {
    const { controller, stage } = make();
    controller.setChrome(left);
    controller.setCamera({ x: -50, y: 70, zoom: 0.5 });
    stage.focus();
    const area = controller.getSafeArea();
    const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const anchor = controller.screenToWorld(centre);
    controller.handleKey(new KeyboardEvent('keydown', { key }));
    expect(controller.worldToScreen(anchor)).toEqual(centre);
    controller.zoomAt(1.25);
    expect(controller.worldToScreen(anchor)).toEqual(centre);
    const pointer = { x: 150, y: 180 };
    const pointerAnchor = controller.screenToWorld(pointer);
    controller.zoomAt(1.25, pointer);
    const projected = controller.worldToScreen(pointerAnchor);
    expect(projected.x).toBeCloseTo(pointer.x, 9);
    expect(projected.y).toBeCloseTo(pointer.y, 9);
  });
});

describe('validation and breakpoints', () => {
  it.each([
    [null, 'chrome', 'null'],
    [{ ...left, id: '' }, 'chrome.id', ''],
    [{ ...left, edge: 'middle' }, 'chrome.edge', 'middle'],
    [{ ...left, open: 'yes' }, 'chrome.open', 'yes'],
    [{ ...left, rect: null }, 'chrome.rect', 'null'],
    [{ ...left, rect: { ...left.rect, x: NaN } }, 'chrome.rect.x', 'NaN'],
    [{ ...left, rect: { ...left.rect, y: Infinity } }, 'chrome.rect.y', 'Infinity'],
    [{ ...left, rect: { ...left.rect, width: -1 } }, 'chrome.rect.width', '-1'],
    [{ ...left, rect: { ...left.rect, height: -1 } }, 'chrome.rect.height', '-1'],
  ])('rejects malformed chrome %j', (input, field, value) => {
    const { controller } = make();
    const call = () => controller.setChrome(input as ChromeSurface);
    expect(call).toThrow(TypeError);
    expect(call).toThrow(`${field}: invalid value ${value}`);
    expect(controller.getSafeArea()).toEqual({ x: 12, y: 12, width: 776, height: 576 });
  });
  it('rejects unknown removal ids', () => {
    const { controller } = make();
    expect(() => controller.removeChrome('missing')).toThrow(TypeError);
    expect(() => controller.removeChrome('missing')).toThrow('chrome.id: invalid value missing');
  });
  it('reports sorted breakpoint thresholds on resize and only enqueues changes', () => {
    const { controller, bounds } = make({
      breakpoints: [
        { name: 'desktop', minWidth: 1280 },
        { name: 'mobile', minWidth: 0 },
        { name: 'tablet', minWidth: 768 },
      ],
    });
    expect(controller.getBreakpoint()).toBe('tablet');
    const listener = vi.fn();
    controller.on('breakpoint', listener);
    for (const [width, expected] of [
      [767, 'mobile'],
      [768, 'tablet'],
      [1280, 'desktop'],
    ] as const) {
      bounds.mockReturnValue(new DOMRect(0, 0, width, 600));
      window.dispatchEvent(new Event('resize'));
      expect(controller.getBreakpoint()).toBe(expected);
      frame();
      expect(listener).toHaveBeenLastCalledWith(expected);
    }
    window.dispatchEvent(new Event('resize'));
    controller.setChrome(left);
    frame();
    expect(listener).toHaveBeenCalledTimes(3);
    const without = make().controller;
    expect(without.getBreakpoint()).toBeNull();
    const below = make({ breakpoints: [{ name: 'wide', minWidth: 900 }] }).controller;
    expect(below.getBreakpoint()).toBeNull();
  });
  it.each([
    [null, 'breakpoints', 'null'],
    [[null], 'breakpoints[0]', 'null'],
    [[{ name: '', minWidth: 0 }], 'breakpoints[0].name', ''],
    [[{ name: 'a', minWidth: -1 }], 'breakpoints[0].minWidth', '-1'],
    [[{ name: 'a', minWidth: NaN }], 'breakpoints[0].minWidth', 'NaN'],
    [
      [
        { name: 'a', minWidth: 0 },
        { name: 'a', minWidth: 1 },
      ],
      'breakpoints duplicate name',
      'a,a',
    ],
    [
      [
        { name: 'a', minWidth: 0 },
        { name: 'b', minWidth: 0 },
      ],
      'breakpoints duplicate minWidth',
      '0,0',
    ],
  ])('rejects invalid breakpoints %j', (breakpoints, field, value) => {
    const call = () => createCanvas({ label: 'Invalid', breakpoints } as CanvasOptions);
    expect(call).toThrow(TypeError);
    expect(call).toThrow(`${field}: invalid value ${value}`);
  });
});
