// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasController, CanvasOptions } from '../src/index.mjs';
import { createCanvas } from '../src/index.mjs';

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

function advance(milliseconds: number) {
  time += milliseconds;
  vi.advanceTimersByTime(milliseconds);
}

function frame(step = 16) {
  advance(step);
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(time);
}

function make(options: Partial<CanvasOptions> = {}, attached = true) {
  let width = 800;
  const stage = document.createElement('div');
  const world = document.createElement('div');
  const overlay = document.createElement('div');
  stage.append(world, overlay);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 600));
  const controller = createCanvas({ label: 'Culling integration', motion: 'none', ...options });
  controllers.push(controller);
  const elements = { stage, world, overlays: [overlay] };
  if (attached) controller.attach(elements);
  return {
    controller,
    stage,
    world,
    overlay,
    elements,
    resize(next: number) {
      width = next;
      window.dispatchEvent(new Event('resize'));
    },
  };
}

const node = (id: string, x = 0, y = 0) => ({
  id,
  bounds: { x, y, width: 40, height: 40 },
});

describe('controller culling integration', () => {
  it('notifies mounted nodes after writing every layer transform', () => {
    const { controller, world, overlay } = make();
    controller.setNodes([node('a', 10000)]);
    controller.panBy(10000, 0);
    const mounts = vi.fn(() => {
      expect(world.style.transform).toBe('scale(1) translate(-10000px, 0px)');
      expect(overlay.style.transform).toBe(world.style.transform);
    });
    controller.on('mount', mounts);
    expect(controller.getMountedIds()).toEqual(new Set());
    frame();
    expect(mounts).toHaveBeenCalledExactlyOnceWith(new Set(['a']));
    const snapshot = controller.getMountedIds() as Set<string>;
    snapshot.clear();
    expect(controller.getMountedIds()).toEqual(new Set(['a']));
  });

  it('emits moved geometry without changing the mounted set', () => {
    const { controller } = make();
    controller.setNodes([node('a')]);
    frame();
    const mount = vi.fn();
    const geometry = vi.fn();
    controller.on('mount', mount);
    controller.on('geometry', geometry);
    controller.setNodes([node('a', 50)]);
    expect(geometry).not.toHaveBeenCalled();
    frame();
    expect(geometry).toHaveBeenCalledExactlyOnceWith(new Set(['a']));
    expect(mount).not.toHaveBeenCalled();
    expect(controller.getMountedIds()).toEqual(new Set(['a']));
  });

  it('keeps product, selection and DOM focus pins independent', () => {
    const { controller, stage, world } = make();
    controller.setNodes([
      node('origin'),
      node('product', -8000),
      node('selected', -9000),
      node('focused', -10000),
    ]);
    const focus = document.createElement('button');
    focus.setAttribute('data-canvas-node-id', 'focused');
    world.append(focus);
    controller.setPinned('selection', ['product']);
    controller.setSelection(['selected']);
    focus.focus();
    frame();
    controller.panBy(10000, 0);
    frame();
    expect(document.activeElement).toBe(focus);
    expect(controller.getMountedIds()).toEqual(new Set(['product', 'selected', 'focused']));
    controller.setPinned('selection', []);
    frame();
    expect(controller.getMountedIds()).toEqual(new Set(['selected', 'focused']));
    controller.setSelection([]);
    frame();
    expect(controller.getMountedIds()).toEqual(new Set(['focused']));
    stage.focus();
    frame();
    expect(controller.getMountedIds()).toEqual(new Set());
  });

  it('pins registered focus without requiring a data attribute and allows removal cleanup', () => {
    const { controller, world } = make();
    controller.setNodes([node('focused', -10000)]);
    const element = document.createElement('button');
    world.append(element);
    controller.registerNodeElement('focused', element);
    element.focus();
    frame();
    expect(controller.getMountedIds()).toEqual(new Set(['focused']));
    controller.setNodes([]);
    expect(() => controller.registerNodeElement('focused', null)).not.toThrow();
    frame();
    expect(controller.getMountedIds()).toEqual(new Set());
  });
  it('queues selection events and prunes deleted selections', () => {
    const { controller } = make();
    controller.setNodes([node('a')]);
    const selection = vi.fn();
    controller.on('selection', selection);
    controller.setSelection(['a']);
    controller.setSelection(['a']);
    expect(controller.getSelection()).toEqual(['a']);
    expect(selection).not.toHaveBeenCalled();
    frame();
    expect(selection).toHaveBeenCalledExactlyOnceWith(['a']);
    controller.setNodes([]);
    expect(controller.getSelection()).toEqual([]);
    frame();
    expect(selection.mock.calls).toEqual([[['a']], [[]]]);
  });

  it('delivers 968 remounts across five controller frames', () => {
    const { controller } = make();
    controller.setNodes(
      Array.from({ length: 968 }, (_, index) =>
        node(String(index), (index % 44) * 20, Math.floor(index / 44) * 20),
      ),
    );
    const sizes: number[] = [];
    controller.on('mount', (ids) => sizes.push(ids.size));
    for (let index = 0; index < 5; index += 1) frame();
    expect(sizes).toEqual([200, 400, 600, 800, 968]);
    expect(callbacks.size).toBe(0);
  });

  it('prunes during zoom and resumes optional admissions at 120 milliseconds', () => {
    const { controller } = make();
    controller.setNodes([node('a'), node('b', 10000)]);
    frame();
    expect(controller.getMountedIds()).toEqual(new Set(['a']));
    controller.setCamera({ x: 10000, y: 0, zoom: 2 });
    frame();
    expect(controller.getMountedIds()).toEqual(new Set());
    advance(119);
    expect(callbacks.size).toBe(0);
    expect(controller.getMountedIds()).toEqual(new Set());
    advance(1);
    expect(callbacks.size).toBe(1);
    frame(0);
    expect(controller.getMountedIds()).toEqual(new Set(['b']));
  });

  it('admits during a pure pan and freezes every frame of a sixty-step zoom sweep', () => {
    const { controller } = make();
    controller.setNodes(
      Array.from({ length: 5000 }, (_, index) =>
        node(String(index), (index % 50) * 300, Math.floor(index / 50) * 100),
      ),
    );
    frame();
    let previous = new Set(controller.getMountedIds());
    let added = 0;
    let removed = 0;
    controller.on('mount', (ids) => {
      added += [...ids].filter((id) => !previous.has(id)).length;
      removed += [...previous].filter((id) => !ids.has(id)).length;
      previous = new Set(ids);
    });
    controller.setCamera({ x: 6000, y: 0, zoom: 1 });
    frame();
    expect(added).toBeGreaterThan(0);
    const startZoom = controller.getCamera().zoom;
    removed = 0;
    for (let index = 0; index < 60; index += 1) {
      added = 0;
      const zoomBefore = controller.getCamera().zoom;
      controller.setCamera({
        x: index % 2 === 0 ? 6000 : 0,
        y: 0,
        zoom: startZoom + (index + 1) / 100,
      });
      frame();
      expect(controller.getCamera().zoom, `frame ${index} changes zoom`).not.toBe(zoomBefore);
      expect(added, `frame ${index} admits no optional nodes while zoom changes`).toBe(0);
    }
    expect(removed).toBeGreaterThan(0);
    advance(119);
    expect(added).toBe(0);
    advance(1);
    frame(0);
    expect(added).toBeGreaterThan(0);
  });

  it('clears mounted state on detach and emits mounts again on reattach', () => {
    const { controller, elements } = make();
    controller.setNodes([node('a')]);
    const mount = vi.fn();
    controller.on('mount', mount);
    frame();
    controller.detach();
    expect(controller.getMountedIds()).toEqual(new Set());
    expect(callbacks.size).toBe(0);
    controller.attach(elements);
    frame();
    expect(mount.mock.calls).toEqual([[new Set(['a'])], [new Set(['a'])]]);
  });
});

