import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import type { PlanningModelGraph } from './planning-model.js';
import { authoredTimestamp } from './presentation-view.js';

const retainedRevisions = new Map<string, PlanningModelGraph>();

export function retainGraphRevision(
  graph: PlanningModelGraph,
  binding: DashboardQueryIdentity,
): PlanningModelGraph {
  const key = JSON.stringify([
    binding.actorId,
    binding.projectId,
    binding.scopeId,
    binding.domainId,
    binding.domainVersion,
    binding.generation,
    binding.viewHash,
  ]);
  const previous = retainedRevisions.get(key);
  if (previous) return previous;
  retainedRevisions.set(key, graph);
  // Route rebinding clones validated wire data; keep only a few bound immutable revisions.
  if (retainedRevisions.size > 4)
    retainedRevisions.delete(retainedRevisions.keys().next().value as string);
  return graph;
}

const timestampIndices = new WeakMap<PlanningModelGraph, readonly number[]>();

export function planningClockKey(
  graph: PlanningModelGraph,
  view: PlanningView | null,
  now: Date,
): string {
  if (
    !view?.filters.attention &&
    !view?.filters.createdWithinDays &&
    !view?.filters.updatedWithinDays
  )
    return '';
  let timestamps = timestampIndices.get(graph);
  if (!timestamps) {
    timestamps = graph.nodes
      .flatMap((node) => [node.frontmatter.created, node.frontmatter.updated])
      .map(authoredTimestamp)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    timestampIndices.set(graph, timestamps);
  }
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timestamps[middle] <= now.getTime()) low = middle + 1;
    else high = middle;
  }
  // Relative dates change at UTC midnight or when a future authored timestamp becomes valid.
  return `${now.toISOString().slice(0, 10)}:${low}`;
}

export function createPlanningProjectionCache<T>() {
  const revisions = new WeakMap<PlanningModelGraph, Map<string, T>>();
  return (graph: PlanningModelGraph, key: string, create: () => T): T => {
    let entries = revisions.get(graph);
    if (!entries) {
      entries = new Map();
      revisions.set(graph, entries);
    }
    const prior = entries.get(key);
    if (prior !== undefined) return prior;
    const value = create();
    entries.set(key, value);
    if (entries.size > 32) entries.delete(entries.keys().next().value as string);
    return value;
  };
}
