import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import {
  filterPlanningNodes,
  groupPlanningNodes,
  type PlanningGroup,
  type PlanningModelNode,
} from './planning-model.js';

const DAY = 86_400_000;
const PRIORITY_RANK: Readonly<Record<string, number>> = {
  P0: 0,
  critical: 0,
  P1: 1,
  high: 1,
  P2: 2,
  medium: 2,
  P3: 3,
  low: 3,
};

export function planningLabels(node: PlanningModelNode): readonly string[] {
  const values = Array.isArray(node.frontmatter.labels)
    ? node.frontmatter.labels
    : [node.frontmatter.label];
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(value)) return null;
  const date = value.slice(0, 10);
  const day = Date.parse(date);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withinDays(value: unknown, days: number | null, today: number): boolean {
  if (days === null) return true;
  const parsed = timestamp(value);
  return parsed !== null && parsed >= today - (days - 1) * DAY && parsed < today + DAY;
}

function compareValues(
  left: PlanningModelNode,
  right: PlanningModelNode,
  field: PlanningView['sort']['field'],
): number {
  if (field === 'priority') {
    return (
      (PRIORITY_RANK[String(left.frontmatter.priority)] ?? 4) -
      (PRIORITY_RANK[String(right.frontmatter.priority)] ?? 4)
    );
  }
  if (field === 'updated') {
    return (timestamp(left.frontmatter.updated) ?? 0) - (timestamp(right.frontmatter.updated) ?? 0);
  }
  return left[field].localeCompare(right[field], undefined, { numeric: true, sensitivity: 'base' });
}

/** URL presentation narrows a validated snapshot without changing its identity or authority. */
export function applyPlanningView<Node extends PlanningModelNode>(
  nodes: readonly Node[],
  view: PlanningView | null,
  now = new Date(),
): readonly Node[] {
  if (!view) return nodes;
  const filters = view.filters;
  const today = Date.parse(now.toISOString().slice(0, 10));
  const searched = filterPlanningNodes(nodes, { search: filters.query.trim() || undefined });
  const matches = searched.filter(
    (node) =>
      (!filters.type.length || filters.type.includes(node.type)) &&
      (!filters.status.length || filters.status.includes(node.status)) &&
      (!filters.priority.length || filters.priority.includes(String(node.frontmatter.priority))) &&
      (!filters.label.length ||
        filters.label.some((label) => planningLabels(node).includes(label))) &&
      withinDays(node.frontmatter.created, filters.createdWithinDays, today) &&
      withinDays(node.frontmatter.updated, filters.updatedWithinDays, today),
  );
  const direction = view.sort.direction === 'asc' ? 1 : -1;
  return matches.sort(
    (left, right) =>
      compareValues(left, right, view.sort.field) * direction ||
      left.id.localeCompare(right.id, undefined, { numeric: true }),
  );
}

export function groupPresentationNodes<Node extends PlanningModelNode>(
  nodes: readonly Node[],
  groupBy: PlanningView['groupBy'],
): readonly PlanningGroup<Node>[] {
  if (groupBy === 'none') return [{ key: 'all', label: 'All artifacts', nodes }];
  if (groupBy !== 'label') return groupPlanningNodes(nodes, groupBy);
  const groups = new Map<string, Node[]>();
  for (const node of nodes) {
    const labels = [...new Set(planningLabels(node))].sort();
    for (const key of labels.length ? labels : ['']) {
      const group = groups.get(key);
      if (group) group.push(node);
      else groups.set(key, [node]);
    }
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, members]) => ({
      key,
      label: key || 'No label',
      nodes: members,
    }));
}
