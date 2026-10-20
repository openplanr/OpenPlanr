// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, CanvasController, CanvasOptions } from '../src/index.mjs';
import { cameraFromScreenTranslate, cameraToScreenTranslate, createCanvas } from '../src/index.mjs';

let callbacks: Map<number, FrameRequestCallback>;
let sequence: number;
let controllers: CanvasController[];
let time: number;

beforeEach(() => {
  callbacks = new Map();
  sequence = 0;
  time = 0;
  controllers = [];
  vi.spyOn(window.performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id);
  });
});
afterEach(() => {
  for (const controller of controllers) controller.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
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
  const overlay = document.createElement('div');
  stage.append(world, overlay);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 800, 600));
  const controller = createCanvas({ label: 'Test canvas', motion: 'none', ...options });
  controllers.push(controller);
  controller.attach({ stage, world, overlays: [overlay] });
  return { controller, stage, world, overlay };
}
const node = (id: string, x = 0, y = 0) => ({ id, bounds: { x, y, width: 100, height: 100 } });

describe('camera geometry', () => {
  it('resets directly to exactly 100% from many persisted and fitted zooms', () => {
    const { controller, stage } = make();
    stage.focus();
    controller.setNodes([node('a')]);
    const centre = { x: 400, y: 300 };
    const zooms = [
      0.04,
      0.123456789,
      0.3,
      0.7,
      1,
      3.3,
      3.7,
      4,
      ...Array.from({ length: 200 }, (_, index) => 0.04 + (index * 3.96) / 200),
    ];
    for (const zoom of zooms) {
      for (const fitted of [false, true]) {
        if (fitted) controller.fit('all', { padding: 0, maxZoom: zoom });
        else controller.setCamera({ x: -111.125, y: 240.75, zoom });
        const anchor = controller.screenToWorld(centre);
        expect(controller.handleKey(new KeyboardEvent('keydown', { key: '0' }))).toBe(true);
        expect(controller.getCamera().zoom, `reset from ${zoom}, fitted=${fitted}`).toBe(1);
        const projected = controller.worldToScreen(anchor);
        expect(Math.abs(projected.x - centre.x)).toBeLessThan(1e-9);
        expect(Math.abs(projected.y - centre.y)).toBeLessThan(1e-9);
      }
    }
  });

  it.each([
    { min: 1.2, max: 3.3, from: 3.3, expected: 1.2 },
    { min: 0.04, max: 0.7, from: 0.3, expected: 0.7 },
  ])('resets to the exact allowed zoom nearest 100% for %j', ({ min, max, from, expected }) => {
    const { controller, stage } = make({ zoom: { min, max } });
    stage.focus();
    controller.setCamera({ x: 10, y: -20, zoom: from });
    const anchor = controller.screenToWorld({ x: 400, y: 300 });
    controller.handleKey(new KeyboardEvent('keydown', { key: '0' }));
    expect(controller.getCamera().zoom).toBe(expected);
    const projected = controller.worldToScreen(anchor);
    expect(Math.abs(projected.x - 400)).toBeLessThan(1e-9);
    expect(Math.abs(projected.y - 300)).toBeLessThan(1e-9);
  });

  it.each([0.123456789, 0.3, 0.7, 1, 3.3])(
    'finishes animated fit at its exact maxZoom cap %s',
    (maxZoom) => {
      const { controller } = make({ motion: 'auto' });
      controller.setNodes([node('a')]);
      controller.setCamera({ x: 0, y: 0, zoom: 4 });
      controller.fit('all', { padding: 0, maxZoom });
      frame(100);
      frame(100);
      expect(controller.getCamera().zoom).toBe(maxZoom);
    },
  );

  it('lands on exact custom zoom limits for direct, relative and animated moves', () => {
    const { controller } = make({ motion: 'auto', zoom: { min: 0.04, max: 3.3 } });
    controller.setCamera({ x: 0, y: 0, zoom: 100 });
    expect(controller.getCamera().zoom).toBe(3.3);
    controller.setCamera({ x: 0, y: 0, zoom: 0.001 });
    expect(controller.getCamera().zoom).toBe(0.04);
    controller.zoomAt(1000);
    expect(controller.getCamera().zoom).toBe(3.3);
    controller.zoomAt(0.0001);
    expect(controller.getCamera().zoom).toBe(0.04);
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    controller.setCamera({ x: 0, y: 0, zoom: 0.001 }, { animate: true });
    frame(200);
    expect(controller.getCamera().zoom).toBe(0.04);
    controller.setCamera({ x: 0, y: 0, zoom: 100 }, { animate: true });
    frame(200);
    expect(controller.getCamera().zoom).toBe(3.3);
  });

  it.each([0.04, 1, 4])('round trips at zoom %s', (zoom) => {
    const { controller } = make();
    controller.setCamera({ x: -240.25, y: 53.875, zoom });
    const world = { x: 135.125, y: -90.75 };
    const restored = controller.screenToWorld(controller.worldToScreen(world));
    expect(Math.abs(restored.x - world.x)).toBeLessThan(1e-9);
    expect(Math.abs(restored.y - world.y)).toBeLessThan(1e-9);
  });
  it('round trips persisted Studio translations', () => {
    for (const scale of [0.04, 1, 4]) {
      const stored = { x: -821.5, y: 499.25, scale };
      expect(cameraToScreenTranslate(cameraFromScreenTranslate(stored))).toEqual(stored);
    }
  });
  it('clamps zoom and preserves the pointer anchor', () => {
    const { controller } = make();
    controller.setCamera({ x: 14, y: -70, zoom: 1 });
    const pointer = { x: 210, y: 155 };
    const anchor = controller.screenToWorld(pointer);
    controller.zoomAt(1000, pointer);
    expect(controller.getCamera().zoom).toBe(4);
    expect(controller.worldToScreen(anchor)).toEqual(pointer);
    controller.zoomAt(0.0001);
    expect(controller.getCamera().zoom).toBe(0.04);
  });
  it('pans by screen pixels at the current zoom', () => {
    const { controller } = make();
    controller.setCamera({ x: 0, y: 0, zoom: 4 });
    controller.panBy(100, -80);
    expect(controller.getCamera()).toEqual({ x: 25, y: -20, zoom: 4 });
  });
  it('fits all, selection and explicit ids with padding and a maximum zoom', () => {
    const { controller } = make();
    controller.setNodes([node('a'), node('b', 300, 200)]);
    controller.fit('all', { padding: 100, maxZoom: 1 });
    expect(controller.getCamera()).toEqual({ x: -200, y: -150, zoom: 1 });
    controller.setSelection(['b']);
    controller.fit('selection', { padding: 0 });
    expect(controller.getCamera()).toEqual({ x: 250, y: 175, zoom: 4 });
    controller.fit(['a'], { padding: 0, maxZoom: 1 });
    expect(controller.getCamera()).toEqual({ x: -350, y: -250, zoom: 1 });
    controller.setNodes([]);
    const before = controller.getCamera();
    controller.fit('all');
    expect(controller.getCamera()).toEqual(before);
  });
  it('rejects SVG worlds and overlays by field name', () => {
    const { controller, stage, world } = make();
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    expect(() => controller.attach({ stage, world: group as unknown as HTMLElement })).toThrow(
      /elements.world/u,
    );
    expect(() =>
      controller.attach({ stage, world, overlays: [group as unknown as HTMLElement] }),
    ).toThrow(/elements.overlays\[0\]/u);
  });
  it('hit tests world bounds through the camera without depending on mounts', () => {
    const { controller } = make();
    controller.setNodes([node('a', 100, 200), node('far', 10000, 10000)]);
    controller.setCamera({ x: 50, y: 150, zoom: 2 });
    expect(controller.hitTest({ x: 100, y: 100 })).toBe('a');
    expect(controller.hitTest({ x: 99, y: 100 })).toBeNull();
    controller.setCamera({ x: 10000, y: 10000, zoom: 1 });
    expect(controller.hitTest({ x: 0, y: 0 })).toBe('far');
    expect(() => controller.hitTest({ x: NaN, y: 0 })).toThrow(/screenPoint.x/u);
  });
  it('clamps pan to padded world bounds', () => {
    const { controller } = make({
      worldBounds: { rect: { x: 100, y: 200, width: 2000, height: 1600 }, padding: 50 },
    });
    controller.setCamera({ x: -999, y: -999, zoom: 1 });
    expect(controller.getCamera()).toEqual({ x: 50, y: 150, zoom: 1 });
    controller.setCamera({ x: 9999, y: 9999, zoom: 1 });
    expect(controller.getCamera()).toEqual({ x: 1350, y: 1250, zoom: 1 });
  });
  it('centers a world smaller than the stage in its padded bounds', () => {
    const { controller } = make({
      worldBounds: { rect: { x: 0, y: 0, width: 100, height: 100 }, padding: 10 },
    });
    expect(controller.getCamera()).toEqual({ x: -350, y: -250, zoom: 1 });
  });
  it('reveals minimally or centers on request', () => {
    const { controller } = make();
    controller.setNodes([node('a', 750, 550)]);
    controller.reveal('a');
    expect(controller.getCamera()).toEqual({ x: 62, y: 62, zoom: 1 });
    controller.reveal('a', { mode: 'center' });
    expect(controller.getCamera()).toEqual({ x: 400, y: 300, zoom: 1 });
    controller.reveal('a');
    expect(controller.getCamera()).toEqual({ x: 400, y: 300, zoom: 1 });
  });
  it('moves instantly with motion disabled and with reduced motion', () => {
    const target = { x: 100, y: 200, zoom: 2 };
    const { controller } = make();
    controller.setCamera(target, { animate: true });
    expect(controller.getCamera()).toEqual(target);
    const reduced = make({ motion: 'auto' }).controller;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    });
    reduced.setCamera(target, { animate: true });
    expect(reduced.getCamera()).toEqual(target);
    Reflect.deleteProperty(window, 'matchMedia');
  });
  it('finishes animated moves within 200 milliseconds and cancels them on direct input', () => {
    const { controller } = make({ motion: 'auto' });
    frame();
    controller.setCamera({ x: 100, y: 200, zoom: 2 }, { animate: true });
    frame(100);
    expect(controller.getCamera()).toEqual({ x: 50, y: 100, zoom: 1.5 });
    frame(100);
    expect(controller.getCamera()).toEqual({ x: 100, y: 200, zoom: 2 });
    controller.setCamera({ x: 0, y: 0, zoom: 1 }, { animate: true });
    controller.panBy(20, 0);
    const interrupted = controller.getCamera();
    frame(200);
    expect(controller.getCamera()).toEqual(interrupted);
  });
});

