// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '../src/controller.mjs';
import { createFrames } from '../src/frames.mjs';
import { bindInput, isEditable, normalizeWheel } from '../src/input.mjs';
import type { CanvasController, CanvasNode } from '../src/types.mjs';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function surface(mode: 'pan' | 'none' = 'pan', shortcutsEnabled = () => true) {
  const stage = document.createElement('div');
  const world = document.createElement('div');
  stage.tabIndex = 0;
  stage.append(world);
  document.body.append(stage);
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
    x: 20,
    y: 30,
    left: 20,
    top: 30,
    right: 820,
    bottom: 630,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  const captured = new Set<number>();
  Object.assign(stage, {
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  });
  const controller: CanvasController = {
    attach: vi.fn(),
    detach: vi.fn(),
    destroy: vi.fn(),
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    registerNodeElement: vi.fn(),
    setPinned: vi.fn(),
    getMountedIds: () => new Set(),
    getDiagnostics: () => [],
    getBreakpoint: () => null,
    getLevel: () => 'dom',
    getOverviewMetrics: () => ({
      cachePixelBytes: 0,
      redraws: 0,
      cameraFrame: 0,
      presentedCameraFrame: 0,
      presentationLagFrames: [],
    }),
    getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
    setCamera: vi.fn(),
    panBy: vi.fn(),
    zoomAt: vi.fn(),
    fit: vi.fn(),
    reveal: vi.fn(),
    worldToScreen: (point) => point,
    screenToWorld: (point) => point,
    hitTest: () => null,
    setSelection: vi.fn(),
    getSelection: () => [],
    focusNode: vi.fn(async () => {}),
    getFocus: () => null,
    getOutline: () => [],
    setPointerMode: vi.fn(),
    handleKey: vi.fn(() => false),
    setActiveFrame: vi.fn(),
    getActiveFrame: () => null,
    deactivateFrame: vi.fn(),
    on: () => () => {},
  };
  const binding = bindInput({ stage, world }, controller, () => mode, shortcutsEnabled);
  cleanups.push(() => binding.dispose());
  return { stage, world, controller, binding };
}

function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  id = 1,
  pointerType = 'mouse',
  button = 0,
) {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType } });
  target.dispatchEvent(event);
  return event;
}

function key(target: Element, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}

describe('wheel input', () => {
  it.each([
    [0, { x: 2, y: -3 }],
    [1, { x: 32, y: -48 }],
    [2, { x: 1200, y: -1800 }],
  ])('normalizes delta mode %s', (deltaMode, expected) => {
    expect(normalizeWheel({ deltaX: 2, deltaY: -3, deltaMode }, 600)).toEqual(expected);
  });

  it('pans using screen deltas and suppresses stage scrolling only', () => {
    const { stage, controller } = surface();
    const wheel = new WheelEvent('wheel', {
      deltaX: 2,
      deltaY: 3,
      deltaMode: 1,
      bubbles: true,
      cancelable: true,
    });
    stage.dispatchEvent(wheel);
    expect(controller.panBy).toHaveBeenCalledWith(32, 48);
    expect(wheel.defaultPrevented).toBe(true);
    const outside = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true });
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    expect(controller.panBy).toHaveBeenCalledTimes(1);
  });

  it.each(['ctrlKey', 'metaKey'])('zooms at a stage-relative pointer with %s', (modifier) => {
    const { stage, controller } = surface();
    stage.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 3,
        deltaMode: 1,
        clientX: 120,
        clientY: 230,
        [modifier]: true,
        cancelable: true,
      }),
    );
    expect(controller.zoomAt).toHaveBeenCalledWith(0.8, { x: 100, y: 200 });
    expect(controller.panBy).not.toHaveBeenCalled();
  });

  it.each([
    [0, 4, Math.exp(-0.04)],
    [0, 100, 0.8],
    [0, -100, 1.25],
    [1, 1, Math.exp(-0.16)],
    [1, 3, 0.8],
    [1, -3, 1.25],
    [2, 0.01, Math.exp(-0.06)],
    [2, 1, 0.8],
    [2, -1, 1.25],
  ])('applies the zoom curve for delta mode %s and deltaY %s', (deltaMode, deltaY, factor) => {
    const { stage, controller } = surface();
    stage.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        deltaMode,
        ctrlKey: true,
        clientX: 120,
        clientY: 230,
        cancelable: true,
      }),
    );
    expect(controller.zoomAt).toHaveBeenCalledWith(factor, { x: 100, y: 200 });
    expect(controller.panBy).not.toHaveBeenCalled();
  });

  it('measures the stage once per wheel burst and again after a resize or scroll', () => {
    const { stage, controller } = surface();
    const measure = vi.mocked(stage.getBoundingClientRect);
    const wheel = (timeStamp: number, ctrlKey = true) => {
      const event = new WheelEvent('wheel', {
        deltaY: 1,
        ctrlKey,
        clientX: 120,
        clientY: 230,
        cancelable: true,
      });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      stage.dispatchEvent(event);
    };
    measure.mockClear();
    for (let index = 0; index < 20; index++) wheel(1000 + index * 8, index % 2 === 0);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(controller.zoomAt).toHaveBeenLastCalledWith(Math.exp(-0.01), { x: 100, y: 200 });
    wheel(1500);
    expect(measure).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('resize'));
    wheel(1508);
    expect(measure).toHaveBeenCalledTimes(3);
    document.body.dispatchEvent(new Event('scroll'));
    wheel(1516);
    expect(measure).toHaveBeenCalledTimes(4);
    wheel(1524);
    expect(measure).toHaveBeenCalledTimes(4);
  });
});

