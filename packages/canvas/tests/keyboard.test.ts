// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '../src/controller.mjs';
import type { CanvasController, CanvasNode, CanvasOptions } from '../src/types.mjs';

let controllers: CanvasController[];
let callbacks: Map<number, FrameRequestCallback>;
let sequence: number;
let time: number;

beforeEach(() => {
  controllers = [];
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

function node(id: string, x: number, y = 100): CanvasNode {
  return { id, bounds: { x, y, width: 40, height: 40 } };
}

function make(options: Partial<CanvasOptions> = {}) {
  const stage = document.createElement('div');
  const world = document.createElement('div');
  stage.append(world);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  const captured = new Set<number>();
  Object.assign(stage, {
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  });
  const controller = createCanvas({ label: 'Keyboard tests', motion: 'none', ...options });
  controllers.push(controller);
  controller.attach({ stage, world });
  controller.setNodes([node('first', 100), node('middle', 300), node('last', 500)]);
  const elements = new Map<string, HTMLButtonElement>();
  for (const id of ['first', 'middle', 'last']) {
    const element = document.createElement('button');
    element.textContent = `${id} text`;
    world.append(element);
    controller.registerNodeElement(id, element);
    elements.set(id, element);
  }
  stage.focus();
  async function focus(id = 'middle') {
    const pending = controller.focusNode(id);
    await frame();
    await pending;
  }
  function key(key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...options });
    const consumed = controller.handleKey(event);
    expect(event.defaultPrevented).toBe(consumed);
    return consumed;
  }
  return { controller, stage, world, elements, key, focus };
}