describe('lifecycle and the frame writer', () => {
  it('does no per-frame frame DOM reads or writes when 5,000 nodes have no frames', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { controller, stage } = make();
    controller.setNodes(Array.from({ length: 5000 }, (_, index) => node(`node-${index}`)));
    frame();
    await Promise.resolve();
    const done = stage.querySelector<HTMLButtonElement>('[data-canvas-frame-done]');
    if (!done) throw new Error('Done control is missing');
    const queries = vi.spyOn(stage, 'querySelectorAll');
    const geometry = vi.spyOn(stage, 'getBoundingClientRect').mockClear();
    const hiddenReads = vi.spyOn(done, 'hidden', 'get');
    const hiddenWrites = vi.spyOn(done, 'hidden', 'set');
    const attributes = vi.spyOn(done, 'getAttribute');
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(done, { attributes: true });
    observer.observe(stage, { attributes: true });
    try {
      vi.advanceTimersByTime(150);
      for (let index = 0; index < 180; index += 1) {
        controller.panBy(3, 2);
        frame();
      }
      vi.advanceTimersByTime(150);
      await Promise.resolve();
      expect(queries).not.toHaveBeenCalled();
      expect(geometry).not.toHaveBeenCalled();
      expect(hiddenReads).not.toHaveBeenCalled();
      expect(hiddenWrites).not.toHaveBeenCalled();
      expect(attributes).not.toHaveBeenCalled();
      expect(mutations).toEqual([]);
    } finally {
      observer.disconnect();
    }
  });

  it('allows repeated subscription cleanup after destruction for both event types', () => {
    const controller = createCanvas({ label: 'Subscription cleanup' });
    const camera = controller.on('camera', vi.fn());
    const activeFrame = controller.on('active-frame', vi.fn());
    controller.destroy();
    expect(() => {
      camera();
      activeFrame();
      camera();
      activeFrame();
    }).not.toThrow();
  });

  it('writes CSS transforms once per layer and notifies after writing', () => {
    const { controller, world, overlay } = make();
    frame();
    const writes = vi.spyOn(world, 'setAttribute');
    const notifications: Camera[] = [];
    controller.on('camera', (camera) => {
      const expected = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
      expect(overlay.style.transform).toBe(expected);
      notifications.push(camera);
    });
    controller.panBy(5, 6);
    controller.panBy(7, 8);
    expect(notifications).toHaveLength(0);
    frame();
    expect(notifications).toEqual([{ x: 12, y: 14, zoom: 1 }]);
    expect(writes.mock.calls.filter(([name]) => name === 'transform')).toHaveLength(0);
    expect(world.style.transform).toBe('scale(1) translate(-12px, -14px)');
    frame();
    expect(notifications).toHaveLength(1);
  });
  it('removes will-change 150 milliseconds after the last move', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { controller, world } = make();
    controller.panBy(5, 5);
    expect(world.style.willChange).toBe('transform');
    vi.advanceTimersByTime(100);
    controller.panBy(5, 5);
    vi.advanceTimersByTime(149);
    expect(world.style.willChange).toBe('transform');
    vi.advanceTimersByTime(1);
    expect(world.style.willChange).toBe('');
  });
  it('creates detached, attaches and detaches idempotently, restores owned DOM', () => {
    const controller = createCanvas({ label: 'Detached' });
    controllers.push(controller);
    controller.setCamera({ x: 5, y: 6, zoom: 2 });
    expect(callbacks.size).toBe(0);
    const stage = document.createElement('div');
    const world = document.createElement('div');
    stage.tabIndex = 3;
    stage.style.touchAction = 'auto';
    world.style.transform = 'scale(3)';
    stage.append(world);
    controller.attach({ stage, world });
    controller.attach({ stage, world });
    expect(callbacks.size).toBe(1);
    frame();
    controller.detach();
    controller.detach();
    expect(stage.tabIndex).toBe(3);
    expect(stage.style.touchAction).toBe('auto');
    expect(world.style.transform).toBe('scale(3)');
    controller.panBy(10, 10);
    expect(callbacks.size).toBe(0);
    controller.attach({ stage, world });
    frame();
    expect(world.style.transform).toBe('scale(2) translate(-10px, -11px)');
  });
  it('coalesces active-frame events and allows unsubscription', () => {
    const { controller } = make();
    controller.setNodes([{ ...node('frame'), frame: true }]);
    const listener = vi.fn();
    const unsubscribe = controller.on('active-frame', listener);
    controller.setActiveFrame('frame');
    expect(controller.getActiveFrame()).toBe('frame');
    expect(listener).not.toHaveBeenCalled();
    frame();
    expect(listener).toHaveBeenCalledWith('frame');
    unsubscribe();
    controller.deactivateFrame();
    frame();
    expect(listener).toHaveBeenCalledTimes(1);
    controller.setActiveFrame('frame');
    controller.setNodes([]);
    expect(controller.getActiveFrame()).toBeNull();
  });
  it('copies camera, node bounds and selection state', () => {
    const { controller } = make();
    const entry = node('a');
    controller.setNodes([entry]);
    entry.bounds.x = 10000;
    controller.setSelection(['a']);
    const selection = controller.getSelection() as string[];
    selection.push('unknown');
    expect(controller.getSelection()).toEqual(['a']);
    const camera = controller.getCamera() as { x: number };
    camera.x = 10000;
    expect(controller.getCamera().x).toBe(0);
    controller.fit('all', { maxZoom: 1 });
    expect(controller.getCamera().x).toBe(-350);
  });
  it('rejects every controller operation after destruction', () => {
    const controller = createCanvas({ label: 'Destroyed' });
    controller.destroy();
    const calls = [
      () => controller.attach({ stage: document.body, world: document.body }),
      () => controller.detach(),
      () => controller.destroy(),
      () => controller.setNodes([]),
      () => controller.setEdges([]),
      () => controller.registerNodeElement('a', null),
      () => controller.setPinned('editing', []),
      () => controller.getMountedIds(),
      () => controller.getDiagnostics(),
      () => controller.getBreakpoint(),
      () =>
        controller.setChrome({
          id: 'panel',
          edge: 'left',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          open: true,
        }),
      () => controller.removeChrome('panel'),
      () => controller.getSafeArea(),
      () => controller.hitTest({ x: 0, y: 0 }),
      () => controller.getCamera(),
      () => controller.setCamera({ x: 0, y: 0, zoom: 1 }),
      () => controller.panBy(1, 1),
      () => controller.zoomAt(1),
      () => controller.fit('all'),
      () => controller.reveal('a'),
      () => controller.worldToScreen({ x: 0, y: 0 }),
      () => controller.screenToWorld({ x: 0, y: 0 }),
      () => controller.setSelection([]),
      () => controller.getSelection(),
      () => controller.setPointerMode('pan'),
      () => controller.handleKey(new KeyboardEvent('keydown', { key: '+' })),
      () => controller.setActiveFrame(null),
      () => controller.getActiveFrame(),
      () => controller.deactivateFrame(),
      () => controller.on('camera', () => {}),
    ];
    for (const call of calls)
      expect(call).toThrowError(new Error('Canvas controller is destroyed'));
  });
});

