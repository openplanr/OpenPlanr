import { Select, Tabs } from '../../design-system/components/index.js';
import {
  ACTIVITY_KINDS,
  ACTIVITY_RANGES,
  type ActivityFilters,
  type ActivityKind,
  type ActivityModel,
} from './planning-activity-view.js';
import { planningArtifactTypeLabel } from './planning-model.js';

const ANY = 'any';
const TYPES = ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr'];
const SEGMENT: Readonly<Record<ActivityKind | 'all', string>> = {
  all: 'All',
  created: 'Created',
  status: 'Status',
  edited: 'Edited',
  removed: 'Removed',
};

/** Kind segment with counts, then the Type, Spec and range chips. */
export function ActivityFilterRow({
  filters,
  counts,
  specs,
  panelId,
  onChange,
}: {
  filters: ActivityFilters;
  counts: ActivityModel['counts'];
  specs: readonly string[];
  panelId: string;
  onChange: (next: Partial<ActivityFilters>) => void;
}) {
  const type = filters.types.length === 1 ? filters.types[0] : ANY;
  const ranges = ACTIVITY_RANGES.includes(filters.days as (typeof ACTIVITY_RANGES)[number])
    ? ACTIVITY_RANGES
    : [...ACTIVITY_RANGES, filters.days].sort((left, right) => left - right);
  return (
    <div className="pc-activity__filters">
      <div className="pc-activity__kinds">
        <Tabs
          label="Kind of change"
          variant="pill"
          value={filters.kind}
          tabs={(['all', ...ACTIVITY_KINDS] as const).map((kind) => ({
            id: kind,
            label: SEGMENT[kind],
            panelId,
            count: counts[kind],
          }))}
          onChange={(next) => {
            const kind = (['all', ...ACTIVITY_KINDS] as const).find((value) => value === next);
            if (kind) onChange({ kind });
          }}
        />
      </div>
      <Select
        variant="filter"
        ariaLabel="Type"
        triggerLabel={`Type: ${type === ANY ? 'any' : planningArtifactTypeLabel(type)}`}
        active={type !== ANY}
        value={type}
        onChange={(value) => onChange({ types: value === ANY ? [] : [value] })}
        options={[
          { value: ANY, label: 'Any type' },
          ...TYPES.map((value) => ({ value, label: planningArtifactTypeLabel(value) })),
        ]}
      />
      <Select
        variant="filter"
        ariaLabel="Spec"
        triggerLabel={`Spec: ${filters.spec ?? 'any'}`}
        active={filters.spec !== null}
        value={filters.spec ?? ANY}
        onChange={(value) => onChange({ spec: value === ANY ? null : value })}
        options={[
          { value: ANY, label: 'Any spec' },
          ...specs.map((value) => ({ value, label: value })),
        ]}
      />
      <Select
        variant="filter"
        ariaLabel="Date range"
        triggerLabel={`Last ${filters.days} days`}
        value={String(filters.days)}
        onChange={(value) => onChange({ days: Number(value) })}
        options={ranges.map((days) => ({ value: String(days), label: `Last ${days} days` }))}
      />
    </div>
  );
}
