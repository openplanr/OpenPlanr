// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '../src/index.mjs';
import type { CanvasController, CanvasOptions } from '../src/types.mjs';

let callbacks: Map<number, FrameRequestCallback>;
let sequence: number;
let time: number;
const controllers: CanvasController[] = [];

beforeEach(() => {
  callbacks = new Map();
  sequence = 0;
  time = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(window.performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frame(step = 16) {
  time += step;
  vi.advanceTimersByTime(step);
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(time);
}

const node = (id: string, x = 100) => ({ id, bounds: { x, y: 100, width: 100, height: 50 } });

function make(options: Partial<CanvasOptions> = {}) {
  const stage = document.createElement('div');
  const world = document.createElement('div');
  const overlay = document.createElement('div');
  const edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const overview = document.createElement('canvas');
  overview.style.visibility = 'collapse';
  world.append(edges);
  stage.append(overview, world, overlay);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  const controller = createCanvas({ label: 'Detail integration', motion: 'none', ...options });
  controllers.push(controller);
  const elements = { stage, world, overlays: [overlay], edges, overview };
  controller.attach(elements);
  function register(id: string) {
    const element = document.createElement('button');
    element.setAttribute('aria-label', id);
    world.append(element);
    controller.registerNodeElement(id, element);
    return element;
  }
  return { controller, stage, world, overlay, edges, overview, elements, register };
}

describe('level presentation', () => {
  it('writes node visibility only when overview presentation changes', () => {
    const { controller, register } = make();
    controller.setNodes([node('a')]);
    const wrapper = register('a');
    const writes = vi.spyOn(wrapper.style, 'visibility', 'set');
    frame();
    controller.setPinned('editing', ['a']);
    frame();
    expect(writes).not.toHaveBeenCalled();
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    frame();
    expect(writes.mock.calls).toEqual([['visible']]);
    controller.setSelection(['a']);
    frame();
    expect(writes.mock.calls).toEqual([['visible']]);
    controller.setPinned('editing', []);
    controller.setSelection([]);
    frame();
    expect(writes.mock.calls).toEqual([['visible'], ['hidden']]);
    controller.setCamera({ x: 0, y: 0, zoom: 1 });
    frame(120);
    frame(120);
    expect(wrapper.style.visibility).toBe('');
    expect(writes.mock.calls).toEqual([['visible'], ['hidden'], ['']]);
    controller.setPinned('editing', ['a']);
    frame();
    expect(writes).toHaveBeenCalledTimes(3);
  });

  it('keeps every pin source full, visible and focused over the overview', () => {
    const { controller, world, overlay, edges, overview, register } = make();
    const ids = ['optional', 'focused', 'selected', 'edited', 'product'];
    controller.setNodes(ids.map((id) => node(id)));
    const wrappers = new Map(ids.map((id) => [id, register(id)]));
    controller.setPinned('editing', ['edited']);
    controller.setPinned('sidebar', ['product']);
    controller.setSelection(['selected']);
    const focused = wrappers.get('focused');
    if (!focused) throw new Error('Focused wrapper missing');
    focused.focus();
    frame();
    controller.setCamera({ x: 21, y: -31, zoom: 0.4 });
    frame();
    expect(controller.getLevel()).toBe('compact');
    expect(controller.getLevel('optional')).toBe('compact');
    for (const id of ids.slice(1)) expect(controller.getLevel(id)).toBe('dom');
    controller.setCamera({ x: 21, y: -31, zoom: 0.36 });
    frame();
    expect(controller.getLevel()).toBe('overview');
    expect(world.style.visibility).toBe('hidden');
    expect(overlay.style.visibility).toBe('hidden');
    expect(edges.style.visibility).toBe('hidden');
    expect(overview.style.visibility).toBe('visible');
    expect(controller.getMountedIds()).toEqual(new Set(ids.slice(1)));
    for (const id of ids.slice(1)) {
      expect(controller.getLevel(id)).toBe('dom');
      expect(wrappers.get(id)?.style.visibility).toBe('visible');
    }
    expect(document.activeElement).toBe(focused);
    expect(controller.getOverviewMetrics().cachePixelBytes).toBe(800 * 600 * 4 * 4);
  });

  it('retains the overview until the first returning DOM chunk is ready', () => {
    const { controller, world, overview } = make();
    controller.setNodes([node('optional')]);
    frame();
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    frame();
    expect(controller.getMountedIds().size).toBe(0);
    controller.setCamera({ x: 0, y: 0, zoom: 0.44 });
    frame();
    expect(controller.getLevel()).toBe('overview');
    expect(overview.style.visibility).toBe('visible');
    expect(world.style.visibility).toBe('hidden');
    const levels: string[] = [];
    controller.on('level', (level) => levels.push(level));
    frame(120);
    expect(controller.getMountedIds()).toEqual(new Set(['optional']));
    expect(controller.getLevel()).toBe('compact');
    expect(levels).toEqual(['compact']);
    expect(overview.style.visibility).toBe('hidden');
    expect(world.style.visibility).toBe('');
  });

  it('retains the overview until every viewport node is mounted across chunks', () => {
    const { controller, world, overview } = make();
    const viewportNodes = Array.from({ length: 544 }, (_, index) => ({
      id: `viewport-${index}`,
      bounds: {
        x: 100 + (index % 32) * 40,
        y: 100 + Math.floor(index / 32) * 40,
        width: 30,
        height: 30,
      },
    }));
    const marginNodes = Array.from({ length: 100 }, (_, index) => node(`margin-${index}`, 2000));
    controller.setNodes([...viewportNodes, ...marginNodes]);
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    frame();
    frame(150);
    expect(controller.getLevel()).toBe('overview');
    expect(controller.getMountedIds().size).toBe(0);
    const levels: string[] = [];
    controller.on('level', (level) => levels.push(level));
    controller.setCamera({ x: 0, y: 0, zoom: 0.44 });
    frame();
    expect(controller.getMountedIds().size).toBe(0);
    expect(controller.getLevel()).toBe('overview');
    expect(overview.style.visibility).toBe('visible');
    expect(world.style.visibility).toBe('hidden');
    expect(levels).toEqual([]);
    for (const count of [200, 400]) {
      frame(count === 200 ? 120 : 16);
      const mounted = controller.getMountedIds();
      expect(mounted.size).toBe(count);
      expect(viewportNodes.every((node) => mounted.has(node.id))).toBe(false);
      expect(controller.getLevel()).toBe('overview');
      expect(overview.style.visibility).toBe('visible');
      expect(world.style.visibility).toBe('hidden');
      expect(levels).toEqual([]);
    }
    frame();
    const mounted = controller.getMountedIds();
    expect(mounted.size).toBe(600);
    expect(viewportNodes.every((node) => mounted.has(node.id))).toBe(true);
    expect(marginNodes.some((node) => !mounted.has(node.id))).toBe(true);
    expect(controller.getLevel()).toBe('compact');
    expect(overview.style.visibility).toBe('hidden');
    expect(world.style.visibility).toBe('');
    expect(levels).toEqual(['compact']);
    frame();
    expect(controller.getMountedIds().size).toBe(644);
    expect(levels).toEqual(['compact']);
  });

  it('does not emit level events for changes to pinned detail', () => {
    const { controller, register } = make();
    controller.setNodes([node('a')]);
    const wrapper = register('a');
    const levels = vi.fn();
    const geometry = vi.fn();
    controller.on('level', levels);
    controller.on('geometry', geometry);
    controller.setCamera({ x: 0, y: 0, zoom: 0.4 });
    frame();
    controller.setPinned('editing', ['a']);
    frame();
    expect(controller.getLevel('a')).toBe('dom');
    controller.setPinned('editing', []);
    frame();
    expect(controller.getLevel('a')).toBe('compact');
    expect(levels).toHaveBeenCalledExactlyOnceWith('compact');
    expect(geometry).toHaveBeenCalledWith(new Set(['a']));
    expect(wrapper.isConnected).toBe(true);
  });

  it('translates stable cached pixels and invalidates on geometry, viewport and selection', () => {
    const { controller } = make();
    controller.setNodes([node('a')]);
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    frame();
    const initial = controller.getOverviewMetrics().redraws;
    controller.panBy(10, 10);
    frame();
    expect(controller.getOverviewMetrics().redraws).toBe(initial);
    controller.setNodes([node('a', 120)]);
    frame();
    expect(controller.getOverviewMetrics().redraws).toBe(initial + 1);
    controller.setSelection(['a']);
    frame();
    expect(controller.getOverviewMetrics().redraws).toBe(initial + 2);
    controller.panBy(2000, 0);
    frame();
    expect(controller.getOverviewMetrics().redraws).toBe(initial + 3);
  });

  it('scales the cached bitmap during zoom and redraws once 150 milliseconds after the last zoom', () => {
    const { controller } = make();
    controller.setNodes([node('a')]);
    controller.setCamera({ x: 0, y: 0, zoom: 0.34 });
    frame();
    const initial = controller.getOverviewMetrics().redraws;
    for (let step = 0; step < 60; step += 1) {
      controller.setCamera({ x: 0, y: 0, zoom: 0.34 + 0.01 * Math.sin(step) });
      frame();
      expect(controller.getOverviewMetrics().redraws, `active zoom frame ${step}`).toBe(initial);
    }
    frame(133);
    expect(controller.getOverviewMetrics().redraws).toBe(initial);
    frame(1);
    expect(controller.getOverviewMetrics().redraws).toBe(initial + 1);
    frame(400);
    expect(controller.getOverviewMetrics().redraws).toBe(initial + 1);
  });

  it('restores product visibility, canvas attributes and wrappers on detach', () => {
    const { controller, world, overview, elements, register } = make();
    controller.setNodes([node('a')]);
    const wrapper = register('a');
    wrapper.style.visibility = 'inherit';
    controller.setPinned('editing', ['a']);
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    frame();
    expect(wrapper.style.visibility).toBe('visible');
    controller.detach();
    expect(wrapper.style.visibility).toBe('inherit');
    expect(world.style.visibility).toBe('');
    expect(overview.style.visibility).toBe('collapse');
    expect(controller.getOverviewMetrics().cachePixelBytes).toBe(0);
    controller.attach(elements);
    frame();
    expect(controller.getLevel()).toBe('overview');
    expect(overview.style.visibility).toBe('visible');
  });

  it('keeps DOM and SVG visible with detail switching disabled', () => {
    const { controller, world, edges, overview } = make({ lod: false });
    controller.setNodes([node('a')]);
    controller.setCamera({ x: 0, y: 0, zoom: 0.1 });
    frame();
    expect(controller.getLevel()).toBe('dom');
    expect(world.style.visibility).toBe('');
    expect(edges.style.visibility).toBe('');
    expect(overview.style.visibility).toBe('hidden');
    expect(controller.getOverviewMetrics().redraws).toBe(0);
  });

  it('waits for a hidden stage to gain dimensions before creating the overview', () => {
    const { controller, stage, world } = make();
    const bounds = vi.mocked(stage.getBoundingClientRect);
    bounds.mockReturnValue(new DOMRect(0, 0, 0, 0));
    window.dispatchEvent(new Event('resize'));
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    expect(() => frame()).not.toThrow();
    expect(controller.getOverviewMetrics().redraws).toBe(0);
    expect(world.style.visibility).toBe('');
    bounds.mockReturnValue(new DOMRect(0, 0, 800, 600));
    window.dispatchEvent(new Event('resize'));
    frame();
    expect(controller.getLevel()).toBe('overview');
    expect(controller.getOverviewMetrics().redraws).toBe(1);
    expect(world.style.visibility).toBe('hidden');
  });

  it('redraws a stationary overview on a forced-colours change and removes the listener', () => {
    const media = new EventTarget();
    let forced = false;
    const remove = vi.spyOn(media, 'removeEventListener');
    Object.defineProperty(media, 'matches', { get: () => forced });
    vi.stubGlobal('matchMedia', () => media);
    const { controller } = make();
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    frame();
    const redraws = controller.getOverviewMetrics().redraws;
    forced = true;
    media.dispatchEvent(new Event('change'));
    frame();
    expect(controller.getOverviewMetrics().redraws).toBe(redraws + 1);
    controller.detach();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