describe('validation errors name the field and value', () => {
  it.each([
    [{ label: '' }, 'label', ''],
    [{ zoom: null }, 'zoom', 'null'],
    [{ zoom: { min: null } }, 'zoom.min', 'null'],
    [{ zoom: { max: null } }, 'zoom.max', 'null'],
    [{ pointerMode: null }, 'pointerMode', 'null'],
    [{ worldBounds: null }, 'worldBounds', 'null'],
    [{ keyboard: null }, 'keyboard', 'null'],
    [{ zoom: { min: 5, max: 4 } }, 'zoom.min', '5'],
    [{ zoom: { min: 0 } }, 'zoom.min', '0'],
    [{ zoom: { max: NaN } }, 'zoom.max', 'NaN'],
    [{ worldBounds: { rect: { x: 0, y: 0, width: -1, height: 2 }, padding: 0 } }, 'width', '-1'],
    [{ worldBounds: { rect: { x: 0, y: 0, width: 1, height: 2 }, padding: -1 } }, 'padding', '-1'],
    [{ motion: 'bad' }, 'motion', 'bad'],
    [{ pointerMode: 'bad' }, 'pointerMode', 'bad'],
    [{ keyboard: { arrows: 'bad' } }, 'keyboard.arrows', 'bad'],
    [{ strict: 'bad' }, 'strict', 'bad'],
    [{ shortcutsEnabled: 'bad' }, 'shortcutsEnabled', 'bad'],
  ])('rejects invalid options %j', (patch, field, value) => {
    expect(() => createCanvas({ label: 'Invalid', ...patch } as CanvasOptions)).toThrow(TypeError);
    expect(() => createCanvas({ label: 'Invalid', ...patch } as CanvasOptions)).toThrow(
      new RegExp(`${field}.*${value}`, 'u'),
    );
  });
  it('rejects malformed camera, bounds, ids, attachment, options and events', () => {
    const { controller, stage, world } = make();
    const unsafe = controller as unknown as Record<string, (...args: unknown[]) => unknown>;
    const cases: [string, unknown[], string, string][] = [
      ['setCamera', [{ x: Infinity, y: 0, zoom: 1 }], 'camera.x', 'Infinity'],
      ['setCamera', [{ x: 0, y: NaN, zoom: 1 }], 'camera.y', 'NaN'],
      ['setCamera', [{ x: 0, y: 0, zoom: 0 }], 'camera.zoom', '0'],
      ['setCamera', [{ x: 0, y: 0, zoom: 1 }, { animate: 'yes' }], 'animate', 'yes'],
      ['panBy', [NaN, 0], 'dxScreen', 'NaN'],
      ['panBy', [0, Infinity], 'dyScreen', 'Infinity'],
      ['zoomAt', [-1], 'factor', '-1'],
      ['zoomAt', [1, { x: 0, y: NaN }], 'screenPoint.y', 'NaN'],
      ['worldToScreen', [{ x: NaN, y: 0 }], 'point.x', 'NaN'],
      ['screenToWorld', [{ x: 0, y: Infinity }], 'point.y', 'Infinity'],
      ['fit', ['bad'], 'target', 'bad'],
      ['fit', ['all', { padding: -1 }], 'padding', '-1'],
      ['fit', ['all', { maxZoom: 0 }], 'maxZoom', '0'],
      ['fit', [['missing']], 'target.id', 'missing'],
      ['reveal', ['missing'], 'id', 'missing'],
      ['setNodes', [[node('a'), node('a')]], 'duplicate', 'a'],
      ['setNodes', [[node('')]], 'id', ''],
      [
        'setNodes',
        [[{ ...node('a'), bounds: { x: 0, y: 0, width: NaN, height: 1 } }]],
        'width',
        'NaN',
      ],
      [
        'setNodes',
        [[{ ...node('a'), bounds: { x: 0, y: 0, width: 1, height: -1 } }]],
        'height',
        '-1',
      ],
      [
        'setNodes',
        [[{ ...node('a'), bounds: { x: Infinity, y: 0, width: 1, height: 1 } }]],
        'bounds.x',
        'Infinity',
      ],
      ['setNodes', [[{ ...node('a'), frame: 'yes' }]], 'frame', 'yes'],
      ['setNodes', [[{ ...node('a'), kind: 5 }]], 'kind', '5'],
      ['setSelection', [['missing']], 'selection.id', 'missing'],
      ['setPointerMode', ['bad'], 'pointerMode', 'bad'],
      ['setActiveFrame', ['missing'], 'id', 'missing'],
      [
        'attach',
        [{ stage: world, world: document.createElementNS('http://www.w3.org/2000/svg', 'path') }],
        'world',
        'SVGElement',
      ],
      ['attach', [{ stage: null, world }], 'stage', 'null'],
      ['attach', [{ stage, world, overlays: [null] }], 'overlays', 'null'],
      ['attach', [{ stage, world, overlays: 1 }], 'overlays', '1'],
      ['on', ['unknown', () => {}], 'event', 'unknown'],
      ['on', ['camera', 1], 'listener', '1'],
    ];
    for (const [method, args, field, value] of cases) {
      expect(() => unsafe[method](...args), `${method} ${field}`).toThrow(TypeError);
      expect(() => unsafe[method](...args), `${method} ${field}`).toThrow(
        new RegExp(`${field}.*${value}`, 'u'),
      );
    }
    controller.setNodes([node('a')]);
    expect(() => controller.reveal('a', { mode: 'bad' } as unknown as { mode: 'minimal' })).toThrow(
      /mode.*bad/u,
    );
    expect(() => controller.setSelection(['a', 'a'])).toThrow(/selection duplicate.*a/u);
    expect(() => controller.setActiveFrame('a')).toThrow(/frame.id.*a/u);
  });
  it('validates both translation converter inputs', () => {
    expect(() => cameraFromScreenTranslate({ x: 0, y: 0, scale: 0 })).toThrow(
      /translate.scale.*0/u,
    );
    expect(() => cameraFromScreenTranslate({ x: NaN, y: 0, scale: 1 })).toThrow(
      /translate.x.*NaN/u,
    );
    expect(() => cameraToScreenTranslate({ x: 0, y: 0, zoom: Infinity })).toThrow(
      /camera.zoom.*Infinity/u,
    );
  });
});