describe('canvas keyboard map', () => {
  it.each([
    ['+', {}, 1.25],
    ['=', {}, 1.25],
    ['-', {}, 0.8],
    ['0', {}, 1],
  ] as const)('consumes %s and announces the resulting zoom', async (key, options, factor) => {
    const surface = make();
    surface.controller.setCamera({ x: 0, y: 0, zoom: 2 });
    expect(surface.key(key, options)).toBe(true);
    const zoom = key === '0' ? 1 : 2 * factor;
    expect(surface.controller.getCamera().zoom).toBe(zoom);
    await frame(0);
    await frame(500);
    expect(surface.stage.querySelector('[role="status"]')?.textContent).toBe(
      `Zoom ${Math.round(zoom * 100)}%`,
    );
  });

  it.each([
    ['1', 'Digit1', 'all'],
    ['!', 'Digit1', 'all'],
    ['2', 'Digit2', 'selection'],
    ['@', 'Digit2', 'selection'],
  ] as const)('consumes Shift+%s and fits %s', async (key, code, target) => {
    const surface = make();
    surface.controller.setSelection(['middle']);
    const fit = vi.spyOn(surface.controller, 'fit');
    expect(surface.key(key, { code, shiftKey: true })).toBe(true);
    expect(fit).toHaveBeenCalledExactlyOnceWith(target);
    await frame(0);
    await frame(500);
    expect(surface.stage.querySelector('[role="status"]')?.textContent).toBe(
      `Zoom ${Math.round(surface.controller.getCamera().zoom * 100)}%`,
    );
  });

  it.each([
    ['ArrowLeft', 'first'],
    ['ArrowRight', 'last'],
  ])('moves focus with %s', async (key, id) => {
    const surface = make();
    await surface.focus();
    expect(surface.key(key)).toBe(true);
    await frame();
    expect(surface.controller.getFocus()).toBe(id);
    expect(document.activeElement).toBe(surface.elements.get(id));
  });

  it.each([
    ['ArrowRight', 'first'],
    ['ArrowDown', 'first'],
    ['ArrowLeft', 'last'],
    ['ArrowUp', 'last'],
  ])('enters the outline with %s when no node has focus', async (key, id) => {
    const surface = make();
    expect(surface.key(key)).toBe(true);
    await frame();
    expect(surface.controller.getFocus()).toBe(id);
    expect(document.activeElement).toBe(surface.elements.get(id));
  });

  it.each([
    ['ArrowLeft', -144, 0],
    ['ArrowRight', 144, 0],
    ['ArrowUp', 0, -144],
    ['ArrowDown', 0, 144],
  ] as const)('pans one quarter of the safe area with Shift+%s', (key, dx, dy) => {
    const surface = make();
    surface.controller.setChrome({
      id: 'left',
      edge: 'left',
      open: true,
      rect: { x: 0, y: 0, width: 200, height: 600 },
    });
    const pan = vi.spyOn(surface.controller, 'panBy');
    expect(surface.key(key, { shiftKey: true })).toBe(true);
    expect(pan).toHaveBeenCalledExactlyOnceWith(dx, dy);
  });

  it.each(['Enter', ' '])('selects the focused node on %s keydown', async (key) => {
    const surface = make();
    await surface.focus();
    const selection = vi.fn();
    surface.controller.on('selection', selection);
    expect(surface.key(key)).toBe(true);
    expect(surface.controller.getSelection()).toEqual(['middle']);
    await frame();
    expect(selection).toHaveBeenCalledExactlyOnceWith(['middle']);
  });

  it.each(['Home', 'End'])('jumps with %s and announces its accessible name', async (key) => {
    const surface = make();
    const id = key === 'Home' ? 'first' : 'last';
    const element = surface.elements.get(id);
    if (!element) throw new Error(`Outline element ${id} is missing`);
    if (key === 'Home') element.setAttribute('aria-label', 'First accessible name');
    expect(surface.key(key)).toBe(true);
    await frame();
    expect(surface.controller.getFocus()).toBe(id);
    expect(document.activeElement).toBe(element);
    await frame(500);
    expect(surface.stage.querySelector('[role="status"]')?.textContent).toBe(
      key === 'Home' ? 'First accessible name' : 'last text',
    );
  });

  it('uses the product navigation strategy instead of spatial order', async () => {
    const navigate = vi.fn(() => 'first');
    const surface = make({ navigate });
    await surface.focus();
    expect(surface.key('ArrowRight')).toBe(true);
    await frame();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('middle', 'right');
    expect(document.activeElement).toBe(surface.elements.get('first'));
  });

  it.each([false, true])(
    'keeps focus and announces a boundary with product override %s',
    async (custom) => {
      const surface = make(custom ? { navigate: () => null } : {});
      await surface.focus('last');
      expect(surface.key('ArrowRight')).toBe(true);
      await frame(500);
      expect(surface.controller.getFocus()).toBe('last');
      expect(document.activeElement).toBe(surface.elements.get('last'));
      expect(surface.stage.querySelector('[role="status"]')?.textContent).toBe('Edge of canvas');
    },
  );

  it('applies Escape precedence to the active frame, selection, then focus', async () => {
    const surface = make();
    surface.controller.setNodes([
      { ...node('first', 100), frame: true },
      node('middle', 300),
      node('last', 500),
    ]);
    await surface.focus();
    surface.controller.setSelection(['middle']);
    surface.controller.setActiveFrame('first');
    expect(surface.key('Escape')).toBe(true);
    expect(surface.controller.getActiveFrame()).toBeNull();
    expect(surface.controller.getSelection()).toEqual(['middle']);
    expect(surface.controller.getFocus()).toBe('middle');
    expect(surface.key('Escape')).toBe(true);
    expect(surface.controller.getSelection()).toEqual([]);
    expect(surface.controller.getFocus()).toBe('middle');
    expect(surface.key('Escape')).toBe(true);
    expect(surface.controller.getFocus()).toBeNull();
    expect(document.activeElement).toBe(surface.stage);
    expect(surface.key('Escape')).toBe(false);
  });

  it('dispatches a stage key only once when the product forwards the same event', () => {
    const { controller, stage } = make();
    const zoom = vi.spyOn(controller, 'zoomAt');
    const event = new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
    stage.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(controller.handleKey(event)).toBe(false);
    expect(zoom).toHaveBeenCalledExactlyOnceWith(1.25);
  });

  it('does not announce wheel zoom and coalesces repeated keyboard zooms', async () => {
    const { controller, stage, key } = make();
    stage.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, cancelable: true }));
    await frame(500);
    expect(stage.querySelector('[role="status"]')?.textContent).toBe('');
    key('+');
    await frame(0);
    await frame(100);
    key('+');
    await frame(100);
    key('+');
    await frame(299);
    expect(stage.querySelector('[role="status"]')?.textContent).toBe('');
    await frame(1);
    expect(stage.querySelector('[role="status"]')?.textContent).toBe(
      `Zoom ${Math.round(controller.getCamera().zoom * 100)}%`,
    );
  });

  it('keeps held Space panning without selecting when only the stage is focused', () => {
    const surface = make({ pointerMode: 'none' });
    const pan = vi.spyOn(surface.controller, 'panBy');
    surface.stage.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    for (const [type, x] of [
      ['pointerdown', 100],
      ['pointermove', 140],
      ['pointerup', 140],
    ] as const) {
      const event = new MouseEvent(type, {
        clientX: x,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
      surface.stage.dispatchEvent(event);
    }
    document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    expect(pan).toHaveBeenCalledExactlyOnceWith(-40, 0);
    expect(surface.controller.getSelection()).toEqual([]);
  });
});

