import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { LIST_PRESETS, listPreset } from './planning-list-filter.js';
import {
  type PlanningModelGraph,
  type PlanningModelNode,
  planningSpecOf,
} from './planning-model.js';
import { createPlanningProjectionCache, planningClockKey } from './planning-projection-cache.js';
import {
  applyPlanningView,
  authoredTimestamp,
  groupPresentationNodes,
  planningLabels,
} from './presentation-view.js';

function buildMetadata(graph: PlanningModelGraph, now: Date) {
  const progress = new Map<string, { total: number; done: number }>();
  const specs = new Map<string, PlanningModelNode>();
  const labels = new Set<string>();
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    ids.add(node.id);
    if (node.type === 'spec') specs.set(node.id, node);
    for (const label of planningLabels(node)) labels.add(label);
    if (node.type !== 'task') continue;
    const spec = planningSpecOf(node) ?? '';
    const value = progress.get(spec) ?? { total: 0, done: 0 };
    value.total++;
    if (node.status === 'done') value.done++;
    progress.set(spec, value);
  }
  return {
    progress,
    specs,
    ids,
    labels: [...labels].sort(),
    totals: new Map(
      LIST_PRESETS.map(([key]) => [
        key,
        applyPlanningView(graph.nodes, listPreset(key), now, graph).length,
      ]),
    ),
  };
}
const metadataCache = createPlanningProjectionCache<ReturnType<typeof buildMetadata>>();
export function selectListMetadata(graph: PlanningModelGraph, now = new Date()) {
  return metadataCache(graph, planningClockKey(graph, listPreset('today'), now), () =>
    buildMetadata(graph, now),
  );
}

function buildProjection(graph: PlanningModelGraph, view: PlanningView, now: Date) {
  const rows = applyPlanningView(graph.nodes, view, now, graph);
  const hiddenDone =
    view.filters.status.length && !view.filters.status.includes('done')
      ? applyPlanningView(
          graph.nodes,
          { ...view, filters: { ...view.filters, status: ['done'] } },
          now,
          graph,
        ).length
      : 0;
  const hasDates = view.filters.createdWithinDays || view.filters.updatedWithinDays;
  const dateExcluded = hasDates
    ? applyPlanningView(
        graph.nodes,
        {
          ...view,
          filters: { ...view.filters, createdWithinDays: null, updatedWithinDays: null },
        },
        now,
        graph,
      ).filter((node) =>
        ['created', 'updated'].some((field) => {
          if (
            !(field === 'created' ? view.filters.createdWithinDays : view.filters.updatedWithinDays)
          )
            return false;
          const stamp = authoredTimestamp(node.frontmatter[field]);
          return stamp === null || stamp > now.getTime();
        }),
      ).length
    : 0;
  return { rows, hiddenDone, dateExcluded };
}
const projectionCache = createPlanningProjectionCache<ReturnType<typeof buildProjection>>();
export function selectListProjection(
  graph: PlanningModelGraph,
  view: PlanningView,
  now = new Date(),
) {
  const key = JSON.stringify([view.filters, view.sort, planningClockKey(graph, view, now)]);
  return projectionCache(graph, key, () => buildProjection(graph, view, now));
}

function buildGroups(
  graph: PlanningModelGraph,
  rows: readonly PlanningModelNode[],
  groupBy: PlanningView['groupBy'],
) {
  const specs = selectListMetadata(graph).specs;
  const grouped = groupPresentationNodes(rows, groupBy).map((group) => ({
    ...group,
    label:
      groupBy === 'spec' && specs.has(group.key)
        ? `${group.key} · ${specs.get(group.key)?.title}`
        : group.label,
  }));
  const appearances = grouped.flatMap((group) => group.nodes.map((node) => ({ group, node })));
  const positions = new Map<string, Map<string, number>>();
  appearances.forEach((entry, index) => {
    const group = positions.get(entry.group.key) ?? new Map<string, number>();
    group.set(entry.node.id, index + 1);
    positions.set(entry.group.key, group);
  });
  return { grouped, appearances, positions };
}
const groupCache = new WeakMap<
  readonly PlanningModelNode[],
  Map<string, ReturnType<typeof buildGroups>>
>();
export function selectListGroups(
  graph: PlanningModelGraph,
  rows: readonly PlanningModelNode[],
  groupBy: PlanningView['groupBy'],
) {
  let entries = groupCache.get(rows);
  if (!entries) {
    entries = new Map();
    groupCache.set(rows, entries);
  }
  let value = entries.get(groupBy);
  if (!value) {
    value = buildGroups(graph, rows, groupBy);
    entries.set(groupBy, value);
  }
  return value;
}

export { retainGraphRevision } from './planning-projection-cache.js';