describe('controller diagnostics and breakpoints', () => {
  it('updates detached diagnostics synchronously and emits after the attached write', () => {
    const { controller, elements, world } = make({}, false);
    controller.setNodes([node('a')]);
    const listener = vi.fn(() => expect(world.style.transform).toBeTruthy());
    controller.on('diagnostics', listener);
    controller.setEdges([{ id: 'broken', from: 'a', to: 'missing', style: 'default' }]);
    expect(controller.getDiagnostics()).toEqual([
      expect.objectContaining({ id: 'broken', code: 'unknown-endpoint' }),
    ]);
    expect(controller.getDiagnostics()[0]?.reason).toContain('missing');
    expect(listener).not.toHaveBeenCalled();
    const copy = controller.getDiagnostics() as { reason: string }[];
    if (copy[0]) copy[0].reason = 'modified';
    expect(controller.getDiagnostics()[0]?.reason).toContain('missing');
    controller.attach(elements);
    frame();
    expect(listener).toHaveBeenCalledTimes(1);
    controller.setEdges([]);
    expect(controller.getDiagnostics()).toEqual([]);
    frame();
    expect(listener.mock.calls.at(-1)).toEqual([[]]);
  });

  it('throws for unknown endpoints before accepting a strict detached update', () => {
    const { controller } = make({ strict: true }, false);
    controller.setNodes([node('a')]);
    expect(() =>
      controller.setEdges([{ id: 'broken', from: 'a', to: 'missing', style: 'default' }]),
    ).toThrow(/broken.*missing/u);
    expect(controller.getDiagnostics()).toEqual([]);
    expect(() => controller.setNodes([node('b')])).not.toThrow();
  });

  it('defaults to no named breakpoint and reports configured names on resize', () => {
    const plain = make();
    expect(plain.controller.getBreakpoint()).toBeNull();
    plain.resize(400);
    frame();
    expect(plain.controller.getBreakpoint()).toBeNull();
    const { controller, resize } = make({
      breakpoints: [
        { name: 'wide', minWidth: 1000 },
        { name: 'compact', minWidth: 0 },
        { name: 'medium', minWidth: 600 },
      ],
    });
    const listener = vi.fn();
    controller.on('breakpoint', listener);
    expect(controller.getBreakpoint()).toBe('medium');
    frame();
    expect(listener).toHaveBeenCalledExactlyOnceWith('medium');
    resize(1200);
    expect(controller.getBreakpoint()).toBe('wide');
    frame();
    resize(500);
    frame();
    expect(listener.mock.calls).toEqual([['medium'], ['wide'], ['compact']]);
  });

  it('applies 10, 6 and 3 live-frame budgets when custom breakpoints resize', () => {
    const { controller, stage, world, resize } = make({
      breakpoints: [
        { name: 'phone', minWidth: 0 },
        { name: 'tablet', minWidth: 600 },
        { name: 'desktop', minWidth: 1000 },
      ],
    });
    resize(1200);
    controller.setNodes(
      Array.from({ length: 15 }, (_, index) => ({ ...node(String(index), 200, 200), frame: true })),
    );
    for (let index = 0; index < 15; index += 1) {
      const owner = document.createElement('div');
      owner.setAttribute('data-canvas-node-id', String(index));
      owner.append(document.createElement('iframe'));
      world.append(owner);
    }
    frame();
    for (let index = 0; index < 15; index += 1) {
      const booting = stage.querySelector('[data-canvas-frame-booting]');
      if (!booting) break;
      booting.dispatchEvent(new Event('load'));
    }
    expect(stage.querySelectorAll('[data-canvas-frame-live]')).toHaveLength(10);
    expect(stage.querySelectorAll('[data-canvas-frame-placeholder]')).toHaveLength(5);
    resize(900);
    frame();
    expect(stage.querySelectorAll('[data-canvas-frame-live]')).toHaveLength(6);
    resize(500);
    frame();
    expect(stage.querySelectorAll('[data-canvas-frame-live]')).toHaveLength(3);
    expect(stage.querySelectorAll('[data-canvas-frame-placeholder]')).toHaveLength(12);
  });
});
