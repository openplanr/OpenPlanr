import { type FocusEvent, type KeyboardEvent, type MouseEvent, useEffect, useRef } from 'react';
import { Button, PcIcon } from '../../design-system/components/index.js';
import { type PlanningModelNode, planningDetailHref, planningDisplayId } from './planning-model.js';

/** Drawn 16px checkbox with a visually hidden name. */
export function ListCheckbox({
  label,
  checked,
  indeterminate = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="pc-checkbox pc-list__check">
      <input
        ref={input}
        type="checkbox"
        className="pc-checkbox__input"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pc-checkbox__box" aria-hidden="true">
        <PcIcon name={indeterminate ? 'minus' : 'check'} size={12} />
      </span>
      <span className="pc-visually-hidden">{label}</span>
    </label>
  );
}

type GroupRow = Readonly<{
  node: PlanningModelNode;
  checked: boolean;
  inspected: boolean;
  onInspect: (node: PlanningModelNode, open?: boolean) => void;
  onSelect: (node: PlanningModelNode) => void;
}>;

function modified(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

/** Props that make a spec-led group header behave as that spec's row. */
function rowProps(row: GroupRow | undefined) {
  if (!row) return {};
  const { node, checked, inspected, onInspect, onSelect } = row;
  return {
    tabIndex: 0,
    'data-keyboard-item': node.id,
    'data-spec-row': 'true',
    'aria-selected': checked,
    'data-selected': inspected || undefined,
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onInspect(node, false);
    },
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (modified(event) || (event.target instanceof Element && event.target.closest('a, button')))
        return;
      event.currentTarget.focus({ preventScroll: true });
      onInspect(node);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === ' ') {
        event.preventDefault();
        onSelect(node);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onInspect(node);
      }
    },
  };
}

function GroupId({ groupKey, row }: { groupKey: string; row: GroupRow | undefined }) {
  if (!row) return <span className="pc-list__group-id">{planningDisplayId(groupKey)}</span>;
  return (
    <a
      className="pc-list__group-id"
      href={planningDetailHref(row.node) ?? undefined}
      onClick={(event) => {
        if (modified(event)) return;
        event.preventDefault();
        row.onInspect(row.node);
      }}
    >
      {planningDisplayId(groupKey)}
    </a>
  );
}

/** Group row: chevron, spec ID and title, and task progress; a spec-led group is the spec's row. */
export function ListGroupHeader({
  groupKey,
  label,
  specTitle,
  collapsed,
  progress,
  narrow = false,
  row,
  onToggle,
}: {
  groupKey: string;
  label: string;
  specTitle: string | undefined;
  collapsed: boolean;
  progress: Readonly<{ done: number; total: number }> | undefined;
  narrow?: boolean;
  row?: GroupRow;
  onToggle: () => void;
}) {
  const id = specTitle !== undefined ? <GroupId groupKey={groupKey} row={row} /> : null;
  const title = <span className="pc-list__group-title">{specTitle ?? label}</span>;
  const unit = progress?.total === 1 ? 'task' : 'tasks';
  const count = progress ? (
    <span className="pc-list__group-progress-count">
      {progress.done}/{progress.total}
      <span className="pc-visually-hidden"> {unit}</span>
    </span>
  ) : null;
  if (narrow && row)
    return (
      <div className="pc-list__group-header" data-narrow="true" {...rowProps(row)}>
        {id}
        {title}
        {count}
        <Button
          size="sm"
          variant="ghost"
          icon={collapsed ? 'chevron-right' : 'chevron-down'}
          aria-expanded={!collapsed}
          ariaLabel={label}
          onClick={onToggle}
        />
      </div>
    );
  if (narrow)
    return (
      <div className="pc-list__group-header" data-narrow="true">
        <button
          type="button"
          className="pc-list__group-toggle"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {id}
          {title}
          {count}
        </button>
      </div>
    );
  return (
    <div className="pc-list__group-header" {...rowProps(row)}>
      <Button
        size="sm"
        variant="ghost"
        icon={collapsed ? 'chevron-right' : 'chevron-down'}
        aria-expanded={!collapsed}
        ariaLabel={label}
        onClick={onToggle}
      />
      {id}
      {title}
      {progress ? (
        <>
          <span
            className="pc-list__group-bar"
            role="progressbar"
            aria-label={`${label} task progress`}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </span>
          <span className="pc-list__group-progress-count">
            {progress.done}/{progress.total} {unit}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** One card in place of the table when nothing matches. */
export function ListEmpty({
  sentence,
  activeFilterCount,
  hiddenDone,
  onClear,
  onShowDone,
}: {
  sentence: string;
  activeFilterCount: number;
  hiddenDone: number;
  onClear: () => void;
  onShowDone: () => void;
}) {
  return (
    <div className="pc-list__empty">
      <h2>No items match these filters</h2>
      {sentence ? <p>{sentence}</p> : null}
      <span className="pc-list__empty-actions">
        <button type="button" onClick={onClear}>
          Clear {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'}
        </button>
        {hiddenDone ? (
          <button type="button" onClick={onShowDone}>
            Show {hiddenDone} done {hiddenDone === 1 ? 'match' : 'matches'}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** "Showing 1–100 of 352" with Previous and Next. */
export function ListPagination({
  start,
  end,
  total,
  page,
  pageCount,
  onPage,
}: {
  start: number;
  end: number;
  total: number;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="pc-list__pagination" aria-label="Planning artifact pages">
      <span className="pc-list__page-status" aria-live="polite">
        Showing {total ? start + 1 : 0}–{end} of {total}
      </span>
      <div className="pc-list__page-actions">
        <button type="button" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}>
          Previous
        </button>
        <button
          type="button"
          disabled={page + 1 >= pageCount}
          onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
