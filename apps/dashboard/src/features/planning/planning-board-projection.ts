import { ARTIFACT_STATUS_ORDER } from '../../design-system/components/index.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import {
  groupPlanningNodes,
  type PlanningModelGraph,
  planningGroupingDimensions,
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
