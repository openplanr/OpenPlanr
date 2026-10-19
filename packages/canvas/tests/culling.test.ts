import { describe, expect, it } from 'vitest';
import { createCulling } from '../src/culling.mjs';
import type { CanvasNode, Rect } from '../src/types.mjs';

const viewport: Rect = { x: 0, y: 0, width: 800, height: 600 };
const node = (id: string, x = 0, y = 0): CanvasNode => ({
  id,
  bounds: { x, y, width: 40, height: 40 },
});
const entries = (values: readonly CanvasNode[]) =>
  new Map(values.map((value) => [value.id, value]));

describe('mounted region', () => {
  it('retains the mounted set and cached region while panning inside it', () => {
    const culling = createCulling();
    culling.setNodes(entries([node('origin'), node('margin', -350), node('outside', -450)]));
    expect(culling.update(viewport, 0, false, false).mount?.mounted).toEqual(['origin', 'margin']);
    const region = culling.getRegion();
    expect(region).toEqual({ x: -400, y: -300, width: 1600, height: 1200 });
    expect(culling.update({ ...viewport, x: 300 }, 16, false, false).mount).toBeUndefined();
    expect(culling.getRegion()).toBe(region);
    const delta = culling.update({ ...viewport, x: 401 }, 32, false, false).mount;
    expect(delta?.unmounted).toEqual(['margin']);
    expect(culling.getRegion()).not.toBe(region);
  });

  it('emits geometry without a mount event when a mounted node moves', () => {
    const culling = createCulling();
    culling.setNodes(entries([node('a')]));
    culling.update(viewport, 0, false, false);
    expect(culling.setNodes(entries([node('a', 50)]))).toEqual(['a']);
    expect(culling.update(viewport, 16, false, false)).toEqual({ geometry: ['a'], pending: false });
    expect(culling.setNodes(entries([node('a', 50)]))).toEqual([]);
    expect(culling.update(viewport, 32, false, false).geometry).toEqual([]);
  });

  it('keeps independent pin sources and all 500 offscreen pins', () => {
    const culling = createCulling();
    const values = Array.from({ length: 500 }, (_, index) => node(`pin-${index}`, 8000, index));
    culling.setNodes(entries(values));
    culling.setPinned('selection', ['pin-0']);
    culling.setPinned(
      'editing',
      values.map((value) => value.id),
    );
    const delta = culling.update(viewport, 0, true, true).mount;
    expect(new Set(delta?.mounted)).toEqual(new Set(values.map((value) => value.id)));
    expect(culling.getMountedIds()).toHaveLength(500);
    culling.setPinned('editing', []);
    expect(culling.update(viewport, 16, true, true).mount?.unmounted).toHaveLength(499);
    expect(culling.getMountedIds()).toEqual(['pin-0']);
    culling.setPinned('selection', []);
    expect(culling.update(viewport, 32, false, false).mount?.unmounted).toEqual(['pin-0']);
  });

  it('remounts 968 nodes over five frames with at most 200 optional mounts each', () => {
    const culling = createCulling();
    const values = Array.from({ length: 968 }, (_, index) =>
      node(String(index), (index % 44) * 20, Math.floor(index / 44) * 20),
    );
    culling.setNodes(entries(values));
    const chunks: number[] = [];
    for (let frame = 0; frame < 5; frame += 1) {
      const delta = culling.update(viewport, frame * 16, false, false);
      chunks.push(delta.mount?.mounted.length ?? 0);
      expect(delta.pending).toBe(frame < 4);
    }
    expect(chunks).toEqual([200, 200, 200, 200, 168]);
    expect(culling.getMountedIds()).toHaveLength(968);
  });

  it('admits nearest the stage centre first and defers remaining chunks until a gesture ends', () => {
    const culling = createCulling({ chunkSize: 1 });
    culling.setNodes(entries([node('far', -300), node('middle', 0), node('near', 380, 280)]));
    expect(culling.update(viewport, 0, true, false).mount?.mounted).toEqual(['near']);
    expect(culling.update(viewport, 16, true, false)).toEqual({ geometry: [], pending: false });
    expect(culling.update(viewport, 32, false, false).mount?.mounted).toEqual(['middle']);
    expect(culling.update(viewport, 48, false, false).mount?.mounted).toEqual(['far']);
  });

  it('freezes optional admissions until 120 milliseconds after the last zoom change', () => {
    const culling = createCulling();
    culling.setNodes(entries([node('a'), node('b', 10000), node('pin', -10000)]));
    culling.update(viewport, 0, false, false);
    const distant = { ...viewport, x: 10000 };
    const delta = culling.update(distant, 16, true, true);
    expect(delta.mount).toEqual({ mounted: [], unmounted: ['a'] });
    expect(delta.resumeAt).toBe(136);
    culling.setPinned('focus', ['pin']);
    culling.setNodes(entries([node('a'), node('b', 10020), node('pin', -10000)]));
    const during = culling.update(distant, 100, true, true);
    expect(during.mount?.mounted).toEqual(['pin']);
    expect(during.geometry).toEqual(['b']);
    expect(during.resumeAt).toBe(220);
    expect(culling.update(distant, 219, false, false).mount).toBeUndefined();
    expect(culling.update(distant, 220, false, false).mount?.mounted).toEqual(['b']);
  });

  it('prunes the region during zoom-in and removes deleted pins during a freeze', () => {
    const culling = createCulling();
    culling.setNodes(entries([node('near', 400, 300), node('far', -300)]));
    culling.setPinned('product', ['near']);
    culling.update(viewport, 0, false, false);
    const smaller = { x: 200, y: 150, width: 400, height: 300 };
    expect(culling.update(smaller, 16, true, true).mount?.unmounted).toEqual(['far']);
    culling.setNodes(entries([node('far', -300)]));
    expect(culling.update(smaller, 32, true, false).mount?.unmounted).toEqual(['near']);
    expect(culling.getMountedIds()).toEqual([]);
  });

  it('clears mounted and cached state on reset while preserving node and pin registrations', () => {
    const culling = createCulling();
    culling.setNodes(entries([node('pin', 8000)]));
    culling.setPinned('product', ['pin']);
    culling.update(viewport, 0, false, false);
    culling.reset();
    expect(culling.getRegion()).toBeUndefined();
    expect(culling.getMountedIds()).toEqual([]);
    expect(culling.update(viewport, 16, false, false).mount?.mounted).toEqual(['pin']);
  });
});
