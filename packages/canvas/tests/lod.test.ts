import { describe, expect, it } from 'vitest';
import { createCanvas } from '../src/controller.mjs';
import { createLod } from '../src/lod.mjs';
import type { CanvasOptions } from '../src/types.mjs';

describe('level hysteresis', () => {
  it('switches only outside both bands, including jumps over both levels', () => {
    const lod = createLod(undefined);
    for (const [zoom, level] of [
      [0.6, 'dom'],
      [0.57, 'dom'],
      [0.569, 'compact'],
      [0.6, 'compact'],
      [0.63, 'compact'],
      [0.631, 'dom'],
      [0.36, 'overview'],
      [0.37, 'overview'],
      [0.4, 'overview'],
      [0.43, 'overview'],
      [0.431, 'compact'],
      [0.37, 'compact'],
      [0.369, 'overview'],
      [1, 'dom'],
    ] as const)
      expect(lod.update(zoom), String(zoom)).toBe(level);
  });

  it('makes exactly twenty transitions per band despite jitter', () => {
    for (const [low, high, center] of [
      [0.36, 0.44, 0.4],
      [0.56, 0.64, 0.6],
    ]) {
      const lod = createLod(undefined);
      lod.update(high);
      let switches = 0;
      let previous = lod.get();
      for (let crossing = 0; crossing < 20; crossing += 1) {
        for (const zoom of [
          center - 0.01,
          center + 0.01,
          crossing % 2 ? high : low,
          center,
          center - 0.01,
        ]) {
          const next = lod.update(zoom);
          if (next !== previous) switches += 1;
          previous = next;
        }
      }
      expect(switches).toBe(20);
    }
  });

  it('supports custom bands and disabling all detail switches', () => {
    const lod = createLod({ compactBelow: 0.8, overviewBelow: 0.2, hysteresis: 0.01 });
    expect(lod.update(0.78)).toBe('compact');
    expect(lod.update(0.18)).toBe('overview');
    expect(lod.update(0.22)).toBe('compact');
    expect(lod.update(0.82)).toBe('dom');
    const disabled = createLod(false);
    expect(disabled.update(0.01)).toBe('dom');
    expect(disabled.update(2)).toBe('dom');
  });
});

describe('level validation and detached state', () => {
  it.each([
    [{ lod: null }, 'lod', 'null'],
    [{ lod: true }, 'lod', 'true'],
    [{ lod: [] }, 'lod', ''],
    [{ lod: { compactBelow: NaN } }, 'lod.compactBelow', 'NaN'],
    [{ lod: { overviewBelow: -1 } }, 'lod.overviewBelow', '-1'],
    [{ lod: { hysteresis: Infinity } }, 'lod.hysteresis', 'Infinity'],
    [{ lod: { hysteresis: -1 } }, 'lod.hysteresis', '-1'],
    [{ lod: { overviewBelow: 0.7 } }, 'lod.overviewBelow', '0.7'],
    [{ lod: { hysteresis: 0.4 } }, 'lod.hysteresis', '0.4'],
    [{ overviewStyle: 'bad' }, 'overviewStyle', 'bad'],
    [{ overviewRenderer: 'bad' }, 'overviewRenderer', 'bad'],
  ])('names the invalid option and value for %j', (patch, field, value) => {
    const options = { label: 'Invalid level', ...patch } as unknown as CanvasOptions;
    expect(() => createCanvas(options)).toThrow(TypeError);
    expect(() => createCanvas(options)).toThrow(new RegExp(`${field}.*${value}`, 'u'));
  });

  it('reports level and full detail pins without a browser', () => {
    const controller = createCanvas({ label: 'Detached detail' });
    controller.setNodes([{ id: 'a', bounds: { x: 0, y: 0, width: 10, height: 10 } }]);
    controller.setCamera({ x: 0, y: 0, zoom: 0.4 });
    expect(controller.getLevel()).toBe('compact');
    controller.setPinned('editing', ['a']);
    expect(controller.getLevel('a')).toBe('dom');
    controller.setCamera({ x: 0, y: 0, zoom: 0.36 });
    expect(controller.getLevel()).toBe('overview');
    expect(controller.getLevel('a')).toBe('dom');
    expect(() => controller.getLevel('missing')).toThrow(/id.*missing/u);
    controller.destroy();
    expect(() => controller.getLevel()).toThrow('Canvas controller is destroyed');
    expect(() => controller.getOverviewMetrics()).toThrow('Canvas controller is destroyed');
  });
});
