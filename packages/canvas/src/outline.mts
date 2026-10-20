import { invalid } from './camera.mjs';
import type { CanvasNode, CanvasOptions, NodeId } from './types.mjs';

export function createOutline(
  nodes: readonly CanvasNode[],
  order?: CanvasOptions['outlineOrder'],
): readonly NodeId[] {
  if (!order)
    return Object.freeze(
      [...nodes]
        .sort(
          (a, b) =>
            a.bounds.y - b.bounds.y ||
            a.bounds.x - b.bounds.x ||
            a.id.localeCompare(b.id, undefined, { numeric: true }),
        )
        .map((node) => node.id),
    );
  const result = order(nodes.map((node) => ({ ...node, bounds: { ...node.bounds } })));
  const ids = new Set(nodes.map((node) => node.id));
  if (
    !Array.isArray(result) ||
    result.length !== nodes.length ||
    new Set(result).size !== nodes.length ||
    result.some((id) => !ids.has(id))
  )
    invalid('outlineOrder', result);
  return Object.freeze([...result]);
}
