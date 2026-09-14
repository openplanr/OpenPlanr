import type { ReactNode } from 'react';
import { Badge, type BadgeTone, CommandHint } from './console-core.js';
import { PcIcon, type PcIconName } from './console-icon.js';
import './planr-console.css';

/*
 * Planr-domain components, ported 1:1 from the design system: the two status vocabularies
 * (ArtifactStatus for the graph, StateBadge for the Operate protocol), work-item and
 * capability labels, the read-only governed action card, the dependency graph with its
 * outline peer, the activity timeline, sprint progress, and the page helpers every screen
 * shares. Everything renders only what it is given.
 */

// ---------------------------------------------------------------- ArtifactStatus

export const ARTIFACT_STATUS_ORDER = Object.freeze([
  'outstanding',
  'in-progress',
  'blocked',
  'addressed',
  'done',
] as const);

const ARTIFACT_LABEL: Readonly<Record<string, string>> = Object.freeze({
  done: 'done',
  'in-progress': 'in progress',
  blocked: 'blocked',
  outstanding: 'outstanding',
  addressed: 'addressed',
});

export type ArtifactStatusProps = Readonly<{
  status: string;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  count?: number | string;
}>;

/**
 * Status of a planning artifact: a shape-varied dot plus a label, never a bordered chip, so
 * it can never be misread as a governed action state — including in greyscale or at 11px.
 */
