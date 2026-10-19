import { ARTIFACT_STATUS_ORDER } from '../../design-system/components/index.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import {
  groupPlanningNodes,
  type PlanningModelGraph,
  type PlanningModelNode,
  planningGroupingDimensions,
  planningSpecOf,
} from './planning-model.js';
import { createPlanningProjectionCache, planningClockKey } from './planning-projection-cache.js';
import { applyPlanningView, groupPresentationNodes } from './presentation-view.js';

function buildItems(graph: PlanningModelGraph, presentation: PlanningView | null, now: Date) {
  const items = applyPlanningView(
    graph.nodes.filter((node) => node.type !== 'sprint'),
    presentation,
    now,
    graph,
  );
  const availableDimensions = planningGroupingDimensions(items);
  const dimensions = [
    { key: 'none', label: 'None' },
    ...availableDimensions,
    ...(!availableDimensions.some((entry) => entry.key === 'spec')
      ? [{ key: 'spec', label: 'Spec' }]
      : []),
    { key: 'label', label: 'Label' },
  ];
  return { items, dimensions };
}

const itemCache = createPlanningProjectionCache<ReturnType<typeof buildItems>>();

function buildProjection(source: ReturnType<typeof buildItems>, dimension: string) {
  const { items, dimensions } = source;
  const active = dimensions.find((entry) => entry.key === dimension);
  const activeKey = active?.key ?? 'status';
  const byStatus = activeKey === 'status';
  const columns = byStatus
    ? ARTIFACT_STATUS_ORDER.map((status) => ({
        key: status,
        label: status,
        nodes: items.filter((node) => node.status === status),
      }))
    : activeKey === 'none' || activeKey === 'label'
      ? groupPresentationNodes(items, activeKey)
      : groupPlanningNodes(items, activeKey);
  return {
    ...source,
    columns,
    activeKey,
    byStatus,
    groupedBy: active?.label.toLowerCase() ?? 'status',
  };
}

const projectionCache = createPlanningProjectionCache<ReturnType<typeof buildProjection>>();

export function selectBoardProjection(
  graph: PlanningModelGraph,
  presentation: PlanningView | null,
  dimension: string,
  now = new Date(),
) {
  const key = JSON.stringify([
    presentation?.filters ?? null,
    presentation?.sort ?? null,
    planningClockKey(graph, presentation, now),
  ]);
  return projectionCache(graph, JSON.stringify([key, dimension]), () =>
    buildProjection(
      itemCache(graph, key, () => buildItems(graph, presentation, now)),
      dimension,
    ),
  );
}

export { retainGraphRevision } from './planning-projection-cache.js';

function buildBoardMetadata(graph: PlanningModelGraph) {
  const specs = new Map<string, PlanningModelNode>();
  const progress = new Map<string, { done: number; total: number }>();
  for (const node of graph.nodes) {
    if (node.type === 'spec') specs.set(node.id, node);
    if (node.type !== 'task') continue;
    const key = planningSpecOf(node) ?? '';
    const value = progress.get(key) ?? { done: 0, total: 0 };
    value.total++;
    if (node.status === 'done') value.done++;
    progress.set(key, value);
  }
  return { specs, progress };
}
const metadataCache = createPlanningProjectionCache<ReturnType<typeof buildBoardMetadata>>();

function buildLanes(
  graph: PlanningModelGraph,
  items: readonly PlanningModelNode[],
  swimlanes: boolean,
) {
  const metadata = metadataCache(graph, '', () => buildBoardMetadata(graph));
  const groups = groupPresentationNodes(items, swimlanes ? 'spec' : 'none');
  return groups.map((group) => {
    const spec = metadata.specs.get(group.key);
    const progress = metadata.progress.get(group.key);
    return {
      ...group,
      spec,
      progress,
      label: spec ? `${group.key} · ${spec.title}` : group.label,
      columns: groupPlanningNodes(group.nodes, 'status'),
    };
  });
}

export type BoardLane = ReturnType<typeof buildLanes>[number];
const laneCache = new WeakMap<
  readonly PlanningModelNode[],
  Map<boolean, { graph: PlanningModelGraph; lanes: readonly BoardLane[] }>
>();

export function selectBoardLanes(
  graph: PlanningModelGraph,
  items: readonly PlanningModelNode[],
  swimlanes: boolean,
) {
  let entries = laneCache.get(items);
  if (!entries) {
    entries = new Map();
    laneCache.set(items, entries);
  }
  let value = entries.get(swimlanes);
  if (!value || value.graph !== graph) {
    value = { graph, lanes: buildLanes(graph, items, swimlanes) };
    entries.set(swimlanes, value);
  }
  return value.lanes;
}
