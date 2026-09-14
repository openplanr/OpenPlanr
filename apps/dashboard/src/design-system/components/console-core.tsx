import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';
import { PcIcon, type PcIconName } from './console-icon.js';
import './planr-console.css';

/*
 * Planr Console core kit, ported 1:1 from the design system's component sources
 * (Button, IconButton, Kbd, Badge, Card, EmptyState, Tabs, Skeleton, Toolbar,
 * SectionHeader, Input, Select, Switch, InlineAlert, CommandHint, DataTable).
 * Presentational only; every component renders exactly what it is given.
 */

// ---------------------------------------------------------------- Button

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';
export type ControlSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Readonly<{
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: PcIconName;
  iconAfter?: PcIconName;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  shortcut?: string;
  type?: 'button' | 'submit';
  onClick?: () => void;
  ariaLabel?: string;
}>;

const BUTTON_ICON = { sm: 13, md: 14, lg: 16 } as const;

/** The console's action control. Primary is reserved for the one governed action per view. */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  disabled = false,
  loading = false,
  fullWidth = false,
  shortcut,
  type = 'button',
  onClick,
  ariaLabel,
}: ButtonProps) {
  return (
    <button
      type={type}
      className="pc-button"
      data-variant={variant}
      data-size={size}
      data-full={fullWidth || undefined}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {loading ? (
        <PcIcon name="loader-circle" size={BUTTON_ICON[size]} spin />
      ) : icon ? (
        <PcIcon name={icon} size={BUTTON_ICON[size]} />
      ) : null}
      {children}
      {iconAfter ? <PcIcon name={iconAfter} size={BUTTON_ICON[size]} /> : null}
      {shortcut ? <span className="pc-button__shortcut">{shortcut}</span> : null}
    </button>
  );
}

export type IconButtonProps = Readonly<{
  icon: PcIconName;
  label: string;
  size?: ControlSize;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'strong' | 'danger' | 'accent';
  onClick?: () => void;
}>;

const ICON_BUTTON_ICON = { sm: 13, md: 15, lg: 17 } as const;

/** Square icon-only control for toolbars and row affordances. `label` is the accessible name. */
export function IconButton({
  icon,
  label,
  size = 'md',
  active = false,
  disabled = false,
  tone = 'default',
  onClick,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className="pc-icon-button"
      data-size={size}
      data-tone={tone}
      data-active={active || undefined}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <PcIcon name={icon} size={ICON_BUTTON_ICON[size]} />
    </button>
  );
}

export type KbdProps = Readonly<{ children: ReactNode; size?: 'sm' | 'md' }>;

