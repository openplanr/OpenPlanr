// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFrameLoader } from '../src/frame-loader.mjs';
import type { CanvasNode } from '../src/types.mjs';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function setup(count = 15) {
  const stage = document.createElement('div');
  const world = document.createElement('div');
  stage.append(world);
  document.body.append(stage);
  const nodes: CanvasNode[] = [];
  const frames = new Map<string, HTMLIFrameElement>();
  for (let index = count - 1; index >= 0; index -= 1) {
    const id = `frame-${index}`;
    nodes.push({ id, bounds: { x: index * 100, y: 0, width: 80, height: 60 }, frame: true });
    const wrapper = document.createElement('article');
    wrapper.setAttribute('data-canvas-node-id', id);
    const frame = document.createElement('iframe');
    frame.setAttribute('srcdoc', `<p>${id}</p>`);
    wrapper.append(frame);
    world.append(wrapper);
    frames.set(id, frame);
  }
  let mounted = new Set(nodes.map((node) => node.id));
  let budget = 10;
  const loader = createFrameLoader(
    { stage, world },
    () => nodes,
    () => mounted,
    () => ({ x: 0, y: 0 }),
    () => budget,
  );
  cleanups.push(() => loader.dispose());
  return {
    stage,
    world,
    nodes,
    frames,
    loader,
    setMounted(ids: string[]) {
      mounted = new Set(ids);
      loader.refresh();
    },
    setBudget(value: number) {
      budget = value;
      loader.refresh();
    },
  };
}

function complete(frames: Map<string, HTMLIFrameElement>, id: string) {
  const frame = frames.get(id);
  if (!frame) throw new Error(`Test frame ${id} does not exist`);
  frame.dispatchEvent(new Event('load'));
}

