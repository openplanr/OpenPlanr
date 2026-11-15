import type { GraphEdge, GraphNode } from '../../design-system/components/index.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import {
  type PlanningArtifactType,
  type PlanningModelGraph,
  planningSpecOf,
} from './planning-model.js';
import { createStructuralIndex, type StructuralIndex } from './planning-structural-model.js';
import { applyPlanningView } from './presentation-view.js';

export type GraphLens = 'lineage' | 'dependencies' | 'project';
export type GraphFocusOptions = Readonly<{
  lens: GraphLens;
  focusId: string | null;
  types: readonly PlanningArtifactType[];
  contains: boolean;
  dependencies: boolean;
  presentation: PlanningView | null;
}>;
export type FocusedGraph = Readonly<{
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  ids: ReadonlySet<string>;
  unresolved: readonly string[];
  cycle: boolean;
}>;
type Index = Readonly<{
  structural: StructuralIndex;
  projections: Map<string, FocusedGraph>;
}>;
const indices = new WeakMap<PlanningModelGraph, Index>();

export { retainGraphRevision } from './planning-projection-cache.js';

export function graphFocusIndex(graph: PlanningModelGraph): StructuralIndex {
  let index = indices.get(graph);
  if (!index) {
    index = { structural: createStructuralIndex(graph), projections: new Map() };
    indices.set(graph, index);
  }
  return index.structural;
}

export function initialGraphLens(graph: PlanningModelGraph): GraphLens {
  if (graph.nodes.some((node) => node.type === 'spec')) return 'lineage';
  return graph.edges.some((edge) => edge.kind === 'depends_on') ? 'dependencies' : 'project';
}

export function initialGraphFocus(
  graph: PlanningModelGraph,
  selectedId: string | null,
): string | null {
  const index = graphFocusIndex(graph);
  const selected = selectedId ? index.byId.get(selectedId) : undefined;
  const spec = selected ? planningSpecOf(selected) : null;
  return (
    (spec && index.byId.has(spec) ? spec : null) ??
    [...graph.nodes]
      .filter((node) => node.type === 'spec')
      .sort(
        (a, b) =>
          Number(b.status === 'in-progress') - Number(a.status === 'in-progress') ||
          Number((index.children.get(b.id) ?? []).some((ref) => ref.node?.type === 'story')) -
            Number((index.children.get(a.id) ?? []).some((ref) => ref.node?.type === 'story')) ||
          a.id.localeCompare(b.id),
      )[0]?.id ??
    selected?.id ??
    [...graph.nodes]
      .filter((node) => node.type === 'quick' || node.type === 'task')
      .sort(
        (a, b) =>
          Number(b.status === 'in-progress') - Number(a.status === 'in-progress') ||
          Number((index.dependencies.get(b.id)?.length ?? 0) > 0) -
            Number((index.dependencies.get(a.id)?.length ?? 0) > 0) ||
          a.id.localeCompare(b.id),
      )[0]?.id ??
    graph.nodes[0]?.id ??
    null
  );
}

function walk(
  start: string,
  adjacency: StructuralIndex['children'],
  ids: Set<string>,
  boundaries?: StructuralIndex,
): void {
  const visited = new Set<string>();
  const queue = [start];
  for (let offset = 0; offset < queue.length; offset += 1) {
    const id = queue[offset];
    if (visited.has(id)) continue;
    visited.add(id);
    ids.add(id);
    if (boundaries?.byId.get(id)?.type === 'spec') continue;
    for (const ref of adjacency.get(id) ?? [])
      if (ref.node && (!boundaries || ref.node.type !== 'sprint')) queue.push(ref.node.id);
  }
}

function hasCycle(ids: ReadonlySet<string>, edges: readonly GraphEdge[]): boolean {
  const degree = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    const next = outgoing.get(edge.from) ?? [];
    next.push(edge.to);
    outgoing.set(edge.from, next);
  }
  const queue = [...ids].filter((id) => degree.get(id) === 0);
  for (let offset = 0; offset < queue.length; offset += 1) {
    for (const id of outgoing.get(queue[offset]) ?? []) {
      degree.set(id, (degree.get(id) ?? 0) - 1);
      if (degree.get(id) === 0) queue.push(id);
    }
  }
  return queue.length !== ids.size;
}

export function selectFocusedGraph(
  graph: PlanningModelGraph,
  options: GraphFocusOptions,
): FocusedGraph {
  const structural = graphFocusIndex(graph);
  const cache = indices.get(graph)?.projections;
  const now = new Date();
  const filters = options.presentation?.filters;
  const temporal = filters?.attention || filters?.createdWithinDays || filters?.updatedWithinDays;
  const key = JSON.stringify([options, temporal ? now.getTime() : null]);
  const cached = cache?.get(key);
  if (cached) return cached;
  const scope = new Set<string>();
  const focus = options.focusId && structural.byId.has(options.focusId) ? options.focusId : null;
  if (options.lens === 'project' || !focus) for (const node of graph.nodes) scope.add(node.id);
  else if (options.lens === 'lineage') {
    walk(focus, structural.parents, scope, structural);
    walk(focus, structural.children, scope);
  } else {
    const queue = [focus];
    for (let offset = 0; offset < queue.length; offset += 1) {
      const id = queue[offset];
      if (scope.has(id)) continue;
      scope.add(id);
      for (const ref of [
        ...(structural.dependencies.get(id) ?? []),
        ...(structural.dependents.get(id) ?? []),
      ])
        if (ref.node && !scope.has(ref.node.id)) queue.push(ref.node.id);
    }
  }
  const source = applyPlanningView(graph.nodes, options.presentation, now, graph).filter(
    (node) => scope.has(node.id) && options.types.includes(node.type),
  );
  const ids = new Set(source.map((node) => node.id));
  const nodes: GraphNode[] = source.map((node) => ({
    id: node.id,
    canonicalId: node.id,
    type: node.type,
    label: node.title,
    status: node.status,
    blocked: node.status === 'blocked',
  }));
  const edges = graph.edges.filter(
    (edge) =>
      ids.has(edge.from) &&
      ids.has(edge.to) &&
      (edge.kind === 'contains' ? options.contains : options.dependencies),
  );
  const unresolved = source.flatMap((node) =>
    [
      ...(options.dependencies ? (structural.dependencies.get(node.id) ?? []) : []),
      ...(options.contains
        ? [...(structural.parents.get(node.id) ?? []), ...(structural.children.get(node.id) ?? [])]
        : []),
    ]
      .filter((ref) => !ref.node)
      .map((ref) => `${node.id}: ${ref.reference}. ${ref.reason}.`),
  );
  const result = { nodes, edges, ids, unresolved, cycle: hasCycle(ids, edges) };
  cache?.set(key, result);
  // Bound presentation combinations while retaining the immutable source revision for revisits.
  if (cache && cache.size > 24) cache.delete(cache.keys().next().value as string);
  return result;
}

export function graphBlockerReason(graph: PlanningModelGraph, id: string): string {
  const dependencies = graphFocusIndex(graph).dependencies.get(id) ?? [];
  const missing = dependencies.filter((ref) => !ref.node);
  const open = dependencies.filter(
    (ref) => ref.node && !['done', 'addressed'].includes(ref.node.status),
  );
  if (missing.length)
    return `Readiness unknown: ${missing.map((ref) => ref.reference).join(', ')} unresolved.${open.length ? ` Also waits on ${open.map((ref) => ref.node?.id).join(', ')}.` : ''}`;
  return open.length
    ? `Waits on ${open.map((ref) => ref.node?.id).join(', ')}.`
    : 'No open dependencies in the current graph.';
}
