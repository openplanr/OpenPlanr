// @vitest-environment jsdom
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '../src/controller.mjs';
import { CanvasFocusError, navigateSpatial } from '../src/focus.mjs';
import type { CanvasController, CanvasNode, CanvasOptions, Direction } from '../src/types.mjs';

let callbacks: Map<number, FrameRequestCallback>;
let controllers: CanvasController[];
let sequence: number;
let time: number;

beforeEach(() => {
  callbacks = new Map();
  controllers = [];
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
  for (const controller of controllers) controller.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function frame(step = 16) {
  time += step;
  vi.advanceTimersByTime(step);
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(time);
  await Promise.resolve();
}

function node(id: string, x = 100, y = 100): CanvasNode {
  return { id, bounds: { x, y, width: 40, height: 40 } };
}

function make(options: Partial<CanvasOptions> = {}) {
  const stage = document.createElement('div');
  const world = document.createElement('div');
  stage.append(world);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  const controller = createCanvas({ label: 'Focus tests', motion: 'none', ...options });
  controllers.push(controller);
  controller.attach({ stage, world });
  function register(id: string, tabIndex?: number) {
    const element = document.createElement('button');
    element.textContent = id;
    if (tabIndex !== undefined) element.tabIndex = tabIndex;
    world.append(element);
    controller.registerNodeElement(id, element);
    return element;
  }
  return { controller, stage, world, register };
}

describe('spatial focus navigation', () => {
  const origin = node('origin', 0, 0);

  it.each([
    ['right', 100, 0],
    ['left', -100, 0],
    ['down', 0, 100],
    ['up', 0, -100],
  ] as const)('finds the nearest centre in the %s cone', (direction, x, y) => {
    expect(
      navigateSpatial([origin, node('far', x * 2, y * 2), node('near', x, y)], origin, direction),
    ).toBe('near');
  });

  it.each([
    ['right', 100, 100],
    ['right', 100, -100],
    ['left', -100, 100],
    ['left', -100, -100],
    ['down', 100, 100],
    ['down', -100, 100],
    ['up', 100, -100],
    ['up', -100, -100],
  ] as const)('includes the exact 45-degree %s boundary at %s,%s', (direction, x, y) => {
    expect(navigateSpatial([origin, node('boundary', x, y)], origin, direction)).toBe('boundary');
  });

  it('excludes centres just outside the cone and overlapping centres', () => {
    expect(
      navigateSpatial([origin, node('outside', 100, 100.01), node('same', 0, 0)], origin, 'right'),
    ).toBeNull();
  });

  it('uses Euclidean distance before numeric ID order for ties', () => {
    const nodes = [origin, node('far', 120, 0), node('n10', 90, 30), node('n2', 90, -30)];
    expect(navigateSpatial(nodes, origin, 'right')).toBe('n2');
    expect(navigateSpatial([...nodes].reverse(), origin, 'right')).toBe('n2');
  });

  it.each(['up', 'down', 'left', 'right'] as const)(
    'returns null for an empty %s direction',
    (direction) => {
      expect(navigateSpatial([origin], origin, direction)).toBeNull();
    },
  );

  it('measures navigation across 5,000 bounds', () => {
    const nodes = Array.from({ length: 5000 }, (_, index) =>
      node(`n${index}`, (index % 100) * 80, Math.floor(index / 100) * 80),
    );
    const from = nodes[2525];
    if (!from) throw new Error('Navigation fixture has no origin');
    const directions: Direction[] = ['up', 'right', 'down', 'left'];
    for (let index = 0; index < 20; index += 1) navigateSpatial(nodes, from, 'right');
    const samples = directions.map((direction) => {
      const start = performance.now();
      for (let index = 0; index < 100; index += 1) navigateSpatial(nodes, from, direction);
      return (performance.now() - start) / 100;
    });
    expect(Math.max(...samples)).toBeLessThan(1);
  });
});

describe('controller focus', () => {
  it('bounds tabindex writes when a batch registers in reverse outline order', async () => {
    const { controller, world, register } = make();
    const nodes = Array.from({ length: 1000 }, (_, index) => node(`n${index}`, index * 80));
    controller.setNodes(nodes);
    const writes = vi.spyOn(Element.prototype, 'setAttribute');
    for (const { id } of [...nodes].reverse()) register(id);
    await frame();
    expect(writes.mock.calls.filter(([name]) => name === 'tabindex').length).toBeLessThanOrEqual(
      1002,
    );
    expect(world.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(world.querySelector('[tabindex="0"]')?.textContent).toBe('n0');
  });

  it('reselects the first mounted fallback after removal, registration and outline changes', async () => {
    const { controller, world, register } = make();
    controller.setNodes([node('first', 0), node('middle', 100), node('last', 200)]);
    const last = register('last');
    const middle = register('middle');
    await frame();
    expect(middle.tabIndex).toBe(0);
    controller.registerNodeElement('middle', null);
    middle.remove();
    await frame();
    expect(last.tabIndex).toBe(0);
    const first = register('first');
    await frame();
    expect(first.tabIndex).toBe(0);
    expect(last.tabIndex).toBe(-1);
    controller.setNodes([node('first', 300), node('last', 200)]);
    await frame();
    expect(last.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    expect(world.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('keeps one mounted node in the tab order and restores attributes on detach', async () => {
    const { controller, stage, register } = make();
    controller.setNodes([node('later', 300), node('first', 100)]);
    const later = register('later', 4);
    const first = register('first');
    expect(stage.getAttribute('role')).toBe('group');
    expect(stage.getAttribute('aria-roledescription')).toBe('canvas');
    expect(stage.getAttribute('aria-label')).toBe('Focus tests');
    expect(stage.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(0);
    expect(later.tabIndex).toBe(-1);
    const focus = controller.focusNode('later');
    await frame();
    await focus;
    expect(document.activeElement).toBe(later);
    expect(stage.tabIndex).toBe(-1);
    expect(first.tabIndex).toBe(-1);
    expect(later.tabIndex).toBe(0);
    controller.detach();
    expect(later.tabIndex).toBe(4);
    expect(first.hasAttribute('tabindex')).toBe(false);
    expect(stage.hasAttribute('tabindex')).toBe(false);
    expect(stage.hasAttribute('role')).toBe(false);
    expect(stage.hasAttribute('aria-label')).toBe(false);
    expect(stage.hasAttribute('aria-roledescription')).toBe(false);
    expect(stage.querySelector('[role="status"]')).toBeNull();
  });

  it('rejects unknown IDs with a typed error naming the node', async () => {
    const { controller } = make();
    const pending = controller.focusNode('missing');
    await expect(pending).rejects.toBeInstanceOf(CanvasFocusError);
    await expect(pending).rejects.toMatchObject({
      code: 'unknown-node',
      message: expect.stringContaining('missing'),
    });
  });

  it('rejects when no element registers within two frames after reveal settles', async () => {
    const { controller, stage } = make();
    controller.setNodes([node('unmounted')]);
    stage.focus();
    const pending = controller.focusNode('unmounted');
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'no-element',
      message: expect.stringContaining('unmounted'),
    });
    await frame();
    await frame();
    await frame();
    await rejection;
    await expect(pending).rejects.toBeInstanceOf(CanvasFocusError);
    expect(document.activeElement).toBe(stage);
  });

  it('pins and reveals a distant node before waiting for its element', async () => {
    const { controller, register } = make();
    controller.setChrome({
      id: 'left',
      edge: 'left',
      open: true,
      rect: { x: 0, y: 0, width: 200, height: 600 },
    });
    const target = node('distant', 8000, 6000);
    controller.setNodes([node('origin'), target]);
    await frame();
    expect(controller.getMountedIds().has('distant')).toBe(false);
    const pending = controller.focusNode('distant');
    await frame();
    expect(controller.getMountedIds().has('distant')).toBe(true);
    const element = register('distant');
    const focus = vi.spyOn(element, 'focus');
    await frame();
    await pending;
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(element);
    expect(controller.getFocus()).toBe('distant');
    const screen = controller.worldToScreen(target.bounds);
    const safe = controller.getSafeArea();
    expect(screen.x).toBeGreaterThanOrEqual(safe.x);
    expect(screen.y).toBeGreaterThanOrEqual(safe.y);
    expect(screen.x + target.bounds.width).toBeLessThanOrEqual(safe.x + safe.width);
    expect(screen.y + target.bounds.height).toBeLessThanOrEqual(safe.y + safe.height);
    expect(controller.getCamera()).toEqual({ x: 7252, y: 5452, zoom: 1 });
  });

  it('emits one focus event per change and preserves focus through overview', async () => {
    const { controller, register } = make();
    controller.setNodes([node('a')]);
    const element = register('a');
    const changes = vi.fn();
    controller.on('focus', changes);
    const first = controller.focusNode('a');
    await frame();
    await first;
    const repeated = controller.focusNode('a');
    await frame();
    await repeated;
    controller.setCamera({ x: 10000, y: 10000, zoom: 0.3 });
    await frame();
    expect(controller.getLevel()).toBe('overview');
    expect(controller.getLevel('a')).toBe('dom');
    expect(document.activeElement).toBe(element);
    expect(element.style.visibility).not.toBe('hidden');
    expect(changes.mock.calls).toEqual([['a']]);
  });

  it('reveals a node focused directly through its registered element', async () => {
    const { controller, register } = make();
    controller.setNodes([node('covered', 900, 700)]);
    const element = register('covered');
    element.focus();
    await frame();
    expect(document.activeElement).toBe(element);
    expect(controller.getFocus()).toBe('covered');
    expect(controller.getCamera()).toEqual({ x: 152, y: 152, zoom: 1 });
  });

  it('leaves focus outside when a parked node remounts after the user exits', async () => {
    const { controller, stage, register } = make();
    controller.setNodes([node('a')]);
    const original = register('a');
    const pending = controller.focusNode('a');
    await frame();
    await pending;
    controller.registerNodeElement('a', null);
    original.remove();
    expect(document.activeElement).toBe(stage);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(controller.getFocus()).toBeNull();
    register('a');
    await frame();
    expect(document.activeElement).toBe(outside);
    expect(controller.getFocus()).toBeNull();
  });

  it('holds focus at the stage while a focused element is replaced', async () => {
    const { controller, stage, register } = make();
    controller.setNodes([node('a')]);
    const original = register('a');
    const pending = controller.focusNode('a');
    await frame();
    await pending;
    controller.registerNodeElement('a', null);
    original.remove();
    expect(document.activeElement).toBe(stage);
    expect(controller.getFocus()).toBe('a');
    await frame();
    const replacement = register('a');
    await frame();
    expect(document.activeElement).toBe(replacement);
    expect(controller.getFocus()).toBe('a');
    controller.setNodes([]);
    replacement.remove();
    expect(controller.getFocus()).toBeNull();
    expect(document.activeElement).toBe(stage);
  });
});