/** Keyboard key. The console is keyboard-first, so shortcuts are shown, not hidden. */
export function Kbd({ children, size = 'md' }: KbdProps) {
  return (
    <kbd className="pc-kbd" data-size={size}>
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------- Badge / Card / EmptyState

export type BadgeTone = 'neutral' | 'accent' | 'info' | 'warn' | 'danger' | 'success';

export type BadgeProps = Readonly<{
  children: ReactNode;
  tone?: BadgeTone;
  variant?: 'soft' | 'outline' | 'solid';
  icon?: PcIconName;
  mono?: boolean;
}>;

/** Small count / attribute marker. Governed action state uses StateBadge instead. */
export function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  icon,
  mono = false,
}: BadgeProps) {
  return (
    <span
      className="pc-badge"
      data-tone={tone}
      data-variant={variant}
      data-mono={mono || undefined}
    >
      {icon ? <PcIcon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

export type CardProps = Readonly<{
  children: ReactNode;
  title?: string;
  meta?: string;
  actions?: ReactNode;
  padding?: number;
  elevated?: boolean;
}>;

/** Hairline container for grouped content. Flat by default; `elevated` only for floating surfaces. */
export function Card({
  children,
  title,
  meta,
  actions,
  padding = 14,
  elevated = false,
}: CardProps) {
  return (
    <section className="pc-card" data-elevated={elevated || undefined}>
      {title || actions ? (
        <header className="pc-card__head">
          {title ? <h2 className="pc-card__title">{title}</h2> : null}
          {meta ? <span className="pc-card__meta">{meta}</span> : null}
          {actions ? <div className="pc-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="pc-card__body" style={{ padding }}>
        {children}
      </div>
    </section>
  );
}

export type EmptyStateProps = Readonly<{
  icon?: PcIconName;
  title: string;
  description?: string;
  action?: ReactNode;
}>;

/** Empty state for a filtered table, a fresh workspace, or a cycle with nothing proposed. */
export function EmptyState({ icon = 'inbox', title, description, action }: EmptyStateProps) {
  return (
    <div className="pc-empty">
      <span className="pc-empty__glyph" aria-hidden="true">
        <PcIcon name={icon} size={17} />
      </span>
      <span className="pc-empty__title">{title}</span>
      {description ? <p className="pc-empty__desc">{description}</p> : null}
      {action ? <div className="pc-empty__action">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Tabs

export type TabDefinition = Readonly<{
  id: string;
  label: string;
  icon?: PcIconName;
  count?: number | string;
}>;

export type TabsProps = Readonly<{
  tabs: readonly TabDefinition[];
  value: string;
  onChange: (id: string) => void;
  size?: 'sm' | 'md';
  label?: string;
}>;

/** Underlined view switcher for a single surface. */
export function Tabs({ tabs, value, onChange, size = 'md', label }: TabsProps) {
  return (
    <div className="pc-tabs" data-size={size} role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="pc-tabs__tab"
            aria-selected={active}
            data-active={active || undefined}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon ? <PcIcon name={tab.icon} size={13} /> : null}
            {tab.label}
            {tab.count !== undefined ? <span className="pc-tabs__count">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Skeleton

export type SkeletonProps = Readonly<{
  w?: number | string;
  h?: number;
  radius?: string;
  delay?: number;
}>;

/** Loading placeholder sized like the value it stands in for, so nothing shifts when data lands. */
export function Skeleton({ w = '100%', h = 10, radius, delay = 0 }: SkeletonProps) {
  return (
    <span
      className="pc-skeleton"
      aria-hidden="true"
      style={{ width: w, height: h, borderRadius: radius, animationDelay: `${delay}ms` }}
    />
  );
}

export type SkeletonColumn = Readonly<{ label: string; width?: number; fill?: string }>;

export type SkeletonTableProps = Readonly<{
  columns: readonly SkeletonColumn[];
  rows?: number;
  label?: string;
}>;

const SKELETON_FLOOR = 160;

/** A table that has not arrived yet: real header labels, placeholder cells. */
export function SkeletonTable({ columns, rows = 6, label }: SkeletonTableProps) {
  const minWidth =
    24 +
    12 * Math.max(columns.length - 1, 0) +
    columns.reduce((sum, column) => sum + (column.width ?? SKELETON_FLOOR), 0);
  const cell = (column: SkeletonColumn) => ({
    flex: column.width ? `0 0 ${column.width}px` : `1 0 ${SKELETON_FLOOR}px`,
  });
  const placeholders = Array.from({ length: rows }, (_, row) => ({ id: `row-${row}`, row }));
  return (
    <output className="pc-skeleton-table" aria-busy="true" aria-label={label ?? 'Loading'}>
      <div className="pc-skeleton-table__head" style={{ minWidth }}>
        {columns.map((column) => (
          <span key={column.label} style={cell(column)}>
            {column.label}
          </span>
        ))}
      </div>
      {placeholders.map(({ id, row }) => (
        <div key={id} className="pc-skeleton-table__row" style={{ minWidth }}>
          {columns.map((column, index) => (
            <span key={column.label} style={cell(column)}>
              <Skeleton
                w={column.fill ?? (index === 0 ? '72%' : '56%')}
                delay={(row * columns.length + index) * 40}
              />
            </span>
          ))}
        </div>
      ))}
    </output>
  );
}

export type SkeletonCardsProps = Readonly<{
  count?: number;
  height?: number;
  min?: number;
  label?: string;
}>;

/** Card-shaped placeholders for the grids that hold action cards. */
export function SkeletonCards({ count = 4, height = 148, min = 360, label }: SkeletonCardsProps) {
  const placeholders = Array.from({ length: count }, (_, index) => ({
    id: `card-${index}`,
    index,
  }));
  return (
    <output
      className="pc-skeleton-cards"
      aria-busy="true"
      aria-label={label ?? 'Loading'}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}
    >
      {placeholders.map(({ id, index }) => (
        <div key={id} className="pc-skeleton-cards__card" style={{ height }}>
          <div className="pc-skeleton-cards__row">
            <Skeleton w={84} h={16} delay={index * 60} />
            <Skeleton w={104} h={18} radius="999px" delay={index * 60 + 40} />
          </div>
          <Skeleton w="82%" h={13} delay={index * 60 + 80} />
          <Skeleton w="94%" delay={index * 60 + 120} />
          <Skeleton w="66%" delay={index * 60 + 160} />
          <span className="pc-skeleton-cards__foot">
            <Skeleton w="46%" h={22} delay={index * 60 + 200} />
          </span>
        </div>
      ))}
    </output>
  );
}

// ---------------------------------------------------------------- Toolbar / SectionHeader

export type ToolbarProps = Readonly<{ children: ReactNode; right?: ReactNode }>;

/** Horizontal control strip above a table or graph: filters left, view switches right. */
export function Toolbar({ children, right }: ToolbarProps) {
  return (
    <div className="pc-toolbar-bar">
      {children}
      {right ? <div className="pc-toolbar-bar__right">{right}</div> : null}
    </div>
  );
}

export function ToolbarDivider() {
  return <span className="pc-toolbar-bar__divider" aria-hidden="true" />;
}

export type SectionHeaderProps = Readonly<{
  eyebrow?: string;
  title: string;
  count?: string | number;
  description?: string;
  actions?: ReactNode;
  sticky?: boolean;
  headingLevel?: 1 | 2 | 3;
}>;

/** View header: eyebrow capability label, title, count, and the view's action cluster. */
export function SectionHeader({
  eyebrow,
  title,
  count,
  description,
  actions,
  sticky = false,
  headingLevel = 1,
}: SectionHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'h3';
  return (
    <header className="pc-section-header" data-sticky={sticky || undefined}>
      <div className="pc-section-header__text">
        {eyebrow ? <span className="pc-section-header__eyebrow">{eyebrow}</span> : null}
        <div className="pc-section-header__row">
          <Heading className="pc-section-header__title">{title}</Heading>
          {count !== undefined ? <span className="pc-section-header__count">{count}</span> : null}
        </div>
        {description ? <p className="pc-section-header__desc">{description}</p> : null}
      </div>
      {actions ? <div className="pc-section-header__actions">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------- Input / Select / Switch

export type InputProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  icon?: PcIconName;
  suffix?: string;
  size?: ControlSize;
  mono?: boolean;
  width?: number;
}>;

/** Single-line text input at console density. */
export function Input({
  value,
  onChange,
  ariaLabel,
  placeholder,
  icon,
  suffix,
  size = 'md',
  mono = false,
  width,
}: InputProps) {
  return (
    <span className="pc-input" data-size={size} style={{ width }}>
      {icon ? <PcIcon name={icon} size={14} color="var(--pc-text-tertiary)" /> : null}
      <input
        className="pc-input__field"
        data-mono={mono || undefined}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      {suffix ? <span className="pc-input__suffix">{suffix}</span> : null}
    </span>
  );
}

export type SelectOption = Readonly<{ value: string; label: string }>;

export type SelectProps = Readonly<{
  value: string;
  onChange: (value: string) => void;
  options: readonly (SelectOption | string)[];
  ariaLabel: string;
  size?: ControlSize;
  width?: number;
}>;

/** Native select in console dress. */
export function Select({ value, onChange, options, ariaLabel, size = 'md', width }: SelectProps) {
  return (
    <span className="pc-select" data-size={size} style={{ width }}>
      <select
        className="pc-select__field"
        value={value}
        aria-label={ariaLabel}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      >
        {options.map((option) => {
          const item = typeof option === 'string' ? { value: option, label: option } : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
      <PcIcon name="chevron-down" size={13} color="var(--pc-text-tertiary)" />
    </span>
  );
}

export type SwitchProps = Readonly<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}>;

/** Binary setting. Never a form submit. */
export function Switch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  size = 'md',
}: SwitchProps) {
  return (
    <label className="pc-switch" data-size={size} data-disabled={disabled || undefined}>
      <input
        type="checkbox"
        role="switch"
        className="pc-switch__input"
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="pc-switch__track" aria-hidden="true">
        <span className="pc-switch__thumb" />
      </span>
      {label ? <span className="pc-switch__label">{label}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------- InlineAlert / CommandHint

export type InlineAlertTone = 'warn' | 'danger' | 'info' | 'success';

export type InlineAlertProps = Readonly<{
  tone?: InlineAlertTone | 'warning';
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}>;

const ALERT_ICON: Readonly<Record<InlineAlertTone, PcIconName>> = Object.freeze({
  warn: 'triangle-alert',
  danger: 'octagon-alert',
  info: 'info',
  success: 'circle-check',
});

/** Inline banner for a condition the operator must resolve. It stays until fixed. */
export function InlineAlert({ tone = 'warn', title, children, actions }: InlineAlertProps) {
  const resolved: InlineAlertTone = tone === 'warning' ? 'warn' : tone;
  return (
    <div className="pc-alert" data-tone={resolved} role="note">
      <PcIcon name={ALERT_ICON[resolved]} size={14} />
      <div className="pc-alert__body">
        {title ? <span className="pc-alert__title">{title}</span> : null}
        {children ? <span className="pc-alert__text">{children}</span> : null}
      </div>
      {actions ? <div className="pc-alert__actions">{actions}</div> : null}
    </div>
  );
}

export type CommandHintProps = Readonly<{
  command: string;
  label?: string;
  size?: 'sm' | 'md';
}>;

/**
 * A copy-ready invocation. The console never mutates the graph; the clipboard write is
 * the only outbound effect a read-only surface gets, and a refused write is reported.
 */
export function CommandHint({ command, label, size = 'md' }: CommandHintProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'blocked'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 1400);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = () => {
    if (!navigator.clipboard) {
      setState('blocked');
      return;
    }
    navigator.clipboard.writeText(command).then(
      () => setState('copied'),
      () => setState('blocked'),
    );
  };
  const buttonLabel =
    state === 'copied'
      ? 'Command copied'
      : state === 'blocked'
        ? 'Copy was blocked'
        : 'Copy command';
  return (
    <div className="pc-command-hint" data-size={size}>
      {label ? <span className="pc-command-hint__label">{label}</span> : null}
      <div className="pc-command-hint__row">
        <span className="pc-command-hint__command">
          <PcIcon name="terminal" size={12} color="var(--pc-text-tertiary)" />
          {command}
        </span>
        <button
          type="button"
          className="pc-command-hint__copy"
          data-state={state}
          aria-label={buttonLabel}
          onClick={copy}
        >
          <PcIcon
            name={state === 'copied' ? 'check' : state === 'blocked' ? 'x' : 'copy'}
            size={12}
          />
          {state === 'idle' ? null : state}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- DataTable

export type DataTableColumn<Row> = Readonly<{
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right';
  mono?: boolean;
  sortable?: boolean;
  render?: (row: Row) => ReactNode;
}>;

export type DataTableSort = Readonly<{ key: string; dir: 'asc' | 'desc' }>;

export type DataTableProps<Row extends { readonly id: string }> = Readonly<{
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  compact?: boolean;
  caption?: string;
  emptyMessage?: string;
  selectedId?: string;
  sort?: DataTableSort;
  onSort?: (key: string) => void;
  onRowClick?: (row: Row) => void;
}>;

function cellValue<Row>(row: Row, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  return value === null || value === undefined ? null : String(value);
}

/**
 * The console's workhorse table: sticky header, 32px rows, zebra stripe, sortable columns,
 * optional row activation. Rows never become cards; legibility past 200 rows comes from density.
 */
export function DataTable<Row extends { readonly id: string }>({
  columns,
  rows,
  compact = false,
  caption,
  emptyMessage = 'Nothing here yet.',
  selectedId,
  sort,
  onSort,
  onRowClick,
}: DataTableProps<Row>) {
  const activate = (row: Row) => onRowClick?.(row);
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (!onRowClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(row);
    }
  };
  return (
    <div className="pc-table-wrap">
      <table
        className="pc-table"
        data-compact={compact || undefined}
        data-interactive={onRowClick ? true : undefined}
      >
        {caption ? <caption className="pc-visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const heading = (
                <span className="pc-table__heading">
                  {column.label}
                  {column.sortable ? (
                    <PcIcon
                      name={
                        active
                          ? sort?.dir === 'asc'
                            ? 'chevron-up'
                            : 'chevron-down'
                          : 'chevrons-up-down'
                      }
                      size={12}
                      color={active ? 'var(--pc-text-primary)' : 'var(--pc-text-tertiary)'}
                    />
                  ) : null}
                </span>
              );
              return (
                <th
                  key={column.key}
                  scope="col"
                  data-align={column.align ?? 'left'}
                  style={{ width: column.width }}
                  aria-sort={
                    active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      className="pc-table__sort"
                      onClick={() => onSort(column.key)}
                    >
                      {heading}
                    </button>
                  ) : (
                    heading
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="pc-table__empty" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                data-selected={selectedId !== undefined && row.id === selectedId ? true : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => activate(row) : undefined}
                onKeyDown={onRowClick ? (event) => onRowKey(event, row) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-align={column.align ?? 'left'}
                    data-mono={column.mono || undefined}
                    style={{ maxWidth: column.width }}
                  >
                    {column.render ? column.render(row) : cellValue(row, column.key)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Stable id for labelled controls that need one. */
export function useControlId(prefix: string): string {
  const id = useId();
  return `${prefix}-${id}`;
}