describe('camera key dispatch', () => {
  it('suspends forwarded keys until composition ends', () => {
    const { controller, stage } = make();
    stage.focus();
    stage.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(controller.handleKey(new KeyboardEvent('keydown', { key: '+' }))).toBe(false);
    expect(controller.getCamera().zoom).toBe(1);
    stage.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(controller.handleKey(new KeyboardEvent('keydown', { key: '+' }))).toBe(true);
    expect(controller.getCamera().zoom).toBe(1.25);
  });
  it('consumes supported events once even when a coordinator forwards them', () => {
    const { controller, stage } = make();
    stage.focus();
    const coordinator = vi.fn((event: KeyboardEvent) => controller.handleKey(event));
    stage.addEventListener('keydown', coordinator, true);
    const event = new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
    stage.dispatchEvent(event);
    expect(coordinator).toHaveReturnedWith(true);
    expect(controller.getCamera().zoom).toBe(1.25);
    expect(controller.handleKey(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });
  it.each([
    ['=', {}, true],
    ['-', {}, true],
    ['0', {}, true],
    ['1', { shiftKey: true }, true],
    ['!', { shiftKey: true }, true],
    ['2', { shiftKey: true }, true],
    ['@', { shiftKey: true }, true],
    ['ArrowUp', { shiftKey: true }, true],
    ['ArrowDown', { shiftKey: true }, true],
    ['ArrowLeft', { shiftKey: true }, true],
    ['ArrowRight', { shiftKey: true }, true],
    ['ArrowRight', {}, true],
    ['q', {}, false],
    ['Escape', {}, false],
    ['+', { ctrlKey: true }, false],
    ['-', { metaKey: true }, false],
    ['+', { altKey: true }, false],
    ['+', { isComposing: true }, false],
  ] as const)('reports consumption for %s %j', (key, modifiers, consumed) => {
    const { controller, stage } = make();
    stage.focus();
    const event = new KeyboardEvent('keydown', { key, ...modifiers, cancelable: true });
    expect(controller.handleKey(event)).toBe(consumed);
    expect(event.defaultPrevented).toBe(consumed);
  });
  it('leaves arrows, editable focus, outside events and disabled shortcuts to the product', () => {
    let enabled = true;
    const { controller, stage } = make({
      keyboard: { arrows: 'none' },
      shortcutsEnabled: () => enabled,
    });
    stage.focus();
    const before = controller.getCamera();
    expect(
      controller.handleKey(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true })),
    ).toBe(false);
    const editor = document.createElement('input');
    stage.append(editor);
    editor.focus();
    expect(controller.handleKey(new KeyboardEvent('keydown', { key: '+' }))).toBe(false);
    stage.focus();
    enabled = false;
    expect(controller.handleKey(new KeyboardEvent('keydown', { key: '+' }))).toBe(false);
    enabled = true;
    const outside = new KeyboardEvent('keydown', { key: '+', bubbles: true });
    document.body.dispatchEvent(outside);
    expect(controller.handleKey(outside)).toBe(false);
    expect(controller.getCamera()).toEqual(before);
  });
});