describe('keyboard ownership guards', () => {
  it.each(['input', 'textarea', 'div'] as const)('ignores an editable %s target', (tag) => {
    const { controller, stage } = make();
    const editor = document.createElement(tag);
    if (tag === 'div') editor.setAttribute('contenteditable', 'true');
    stage.append(editor);
    const event = new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    expect(controller.handleKey(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(controller.getCamera().zoom).toBe(1);
  });

  it('ignores both composing events and the composition lifecycle', () => {
    const { stage, key } = make();
    expect(key('+', { isComposing: true })).toBe(false);
    stage.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(key('+')).toBe(false);
    expect(key('ArrowRight')).toBe(false);
    stage.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(key('+')).toBe(true);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'preserves browser and operating system shortcuts with %s',
    (modifier) => {
      const { key } = make();
      for (const value of ['+', '-', 'ArrowRight', 'Home', 'Escape']) {
        expect(key(value, { [modifier]: true })).toBe(false);
      }
    },
  );

  it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])(
    'never reads %s when arrows are disabled',
    (key) => {
      const surface = make({ keyboard: { arrows: 'none' } });
      expect(surface.key(key)).toBe(false);
      expect(surface.key(key, { shiftKey: true })).toBe(false);
      expect(surface.controller.getFocus()).toBeNull();
      expect(surface.controller.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
    },
  );

  it('disables only single-character shortcuts', async () => {
    const surface = make({ shortcutsEnabled: () => false });
    for (const key of ['+', '=', '-', '0']) expect(surface.key(key)).toBe(false);
    expect(surface.key('1', { shiftKey: true })).toBe(false);
    expect(surface.key('2', { shiftKey: true })).toBe(false);
    expect(surface.key('ArrowRight')).toBe(true);
    await frame();
    expect(surface.controller.getFocus()).toBe('first');
    expect(surface.key('ArrowRight', { shiftKey: true })).toBe(true);
    expect(surface.key('Enter')).toBe(true);
    expect(surface.key(' ')).toBe(true);
    expect(surface.key('Escape')).toBe(true);
    expect(surface.key('Escape')).toBe(true);
    expect(surface.key('Home')).toBe(true);
    await frame();
    expect(surface.key('End')).toBe(true);
    await frame();
    expect(surface.controller.getFocus()).toBe('last');
    expect(surface.key('x')).toBe(false);
  });

  it('leaves Enter, Escape and unrelated keys unconsumed when no action applies', () => {
    const { key } = make();
    for (const value of ['Enter', 'Escape', 'x', 'Tab', '1', '2']) expect(key(value)).toBe(false);
  });
});
