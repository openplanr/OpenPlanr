// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { observeTransformWrites } from '../bench/transform-writes';

const observers: ReturnType<typeof observeTransformWrites>[] = [];
afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
});

describe('bench transform observations', () => {
  it('counts HTML transform changes while ignoring unrelated styles in the same batch', async () => {
    const world = document.createElement('div');
    const frames: number[] = [];
    let frame = 1;
    observers.push(observeTransformWrites(world, () => frames.push(frame)));
    world.style.transformOrigin = '0 0';
    world.style.willChange = 'transform';
    world.style.transform = 'scale(1) translate(-3px, -4px)';
    world.style.willChange = '';
    await Promise.resolve();
    expect(frames).toEqual([1]);
    frame = 2;
    world.style.willChange = 'transform';
    world.style.transform = 'scale(1) translate(-6px, -8px)';
    await Promise.resolve();
    expect(frames).toEqual([1, 2]);
  });

  it('keeps two intermediate HTML writes visible even if the final transform equals the initial one', async () => {
    const world = document.createElement('div');
    world.style.transform = 'scale(1)';
    const writes: number[] = [];
    observers.push(observeTransformWrites(world, () => writes.push(1)));
    world.style.transform = 'scale(2)';
    world.style.willChange = 'transform';
    world.style.transform = 'scale(1)';
    await Promise.resolve();
    expect(writes).toHaveLength(2);
  });

  it('ignores redundant transforms and observes style replacement or removal', async () => {
    const world = document.createElement('div');
    world.style.transform = 'scale(1)';
    const writes: number[] = [];
    observers.push(observeTransformWrites(world, () => writes.push(1)));
    world.style.transform = 'scale(1)';
    world.setAttribute('style', 'color: red; transform: scale(1)');
    await Promise.resolve();
    expect(writes).toHaveLength(0);
    world.style.cssText = 'transform: scale(2); color: blue';
    world.removeAttribute('style');
    await Promise.resolve();
    expect(writes).toHaveLength(2);
  });

  it('counts HTML world and overlay independently without replacing native methods', async () => {
    const world = document.createElement('div');
    const overlay = document.createElement('div');
    const original = world.setAttribute;
    const writes = { world: 0, overlay: 0 };
    observers.push(
      observeTransformWrites(world, () => {
        writes.world += 1;
      }),
    );
    observers.push(
      observeTransformWrites(overlay, () => {
        writes.overlay += 1;
      }),
    );
    world.style.willChange = 'transform';
    world.style.transform = 'translate(-3px, -4px) scale(1)';
    overlay.style.transform = 'translate(-3px, -4px) scale(1)';
    world.style.transform = 'translate(-6px, -8px) scale(1)';
    world.style.transform = 'translate(-6px, -8px) scale(1)';
    await Promise.resolve();
    expect(writes).toEqual({ world: 2, overlay: 1 });
    expect(world.setAttribute).toBe(original);
  });

  it('flushes pending records exactly once and stops after disconnect', async () => {
    const world = document.createElement('div');
    const writes: number[] = [];
    const observer = observeTransformWrites(world, () => writes.push(1));
    observers.push(observer);
    world.style.transform = 'scale(2)';
    observer.flush();
    expect(writes).toHaveLength(1);
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    observer.disconnect();
    world.style.transform = 'scale(3)';
    await Promise.resolve();
    expect(writes).toHaveLength(1);
  });
});
