import { describe, expect, it } from 'vitest';
import { createSpatialGrid } from '../src/spatial-grid.mjs';
import type { Rect } from '../src/types.mjs';

describe('spatial grid', () => {
  it('matches brute-force intersection across 10,000 seeded rectangles', () => {
    let seed = 91827;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const rectangles = new Map<string, Rect>();
    const grid = createSpatialGrid();
    for (let index = 0; index < 10000; index += 1) {
      const bounds = {
        x: random() * 30000 - 15000,
        y: random() * 30000 - 15000,
        width: random() * 900,
        height: random() * 900,
      };
      rectangles.set(String(index), bounds);
      grid.set(String(index), bounds);
    }
    for (let index = 0; index < 100; index += 1) {
      const query = {
        x: random() * 30000 - 15000,
        y: random() * 30000 - 15000,
        width: random() * 3000,
        height: random() * 3000,
      };
      const expected = [...rectangles]
        .filter(
          ([, bounds]) =>
            bounds.x <= query.x + query.width &&
            bounds.x + bounds.width >= query.x &&
            bounds.y <= query.y + query.height &&
            bounds.y + bounds.height >= query.y,
        )
        .map(([id]) => id);
      expect(grid.query(query)).toEqual(new Set(expected));
    }
  });

  it('moves, removes and deduplicates nodes across negative and boundary cells', () => {
    const grid = createSpatialGrid(512);
    const bounds = { x: -512, y: -512, width: 1024, height: 1024 };
    expect(grid.set('wide', bounds)).toBe(true);
    expect(grid.set('wide', { ...bounds })).toBe(false);
    expect(grid.query({ x: 512, y: 512, width: 0, height: 0 })).toEqual(new Set(['wide']));
    grid.set('wide', { ...bounds, x: 2048 });
    expect(grid.query({ x: 0, y: 0, width: 10, height: 10 })).toEqual(new Set());
    expect(grid.query({ x: 2200, y: 0, width: 10, height: 10 })).toEqual(new Set(['wide']));
    expect(grid.remove('wide')).toBe(true);
    expect(grid.remove('wide')).toBe(false);
    expect(grid.query({ x: -10000, y: -10000, width: 30000, height: 30000 })).toEqual(new Set());
  });

  it('queries huge rectangles without allocating a cell for every world position', () => {
    const grid = createSpatialGrid();
    grid.set('large', { x: -1e12, y: -1e12, width: 2e12, height: 2e12 });
    grid.set('small', { x: 20, y: 20, width: 10, height: 10 });
    expect(grid.query({ x: 0, y: 0, width: 100, height: 100 })).toEqual(
      new Set(['large', 'small']),
    );
    grid.set('distant', { x: 1e20, y: 1e20, width: 0, height: 0 });
    expect(grid.query({ x: 1e20, y: 1e20, width: 0, height: 0 })).toEqual(new Set(['distant']));
    grid.clear();
    expect(grid.query({ x: 0, y: 0, width: 100, height: 100 })).toEqual(new Set());
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid cell size %s', (cellSize) => {
    expect(() => createSpatialGrid(cellSize)).toThrow(/culling.cellSize/u);
  });
});
