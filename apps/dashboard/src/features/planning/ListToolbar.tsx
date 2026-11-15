import { useState } from 'react';
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
import { ClearableChip, ListFiltersSheet } from './ListFiltersSheet.js';
import { LIST_PRESETS, listPreset } from './planning-list-filter.js';
import {
  type ListClearableFilter,
  type ListValueFilter,
  listChipLabel,
  listClearableChips,
  listFilterButtonCount,
  listFilterValueLabel,
} from './planning-list-view.js';
import type { ListLayout } from './planning-list-window.js';
import { planningArtifactTypeLabel } from './planning-model.js';
import './planning.css';
import './list.css';

const ALL = 'all';
const TYPES = ['epic', 'feature', 'story', 'task', 'spec', 'backlog', 'quick', 'sprint', 'adr'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'critical', 'high', 'medium', 'low'];
const GROUPS = ['none', 'spec', 'type', 'status', 'label'] as const;

type Filters = PlanningView['filters'];

const PRESETS = LIST_PRESETS.slice(0, 5);

function activePreset(view: PlanningView): string {
  return (
    PRESETS.find(([key]) => {
      const preset = listPreset(key);
      return (
        JSON.stringify(view.filters) === JSON.stringify(preset.filters) &&
        view.groupBy === preset.groupBy
      );
    })?.[0] ?? ''
  );
}

function PresetTabs({
  view,
  counts,
  onPreset,
}: {
  view: PlanningView;
  counts: ReadonlyMap<string, number> | undefined;
  onPreset: (view: PlanningView) => void;
}) {
  return (
    <div className="pc-list__presets">
      <Tabs
        label="List presets"
        variant="pill"
        value={activePreset(view)}
        tabs={PRESETS.map(([id, label]) => ({ id, label, count: counts?.get(id) }))}
        onChange={(id) => {
          const preset = PRESETS.find(([key]) => key === id);
          if (preset) onPreset({ ...listPreset(preset[0]), density: view.density });
        }}
      />
    </div>
  );
}

/** Title, count and preset tabs; below 1200px the top bar carries the title. */
export function ListTitle({
  shown,
  total,
  view,
  counts,
  layout = 'desktop',
  onPreset,
}: {
  shown: number;
  total: number;
  view: PlanningView;
  counts: ReadonlyMap<string, number> | undefined;
  layout?: ListLayout;
  onPreset: (view: PlanningView) => void;
}) {
  if (layout !== 'desktop')
    return (
      <div className="pc-visually-hidden">
        <h1>List</h1>
        <span>
          {shown} of {total}
        </span>
      </div>
    );
  return (
    <div className="pc-list__head">
      <span className="pc-list__title-heading">
        <h1>List</h1>
        <span className="pc-list__count">
          {shown} of {total}
        </span>
      </span>
      <span className="pc-list__divider" aria-hidden="true" />
      <PresetTabs view={view} counts={counts} onPreset={onPreset} />
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

type ToolbarProps = {
  filters: Filters;
  groupBy: PlanningView['groupBy'];
  labels: readonly string[];
  compact: boolean;
  sharePending: boolean;
  dateNote: string;
  layout?: ListLayout;
  view: PlanningView;
  counts: ReadonlyMap<string, number> | undefined;
  shown: number;
  onPreset: (view: PlanningView) => void;
  onQuery: (query: string) => void;
  onFilters: (filters: Partial<Filters>) => void;
  onGroupBy: (groupBy: PlanningView['groupBy']) => void;
  onClear: () => void;
  onClearChip: (field: ListClearableFilter) => void;
  onDensity: (compact: boolean) => void;
  onShare: () => void;
};

const SHEET_FIELDS = [
  ['status', 'Status'],
  ['type', 'Type'],
  ['priority', 'Priority'],
  ['label', 'Label'],
] as const;

/** Tablet and phone: search, a Filters button that opens the sheet, and the presets. */
function NarrowToolbar({
  filters,
  groupBy,
  labels,
  dateNote,
  layout,
  view,
  counts,
  shown,
  onPreset,
  onQuery,
  onFilters,
  onGroupBy,
  onClear,
  onClearChip,
}: ToolbarProps) {
  const [open, setOpen] = useState(false);
  const count = listFilterButtonCount(filters);
  const active = activePreset(view);
  return (
    <>
      <div className="pc-list__toolbar" data-layout={layout}>
        <Input
          icon="search"
          placeholder="Filter by id or title"
          ariaLabel="Filter by id or title"
          value={filters.query}
          onChange={(value) => onQuery(value.slice(0, 200))}
        />
        <ListFiltersSheet
          trigger={
            <button type="button" className="pc-list__filters" data-active={count > 0 || undefined}>
              {layout === 'phone' ? <PcIcon name="filter" size={14} /> : null}
              {count ? `Filters ${count}` : 'Filters'}
            </button>
          }
          open={open}
          onOpenChange={setOpen}
          filters={filters}
          groupBy={groupBy}
          sections={SHEET_FIELDS.filter(([field]) => field !== 'label' || labels.length).map(
            ([field, legend]) => ({ field, legend, options: valueOptions(field, labels) }),
          )}
          clearable={listClearableChips(filters)}
          dateNote={dateNote}
          shown={shown}
          onFilters={onFilters}
          onGroupBy={onGroupBy}
          onClear={onClear}
          onClearChip={onClearChip}
        />
        {layout === 'tablet' ? (
          <Select
            ariaLabel="Preset"
            triggerLabel={PRESETS.find(([key]) => key === active)?.[1] ?? 'Presets'}
            value={active}
            onChange={(id) => {
              const preset = PRESETS.find(([key]) => key === id);
              if (preset) onPreset({ ...listPreset(preset[0]), density: view.density });
            }}
            options={PRESETS.map(([value, label]) => ({ value, label }))}
          />
        ) : null}
      </div>
      {layout === 'phone' ? <PresetTabs view={view} counts={counts} onPreset={onPreset} /> : null}
    </>
  );
}

/** Search, filter chips, density and the filter link, on one row. */
export function ListToolbar(props: ToolbarProps) {
  const {
    filters,
    groupBy,
    labels,
    compact,
    sharePending,
    dateNote,
    layout = 'desktop',
    onFilters,
    onGroupBy,
    onClear,
    onClearChip,
    onDensity,
    onShare,
    onQuery,
  } = props;
  if (layout !== 'desktop') return <NarrowToolbar {...props} layout={layout} />;
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
