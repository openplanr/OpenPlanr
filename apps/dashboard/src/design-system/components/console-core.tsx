import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Tabs as RadixTabs } from './composite-primitives.js';
import { PcIcon, type PcIconName } from './console-icon.js';
import { Tooltip } from './tooltip.js';

export {
  ChipToggle,
  type ChipToggleProps,
  Select,
  type SelectOption,
  type SelectProps,
} from './chip-menu.js';
export { CommandHint, type CommandHintProps } from './command-hint.js';

import './planr-console.css';

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
  'aria-expanded'?: boolean;
  'aria-pressed'?: boolean;
  'data-copy-command'?: 'true';
  disabledReason?: string;
}>;

const BUTTON_ICON = { sm: 15, md: 15, lg: 16 } as const;

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
  'aria-expanded': ariaExpanded,
  'aria-pressed': ariaPressed,
  'data-copy-command': copyCommand,
  disabledReason,
}: ButtonProps) {
  const reasonId = useId();
  return (
    <>
      <button
        type={type}
        className="pc-button"
        data-variant={variant}
        data-size={size}
        data-full={fullWidth || undefined}
        disabled={disabled || loading}
        aria-disabled={disabled || loading || undefined}
        aria-busy={loading || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        aria-label={ariaLabel}
        aria-expanded={ariaExpanded}
        aria-pressed={ariaPressed}
        data-copy-command={copyCommand}
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
      {disabledReason ? (
        <span className="pc-control-reason" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}

export type IconButtonProps = Readonly<{
  icon: PcIconName;
  label: string;
  size?: ControlSize;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'strong' | 'danger' | 'accent';
  disabledReason?: string;
  onClick?: () => void;
}>;

const ICON_BUTTON_ICON = { sm: 13, md: 16, lg: 16 } as const;

/** Square icon-only control for toolbars and row affordances. `label` is the accessible name. */
export function IconButton({
  icon,
  label,
  size = 'md',
  active = false,
  disabled = false,
  tone = 'default',
  onClick,
  disabledReason,
}: IconButtonProps) {
  const reasonId = useId();
  return (
    <Tooltip content={disabledReason ?? label}>
      <button
        type="button"
        className="pc-icon-button"
        data-size={size}
        data-tone={tone}
        data-active={active || undefined}
        aria-label={label}
        aria-pressed={active || undefined}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        onClick={onClick}
      >
        <PcIcon name={icon} size={ICON_BUTTON_ICON[size]} />
        {disabledReason ? (
          <span className="pc-visually-hidden" id={reasonId}>
            {disabledReason}
          </span>
        ) : null}
      </button>
    </Tooltip>
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

export type CardHeaderProps = Readonly<{
  title?: ReactNode;
  glyph?: ReactNode;
  count?: string | number;
  description?: string;
  actions?: ReactNode;
  href?: string;
  id?: string;
}>;

/** Fixed-height heading for artifact cards. */
export function CardHeader({
  title,
  glyph,
  count,
  description,
  actions,
  href,
  id,
}: CardHeaderProps) {
  const descriptionId = useId();
  return (
    <header className="pc-card__head">
      <div className="pc-card__heading">
        {glyph ? (
          <span className="pc-card__glyph" aria-hidden="true">
            {glyph}
          </span>
        ) : null}
        <h2 className="pc-card__title" id={id}>
          {title}
        </h2>
        {count !== undefined ? <span className="pc-card__meta">{count}</span> : null}
      </div>
      {description ? (
        <>
          <Tooltip content={description}>
            <button
              type="button"
              className="pc-card__info"
              aria-label={`About ${typeof title === 'string' ? title : 'this card'}`}
              aria-describedby={descriptionId}
            >
              <PcIcon name="info" size={15} />
            </button>
          </Tooltip>
          <span id={descriptionId} className="pc-visually-hidden">
            {description}
          </span>
        </>
      ) : null}
      {actions || href ? (
        <div className="pc-card__actions">
          {actions}
          {href ? (
            <a href={href} className="pc-card__see-all">
              See all{count !== undefined ? ` ${count}` : ''}
              <span className="pc-visually-hidden"> {title}</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

export type CardProps = Readonly<{
  children: ReactNode;
  className?: string;
  title?: string;
  meta?: string;
  actions?: ReactNode;
  padding?: number;
  elevated?: boolean;
  description?: string;
}>;

/** Hairline container for grouped content. Flat by default; `elevated` only for floating surfaces. */
export function Card({
  children,
  className,
  title,
  meta,
  actions,
  padding = 20,
  elevated = false,
  description,
}: CardProps) {
  return (
    <section
      className={className ? `pc-card ${className}` : 'pc-card'}
      data-elevated={elevated || undefined}
    >
      {title || actions ? (
        <CardHeader title={title} count={meta} description={description} actions={actions} />
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
  variant?: 'tile';
}>;

/** Empty state for a filtered table, a fresh workspace, or a cycle with nothing proposed. */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  variant,
}: EmptyStateProps) {
  return (
    <div className="pc-empty" data-variant={variant}>
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
  disabled?: boolean;
  disabledReason?: string;
  panelId?: string;
}>;

export type TabsProps = Readonly<{
  tabs: readonly TabDefinition[];
  value: string;
  onChange: (id: string) => void;
  size?: 'sm' | 'md';
  label?: string;
  variant?: 'underline' | 'pill';
}>;

/** Underlined view switcher for a single surface. */
export function Tabs({
  tabs,
  value,
  onChange,
  size = 'md',
  label,
  variant = 'underline',
}: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onChange} activationMode="manual">
      <RadixTabs.List
        className="pc-tabs"
        data-size={size}
        data-variant={variant}
        aria-label={label}
      >
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.id}
            value={tab.id}
            className="pc-tabs__tab"
            disabled={tab.disabled}
            aria-disabled={tab.disabled || undefined}
            aria-description={tab.disabledReason}
            aria-controls={tab.panelId}
            data-active={tab.id === value || undefined}
            onMouseDown={(event) => {
              // Preserve click activation while Radix owns roving focus and arrow keys.
              event.preventDefault();
              if (!tab.disabled) event.currentTarget.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (!tab.disabled) onChange(tab.id);
              }
            }}
            onClick={() => {
              if (!tab.disabled) onChange(tab.id);
            }}
          >
            {tab.icon ? <PcIcon name={tab.icon} size={13} /> : null}
            {tab.label}
            {tab.count !== undefined ? <span className="pc-tabs__count">{tab.count}</span> : null}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
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
  inset?: boolean;
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
  inset = false,
}: SectionHeaderProps) {
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'h3';
  return (
    <header
      className="pc-section-header"
      data-sticky={sticky || undefined}
      data-inset={inset || undefined}
    >
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
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel: string;
  placeholder?: string;
  icon?: PcIconName;
  suffix?: string;
  size?: ControlSize;
  mono?: boolean;
  width?: number;
  disabled?: boolean;
  disabledReason?: string;
  error?: string;
}>;

/** Single-line text input at console density. */
export function Input({
  value,
  onChange,
  onKeyDown,
  ariaLabel,
  placeholder,
  icon,
  suffix,
  size = 'md',
  mono = false,
  width,
  disabled = false,
  disabledReason,
  error,
}: InputProps) {
  const reasonId = useId();
  return (
    <span className="pc-field-control" style={{ width }}>
      <span
        className="pc-input"
        data-size={size}
        data-disabled={disabled || undefined}
        data-invalid={Boolean(error) || undefined}
      >
        {icon ? <PcIcon name={icon} size={15} color="var(--pc-text-tertiary)" /> : null}
        <input
          className="pc-input__field"
          data-mono={mono || undefined}
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error || disabledReason ? reasonId : undefined}
          onKeyDown={onKeyDown}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            if (!disabled) onChange(event.target.value);
          }}
        />
        {suffix ? <span className="pc-input__suffix">{suffix}</span> : null}
      </span>
      {error || disabledReason ? (
        <span className="pc-control-reason" id={reasonId} role={error ? 'alert' : undefined}>
          {error ?? disabledReason}
        </span>
      ) : null}
    </span>
  );
}

export type SwitchProps = Readonly<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
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
  disabledReason,
}: SwitchProps) {
  const reasonId = useId();
  return (
    <label className="pc-switch" data-size={size} data-disabled={disabled || undefined}>
      <input
        type="checkbox"
        role="switch"
        className="pc-switch__input"
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        aria-label={label ? undefined : ariaLabel}
        onChange={(event) => {
          if (!disabled) onChange(event.target.checked);
        }}
      />
      <span className="pc-switch__track" aria-hidden="true">
        <span className="pc-switch__thumb" />
      </span>
      {label ? <span className="pc-switch__label">{label}</span> : null}
      {disabledReason ? (
        <span className="pc-control-reason" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
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

// ---------------------------------------------------------------- DataTable

export type DataTableColumn<Row> = Readonly<{
  key: string;
  label: string;
  width?: number | string;
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
  selectedIds?: ReadonlySet<string>;
  onRowSelect?: (row: Row) => void;
  rowCount?: number;
  rowPosition?: (row: Row) => number;
  rowWindow?: Readonly<{ start: number; end: number; rowHeight: number; retainedId?: string }>;
  groups?: readonly Readonly<{
    key: string;
    label: string;
    rows: readonly Row[];
    header?: ReactNode;
    headerRowPosition?: number;
    collapsed?: boolean;
    rowWindow?: DataTableProps<Row>['rowWindow'];
    rowPosition?: (row: Row) => number;
  }>[];
  rowHref?: (row: Row) => string | null;
  sort?: DataTableSort;
  onSort?: (key: string) => void;
  onRowClick?: (row: Row) => void;
  onRowFocus?: (row: Row) => void;
}>;

function cellValue<Row>(row: Row, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  return value === null || value === undefined ? null : String(value);
}

type TableWindowEntry<Row> = { row: Row; index: number } | { gap: number; index: number };
function tableWindowEntries<Row extends { readonly id: string }>(
  rows: readonly Row[],
  window: DataTableProps<Row>['rowWindow'],
): TableWindowEntry<Row>[] {
  if (!window) return rows.map((row, index) => ({ row, index }));
  const result: TableWindowEntry<Row>[] = [];
  let gap = 0;
  rows.forEach((row, index) => {
    if ((index >= window.start && index < window.end) || row.id === window.retainedId) {
      if (gap) result.push({ gap: gap * window.rowHeight, index: index - gap });
      gap = 0;
      result.push({ row, index });
    } else gap++;
  });
  if (gap) result.push({ gap: gap * window.rowHeight, index: rows.length - gap });
  return result;
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
  selectedIds,
  onRowSelect,
  rowCount,
  rowPosition,
  rowWindow,
  groups,
  rowHref,
  sort,
  onSort,
  onRowClick,
  onRowFocus,
}: DataTableProps<Row>) {
  const scrollRegion = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const scrollContext = caption ?? 'table';
  const measureScrollRegion = useCallback(() => {
    const region = scrollRegion.current;
    if (region)
      setScrollable(
        region.scrollWidth > region.clientWidth || region.scrollHeight > region.clientHeight,
      );
  }, []);
  useLayoutEffect(measureScrollRegion);
  useLayoutEffect(() => {
    const region = scrollRegion.current;
    if (!region) return;
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureScrollRegion);
    observer?.observe(region);
    const table = region.querySelector('table');
    if (table) observer?.observe(table);
    window.addEventListener('resize', measureScrollRegion);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureScrollRegion);
    };
  }, [measureScrollRegion]);
  const regionAccessibility = scrollable
    ? { tabIndex: 0, role: 'region' as const, 'aria-label': scrollContext }
    : {};
  const activate = (row: Row) => onRowClick?.(row);
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (!onRowClick) return;
    if (event.target !== event.currentTarget) return;
    if (event.key === ' ' && onRowSelect) {
      event.preventDefault();
      onRowSelect(row);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(row);
    }
  };
  const rowGroups: NonNullable<DataTableProps<Row>['groups']> = groups ?? [
    { key: 'all', label: '', rows, rowWindow },
  ];
  return (
    <div
      ref={scrollRegion}
      className="pc-table-wrap"
      data-scroll-context={scrollContext}
      {...regionAccessibility}
    >
      <table
        className="pc-table"
        aria-rowcount={rowCount === undefined ? undefined : rowCount + 1}
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
                  data-column={column.key}
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
        {rowGroups.map((group) => (
          <tbody
            key={group.key}
            aria-label={group.label || undefined}
            data-keyboard-group={groups ? group.key : undefined}
          >
            {group.header ? (
              <tr className="pc-table__group-header" aria-rowindex={group.headerRowPosition}>
                <td colSpan={columns.length}>{group.header}</td>
              </tr>
            ) : null}
            {rows.length === 0 ? (
              <tr>
                <td className="pc-table__empty" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              tableWindowEntries(group.rows, group.rowWindow).map((entry) => {
                if ('gap' in entry)
                  return (
                    <tr
                      key={`gap:${entry.index}`}
                      inert
                      className="pc-table__spacer"
                      hidden={group.collapsed}
                    >
                      <td
                        aria-hidden="true"
                        colSpan={columns.length}
                        style={{ height: entry.gap, padding: 0, border: 0 }}
                      />
                    </tr>
                  );
                const { row } = entry;
                return (
                  <tr
                    key={row.id}
                    hidden={group.collapsed}
                    aria-rowindex={
                      group.rowPosition
                        ? group.rowPosition(row) + 1
                        : rowPosition
                          ? rowPosition(row) + 1
                          : undefined
                    }
                    aria-selected={selectedIds ? selectedIds.has(row.id) : undefined}
                    data-done={(row as { status?: string }).status === 'done' || undefined}
                    data-keyboard-item={onRowClick ? row.id : undefined}
                    data-selected={
                      selectedId !== undefined && row.id === selectedId ? true : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    onFocus={onRowFocus ? () => onRowFocus(row) : undefined}
                    onClick={
                      onRowClick
                        ? (event) => {
                            if (
                              event.metaKey ||
                              event.ctrlKey ||
                              event.altKey ||
                              event.shiftKey ||
                              (event.target instanceof Element &&
                                event.target.closest('a, button, input, [role="combobox"]'))
                            )
                              return;
                            event.currentTarget.focus({ preventScroll: true });
                            activate(row);
                          }
                        : undefined
                    }
                    onKeyDown={onRowClick ? (event) => onRowKey(event, row) : undefined}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        data-column={column.key}
                        data-align={column.align ?? 'left'}
                        data-mono={column.mono || undefined}
                        style={{ maxWidth: column.width }}
                      >
                        {rowHref && column.key === 'id' && rowHref(row) ? (
                          <a
                            href={rowHref(row) ?? undefined}
                            onClick={(event) => {
                              if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
                                return;
                              event.preventDefault();
                              event.currentTarget.closest('tr')?.focus({ preventScroll: true });
                              activate(row);
                            }}
                          >
                            {column.render ? column.render(row) : cellValue(row, column.key)}
                          </a>
                        ) : column.render ? (
                          column.render(row)
                        ) : (
                          cellValue(row, column.key)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Stable id for labelled controls that need one. */
export function useControlId(prefix: string): string {
  const id = useId();
  return `${prefix}-${id}`;
}
