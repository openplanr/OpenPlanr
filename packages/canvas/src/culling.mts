import { invalid, positive } from './camera.mjs';
import { createSpatialGrid, sameBounds } from './spatial-grid.mjs';
import type { CanvasNode, NodeId, Rect } from './types.mjs';

interface CullingUpdate {
  mount?: Readonly<{ mounted: readonly NodeId[]; unmounted: readonly NodeId[] }>;
  geometry: readonly NodeId[];
  pending: boolean;
  resumeAt?: number;
}

export function createCulling(
  options: Readonly<{ cellSize?: number; marginFactor?: number; chunkSize?: number }> = {},
) {
  const marginFactor = options.marginFactor ?? 2;
  const chunkSize = options.chunkSize ?? 200;
  positive('culling.marginFactor', marginFactor);
  if (marginFactor < 1) invalid('culling.marginFactor', marginFactor);
  positive('culling.chunkSize', chunkSize);
  const grid = createSpatialGrid(options.cellSize);
  let nodes = new Map<NodeId, CanvasNode>();
  const sources = new Map<string, Set<NodeId>>();
  const mounted = new Set<NodeId>();
  const moved = new Set<NodeId>();
  let region: Rect | undefined;
  let dirty = true;
  let pinsDirty = false;
  let desired = new Set<NodeId>();
  let queue: NodeId[] = [];
  let queueStale = false;
  let frozenUntil = -Infinity;
  let optionalMounts = true;

  function getPinnedIds(): Set<NodeId> {
    const pins = new Set<NodeId>();
    for (const ids of sources.values()) {
      for (const id of ids) if (nodes.has(id)) pins.add(id);
    }
    return pins;
  }

  function setNodes(next: ReadonlyMap<NodeId, CanvasNode>): readonly NodeId[] {
    const changed: NodeId[] = [];
    for (const [id, previous] of nodes) {
      if (!next.has(id)) {
        grid.remove(id);
        moved.delete(id);
        changed.push(id);
      } else {
        const current = next.get(id);
        if (current && !sameBounds(previous.bounds, current.bounds)) {
          moved.add(id);
          changed.push(id);
        } else if (
          current &&
          (previous.kind !== current.kind || previous.frame !== current.frame)
        ) {
          changed.push(id);
        }
      }
    }
    for (const [id, node] of next) {
      if (!nodes.has(id)) changed.push(id);
      grid.set(id, node.bounds);
    }
    nodes = new Map(next);
    if (changed.length) dirty = true;
    return changed;
  }
  function update(
    viewport: Rect,
    now: number,
    gesture: boolean,
    zoomChanged: boolean,
    admitOptional = true,
  ): CullingUpdate {
    if (zoomChanged) frozenUntil = now + 120;
    const outside =
      !region ||
      viewport.x < region.x ||
      viewport.y < region.y ||
      viewport.x + viewport.width > region.x + region.width ||
      viewport.y + viewport.height > region.y + region.height;
    const reevaluate = dirty || outside || zoomChanged || optionalMounts !== admitOptional;
    optionalMounts = admitOptional;
    const pins = getPinnedIds();
    if (reevaluate) {
      region = {
        x: viewport.x - (viewport.width * (marginFactor - 1)) / 2,
        y: viewport.y - (viewport.height * (marginFactor - 1)) / 2,
        width: viewport.width * marginFactor,
        height: viewport.height * marginFactor,
      };
      desired = admitOptional ? grid.query(region) : new Set();
    }
    if (reevaluate || pinsDirty) queueStale = true;
    const admitted: NodeId[] = [];
    const removed: NodeId[] = [];
    for (const id of mounted) {
      if (!nodes.has(id) || (!pins.has(id) && !desired.has(id))) {
        mounted.delete(id);
        removed.push(id);
      }
    }
    for (const id of pins) {
      if (!mounted.has(id)) {
        mounted.add(id);
        admitted.push(id);
      }
    }
    const frozen = now < frozenUntil;
    // Zoom frames are frozen, so the distance sort waits until admissions resume.
    if (queueStale && !frozen) {
      const centerX = viewport.x + viewport.width / 2;
      const centerY = viewport.y + viewport.height / 2;
      const distance = (id: NodeId) => {
        const node = nodes.get(id);
        if (!node) return Infinity;
        return (
          (node.bounds.x + node.bounds.width / 2 - centerX) ** 2 +
          (node.bounds.y + node.bounds.height / 2 - centerY) ** 2
        );
      };
      queue = [...desired]
        .filter((id) => !mounted.has(id) && !pins.has(id))
        .sort((left, right) => distance(left) - distance(right) || left.localeCompare(right));
      queueStale = false;
    }
    if (!frozen && (!gesture || reevaluate)) {
      const batch = queue.splice(0, chunkSize);
      for (const id of batch) {
        mounted.add(id);
        admitted.push(id);
      }
    }
    let waiting = queue.length > 0;
    if (queueStale) {
      waiting = false;
      for (const id of desired)
        if (!mounted.has(id) && !pins.has(id)) {
          waiting = true;
          break;
        }
    }
    const geometry = [...moved];
    moved.clear();
    dirty = false;
    pinsDirty = false;
    return {
      ...(admitted.length || removed.length
        ? { mount: { mounted: admitted, unmounted: removed } }
        : {}),
      geometry,
      pending: waiting && !gesture && !frozen,
      ...(waiting && frozen ? { resumeAt: frozenUntil } : {}),
    };
  }
  return {
    setNodes,
    update,
    hitTest(point: { x: number; y: number }): NodeId | null {
      return (
        grid
          .query({ ...point, width: 0, height: 0 })
          .values()
          .next().value ?? null
      );
    },
    setPinned(source: string, ids: readonly NodeId[]) {
      const previous = sources.get(source);
      if (previous?.size === ids.length && ids.every((id) => previous.has(id))) return;
      if (ids.length) sources.set(source, new Set(ids));
      else sources.delete(source);
      pinsDirty = true;
    },
    getMountedIds: (): readonly NodeId[] => [...mounted],
    getPinnedIds,
    query(region: Rect): readonly CanvasNode[] {
      const result: CanvasNode[] = [];
      for (const id of grid.query(region)) {
        const node = nodes.get(id);
        if (node) result.push(node);
      }
      return result;
    },
    getRegion: (): Rect | undefined => region,
    reset() {
      mounted.clear();
      moved.clear();
      region = undefined;
      desired.clear();
      queue = [];
      queueStale = false;
      frozenUntil = -Infinity;
      dirty = true;
    },
  };
}
