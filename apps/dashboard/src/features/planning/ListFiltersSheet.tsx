import type { ReactElement } from 'react';
import { Dialog, PcIcon, SegmentedControl } from '../../design-system/components/index.js';
import type { PlanningView } from '../../lib/routing/planning-view-codec.js';
import type { ListClearableFilter, ListValueFilter } from './planning-list-view.js';

type Filters = PlanningView['filters'];
type Option = Readonly<{ value: string; label: string }>;

const GROUPS: readonly Readonly<{ key: PlanningView['groupBy']; label: string }>[] = [
  { key: 'spec', label: 'Spec' },
  { key: 'status', label: 'Status' },
  { key: 'type', label: 'Type' },
  { key: 'label', label: 'Label' },
  { key: 'none', label: 'None' },
];

/** Removable chip for a filter that only a URL can set. */
export function ClearableChip({
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

/** Bottom sheet with every List filter as toggle chips; changes apply as they are made. */
export function ListFiltersSheet({
  trigger,
  open,
  onOpenChange,
  filters,
  groupBy,
  sections,
  clearable,
  dateNote,
  shown,
  onFilters,
  onGroupBy,
  onClear,
  onClearChip,
}: {
  trigger: ReactElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: Filters;
  groupBy: PlanningView['groupBy'];
  sections: readonly Readonly<{ field: ListValueFilter; legend: string; options: Option[] }>[];
  clearable: readonly Readonly<{ field: ListClearableFilter; label: string }>[];
  dateNote: string;
  shown: number;
  onFilters: (filters: Partial<Filters>) => void;
  onGroupBy: (groupBy: PlanningView['groupBy']) => void;
  onClear: () => void;
  onClearChip: (field: ListClearableFilter) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="pc-list-sheet__scrim" />
        <Dialog.Content className="pc-list-sheet" aria-modal="true" aria-describedby={undefined}>
          <header className="pc-list-sheet__head">
            <Dialog.Title className="pc-list-sheet__title">Filters</Dialog.Title>
            <button type="button" className="pc-list-sheet__clear" onClick={onClear}>
              Clear all
            </button>
          </header>
          <div className="pc-list-sheet__body">
            {sections.map(({ field, legend, options }) => (
              <fieldset key={field} className="pc-list-sheet__field">
                <legend>{legend}</legend>
                <div className="pc-list-sheet__chips">
                  {options.map((option) => {
                    const pressed = filters[field].includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className="pc-list-sheet__chip"
                        aria-pressed={pressed}
                        onClick={() =>
                          onFilters({
                            [field]: pressed
                              ? filters[field].filter((value) => value !== option.value)
                              : [...filters[field], option.value],
                          })
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {clearable.length ? (
              <fieldset className="pc-list-sheet__field">
                <legend>Other filters</legend>
                <div className="pc-list-sheet__chips">
                  {clearable.map((chip) => (
                    <ClearableChip
                      key={chip.field}
                      field={chip.field}
                      label={chip.label}
                      note={chip.field === 'attention' ? '' : dateNote}
                      onClear={onClearChip}
                    />
                  ))}
                </div>
              </fieldset>
            ) : null}
            <fieldset className="pc-list-sheet__field">
              <legend>Group by</legend>
              <div className="pc-list-sheet__group">
                <SegmentedControl
                  label="Group by"
                  options={GROUPS}
                  value={groupBy}
                  onChange={(value) => onGroupBy(value as PlanningView['groupBy'])}
                />
              </div>
            </fieldset>
          </div>
          <footer className="pc-list-sheet__foot">
            <Dialog.Close className="pc-list-sheet__apply">
              Show {shown} {shown === 1 ? 'item' : 'items'}
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
