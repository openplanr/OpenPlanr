import type { ReactNode } from 'react';
import './planr-console.css';

/**
 * Planr Console presentational primitives that predate the v1 kit and are still consumed by
 * the planning and operate pages. Pure and data-agnostic: they render only what a caller
 * passes and never infer or fabricate planning fields.
 */

const STATUS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  outstanding: 'outstanding',
  'in-progress': 'in progress',
  blocked: 'blocked',
  done: 'done',
  addressed: 'addressed',
});

export type StatusBadgeProps = Readonly<{ status: string; label?: string }>;

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className="pc-status" data-status={status}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * Governed Operate lifecycle states mapped to a signal tone. Values are the real
 * runtime enums (governed action, execution result, cycle, cycle stage, recovery,
 * verification, outcome, finding, evidence claim, projection presentation); unknown
 * states fall back to the neutral tone rather than being invented a color.
 */
const STATE_TONE: Readonly<Record<string, 'pending' | 'active' | 'settled' | 'alert' | 'neutral'>> =
  Object.freeze({
    // governed action lifecycle (OperatingActionStateV2)
    proposed: 'pending',
    approved: 'active',
    queued: 'pending',
    in_progress: 'active',
    completed: 'settled',
    blocked: 'alert',
    rejected: 'alert',
    deferred: 'neutral',
    cancelled: 'neutral',
    // execution / rollback result
    succeeded: 'settled',
    failed: 'alert',
    partial: 'pending',
    uncertain: 'pending',
    // cycle lifecycle
    created: 'neutral',
    observing: 'active',
    advising: 'active',
    challenging: 'active',
    synthesizing: 'active',
    awaiting_review: 'pending',
    executing: 'active',
    verifying: 'active',
    closed: 'settled',
    // cycle stage state
    current: 'active',
    available: 'neutral',
    complete: 'settled',
    skipped: 'neutral',
    revisited: 'pending',
    waiting: 'pending',
    // cycle health
    normal: 'active',
    quiet: 'neutral',
    // recovery state
    custody: 'pending',
    divergent: 'alert',
    corrupt: 'alert',
    incompatible: 'alert',
    restored: 'settled',
    // verification / outcome status
    'not-required': 'neutral',
    verified: 'settled',
    unverified: 'pending',
    'insufficient-evidence': 'pending',
    // finding state
    open: 'pending',
    accepted: 'active',
    resolved: 'settled',
    superseded: 'neutral',
    // evidence claim status
    supported: 'settled',
    contradicted: 'alert',
    unknown: 'neutral',
    restricted: 'neutral',
    // projection presentation
    ready: 'active',
    'read-only': 'neutral',
    stale: 'pending',
    offline: 'alert',
  });

function humanizeState(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ');
}

export type ActionStateBadgeProps = Readonly<{ state: string; label?: string }>;

/** Badge for governed Operate lifecycle states. Renders the real state; never infers one. */
export function ActionStateBadge({ state, label }: ActionStateBadgeProps) {
  return (
    <span className="pc-state" data-tone={STATE_TONE[state] ?? 'neutral'} data-state={state}>
      {label ?? humanizeState(state)}
    </span>
  );
}

export type MetricStatProps = Readonly<{
  label: string;
  value: string | number;
  tone?: 'default' | 'attention';
  icon?: ReactNode;
  delta?: string;
  trend?: 'up' | 'down';
}>;

