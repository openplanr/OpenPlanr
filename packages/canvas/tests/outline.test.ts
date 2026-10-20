import { describe, expect, it, vi } from 'vitest';
import { createCanvas } from '../src/controller.mjs';
import { createOutline } from '../src/outline.mjs';
import type { CanvasNode, CanvasOptions } from '../src/types.mjs';

function node(id: string, x = 0, y = 0): CanvasNode {
  return { id, bounds: { x, y, width: 40, height: 40 } };
}

describe('canvas outline', () => {
  const nodes = [node('bottom', 0, 100), node('right', 100), node('n10'), node('n2')];

  it('sorts by top edge, left edge and numeric ID without changing input', () => {
    expect(createOutline(nodes)).toEqual(['n2', 'n10', 'right', 'bottom']);
    expect(nodes.map(({ id }) => id)).toEqual(['bottom', 'right', 'n10', 'n2']);
    expect(createOutline([])).toEqual([]);
  });

  it('uses a complete product order', () => {
    const order = vi.fn((values: readonly CanvasNode[]) => values.map(({ id }) => id));
    expect(createOutline(nodes, order)).toEqual(['bottom', 'right', 'n10', 'n2']);
    expect(order).toHaveBeenCalledExactlyOnceWith(nodes);
  });

  it.each([
    ['missing', ['n2', 'n10', 'right']],
    ['duplicate', ['n2', 'n2', 'right', 'bottom']],
    ['unknown', ['n2', 'n10', 'right', 'unknown']],
    ['extra', ['n2', 'n10', 'right', 'bottom', 'extra']],
    ['non-array', null],
  ])('rejects a %s product order with a field-specific TypeError', (_, result) => {
    const order = (() => result) as CanvasOptions['outlineOrder'];
    const call = () => createOutline(nodes, order);
    expect(call).toThrow(TypeError);
    expect(call).toThrow(/outlineOrder/u);
  });

  it('caches the product order until setNodes changes the geometry', () => {
    const outlineOrder = vi.fn((values: readonly CanvasNode[]) => values.map(({ id }) => id));
    const controller = createCanvas({ label: 'Outline', outlineOrder });
    try {
      controller.setNodes(nodes);
      expect(controller.getOutline()).toEqual(nodes.map(({ id }) => id));
      expect(controller.getOutline()).toEqual(nodes.map(({ id }) => id));
      expect(outlineOrder).toHaveBeenCalledTimes(1);
      controller.setNodes([node('changed')]);
      expect(controller.getOutline()).toEqual(['changed']);
      expect(outlineOrder).toHaveBeenCalledTimes(2);
    } finally {
      controller.destroy();
    }
  });

  it.each(['navigate', 'outlineOrder'] as const)('validates the %s option', (field) => {
    const options = { label: 'Invalid', [field]: 3 } as CanvasOptions;
    expect(() => createCanvas(options)).toThrow(TypeError);
    expect(() => createCanvas(options)).toThrow(new RegExp(field, 'u'));
  });
});
