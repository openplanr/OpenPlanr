import {
  ARTIFACT_STATUS_ORDER,
  ArtifactStatus,
  IconButton,
  Input,
  PcIcon,
  SegmentedControl,
  Select,
  Tabs,
} from '../../design-system/components/index.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import { LIST_PRESETS, listPreset } from './planning-list-filter.js';
import {
  type ListClearableFilter,
  type ListValueFilter,
  listChipLabel,
  listClearableChips,
  listFilterValueLabel,
} from './planning-list-view.js';
import { planningArtifactTypeLabel } from './planning-model.js';
import './planning.css';
import './list.css';

const ALL = 'all';
const TYPES = ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'critical', 'high', 'medium', 'low'];
const GROUPS = ['none', 'spec', 'type', 'status', 'label'] as const;

type Filters = PlanningView['filters'];

/** Title, count and preset tabs. */
export function ListTitle({
  shown,
  total,
  view,
  counts,
  onPreset,
}: {
  shown: number;
  total: number;
  view: PlanningView;
  counts: ReadonlyMap<string, number> | undefined;
  onPreset: (view: PlanningView) => void;
}) {
  const presets = LIST_PRESETS.slice(0, 5);
  const active =
    presets.find(([key]) => {
      const preset = listPreset(key);
      return (
        JSON.stringify(view.filters) === JSON.stringify(preset.filters) &&
        view.groupBy === preset.groupBy
      );
    })?.[0] ?? '';
  return (
    <div className="pc-list__head">
      <span className="pc-list__title-heading">
        <h1>List</h1>
        <span className="pc-list__count">
          {shown} of {total}
        </span>
      </span>
      <span className="pc-list__divider" aria-hidden="true" />
      <div className="pc-list__presets">
        <Tabs
          label="List presets"
          variant="pill"
          value={active}
          tabs={presets.map(([id, label]) => ({ id, label, count: counts?.get(id) }))}
          onChange={(id) => {
            const preset = presets.find(([key]) => key === id);
            if (preset) onPreset({ ...listPreset(preset[0]), density: view.density });
          }}
        />
      </div>
    </div>
  );
}

function valueOptions(field: ListValueFilter, labels: readonly string[]) {
  const values =
    field === 'type'
      ? TYPES
      : field === 'status'
        ? ARTIFACT_STATUS_ORDER
        : field === 'priority'
          ? PRIORITIES
          : labels;
  return values.map((value) => ({
    value,
    label:
      field === 'type'
        ? planningArtifactTypeLabel(value)
        : field === 'status'
          ? listFilterValueLabel(field, value).replace(/^./u, (first) => first.toUpperCase())
          : value,
    icon:
      field === 'status' ? (
        <ArtifactStatus status={value} size="sm" variant="glyph" showLabel={false} />
      ) : undefined,
  }));
}

/** Search, filter chips, density and the filter link, on one row. */
export function ListToolbar({
  filters,
  groupBy,
  labels,
  compact,
  sharePending,
  dateNote,
  onQuery,
  onFilters,
  onGroupBy,
  onClear,
  onClearChip,
  onDensity,
  onShare,
}: {
  filters: Filters;
  groupBy: PlanningView['groupBy'];
  labels: readonly string[];
  compact: boolean;
  sharePending: boolean;
  dateNote: string;
  onQuery: (query: string) => void;
  onFilters: (filters: Partial<Filters>) => void;
  onGroupBy: (groupBy: PlanningView['groupBy']) => void;
  onClear: () => void;
  onClearChip: (field: ListClearableFilter) => void;
  onDensity: (compact: boolean) => void;
  onShare: () => void;
}) {
  return (
    <div className="pc-list__toolbar">
      <Input
        icon="search"
        suffix="/"
        width={300}
        placeholder="Filter by id or title"
        ariaLabel="Filter by id or title"
        value={filters.query}
        onChange={(value) => onQuery(value.slice(0, 200))}
      />
      {(['type', 'status', 'priority', 'label'] as const).map((field) => {
        const name = field.charAt(0).toUpperCase() + field.slice(1);
        return (
          <Select
            key={field}
            variant="filter"
            ariaLabel={name}
            triggerLabel={listChipLabel(field, filters[field])}
            clearLabel={`Clear ${field}`}
            value={ALL}
            onChange={(value) => onFilters({ [field]: value === ALL ? [] : [value] })}
            values={filters[field]}
            onValuesChange={(values) => onFilters({ [field]: values })}
            clearValue={ALL}
            options={valueOptions(field, labels)}
          />
        );
      })}
      <Select
        variant="filter"
        ariaLabel="Group"
        triggerLabel={`Group: ${groupBy}`}
        active={groupBy !== 'none'}
        value={groupBy}
        onChange={(value) => onGroupBy(value as PlanningView['groupBy'])}
        options={GROUPS.map((value) => ({
          value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
        }))}
      />
      {listClearableChips(filters).map((chip) => (
        <ClearableChip
          key={chip.field}
          field={chip.field}
          label={chip.label}
          note={chip.field === 'attention' ? '' : dateNote}
          onClear={onClearChip}
        />
      ))}
      <button type="button" className="pc-list__clear" onClick={onClear}>
        Clear filters
      </button>
      <span className="pc-list__toolbar-gap" aria-hidden="true" />
      <div className="pc-list__density">
        <SegmentedControl
          label="Density"
          options={[
            { key: 'comfortable', label: 'Comfortable' },
            { key: 'compact', label: 'Compact' },
          ]}
          value={compact ? 'compact' : 'comfortable'}
          onChange={(value) => onDensity(value === 'compact')}
        />
      </div>
      <IconButton icon="link" label="Copy filter link" disabled={sharePending} onClick={onShare} />
    </div>
  );
}

function ClearableChip({
  field,
  label,
  note,
  onClear,
}: {
  field: ListClearableFilter;
  label: string;
  note: string;
  onClear: (field: ListClearableFilter) => void;
}) {
  return (
    <button
      type="button"
      className="pc-chip pc-list__clearable"
      data-active="true"
      title={note || undefined}
      aria-label={`Clear filter ${label}`}
      onClick={() => onClear(field)}
    >
      <span className="pc-chip__label">{label}</span>
      <PcIcon name="x" size={12} />
    </button>
  );
}
