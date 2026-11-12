import { useState } from 'react';
import { Dialog } from '../../design-system/components/index.js';
import type { ActivityFilters } from './planning-activity-view.js';
import './list.css';

type Option = Readonly<{ value: string; label: string }>;

function ChipGroup({
  legend,
  options,
  pressed,
  onToggle,
}: {
  legend: string;
  options: readonly Option[];
  pressed: (value: string) => boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="pc-list-sheet__field">
      <legend>{legend}</legend>
      <div className="pc-list-sheet__chips">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="pc-list-sheet__chip"
            aria-pressed={pressed(option.value)}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Phone bottom sheet for the Type, Spec and range filters; changes apply as they are made. */
export function ActivityFiltersSheet({
  filters,
  active,
  shown,
  types,
  specs,
  ranges,
  defaults,
  onChange,
}: {
  filters: ActivityFilters;
  active: number;
  shown: number;
  types: readonly Option[];
  specs: readonly string[];
  ranges: readonly number[];
  defaults: Partial<ActivityFilters>;
  onChange: (next: Partial<ActivityFilters>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="pc-activity__more">
          {active ? `More filters ${active}` : 'More filters'}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="pc-list-sheet__scrim" />
        <Dialog.Content className="pc-list-sheet" aria-modal="true" aria-describedby={undefined}>
          <header className="pc-list-sheet__head">
            <Dialog.Title className="pc-list-sheet__title">Filters</Dialog.Title>
            <button
              type="button"
              className="pc-list-sheet__clear"
              onClick={() => onChange(defaults)}
            >
              Clear all
            </button>
          </header>
          <div className="pc-list-sheet__body">
            <ChipGroup
              legend="Type"
              options={types}
              pressed={(value) => filters.types.includes(value)}
              onToggle={(value) =>
                onChange({
                  types: filters.types.includes(value)
                    ? filters.types.filter((type) => type !== value)
                    : [...filters.types, value],
                })
              }
            />
            <ChipGroup
              legend="Range"
              options={ranges.map((days) => ({ value: String(days), label: `Last ${days} days` }))}
              pressed={(value) => filters.days === Number(value)}
              onToggle={(value) => onChange({ days: Number(value) })}
            />
            {specs.length ? (
              <ChipGroup
                legend="Spec"
                options={specs.map((value) => ({ value, label: value }))}
                pressed={(value) => filters.spec === value}
                onToggle={(value) => onChange({ spec: filters.spec === value ? null : value })}
              />
            ) : null}
          </div>
          <footer className="pc-list-sheet__foot">
            <Dialog.Close asChild>
              <button type="button" className="pc-list-sheet__apply">
                {`Show ${shown} ${shown === 1 ? 'change' : 'changes'}`}
              </button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