export function MetricStat({
  label,
  value,
  tone = 'default',
  icon,
  delta,
  trend,
}: MetricStatProps) {
  return (
    <li className="pc-metric" data-tone={tone}>
      <span className="pc-metric__label">
        {icon ? (
          <span className="pc-metric__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {label}
      </span>
      <span className="pc-metric__row">
        <span className="pc-metric__value">{value}</span>
        {delta ? (
          <span className="pc-metric__delta" data-trend={trend ?? 'up'}>
            {delta}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export type SegmentedOption = Readonly<{ key: string; label: string }>;

export type SegmentedControlProps = Readonly<{
  label: string;
  options: readonly SegmentedOption[];
  value: string;
  onChange: (key: string) => void;
}>;

/** Controlled single-select toggle. Presentational: emits the chosen key, owns no state. */
export function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
  return (
    <fieldset className="pc-segmented" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className="pc-segmented__option"
          data-active={option.key === value}
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

export type BoardColumnProps = Readonly<{
  title: string;
  count: number;
  children: ReactNode;
}>;

export function BoardColumn({ title, count, children }: BoardColumnProps) {
  return (
    <section
      className="pc-board__column"
      aria-label={`${title}: ${count} ${count === 1 ? 'item' : 'items'}`}
    >
      <header className="pc-board__column-head">
        <h3 className="pc-board__column-title">{title}</h3>
        <span className="pc-board__column-count" aria-hidden="true">
          {count}
        </span>
      </header>
      <div className="pc-board__cards">{children}</div>
    </section>
  );
}

export type DefinitionGridItem = Readonly<{
  term: string;
  description: ReactNode;
  mono?: boolean;
}>;

export type DefinitionGridProps = Readonly<{ items: readonly DefinitionGridItem[] }>;

export function DefinitionGrid({ items }: DefinitionGridProps) {
  return (
    <dl className="pc-def-grid">
      {items.map((item) => (
        <div className="pc-def-grid__row" key={item.term}>
          <dt className="pc-def-grid__term">{item.term}</dt>
          <dd className="pc-def-grid__desc" data-mono={item.mono ?? false}>
            {item.description}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type SprintBurndownPoint = Readonly<{ day: number; remaining: number }>;

export type SprintBurndownProps = Readonly<{
  ideal: readonly SprintBurndownPoint[];
  actual: readonly SprintBurndownPoint[];
  committed: number;
  lengthDays: number;
}>;

const BURNDOWN_WIDTH = 320;
const BURNDOWN_HEIGHT = 132;
const BURNDOWN_PAD = 8;

function burndownPath(
  points: readonly SprintBurndownPoint[],
  lengthDays: number,
  maxRemaining: number,
): string {
  const spanX = BURNDOWN_WIDTH - BURNDOWN_PAD * 2;
  const spanY = BURNDOWN_HEIGHT - BURNDOWN_PAD * 2;
  const days = lengthDays > 0 ? lengthDays : 1;
  const top = maxRemaining > 0 ? maxRemaining : 1;
  return points
    .map((point, index) => {
      const x = BURNDOWN_PAD + (Math.min(point.day, days) / days) * spanX;
      const y = BURNDOWN_PAD + spanY - (Math.min(point.remaining, top) / top) * spanY;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Ideal vs. actual burndown as a small line chart. Renders only the points it is given. */
export function SprintBurndown({ ideal, actual, committed, lengthDays }: SprintBurndownProps) {
  const maxRemaining = Math.max(
    committed,
    ...ideal.map((point) => point.remaining),
    ...actual.map((point) => point.remaining),
    1,
  );
  const remaining = actual.at(-1)?.remaining ?? 0;
  const currentDay = actual.at(-1)?.day ?? 0;
  const summary = `Burndown: ${remaining} of ${committed} remaining on day ${currentDay} of ${lengthDays}.`;
  return (
    <figure className="pc-burndown">
      <svg
        className="pc-burndown__chart"
        viewBox={`0 0 ${BURNDOWN_WIDTH} ${BURNDOWN_HEIGHT}`}
        role="img"
        aria-label={summary}
      >
        <line
          className="pc-burndown__grid"
          x1={BURNDOWN_PAD}
          y1={BURNDOWN_HEIGHT - BURNDOWN_PAD}
          x2={BURNDOWN_WIDTH - BURNDOWN_PAD}
          y2={BURNDOWN_HEIGHT - BURNDOWN_PAD}
        />
        <path className="pc-burndown__ideal" d={burndownPath(ideal, lengthDays, maxRemaining)} />
        <path className="pc-burndown__actual" d={burndownPath(actual, lengthDays, maxRemaining)} />
      </svg>
      <figcaption className="pc-burndown__legend">
        <span className="pc-burndown__legend-ideal">Ideal</span>
        <span className="pc-burndown__legend-actual">Remaining</span>
      </figcaption>
    </figure>
  );
}