describe('pointer and keyboard ownership', () => {
  it('moves world content naturally for wheel and pointer drag at the current zoom', () => {
    const { stage, world, binding } = surface();
    binding.dispose();
    const controller = createCanvas({ label: 'Input integration' });
    cleanups.push(() => controller.destroy());
    controller.attach({ stage, world });
    controller.setCamera({ x: 0, y: 0, zoom: 2 });
    stage.dispatchEvent(new WheelEvent('wheel', { deltaX: 20, deltaY: 40, cancelable: true }));
    expect(controller.getCamera()).toEqual({ x: 10, y: 20, zoom: 2 });
    expect(controller.worldToScreen({ x: 0, y: 0 })).toEqual({ x: -20, y: -40 });
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 140, 160);
    expect(controller.getCamera()).toEqual({ x: -10, y: -10, zoom: 2 });
    expect(controller.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 20, y: 20 });
  });

  it('captures a pan and releases it on completion', () => {
    const { stage, controller } = surface();
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 135, 150);
    expect(stage.setPointerCapture).toHaveBeenCalledWith(1);
    expect(controller.panBy).toHaveBeenCalledWith(-35, -50);
    pointer(stage, 'pointerup', 135, 150);
    expect(stage.releasePointerCapture).toHaveBeenCalledWith(1);
    pointer(stage, 'pointermove', 200, 200);
    expect(controller.panBy).toHaveBeenCalledTimes(1);
  });

  it('leaves left drag alone in none mode and middle drag always pans', () => {
    const { stage, controller } = surface('none');
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 130, 150);
    expect(controller.panBy).not.toHaveBeenCalled();
    pointer(stage, 'pointerdown', 100, 100, 2, 'mouse', 1);
    pointer(stage, 'pointermove', 130, 150, 2);
    expect(controller.panBy).toHaveBeenCalledWith(-30, -50);
  });

  it.each(['pan', 'none'] as const)('uses Space while the stage is focused in %s mode', (mode) => {
    const { stage, controller } = surface(mode);
    stage.focus();
    expect(key(stage, ' ').defaultPrevented).toBe(true);
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 130, 150);
    expect(controller.panBy).toHaveBeenCalledWith(-30, -50);
    pointer(stage, 'pointerup', 130, 150);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    if (mode === 'none') {
      pointer(stage, 'pointerdown', 100, 100);
      pointer(stage, 'pointermove', 200, 200);
      expect(controller.panBy).toHaveBeenCalledTimes(1);
    }
  });

  it('guards Space pan focus and composition and keeps it available with shortcuts disabled', () => {
    const { stage, controller } = surface('none');
    expect(key(stage, ' ').defaultPrevented).toBe(false);
    stage.focus();
    expect(key(stage, ' ', { isComposing: true }).defaultPrevented).toBe(false);
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 200, 200);
    expect(controller.panBy).not.toHaveBeenCalled();
    const disabled = surface('none', () => false);
    disabled.stage.focus();
    expect(key(disabled.stage, ' ').defaultPrevented).toBe(true);
    pointer(disabled.stage, 'pointerdown', 100, 100);
    pointer(disabled.stage, 'pointermove', 200, 200);
    expect(disabled.controller.panBy).toHaveBeenCalledWith(-100, -100);
    expect(key(disabled.stage, '+').defaultPrevented).toBe(false);
    expect(disabled.controller.handleKey).toHaveBeenCalledTimes(1);
  });

  it('clears held Space when focus moves from the stage to an editor', () => {
    const { stage, controller } = surface('none');
    const editor = document.createElement('input');
    stage.append(editor);
    stage.focus();
    key(stage, ' ');
    editor.focus();
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 150, 150);
    expect(controller.panBy).not.toHaveBeenCalled();
  });

  it('keeps Space inactive throughout composition even without a key event flag', () => {
    const { stage, controller } = surface('none');
    stage.focus();
    stage.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(key(stage, ' ').defaultPrevented).toBe(false);
    expect(key(stage, '+').defaultPrevented).toBe(false);
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 140, 150);
    expect(controller.panBy).not.toHaveBeenCalled();
    expect(controller.handleKey).not.toHaveBeenCalled();
    stage.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(key(stage, ' ').defaultPrevented).toBe(true);
    pointer(stage, 'pointerdown', 100, 100);
    pointer(stage, 'pointermove', 140, 150);
    expect(controller.panBy).toHaveBeenCalledWith(-40, -50);
  });

  it('recognizes a focused editor inside a same-origin iframe', () => {
    const { stage } = surface();
    const frame = document.createElement('iframe');
    stage.append(frame);
    const embedded = frame.contentDocument;
    if (!embedded) throw new Error('Test iframe has no document');
    const editor = embedded.createElement('input');
    embedded.body.append(editor);
    editor.focus();
    const event = new KeyboardEvent('keydown', { key: '+' });
    stage.dispatchEvent(event);
    expect(isEditable(event)).toBe(true);
  });

  it('only prevents keys consumed by the controller', () => {
    const { stage, controller } = surface();
    vi.mocked(controller.handleKey).mockImplementation((event) => event.key === '0');
    expect(key(stage, '0').defaultPrevented).toBe(true);
    expect(key(stage, 'x').defaultPrevented).toBe(false);
    expect(key(stage, '+', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(stage, '+', { metaKey: true }).defaultPrevented).toBe(false);
  });

  it.each(['input', 'textarea', 'select', 'div'] as const)(
    'guards editable %s targets and focused editors',
    (tag) => {
      const { stage, controller } = surface('none');
      const editor = document.createElement(tag);
      if (tag === 'div') {
        editor.contentEditable = 'true';
        editor.setAttribute('contenteditable', 'true');
        editor.tabIndex = 0;
      }
      stage.append(editor);
      editor.focus();
      expect(key(editor, ' ').defaultPrevented).toBe(false);
      expect(key(stage, '+').defaultPrevented).toBe(false);
      expect(controller.handleKey).not.toHaveBeenCalled();
      const event = new KeyboardEvent('keydown', { key: '+' });
      editor.dispatchEvent(event);
      expect(isEditable(event)).toBe(true);
    },
  );

  it('clears drag and Space state after window blur and removes listeners on disposal', () => {
    const { stage, controller, binding } = surface('none');
    stage.focus();
    key(stage, ' ');
    pointer(stage, 'pointerdown', 10, 10);
    window.dispatchEvent(new Event('blur'));
    pointer(stage, 'pointermove', 100, 100);
    expect(controller.panBy).not.toHaveBeenCalled();
    binding.dispose();
    const wheel = new WheelEvent('wheel', { deltaY: 10, cancelable: true });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});

describe('touch and Safari gestures', () => {
  it.each(['button', 'a', 'div'] as const)('preserves native touch on a %s control', (tag) => {
    const { stage, world, controller } = surface();
    const control = document.createElement(tag);
    if (tag === 'div') control.setAttribute('role', 'button');
    stage.append(control);
    const event = pointer(control, 'pointerdown', 100, 100, 1, 'touch');
    pointer(control, 'pointermove', 120, 130, 1, 'touch');
    expect(event.defaultPrevented).toBe(false);
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    expect(controller.panBy).not.toHaveBeenCalled();
    const card = document.createElement('article');
    card.setAttribute('role', 'button');
    card.setAttribute('data-canvas-node-id', 'card');
    card.append(control);
    world.append(card);
    expect(pointer(control, 'pointerdown', 100, 100, 2, 'touch').defaultPrevented).toBe(false);
    pointer(control, 'pointermove', 120, 130, 2, 'touch');
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    expect(controller.panBy).not.toHaveBeenCalled();
  });

  it.each(['pan', 'none'] as const)('follows %s mode with one touch', (mode) => {
    const { stage, controller } = surface(mode);
    pointer(stage, 'pointerdown', 100, 100, 1, 'touch');
    pointer(stage, 'pointermove', 120, 130, 1, 'touch');
    expect(controller.panBy).toHaveBeenCalledTimes(mode === 'pan' ? 1 : 0);
  });

  it('pans and pinches with two touches even in none mode', () => {
    const { stage, controller } = surface('none');
    pointer(stage, 'pointerdown', 100, 100, 1, 'touch');
    pointer(stage, 'pointerdown', 200, 100, 2, 'touch');
    pointer(stage, 'pointermove', 220, 100, 2, 'touch');
    expect(controller.panBy).toHaveBeenCalledWith(-10, 0);
    expect(controller.zoomAt).toHaveBeenCalledWith(1.2, { x: 140, y: 70 });
    pointer(stage, 'pointercancel', 220, 100, 2, 'touch');
    pointer(stage, 'pointermove', 110, 100, 1, 'touch');
    expect(controller.panBy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['html', 'pan'],
    ['html', 'none'],
    ['svg', 'pan'],
    ['svg', 'none'],
  ] as const)('tracks touch on %s node buttons in %s mode', (worldType, mode) => {
    const { stage, world, controller } = surface(mode);
    const card =
      worldType === 'html'
        ? document.createElement('article')
        : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    card.setAttribute('role', 'button');
    card.setAttribute('data-canvas-node-id', 'card');
    world.append(card);
    pointer(card, 'pointerdown', 100, 100, 1, 'touch');
    pointer(stage, 'pointermove', 120, 130, 1, 'touch');
    if (mode === 'pan') expect(controller.panBy).toHaveBeenCalledExactlyOnceWith(-20, -30);
    else expect(controller.panBy).not.toHaveBeenCalled();
    pointer(card, 'pointerdown', 220, 130, 2, 'touch');
    pointer(stage, 'pointermove', 240, 130, 2, 'touch');
    expect(controller.panBy).toHaveBeenLastCalledWith(-10, 0);
    expect(controller.zoomAt).toHaveBeenCalledExactlyOnceWith(1.2, { x: 160, y: 100 });
  });

  it.each(['mouse', 'touch'])(
    'does not reveal pointer focus during a %s gesture',
    (pointerType) => {
      const { stage, world, binding } = surface();
      binding.dispose();
      const controller = createCanvas({ label: 'Gesture focus', motion: 'none' });
      cleanups.push(() => controller.destroy());
      controller.attach({ stage, world });
      controller.setNodes([{ id: 'covered', bounds: { x: 900, y: 700, width: 100, height: 100 } }]);
      const card = document.createElement('article');
      card.setAttribute('role', 'button');
      world.append(card);
      controller.registerNodeElement('covered', card);
      pointer(stage, 'pointerdown', 100, 100, 1, pointerType);
      const before = controller.getCamera();
      card.focus({ preventScroll: true });
      expect(controller.getFocus()).toBe('covered');
      expect(controller.getCamera()).toEqual(before);
      pointer(stage, 'pointermove', 120, 130, 1, pointerType);
      expect(controller.getCamera()).toEqual({ x: -20, y: -30, zoom: 1 });
      pointer(stage, 'pointerup', 120, 130, 1, pointerType);
      stage.focus();
      card.focus({ preventScroll: true });
      expect(controller.getCamera()).toEqual({ x: 212, y: 212, zoom: 1 });
    },
  );

  it('registers Safari gestures only when the browser supports them', () => {
    const unsupported = surface();
    const absent = new Event('gesturestart', { cancelable: true });
    unsupported.stage.dispatchEvent(absent);
    expect(absent.defaultPrevented).toBe(false);
    Object.defineProperty(window, 'GestureEvent', { value: Event, configurable: true });
    cleanups.push(() => {
      Reflect.deleteProperty(window, 'GestureEvent');
    });
    const { stage, controller } = surface();
    stage.dispatchEvent(new Event('gesturestart', { cancelable: true }));
    for (const scale of [1.5, 3]) {
      const event = new Event('gesturechange', { cancelable: true });
      Object.assign(event, { scale, clientX: 120, clientY: 130 });
      stage.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(controller.zoomAt).toHaveBeenNthCalledWith(1, 1.5, { x: 100, y: 100 });
    expect(controller.zoomAt).toHaveBeenNthCalledWith(2, 2, { x: 100, y: 100 });
  });
});

describe('embedded frame lifecycle', () => {
  function setup(tabIndex: number | null = 2) {
    const { stage, world } = surface();
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-canvas-node-id', 'preview');
    const frame = document.createElement('iframe');
    frame.style.pointerEvents = 'painted';
    if (tabIndex !== null) frame.tabIndex = tabIndex;
    wrapper.append(frame);
    world.append(wrapper);
    const nodes: CanvasNode[] = [
      { id: 'preview', bounds: { x: 0, y: 0, width: 200, height: 100 }, frame: true },
    ];
    const deactivate = vi.fn();
    const getNodes = vi.fn(() => nodes);
    const frames = createFrames({ stage, world }, getNodes, deactivate);
    cleanups.push(() => frames.dispose());
    return { stage, wrapper, frame, frames, deactivate, nodes, getNodes };
  }

  it('positions an active Done control without rescanning nodes or iframes on camera frames', () => {
    const { stage, wrapper, frames, getNodes } = setup();
    const bounds = vi
      .spyOn(wrapper, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(200, 80, 300, 200));
    frames.setActive('preview');
    const done = stage.querySelector<HTMLButtonElement>('[data-canvas-frame-done]');
    if (!done) throw new Error('Done control is missing');
    expect(done.style.left).toBe('420px');
    expect(done.style.top).toBe('50px');
    const queries = vi.spyOn(stage, 'querySelectorAll');
    getNodes.mockClear();
    bounds.mockReturnValue(new DOMRect(100, 60, 300, 200));
    frames.updatePosition();
    expect(done.style.left).toBe('320px');
    expect(done.style.top).toBe('30px');
    expect(queries).not.toHaveBeenCalled();
    expect(getNodes).not.toHaveBeenCalled();
  });

  it('does not mutate unchanged Done or iframe state on refresh or position updates', async () => {
    const { stage, frame, frames } = setup(null);
    frames.setActive('preview');
    const done = stage.querySelector<HTMLButtonElement>('[data-canvas-frame-done]');
    if (!done) throw new Error('Done control is missing');
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(done, { attributes: true });
    observer.observe(frame, { attributes: true });
    try {
      frames.refresh();
      frames.updatePosition();
      frames.setActive('preview');
      frames.setMoving(false);
      await Promise.resolve();
      expect(mutations).toEqual([]);
      frames.setMoving(true);
      await Promise.resolve();
      expect(frame.style.pointerEvents).toBe('none');
      expect(frame.tabIndex).toBe(-1);
      mutations.length = 0;
      frames.refresh();
      frames.setMoving(true);
      await Promise.resolve();
      expect(mutations).toEqual([]);
    } finally {
      observer.disconnect();
    }
  });

  it('shields inactive and moving frames and restores product styles on disposal', () => {
    const { stage, frame, frames } = setup();
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame.tabIndex).toBe(-1);
    frames.setActive('preview');
    expect(frame.style.pointerEvents).toBe('auto');
    expect(frame.tabIndex).toBe(2);
    const done = stage.querySelector<HTMLButtonElement>('[data-canvas-frame-done]');
    expect(done?.hidden).toBe(false);
    expect(done?.tabIndex).toBe(0);
    frames.setMoving(true);
    expect(frame.style.pointerEvents).toBe('none');
    frames.setMoving(false);
    expect(frame.style.pointerEvents).toBe('auto');
    frames.dispose();
    expect(frame.style.pointerEvents).toBe('painted');
    expect(frame.tabIndex).toBe(2);
    expect(stage.querySelector('[data-canvas-frame-done]')).toBeNull();
  });

  it('keeps Done and outside clicks in the host when the iframe is focused', () => {
    const { stage, wrapper, frame, frames, deactivate } = setup();
    frames.setActive('preview');
    frame.focus();
    pointer(wrapper, 'pointerdown', 1, 1);
    expect(deactivate).not.toHaveBeenCalled();
    const done = stage.querySelector<HTMLButtonElement>('[data-canvas-frame-done]');
    done?.focus();
    expect(document.activeElement).toBe(done);
    done?.click();
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(stage);
    frame.focus();
    pointer(document.body, 'pointerdown', 1, 1);
    expect(deactivate).toHaveBeenCalledTimes(2);
    frames.setActive(null);
    expect(done?.hidden).toBe(true);
  });

  it('leaves touch Done activation to its host button', () => {
    const { stage, frames, deactivate } = setup();
    frames.setActive('preview');
    const done = stage.querySelector<HTMLButtonElement>('[data-canvas-frame-done]');
    if (!done) throw new Error('Done control is missing');
    const event = pointer(done, 'pointerdown', 100, 100, 1, 'touch');
    expect(event.defaultPrevented).toBe(false);
    expect(stage.setPointerCapture).not.toHaveBeenCalled();
    done.click();
    expect(deactivate).toHaveBeenCalledOnce();
  });

  it('restores a removed frame and an iframe with no original tabindex', () => {
    const { frame, frames, nodes } = setup(null);
    frames.setActive('preview');
    expect(frame.hasAttribute('tabindex')).toBe(false);
    nodes.splice(0);
    frames.refresh();
    expect(frame.style.pointerEvents).toBe('painted');
    expect(frame.hasAttribute('tabindex')).toBe(false);
  });

  it('shields a frame inserted after its metadata is registered', async () => {
    const { stage, world, binding } = surface();
    binding.dispose();
    const controller = createCanvas({ label: 'Deferred frame rendering' });
    cleanups.push(() => controller.destroy());
    controller.attach({ stage, world });
    controller.setNodes([
      { id: 'deferred', bounds: { x: 0, y: 0, width: 100, height: 100 }, frame: true },
    ]);
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-canvas-node-id', 'deferred');
    const frame = document.createElement('iframe');
    wrapper.append(frame);
    stage.append(wrapper);
    await Promise.resolve();
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame.tabIndex).toBe(-1);
    wrapper.remove();
    await Promise.resolve();
    expect(frame.style.pointerEvents).toBe('');
    expect(frame.hasAttribute('tabindex')).toBe(false);
  });

  it('applies the active and moving states to an iframe inserted later', async () => {
    const { wrapper, frames } = setup();
    wrapper.replaceChildren();
    frames.setActive('preview');
    const frame = document.createElement('iframe');
    wrapper.append(frame);
    await Promise.resolve();
    expect(frame.style.pointerEvents).toBe('auto');
    expect(frame.hasAttribute('tabindex')).toBe(false);
    frame.remove();
    await Promise.resolve();
    frames.setMoving(true);
    wrapper.append(frame);
    await Promise.resolve();
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame.tabIndex).toBe(-1);
  });

  it('disconnects DOM observation on disposal', async () => {
    const { stage, wrapper, frames } = setup();
    const query = vi.spyOn(stage, 'querySelectorAll');
    frames.dispose();
    const frame = document.createElement('iframe');
    wrapper.append(frame);
    await Promise.resolve();
    expect(query).not.toHaveBeenCalled();
    expect(frame.style.pointerEvents).toBe('');
    expect(frame.hasAttribute('tabindex')).toBe(false);
  });
});
