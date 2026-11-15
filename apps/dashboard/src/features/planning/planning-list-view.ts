import type { SelectionBarItem } from '../../design-system/components/selection-bar.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { boardSelectionItems } from './planning-board-view.js';
import type { PlanningModelNode } from './planning-model.js';
import { planningArtifactStatusLabel, planningArtifactTypeLabel } from './planning-model.js';

type Filters = PlanningView['filters'];
export type ListValueFilter = 'type' | 'status' | 'priority' | 'label';
export type ListClearableFilter = 'attention' | 'createdWithinDays' | 'updatedWithinDays';

const OPEN_STATUSES = ['outstanding', 'in-progress', 'blocked'];
const ATTENTION_LABEL: Readonly<Record<string, string>> = {
  waiting: 'waiting',
  stale: 'gone quiet',
  'high-not-started': 'high priority, not started',
  'changed-today': 'changed today',
};
const FIELD_LABEL: Readonly<Record<ListValueFilter, string>> = {
  type: 'Type',
  status: 'Status',
  priority: 'Priority',
  label: 'Label',
};

/** Readable value for one filter value. */
export function listFilterValueLabel(field: ListValueFilter, value: string): string {
  if (field === 'type') return planningArtifactTypeLabel(value).toLowerCase();
  if (field === 'status') return planningArtifactStatusLabel(value).toLowerCase();
  return value;
}

/** Chip text such as "Status: open", "Type: any" or "Status: 2 selected". */
export function listChipLabel(field: ListValueFilter, values: readonly string[]): string {
  const name = FIELD_LABEL[field];
  if (values.length === 0) return `${name}: any`;
  if (
    field === 'status' &&
    values.length === OPEN_STATUSES.length &&
    OPEN_STATUSES.every((status) => values.includes(status))
  )
    return `${name}: open`;
  if (values.length === 1) return `${name}: ${listFilterValueLabel(field, values[0] ?? '')}`;
  return `${name}: ${values.length} selected`;
}

/** Chips for filters only settable from a URL; each clears its own field. */
export function listClearableChips(
  filters: Filters,
): readonly Readonly<{ field: ListClearableFilter; label: string }>[] {
  const chips: { field: ListClearableFilter; label: string }[] = [];
  const created = filters.createdWithinDays;
  if (created !== null)
    chips.push({
      field: 'createdWithinDays',
      label:
        created === 1
          ? 'Filed: today'
          : created === 2
            ? 'Filed: since yesterday'
            : `Created: ${created}d`,
    });
  if (filters.updatedWithinDays !== null)
    chips.push({ field: 'updatedWithinDays', label: `Updated: ${filters.updatedWithinDays}d` });
  if (filters.attention)
    chips.push({
      field: 'attention',
      label: `Attention: ${ATTENTION_LABEL[filters.attention] ?? filters.attention}`,
    });
  return chips;
}

/** Count used by "Clear N filters": every filter value, the query and each URL-only filter. */
export function listActiveFilterCount(filters: Filters): number {
  return (
    filters.type.length +
    filters.status.length +
    filters.priority.length +
    filters.label.length +
    Number(Boolean(filters.query.trim())) +
    Number(filters.createdWithinDays !== null) +
    Number(filters.updatedWithinDays !== null) +
    Number(Boolean(filters.attention))
  );
}

/** Count on the narrow-layout Filters button: every active filter except the query. */
export function listFilterButtonCount(filters: Filters): number {
  return listActiveFilterCount(filters) - Number(Boolean(filters.query.trim()));
}

/** Sentence naming the active filters, e.g. `Status: blocked, Label: security and "entra".` */
export function listFilterSentence(filters: Filters): string {
  const parts: string[] = [];
  for (const field of ['type', 'status', 'priority', 'label'] as const)
    if (filters[field].length)
      parts.push(
        `${FIELD_LABEL[field]}: ${filters[field]
          .map((value) => listFilterValueLabel(field, value))
          .join(', ')}`,
      );
  for (const chip of listClearableChips(filters)) parts.push(chip.label);
  const query = filters.query.trim();
  if (!parts.length) return query ? `"${query}".` : '';
  if (!query) return `${parts.join(', ')}.`;
  return `${parts.join(', ')} and "${query}".`;
}

/** Bar entries for the checked rows, else the inspected row; items without a command are counted. */
export function listSelectionItems(
  checked: readonly PlanningModelNode[],
  inspected: PlanningModelNode | undefined,
): Readonly<{ items: SelectionBarItem[]; missing: number }> {
  const nodes = checked.length ? checked : inspected ? [inspected] : [];
  const items = nodes.flatMap((node) => boardSelectionItems(node));
  return { items, missing: nodes.length - items.length };
}

/** True when a spec group starts with the spec itself, which the List draws as the header row. */
export function listSpecLeads(
  group: Readonly<{ key: string; nodes: readonly PlanningModelNode[] }>,
  groupBy: PlanningView['groupBy'],
): boolean {
  return groupBy === 'spec' && group.nodes[0]?.id === group.key;
}

/** Separate header rows up to and including each group; a spec-led header is an item row. */
export function listHeaderOffsets(
  grouped: readonly Readonly<{ key: string; nodes: readonly PlanningModelNode[] }>[],
  groupBy: PlanningView['groupBy'],
): ReadonlyMap<string, number> {
  const offsets = new Map<string, number>();
  if (groupBy === 'none') return offsets;
  let count = 0;
  for (const group of grouped) {
    if (!listSpecLeads(group, groupBy)) count++;
    offsets.set(group.key, count);
  }
  return offsets;
}