describe('frame boot scheduling', () => {
  it('boots one at a time nearest first, caps live frames and renders Load tiles', () => {
    const { stage, frames, loader } = setup();
    expect([...loader.getLiveIds()]).toEqual(['frame-0']);
    for (let index = 0; index < 10; index += 1) {
      expect(stage.querySelectorAll('[data-canvas-frame-booting]')).toHaveLength(1);
      expect([...loader.getLiveIds()]).toEqual(
        Array.from({ length: index + 1 }, (_, item) => `frame-${item}`).reverse(),
      );
      complete(frames, `frame-${index}`);
    }
    expect(loader.getLiveIds().size).toBe(10);
    expect(stage.querySelectorAll('[data-canvas-frame-booting]')).toHaveLength(0);
    expect(stage.querySelectorAll('[data-canvas-frame-placeholder]')).toHaveLength(5);
    expect(stage.querySelectorAll('button[aria-label^="Load frame"]')).toHaveLength(5);
  });

  it('pauses new boots during a gesture and resumes in order', () => {
    const { frames, loader } = setup();
    loader.setMoving(true);
    complete(frames, 'frame-0');
    expect([...loader.getLiveIds()]).toEqual(['frame-0']);
    loader.refresh();
    expect(loader.getLiveIds().size).toBe(1);
    loader.setMoving(false);
    expect(new Set(loader.getLiveIds())).toEqual(new Set(['frame-0', 'frame-1']));
  });

  it('enforces desktop, tablet and phone live budgets', () => {
    const { frames, loader, setBudget } = setup();
    for (let index = 0; index < 10; index += 1) complete(frames, `frame-${index}`);
    setBudget(6);
    expect(loader.getLiveIds().size).toBe(6);
    setBudget(3);
    expect(loader.getLiveIds().size).toBe(3);
  });

  it('lets Load replace the farthest frame without exceeding the budget', () => {
    const { stage, frames, loader } = setup();
    for (let index = 0; index < 10; index += 1) complete(frames, `frame-${index}`);
    stage.querySelector<HTMLButtonElement>('[aria-label="Load frame frame-14"]')?.click();
    expect(loader.getLiveIds().has('frame-14')).toBe(true);
    expect(loader.getLiveIds().has('frame-9')).toBe(false);
    expect(loader.getLiveIds().size).toBe(10);
  });

  it('prioritizes a requested frame within the budget while gestures still pause its boot', () => {
    const { frames, loader } = setup();
    for (let index = 0; index < 10; index += 1) complete(frames, `frame-${index}`);
    loader.setMoving(true);
    loader.request('frame-14');
    expect(loader.getLiveIds().has('frame-14')).toBe(false);
    expect(loader.getLiveIds().has('frame-9')).toBe(false);
    expect(loader.getLiveIds().size).toBeLessThanOrEqual(10);
    loader.setMoving(false);
    expect(loader.getLiveIds().has('frame-14')).toBe(true);
    expect(loader.getLiveIds().size).toBe(10);
  });

  it('retains unmounted live frames for 180 seconds and expires them', () => {
    vi.useFakeTimers();
    const { frames, loader, setMounted, stage } = setup(1);
    complete(frames, 'frame-0');
    setMounted([]);
    expect(stage.querySelector('[data-canvas-frame-cache] iframe')).toBe(frames.get('frame-0'));
    vi.advanceTimersByTime(179_999);
    expect(loader.getLiveIds().has('frame-0')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(loader.getLiveIds().size).toBe(0);
  });

  it('keeps the live parent and browsing context across product unmount and remount', () => {
    const { world, frames, loader, setMounted } = setup(1);
    complete(frames, 'frame-0');
    const frame = frames.get('frame-0');
    const portal = frame?.parentElement;
    const context = frame?.contentWindow;
    const content = frame?.contentDocument;
    if (!frame || !portal || !context || !content)
      throw new Error('Live frame has no browsing context');
    content.body.setAttribute('data-retained-state', 'present');
    const source = frame.getAttribute('srcdoc');
    setMounted([]);
    world.querySelector('article')?.remove();
    expect(frame.isConnected).toBe(true);
    expect(portal.hidden).toBe(true);
    expect(frame.parentElement).toBe(portal);
    const wrapper = document.createElement('article');
    wrapper.setAttribute('data-canvas-node-id', 'frame-0');
    const replacement = document.createElement('iframe');
    wrapper.append(replacement);
    world.append(wrapper);
    setMounted(['frame-0']);
    expect(frame.parentElement).toBe(portal);
    expect(frame.contentWindow).toBe(context);
    expect(frame.contentDocument).toBe(content);
    expect(frame.contentDocument?.body.getAttribute('data-retained-state')).toBe('present');
    expect(frame.getAttribute('srcdoc')).toBe(source);
    expect(portal.hidden).toBe(false);
    expect(replacement.isConnected).toBe(false);
    expect(world.querySelectorAll('iframe')).toHaveLength(1);
    expect([...loader.getLiveIds()]).toEqual(['frame-0']);
  });

  it('updates live portal geometry without changing the frame parent', () => {
    const { nodes, frames, loader } = setup(1);
    const portal = frames.get('frame-0')?.parentElement;
    if (!portal) throw new Error('Live frame portal is absent');
    expect(portal.style.left).toBe('0px');
    expect(portal.style.width).toBe('80px');
    nodes[0] = { id: 'frame-0', bounds: { x: 120, y: 240, width: 360, height: 180 }, frame: true };
    loader.refresh();
    expect(frames.get('frame-0')?.parentElement).toBe(portal);
    expect(portal.style.left).toBe('120px');
    expect(portal.style.top).toBe('240px');
    expect(portal.style.width).toBe('360px');
    expect(portal.style.height).toBe('180px');
  });

  it('restores an iframe that is its own product node on disposal', () => {
    const stage = document.createElement('div');
    const world = document.createElement('div');
    const frame = document.createElement('iframe');
    frame.setAttribute('data-canvas-node-id', 'own-frame');
    frame.setAttribute('srcdoc', '<p>Own frame</p>');
    frame.style.cssText = 'position: absolute; left: 15px; top: 25px; width: 120px; height: 80px';
    const style = frame.getAttribute('style');
    world.append(frame);
    stage.append(world);
    document.body.append(stage);
    const loader = createFrameLoader(
      { stage, world },
      () => [{ id: 'own-frame', bounds: { x: 15, y: 25, width: 120, height: 80 }, frame: true }],
      () => new Set(['own-frame']),
      () => ({ x: 0, y: 0 }),
      () => 10,
    );
    cleanups.push(() => loader.dispose());
    expect(frame.parentElement?.getAttribute('data-canvas-frame-portal')).toBe('own-frame');
    expect(frame.style.left).toBe('0px');
    loader.dispose();
    expect(frame.parentElement).toBe(world);
    expect(frame.getAttribute('style')).toBe(style);
    expect(frame.getAttribute('srcdoc')).toBe('<p>Own frame</p>');
    expect(world.querySelector('[data-canvas-frame-cache]')).toBeNull();
    expect(world.childNodes).toHaveLength(1);
  });

  it('reclaims a retained slot for a newly mounted frame', () => {
    const { frames, loader, setMounted, setBudget } = setup(2);
    setBudget(1);
    complete(frames, 'frame-0');
    setMounted(['frame-1']);
    expect([...loader.getLiveIds()]).toEqual(['frame-1']);
  });

  it('surfaces load failures in the tile and proceeds to the next frame', () => {
    const { frames, loader, stage } = setup(2);
    frames.get('frame-0')?.dispatchEvent(new Event('error'));
    expect(stage.querySelector('[role="status"]')?.textContent).toContain(
      'Frame frame-0 failed to load',
    );
    expect([...loader.getLiveIds()]).toEqual(['frame-1']);
  });

  it('restores deferred iframe sources on disposal', () => {
    const { frames, loader, stage } = setup(2);
    loader.dispose();
    expect(stage.querySelectorAll('[data-canvas-frame-placeholder]')).toHaveLength(0);
    expect(frames.get('frame-1')?.getAttribute('srcdoc')).toBe('<p>frame-1</p>');
    expect(frames.get('frame-0')?.hasAttribute('data-canvas-frame-live')).toBe(false);
  });
});