export function ArtifactStatus({
  status,
  size = 'md',
  showLabel = true,
  count,
}: ArtifactStatusProps) {
  const known = status in ARTIFACT_LABEL ? status : 'outstanding';
  const label = ARTIFACT_LABEL[known] ?? status;
  return (
    <span className="pc-artifact" data-status={known} data-size={size}>
      <span className="pc-artifact__dot" aria-hidden="true" />
      <span className={showLabel ? 'pc-artifact__label' : 'pc-visually-hidden'}>{label}</span>
      {count !== undefined ? <span className="pc-artifact__count">{count}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------- StateBadge

type StateFamily = 'pre' | 'active' | 'good' | 'bad' | 'inert';
type StateRecipe = Readonly<{
  label: string;
  icon: PcIconName;
  family: StateFamily;
  dash?: boolean;
  double?: boolean;
  live?: boolean;
}>;

/** The nine governed-action states of the Operate protocol. */
export const ACTION_STATES: Readonly<Record<string, StateRecipe>> = Object.freeze({
  proposed: { label: 'proposed', icon: 'circle-dashed', family: 'pre', dash: true },
  approved: { label: 'approved', icon: 'circle-check', family: 'pre' },
  queued: { label: 'queued', icon: 'clock', family: 'pre' },
  in_progress: { label: 'in progress', icon: 'circle-play', family: 'active', live: true },
  completed: { label: 'completed', icon: 'circle-check', family: 'good' },
  blocked: { label: 'blocked', icon: 'circle-slash', family: 'bad' },
  rejected: { label: 'rejected', icon: 'circle-x', family: 'bad', double: true },
  deferred: { label: 'deferred', icon: 'circle-pause', family: 'inert', dash: true },
  cancelled: { label: 'cancelled', icon: 'ban', family: 'inert' },
});

/** Durable execution results — a different vocabulary from the action's own state. */
export const EXECUTION_RESULTS: Readonly<Record<string, StateRecipe>> = Object.freeze({
  succeeded: { label: 'succeeded', icon: 'check-check', family: 'good' },
  failed: { label: 'failed', icon: 'triangle-alert', family: 'bad', double: true },
  partial: { label: 'partial', icon: 'circle-minus', family: 'pre' },
  uncertain: { label: 'uncertain', icon: 'circle-alert', family: 'inert', dash: true },
});

const STATE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  running: 'in_progress',
  closed: 'completed',
  'in-progress': 'in_progress',
});

export type StateBadgeProps = Readonly<{
  state: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  label?: string;
}>;

/**
 * Governed-action state marker: a bordered mono chip whose glyph and border treatment
 * carry the state alongside colour. Reserved for protocol states and execution results.
 */
export function StateBadge({ state, size = 'md', showLabel = true, label }: StateBadgeProps) {
  const key = STATE_ALIASES[state] ?? state;
  const recipe = ACTION_STATES[key] ?? EXECUTION_RESULTS[key] ?? ACTION_STATES.proposed;
  const text = label ?? recipe.label;
  return (
    <span
      className="pc-state-badge"
      role="status"
      aria-label={`State: ${text}`}
      data-state={key}
      data-family={recipe.family}
      data-dash={recipe.dash || undefined}
      data-double={recipe.double || undefined}
      data-size={size}
    >
      <PcIcon name={recipe.icon} size={size === 'sm' ? 11 : 13} pulse={recipe.live} />
      {showLabel ? text : null}
    </span>
  );
}

// ---------------------------------------------------------------- WorkItemChip / CapabilityLabel

type WorkItemType = Readonly<{ icon: PcIconName; prefix: string }>;

export const WORK_ITEM_TYPES: Readonly<Record<string, WorkItemType>> = Object.freeze({
  epic: { icon: 'layers', prefix: 'EPC' },
  feature: { icon: 'box', prefix: 'FTR' },
  story: { icon: 'bookmark', prefix: 'STY' },
  task: { icon: 'square-check-big', prefix: 'TSK' },
  spec: { icon: 'file-text', prefix: 'SPC' },
  backlog: { icon: 'inbox', prefix: 'BKL' },
  quick: { icon: 'flag', prefix: 'QCK' },
  sprint: { icon: 'calendar-range', prefix: 'SPR' },
  adr: { icon: 'shield', prefix: 'ADR' },
});

export type WorkItemChipProps = Readonly<{
  type: string;
  id: string;
  title?: string;
  blocked?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}>;

/** Identifies a node in the pipeline: type glyph on a filled square, mono id, optional title. */
export function WorkItemChip({
  type,
  id,
  title,
  blocked = false,
  interactive = false,
  onClick,
}: WorkItemChipProps) {
  const known = type in WORK_ITEM_TYPES ? type : 'task';
  const recipe = WORK_ITEM_TYPES[known];
  const inner = (
    <>
      <span className="pc-work-item__type" data-type={known} aria-hidden="true">
        <PcIcon name={recipe.icon} size={12} />
      </span>
      <span className="pc-work-item__id">{id}</span>
      {title ? <span className="pc-work-item__title">{title}</span> : null}
      {blocked ? (
        <PcIcon name="circle-slash" size={13} color="var(--pc-astate-failed-fg)" title="Blocked" />
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="pc-work-item" data-interactive onClick={onClick}>
        {inner}
      </button>
    );
  }
  return (
    <span className="pc-work-item" data-interactive={interactive || undefined}>
      {inner}
    </span>
  );
}

type CapabilityRecipe = Readonly<{
  family: 'plan' | 'ship' | 'operate' | 'diagram' | 'status';
  icon: PcIconName;
}>;

/*
 * The five families and glyphs are the design system's fixed pairings; the other real
 * skills are mapped onto the nearest family so every planr-* name renders with a glyph.
 */
export const CAPABILITIES: Readonly<Record<string, CapabilityRecipe>> = Object.freeze({
  'planr-plan': { family: 'plan', icon: 'list-tree' },
  'planr-plan-review': { family: 'plan', icon: 'list-tree' },
  'planr-spec': { family: 'plan', icon: 'file-text' },
  'planr-ship': { family: 'ship', icon: 'git-branch' },
  'planr-land': { family: 'ship', icon: 'git-pull-request' },
  'planr-operate': { family: 'operate', icon: 'gauge' },
  'planr-ceo-review': { family: 'operate', icon: 'scroll-text' },
  'planr-cpo-review': { family: 'operate', icon: 'scroll-text' },
  'planr-cto-review': { family: 'operate', icon: 'scroll-text' },
  'planr-cmo-review': { family: 'operate', icon: 'scroll-text' },
  'planr-coo-review': { family: 'operate', icon: 'scroll-text' },
  'planr-challenger-review': { family: 'operate', icon: 'scroll-text' },
  'planr-chair-review': { family: 'operate', icon: 'scroll-text' },
  'planr-diagram': { family: 'diagram', icon: 'workflow' },
  'planr-design': { family: 'diagram', icon: 'sparkles' },
  'planr-design-loop': { family: 'diagram', icon: 'sparkles' },
  'planr-design-review': { family: 'diagram', icon: 'sparkles' },
  'planr-artifact': { family: 'diagram', icon: 'file-check' },
  'planr-status': { family: 'status', icon: 'activity' },
  'planr-investigate': { family: 'status', icon: 'search' },
  'planr-browser-qa': { family: 'status', icon: 'shield' },
  'planr-doctor': { family: 'status', icon: 'life-buoy' },
  'planr-sync': { family: 'status', icon: 'refresh-cw' },
  'planr-dashboard': { family: 'status', icon: 'gauge' },
});

export type CapabilityLabelProps = Readonly<{
  name: string;
  showIcon?: boolean;
  size?: 'sm' | 'md';
  muted?: boolean;
}>;

/** A capability name in the house convention: mono, lowercase kebab, never translated. */
export function CapabilityLabel({
  name,
  showIcon = true,
  size = 'md',
  muted = false,
}: CapabilityLabelProps) {
  const recipe = CAPABILITIES[name];
  return (
    <span
      className="pc-capability"
      data-family={recipe?.family ?? 'status'}
      data-size={size}
      data-muted={muted || undefined}
    >
      {showIcon ? (
        <PcIcon name={recipe?.icon ?? 'square-dashed'} size={size === 'sm' ? 11 : 13} />
      ) : (
        <span className="pc-capability__dot" aria-hidden="true" />
      )}
      {name}
    </span>
  );
}

// ---------------------------------------------------------------- GovernedActionCard

const RAIL_FAMILY: Readonly<Record<string, StateFamily>> = Object.freeze({
  proposed: 'pre',
  approved: 'pre',
  queued: 'pre',
  in_progress: 'active',
  completed: 'good',
  blocked: 'bad',
  rejected: 'bad',
  deferred: 'inert',
  cancelled: 'inert',
});

export type GovernedActionCardProps = Readonly<{
  actionId?: string;
  state: string;
  capability?: string;
  title: string;
  headingLevel?: 2 | 3;
  summary?: string;
  scope?: readonly string[];
  revision?: number | string;
  route?: string;
  execution?: string;
  deepLink?: string;
  command?: string;
  error?: string;
  compact?: boolean;
}>;

/**
 * One governed action, presented read-only: what it IS, never an offer to change it.
 * Where a control would sit, the card carries the copy-ready invocation and the deep link.
 */
export function GovernedActionCard({
  actionId,
  state,
  capability,
  title,
  headingLevel = 3,
  summary,
  scope,
  revision,
  route,
  execution,
  deepLink,
  command,
  error,
  compact = false,
}: GovernedActionCardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const key = STATE_ALIASES[state] ?? state;
  const family = RAIL_FAMILY[key] ?? 'pre';
  const adverse = key === 'blocked' || key === 'rejected';
  const faded = key === 'completed' || key === 'cancelled';
  return (
    <article
      className="pc-action-card"
      data-action={actionId}
      data-family={family}
      data-adverse={adverse || undefined}
      data-faded={faded || undefined}
      data-live={key === 'in_progress' || undefined}
      data-compact={compact || undefined}
    >
      <div className="pc-action-card__rail" aria-hidden="true" />
      <div className="pc-action-card__body">
        <div className="pc-action-card__head">
          <StateBadge state={key} size="sm" />
          {capability ? <CapabilityLabel name={capability} size="sm" muted /> : null}
          {actionId ? <span className="pc-action-card__id">{actionId}</span> : null}
          {revision !== undefined ? (
            <span className="pc-action-card__rev" title="Protocol revision">
              <PcIcon name="git-commit" size={11} />
              rev {revision}
            </span>
          ) : null}
        </div>
        <div className="pc-action-card__text">
          <Heading className="pc-action-card__title">{title}</Heading>
          {summary ? <p className="pc-action-card__summary">{summary}</p> : null}
        </div>
        {scope && scope.length > 0 ? (
          <ul className="pc-action-card__scope">
            {scope.map((entry) => (
              <li key={entry} className="pc-action-card__chip">
                {entry}
              </li>
            ))}
          </ul>
        ) : null}
        {execution ? (
          <div className="pc-action-card__execution">
            <span className="pc-action-card__label">latest execution</span>
            <StateBadge state={execution} size="sm" />
          </div>
        ) : null}
        {error ? (
          <div className="pc-action-card__error">
            <PcIcon name="triangle-alert" size={13} />
            <span>{error}</span>
          </div>
        ) : null}
        {command ? <CommandHint command={command} size="sm" /> : null}
        {route || deepLink ? (
          <div className="pc-action-card__foot">
            {route ? (
              <span className="pc-action-card__route" title="Delivery route">
                <PcIcon name="corner-down-right" size={11} />
                {route}
              </span>
            ) : null}
            {deepLink ? (
              <a className="pc-action-card__open" href={deepLink} aria-label={`Open ${title}`}>
                open
                <PcIcon name="external-link" size={11} />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- DependencyGraph

export type GraphNode = Readonly<{ id: string; type: string; label: string; blocked?: boolean }>;
export type GraphEdge = Readonly<{ from: string; to: string; blocked?: boolean; active?: boolean }>;

export type DependencyGraphProps = Readonly<{
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  view?: 'graph' | 'outline';
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
}>;

const GRAPH_TYPE_ORDER = [
  'epic',
  'feature',
  'story',
  'task',
  'spec',
  'adr',
  'backlog',
  'quick',
  'sprint',
];
const GRAPH_COL_W = 176;
const GRAPH_ROW_H = 46;
const GRAPH_NODE_W = 148;
const GRAPH_NODE_H = 30;

function OutlineBranch({
  node,
  depth,
  byId,
  edges,
  selectedId,
  onSelect,
}: Readonly<{
  node: GraphNode;
  depth: number;
  byId: ReadonlyMap<string, GraphNode>;
  edges: readonly GraphEdge[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}>) {
  const children = edges
    .filter((edge) => edge.from === node.id)
    .map((edge) => byId.get(edge.to))
    .filter((child): child is GraphNode => child !== undefined);
  const row = (
    <>
      <span className="pc-graph-outline__dot" data-type={node.type} aria-hidden="true" />
      <span className="pc-graph-outline__id">{node.id}</span>
      <span className="pc-graph-outline__label">{node.label}</span>
      {node.blocked ? <span className="pc-graph-outline__blocked">blocked</span> : null}
    </>
  );
  return (
    <li className="pc-graph-outline__item" data-depth={depth === 0 ? 'root' : undefined}>
      {onSelect ? (
        <button
          type="button"
          className="pc-graph-outline__row"
          data-selected={selectedId === node.id || undefined}
          onClick={() => onSelect(node.id)}
        >
          {row}
        </button>
      ) : (
        <span className="pc-graph-outline__row">{row}</span>
      )}
      {children.length > 0 ? (
        <ul className="pc-graph-outline__list">
          {children.map((child) => (
            <OutlineBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              byId={byId}
              edges={edges}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * planr-diagram: a layered dependency graph of pipeline nodes with a required non-visual
 * peer — the same nodes and edges as a nested outline, selected by `view`.
 */
export function DependencyGraph({
  nodes,
  edges,
  view = 'graph',
  selectedId,
  onSelect,
  height,
}: DependencyGraphProps) {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  if (view === 'outline') {
    const roots = nodes.filter((node) => !edges.some((edge) => edge.to === node.id));
    return (
      <div className="pc-graph-outline">
        <ul className="pc-graph-outline__list">
          {roots.map((root) => (
            <OutlineBranch
              key={root.id}
              node={root}
              depth={0}
              byId={byId}
              edges={edges}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </div>
    );
  }

  const columns = GRAPH_TYPE_ORDER.map((type) => ({
    type,
    items: nodes.filter((node) => node.type === type),
  })).filter((column) => column.items.length > 0);
  const position = new Map<string, { x: number; y: number }>();
  columns.forEach((column, columnIndex) => {
    column.items.forEach((node, rowIndex) => {
      position.set(node.id, { x: columnIndex * GRAPH_COL_W + 8, y: rowIndex * GRAPH_ROW_H + 8 });
    });
  });
  const width = columns.length * GRAPH_COL_W;
  const canvasHeight =
    Math.max(1, ...columns.map((column) => column.items.length)) * GRAPH_ROW_H + 16;

  return (
    <figure className="pc-graph" aria-label="Dependency graph" style={{ height }}>
      <div className="pc-graph__canvas" style={{ width, height: canvasHeight }}>
        <svg className="pc-graph__edges" width={width} height={canvasHeight} aria-hidden="true">
          <title>Dependency edges</title>
          {edges.map((edge) => {
            const from = position.get(edge.from);
            const to = position.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + GRAPH_NODE_W;
            const y1 = from.y + GRAPH_NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + GRAPH_NODE_H / 2;
            const midX = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                className="pc-graph__edge"
                data-blocked={edge.blocked || undefined}
                data-active={edge.active || undefined}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
              />
            );
          })}
        </svg>
        {nodes.map((node) => {
          const point = position.get(node.id);
          if (!point) return null;
          return (
            <button
              key={node.id}
              type="button"
              className="pc-graph-node"
              data-selected={selectedId === node.id || undefined}
              data-blocked={node.blocked || undefined}
              style={{ left: point.x, top: point.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H }}
              onClick={onSelect ? () => onSelect(node.id) : undefined}
            >
              <span className="pc-graph-node__dot" data-type={node.type} aria-hidden="true" />
              <span className="pc-graph-node__code">{node.id}</span>
              <span className="pc-graph-node__label">{node.label}</span>
              {node.blocked ? (
                <PcIcon name="circle-slash" size={11} color="var(--pc-astate-failed-fg)" />
              ) : null}
            </button>
          );
        })}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------- ActivityTimeline / SprintProgress

export type ActivityEvent = Readonly<{
  id: string;
  title: string;
  actor: 'agent' | 'human';
  time: string;
  state?: string;
  capability?: string;
  target?: string;
  detail?: string;
}>;

export type ActivityTimelineProps = Readonly<{ events: readonly ActivityEvent[]; dense?: boolean }>;

/** Reverse-chronological log of agent and human events. Renders only what it is given. */
export function ActivityTimeline({ events, dense = false }: ActivityTimelineProps) {
  return (
    <ol className="pc-timeline" data-dense={dense || undefined}>
      {events.map((event) => (
        <li key={event.id} className="pc-timeline__item">
          <span className="pc-timeline__marker" data-actor={event.actor}>
            <PcIcon name={event.actor === 'agent' ? 'bot' : 'user'} size={9} />
          </span>
          <div className="pc-timeline__body">
            <div className="pc-timeline__head">
              <span className="pc-timeline__title">{event.title}</span>
              {event.state ? <StateBadge state={event.state} size="sm" /> : null}
              <span className="pc-timeline__time">{event.time}</span>
            </div>
            {event.capability || event.target ? (
              <div className="pc-timeline__meta">
                {event.capability ? (
                  <CapabilityLabel name={event.capability} size="sm" muted />
                ) : null}
                {event.target ? <span className="pc-timeline__target">{event.target}</span> : null}
              </div>
            ) : null}
            {event.detail ? <p className="pc-timeline__detail">{event.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export type SprintSegment = Readonly<{ state: string; count: number; label?: string }>;

export type SprintProgressProps = Readonly<{
  name: string;
  segments: readonly SprintSegment[];
  day?: number;
  days?: number;
  compact?: boolean;
}>;

/** Segmented burn bar for a sprint or operating cycle. */
export function SprintProgress({
  name,
  segments,
  day,
  days,
  compact = false,
}: SprintProgressProps) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0) || 1;
  return (
    <div className="pc-sprint" data-compact={compact || undefined}>
      <div className="pc-sprint__head">
        <span className="pc-sprint__name">{name}</span>
        {days ? (
          <span className="pc-sprint__day">
            day {day}/{days}
          </span>
        ) : null}
        <span className="pc-sprint__total">{total} items</span>
      </div>
      <div className="pc-sprint__bar" role="img" aria-label={`${name} progress`}>
        {segments.map((segment) => (
          <span
            key={segment.state}
            className="pc-sprint__seg"
            data-state={segment.state}
            style={{ width: `${(segment.count / total) * 100}%` }}
            title={`${segment.label ?? segment.state}: ${segment.count}`}
          />
        ))}
      </div>
      {compact ? null : (
        <div className="pc-sprint__legend">
          {segments.map((segment) => (
            <span key={segment.state} className="pc-sprint__legend-item">
              <span className="pc-sprint__dot" data-state={segment.state} />
              {segment.label ?? segment.state}{' '}
              <span className="pc-sprint__count">{segment.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page helpers

export type ProseProps = Readonly<{ children: ReactNode; tone?: 'strong' | 'dim' | 'default' }>;

/** Wrapping text inside a nowrap table cell. */
export function Prose({ children, tone = 'default' }: ProseProps) {
  return (
    <span className="pc-prose" data-tone={tone}>
      {children}
    </span>
  );
}

/** A value the model may not carry. Renders the absence rather than faking it. */
export function Absent({ children }: Readonly<{ children?: ReactNode }>) {
  return <span className="pc-absent">{children ?? '—'}</span>;
}

export type FieldProps = Readonly<{ label: string; children: ReactNode; mono?: boolean }>;

/** Label + value row for record detail. */
export function Field({ label, children, mono = false }: FieldProps) {
  return (
    <div className="pc-field">
      <span className="pc-field__label">{label}</span>
      <span className="pc-field__value" data-mono={mono || undefined}>
        {children}
      </span>
    </div>
  );
}

export type ProtocolTagProps = Readonly<{ value: string; tone?: BadgeTone }>;

/**
 * Lesser protocol enums — evidence, outcome, recovery, cycle stage. A third treatment: not a
 * dot (artifact status) and not a filled chip (action state), so three vocabularies stay three.
 */
export function ProtocolTag({ value, tone = 'neutral' }: ProtocolTagProps) {
  return (
    <Badge variant="outline" tone={tone} mono>
      {value.replaceAll('_', ' ')}
    </Badge>
  );
}

export type TallyProps = Readonly<{
  counts: Readonly<Record<string, number>>;
  total: number;
  active?: string | null;
  onPick?: (status: string) => void;
}>;

/** Status tally strip: one cell per artifact status plus the total. */
export function Tally({ counts, total, active, onPick }: TallyProps) {
  return (
    <div className="pc-tally">
      <div className="pc-tally__cells">
        {ARTIFACT_STATUS_ORDER.map((status) =>
          onPick ? (
            <button
              key={status}
              type="button"
              className="pc-tally__cell"
              data-active={active === status || undefined}
              onClick={() => onPick(status)}
            >
              <ArtifactStatus status={status} size="sm" />
              <span className="pc-tally__value">{counts[status] ?? 0}</span>
            </button>
          ) : (
            <span key={status} className="pc-tally__cell">
              <ArtifactStatus status={status} size="sm" />
              <span className="pc-tally__value">{counts[status] ?? 0}</span>
            </span>
          ),
        )}
      </div>
      <div className="pc-tally__total">
        <span className="pc-tally__label">total</span>
        <span className="pc-tally__value">{total}</span>
      </div>
    </div>
  );
}
