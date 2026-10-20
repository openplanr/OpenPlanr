import { positive } from './camera.mjs';
import type { NodeId, Rect } from './types.mjs';

export function intersects(left: Rect, right: Rect): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

export function sameBounds(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function createSpatialGrid(cellSize = 512) {
  positive('culling.cellSize', cellSize);
  const bounds = new Map<NodeId, Rect>();
  const cells = new Map<string, Set<NodeId>>();
  const membership = new Map<NodeId, readonly string[]>();
  const spanning = new Set<NodeId>();

  function range(value: Rect) {
    const left = Math.floor(value.x / cellSize);
    const top = Math.floor(value.y / cellSize);
    const right = Math.floor((value.x + value.width) / cellSize);
    const bottom = Math.floor((value.y + value.height) / cellSize);
    const columns = right - left + 1;
    const rows = bottom - top + 1;
    const count = columns * rows;
    return { left, top, columns, rows, count: Number.isFinite(count) ? count : Infinity };
  }
  function remove(id: NodeId) {
    for (const key of membership.get(id) ?? []) {
      const cell = cells.get(key);
      cell?.delete(id);
      if (cell?.size === 0) cells.delete(key);
    }
    membership.delete(id);
    spanning.delete(id);
    return bounds.delete(id);
  }
  function set(id: NodeId, value: Rect) {
    const previous = bounds.get(id);
    if (previous && sameBounds(previous, value)) return false;
    remove(id);
    bounds.set(id, { ...value });
    const area = range(value);
    // Large rectangles stay in a separate bucket to bound index storage.
    if (area.count > 4096) {
      spanning.add(id);
      return true;
    }
    const keys: string[] = [];
    for (let column = 0; column < area.columns; column += 1) {
      for (let row = 0; row < area.rows; row += 1) {
        const key = `${area.left + column},${area.top + row}`;
        let cell = cells.get(key);
        if (!cell) {
          cell = new Set();
          cells.set(key, cell);
        }
        cell.add(id);
        keys.push(key);
      }
    }
    membership.set(id, keys);
    return true;
  }
  function query(value: Rect): Set<NodeId> {
    const area = range(value);
    const candidates = new Set(spanning);
    if (area.count > cells.size) {
      for (const id of bounds.keys()) candidates.add(id);
    } else {
      for (let column = 0; column < area.columns; column += 1) {
        for (let row = 0; row < area.rows; row += 1) {
          for (const id of cells.get(`${area.left + column},${area.top + row}`) ?? [])
            candidates.add(id);
        }
      }
    }
    const result = new Set<NodeId>();
    for (const id of candidates) {
      const entry = bounds.get(id);
      if (entry && intersects(entry, value)) result.add(id);
    }
    return result;
  }
  return {
    set,
    remove,
    query,
    clear() {
      bounds.clear();
      cells.clear();
      membership.clear();
      spanning.clear();
    },
  };
}
