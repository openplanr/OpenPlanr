import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArtifactTag, type ArtifactType, type ChipSurface, chipStyle } from './artifact-recipes.js';
import { Badge, type BadgeTone, CommandHint } from './console-core.js';
import { PcIcon, type PcIconName } from './console-icon.js';
import { Tooltip } from './tooltip.js';
import './planr-console.css';

/**
 * Planr-domain console components: artifact-status dots, governed-action and execution-result
 * badges, work-item and capability labels, the read-only governed action card, the dependency
 * graph with its outline view, sprint progress and page helpers.
 * Entry points: `WorkItemChip`, `ArtifactStatus`, `StateBadge`, `DependencyGraph`, `Absent`.
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
  done: 'Done',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  outstanding: 'Outstanding',
  addressed: 'Addressed',
  quiet: 'Quiet',
});

export type ArtifactStatusProps = Readonly<{
  status: string;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  count?: number | string;
  surface?: ChipSurface;
  label?: string;
  quiet?: boolean;
}>;

const STATUS_GLYPH: Readonly<Record<string, string>> = {
  outstanding: 'ring',
  'in-progress': 'half-ring',
  blocked: 'diamond',
  addressed: 'dotted-ring',
  done: 'solid-dot',
  quiet: 'pause',
};

export function ArtifactStatus({
  status,
  size = 'md',
  showLabel = true,
  count,
  surface = 'panel',
  label,
  quiet = false,
}: ArtifactStatusProps) {
  const known = Object.hasOwn(ARTIFACT_LABEL, status);
  const text = label ?? (known ? ARTIFACT_LABEL[status] : status);
  return (
    <>
      <span
        className="pc-artifact"
        data-status={status}
        data-size={size}
        data-surface={surface}
        style={known ? chipStyle(`status-${status}`, surface) : undefined}
      >
        <span
          className="pc-artifact__dot"
          data-glyph={known ? STATUS_GLYPH[status] : 'unknown'}
          aria-hidden="true"
        />
        <span className={showLabel ? 'pc-artifact__label' : 'pc-visually-hidden'}>{text}</span>
        {count !== undefined ? <span className="pc-artifact__count">{count}</span> : null}
      </span>
      {quiet && status !== 'quiet' ? (
        <ArtifactStatus status="quiet" size={size} surface={surface} />
      ) : null}
    </>
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
  disabled?: boolean;
  disabledReason?: string;
  surface?: ChipSurface;
}>;

/** Identifies a node in the pipeline: type glyph on a filled square, mono id, optional title. */
export function WorkItemChip({
  type,
  id,
  title,
  blocked = false,
  interactive = false,
  onClick,
  disabled = false,
  disabledReason,
  surface = 'panel',
}: WorkItemChipProps) {
  const tagType =
    ({ story: 'us', task: 't', backlog: 'bl', quick: 'qt' } as Record<string, ArtifactType>)[
      type
    ] ?? type;
  const knownType = ['spec', 'us', 't', 'bl', 'adr', 'epic', 'sprint', 'qt'].includes(tagType);
  const inner = (
    <>
      {knownType ? (
        <ArtifactTag type={tagType as ArtifactType} surface={surface}>
          {id}
        </ArtifactTag>
      ) : (
        <span className="pc-work-item__id">
          {id} ({type})
        </span>
      )}
      {title ? <span className="pc-work-item__title">{title}</span> : null}
      {blocked ? (
        <PcIcon name="circle-slash" size={13} color="var(--pc-astate-failed-fg)" title="Blocked" />
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className="pc-work-item"
        data-interactive
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-description={disabledReason}
        onClick={onClick}
      >
        {inner}
      </button>
    );
  }
  return (
    <span
      className="pc-work-item"
      data-interactive={interactive || undefined}
      aria-description={disabledReason}
    >
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

export type GraphNode = Readonly<{
  id: string;
  canonicalId?: string;
  type: string;
  label: string;
  blocked?: boolean;
  status?: string;
  dimmed?: boolean;
}>;
export type GraphEdge = Readonly<{
  from: string;
  to: string;
  blocked?: boolean;
  active?: boolean;
  kind?: string;
}>;

export type DependencyGraphProps = Readonly<{
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  view?: 'graph' | 'outline';
  flow?: 'source-to-target' | 'target-to-source';
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onFocusSelect?: (id: string) => void;
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
const GRAPH_COL_W = 294;
const GRAPH_ROW_H = 94;
const GRAPH_NODE_W = 230;
const GRAPH_NODE_H = 66;
const GRAPH_MIN_ZOOM = 0.0001;

function graphNodeOrder(left: GraphNode, right: GraphNode): number {
  const leftType = GRAPH_TYPE_ORDER.indexOf(left.type);
  const rightType = GRAPH_TYPE_ORDER.indexOf(right.type);
  const byType =
    (leftType < 0 ? GRAPH_TYPE_ORDER.length : leftType) -
    (rightType < 0 ? GRAPH_TYPE_ORDER.length : rightType);
  return byType || left.id.localeCompare(right.id, undefined, { numeric: true });
}

/**
 * Collapse cycles, then rank the resulting DAG. This keeps same-type tasks in their actual
 * dependency stages instead of stacking the entire project in one artifact-type column.
 */
function dependencyRanks(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): ReadonlyMap<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) outgoing.set(node.id, []);
  for (const edge of edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) outgoing.get(edge.from)?.push(edge.to);
  }

  let sequence = 0;
  const discovered = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  for (const node of [...nodes].sort(graphNodeOrder)) {
    if (discovered.has(node.id)) continue;
    const pending: { id: string; next: number; parent?: string }[] = [{ id: node.id, next: 0 }];
    while (pending.length > 0) {
      const frame = pending[pending.length - 1];
      if (!frame) break;
      const { id } = frame;
      if (!discovered.has(id)) {
        discovered.set(id, sequence);
        low.set(id, sequence);
        sequence += 1;
        stack.push(id);
        stacked.add(id);
      }
      const next = outgoing.get(id)?.[frame.next];
      if (next !== undefined) {
        frame.next += 1;
        if (!discovered.has(next)) pending.push({ id: next, next: 0, parent: id });
        else if (stacked.has(next))
          low.set(id, Math.min(low.get(id) ?? 0, discovered.get(next) ?? 0));
        continue;
      }
      pending.pop();
      if (frame.parent !== undefined)
        low.set(frame.parent, Math.min(low.get(frame.parent) ?? 0, low.get(id) ?? 0));
      if (low.get(id) !== discovered.get(id)) continue;
      const component: string[] = [];
      while (stack.length > 0) {
        const member = stack.pop();
        if (member === undefined) break;
        stacked.delete(member);
        component.push(member);
        if (member === id) break;
      }
      components.push(component);
    }
  }

  const componentOf = new Map<string, number>();
  components.forEach((component, index) => {
    for (const id of component) componentOf.set(id, index);
  });
  const componentOutgoing = components.map(() => new Set<number>());
  const indegree = components.map(() => 0);
  for (const edge of edges) {
    const from = componentOf.get(edge.from);
    const to = componentOf.get(edge.to);
    if (from === undefined || to === undefined || from === to || componentOutgoing[from]?.has(to)) {
      continue;
    }
    componentOutgoing[from]?.add(to);
    indegree[to] = (indegree[to] ?? 0) + 1;
  }
  const componentKeys = components.map(
    (component) =>
      [...component].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0] ?? '',
  );
  const componentKey = (index: number) => componentKeys[index] ?? '';
  const queue = components
    .map((_, index) => index)
    .filter((index) => indegree[index] === 0)
    .sort((a, b) => componentKey(a).localeCompare(componentKey(b), undefined, { numeric: true }));
  const componentRank = components.map(() => 0);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of componentOutgoing[current] ?? []) {
      componentRank[next] = Math.max(componentRank[next] ?? 0, (componentRank[current] ?? 0) + 1);
      indegree[next] = (indegree[next] ?? 0) - 1;
      if (indegree[next] === 0) {
        queue.push(next);
        queue.sort((a, b) =>
          componentKey(a).localeCompare(componentKey(b), undefined, { numeric: true }),
        );
      }
    }
  }
  return new Map(nodes.map((node) => [node.id, componentRank[componentOf.get(node.id) ?? 0] ?? 0]));
}

/**
 * Two deterministic barycentric sweeps keep connected work close across adjacent stages.
 * This removes most avoidable crossings without hiding edges or changing dependency rank.
 */
function orderDependencyColumns(
  source: readonly (readonly GraphNode[])[],
  edges: readonly GraphEdge[],
  rankById: ReadonlyMap<string, number>,
): GraphNode[][] {
  const columns = source.map((column) => [...column]);
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const incoming = parents.get(edge.to) ?? [];
    incoming.push(edge.from);
    parents.set(edge.to, incoming);
    const outgoing = children.get(edge.from) ?? [];
    outgoing.push(edge.to);
    children.set(edge.from, outgoing);
  }
  const rowPosition = new Map<string, number>();
  const remember = (rank: number) => {
    const column = columns[rank] ?? [];
    const denominator = Math.max(1, column.length - 1);
    column.forEach((node, index) => {
      rowPosition.set(node.id, index / denominator);
    });
  };
  const sortRank = (rank: number, direction: 'parents' | 'children') => {
    const column = columns[rank] ?? [];
    const scored = column.map((node) => {
      const neighbors = ((direction === 'parents' ? parents : children).get(node.id) ?? [])
        .filter((id) => {
          const neighborRank = rankById.get(id);
          return (
            neighborRank !== undefined &&
            (direction === 'parents' ? neighborRank < rank : neighborRank > rank)
          );
        })
        .map((id) => rowPosition.get(id))
        .filter((position): position is number => position !== undefined);
      return {
        node,
        score:
          neighbors.length > 0
            ? neighbors.reduce((total, position) => total + position, 0) / neighbors.length
            : null,
      };
    });
    scored.sort((left, right) => {
      if (left.score === null && right.score === null) return graphNodeOrder(left.node, right.node);
      if (left.score === null) return 1;
      if (right.score === null) return -1;
      return left.score - right.score || graphNodeOrder(left.node, right.node);
    });
    columns[rank] = scored.map(({ node }) => node);
    remember(rank);
  };

  for (let pass = 0; pass < 2; pass += 1) {
    columns.forEach((_, rank) => {
      remember(rank);
    });
    for (let rank = 1; rank < columns.length; rank += 1) sortRank(rank, 'parents');
    for (let rank = columns.length - 2; rank >= 0; rank -= 1) sortRank(rank, 'children');
  }
  return columns;
}

type GraphPoint = Readonly<{ x: number; y: number }>;
type GraphLayout = Readonly<{
  byId: ReadonlyMap<string, GraphNode>;
  displayId: ReadonlyMap<string, string>;
  neighbours: ReadonlyMap<string, readonly string[]>;
  relationships: ReadonlyMap<string, readonly string[]>;
  edges: readonly GraphEdge[];
  columns: readonly (readonly GraphNode[])[];
  position: ReadonlyMap<string, GraphPoint>;
  width: number;
  height: number;
  minimap: string;
  tracedIds: ReadonlySet<string>;
}>;

// Array identity follows the immutable planning binding, so revisiting a lens reuses its layout.
const graphLayouts = new WeakMap<
  readonly GraphNode[],
  WeakMap<readonly GraphEdge[], Map<string, GraphLayout>>
>();

function graphLayout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  flow: 'source-to-target' | 'target-to-source',
): GraphLayout {
  let byEdges = graphLayouts.get(nodes);
  if (!byEdges) {
    byEdges = new WeakMap();
    graphLayouts.set(nodes, byEdges);
  }
  let byFlow = byEdges.get(edges);
  if (!byFlow) {
    byFlow = new Map();
    byEdges.set(edges, byFlow);
  }
  const cached = byFlow.get(flow);
  if (cached) return cached;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const displayId = new Map(nodes.map((node) => [node.canonicalId ?? node.id, node.id]));
  const presentationEdges =
    flow === 'target-to-source'
      ? edges.map((edge) => ({ ...edge, from: edge.to, to: edge.from }))
      : edges;
  const neighbours = new Map<string, string[]>();
  const relationships = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    for (const [from, to] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      if (from === undefined || to === undefined) continue;
      const adjacent = neighbours.get(from) ?? [];
      adjacent.push(to);
      neighbours.set(from, adjacent);
    }
    const descriptions = relationships.get(edge.from) ?? [];
    descriptions.push(`${edge.kind === 'contains' ? 'contains' : 'depends on'} ${edge.to}`);
    relationships.set(edge.from, descriptions);
  }
  for (const [id, adjacent] of neighbours) neighbours.set(id, [...new Set(adjacent)].sort());
  const rankById = dependencyRanks(nodes, presentationEdges);
  const rankCount = Math.max(0, ...rankById.values()) + 1;
  const ranked: GraphNode[][] = Array.from({ length: rankCount }, () => []);
  for (const node of nodes) ranked[rankById.get(node.id) ?? 0]?.push(node);
  const columns = orderDependencyColumns(
    ranked.map((column) => column.sort(graphNodeOrder)),
    presentationEdges,
    rankById,
  );
  const maxRows = Math.max(1, ...columns.map((column) => column.length));
  const width = Math.max(680, rankCount * GRAPH_COL_W + 48);
  const height = maxRows * GRAPH_ROW_H + 100;
  const position = new Map<string, GraphPoint>();
  columns.forEach((column, rank) => {
    const x = 48 + rank * GRAPH_COL_W;
    const top = 62 + ((maxRows - column.length) * GRAPH_ROW_H) / 2;
    column.forEach((node, index) => {
      position.set(node.id, { x, y: top + index * GRAPH_ROW_H });
    });
  });
  const minimap = [...position.values()]
    .map(({ x, y }) => `M${x},${y}h${GRAPH_NODE_W}v${GRAPH_NODE_H}h-${GRAPH_NODE_W}z`)
    .join('');
  const layout: GraphLayout = {
    byId,
    displayId,
    neighbours,
    relationships,
    edges: presentationEdges,
    columns,
    position,
    width,
    height,
    minimap,
    tracedIds: new Set(
      presentationEdges.filter((edge) => edge.active).flatMap((edge) => [edge.from, edge.to]),
    ),
  };
  byFlow.set(flow, layout);
  return layout;
}

function graphArtifactType(type: string): ArtifactType | undefined {
  const mapped: Readonly<Record<string, ArtifactType>> = {
    spec: 'spec',
    story: 'us',
    task: 't',
    backlog: 'bl',
    adr: 'adr',
    epic: 'epic',
    sprint: 'sprint',
    quick: 'qt',
    us: 'us',
    t: 't',
    bl: 'bl',
    qt: 'qt',
  };
  return mapped[type];
}

function GraphNodeContent({ node }: Readonly<{ node: GraphNode }>) {
  const type = graphArtifactType(node.type);
  return (
    <>
      <span className="pc-graph-node__meta">
        {type ? (
          <ArtifactTag type={type} surface="card">
            {node.id}
          </ArtifactTag>
        ) : (
          <span className="pc-graph-node__code">{node.id}</span>
        )}
        {node.status || node.blocked ? (
          <span aria-hidden="true">
            <ArtifactStatus
              status={node.status ?? 'blocked'}
              size="sm"
              showLabel={false}
              surface="card"
            />
          </span>
        ) : null}
      </span>
      <span className="pc-graph-node__label">{node.label}</span>
    </>
  );
}

/** A read-only dependency canvas with a complete structural list for non-visual navigation. */
export function DependencyGraph({
  nodes,
  edges,
  view = 'graph',
  flow = 'source-to-target',
  selectedId,
  onSelect,
  onFocusSelect,
  height = 520,
}: DependencyGraphProps) {
  const layout = useMemo(() => graphLayout(nodes, edges, flow), [nodes, edges, flow]);
  const figureRef = useRef<HTMLElement>(null);
  const [zoom, setZoom] = useState(1);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    measured: false,
  });
  const admittedIds = useMemo(() => ({ layout, ids: new Set<string>() }), [layout]).ids;
  const readViewport = useCallback(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const width = figure.clientWidth;
    const viewportHeight = figure.clientHeight;
    if (width <= 0 || viewportHeight <= 0) return;
    const next = {
      left: figure.scrollLeft,
      top: figure.scrollTop,
      width,
      height: viewportHeight,
      measured: true,
    };
    setViewport((current) =>
      Object.keys(next).every(
        (key) => current[key as keyof typeof next] === next[key as keyof typeof next],
      )
        ? current
        : next,
    );
  }, []);
  useLayoutEffect(() => {
    if (view !== 'graph') return;
    readViewport();
    const figure = figureRef.current;
    if (!figure || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(readViewport);
    observer.observe(figure);
    return () => observer.disconnect();
  }, [readViewport, view]);
  const moveCamera = useCallback(
    (left: number, top: number) => {
      const figure = figureRef.current;
      if (!figure) return;
      figure.scrollLeft = Math.max(0, left);
      figure.scrollTop = Math.max(0, top);
      readViewport();
    },
    [readViewport],
  );
  const reveal = useCallback(
    (id: string) => {
      const display = layout.displayId.get(id) ?? id;
      const point = layout.position.get(display);
      const figure = figureRef.current;
      if (!point || !figure) return;
      moveCamera(
        (point.x + GRAPH_NODE_W / 2) * zoom - figure.clientWidth / 2,
        (point.y + GRAPH_NODE_H / 2) * zoom - figure.clientHeight / 2,
      );
    },
    [layout, zoom, moveCamera],
  );
  const revealRef = useRef(reveal);
  useLayoutEffect(() => {
    revealRef.current = reveal;
  }, [reveal]);
  useLayoutEffect(() => {
    if (view !== 'graph') return;
    const figure = figureRef.current;
    if (!figure) return;
    const focus = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string } | string>).detail;
      const id = typeof detail === 'string' ? detail : detail?.id;
      if (!id) return;
      reveal(id);
      // The focus scope can change the layout in the same event dispatch.
      requestAnimationFrame(() => revealRef.current(id));
    };
    figure.addEventListener('graph-focus', focus);
    return () => figure.removeEventListener('graph-focus', focus);
  }, [reveal, view]);
  const zoomTo = (next: number) => {
    const bounded = Math.max(GRAPH_MIN_ZOOM, Math.min(2, next));
    const centerX = (viewport.left + viewport.width / 2) / zoom;
    const centerY = (viewport.top + viewport.height / 2) / zoom;
    setZoom(bounded);
    requestAnimationFrame(() =>
      moveCamera(centerX * bounded - viewport.width / 2, centerY * bounded - viewport.height / 2),
    );
  };
  const fit = () => {
    const next = Math.max(
      GRAPH_MIN_ZOOM,
      Math.min(1, viewport.width / layout.width, viewport.height / layout.height),
    );
    setZoom(next);
    moveCamera(0, 0);
  };
  const selectedDisplayId = selectedId ? (layout.displayId.get(selectedId) ?? selectedId) : null;
  const retained = new Set<string>();
  for (const id of [selectedDisplayId, focusedId]) {
    if (!id) continue;
    retained.add(id);
    for (const neighbour of layout.neighbours.get(id) ?? []) retained.add(neighbour);
  }
  const margin = 150;
  const bounds = {
    left: viewport.left / zoom - margin,
    top: viewport.top / zoom - margin,
    right: (viewport.left + viewport.width) / zoom + margin,
    bottom: (viewport.top + viewport.height) / zoom + margin,
  };
  const visibleIds = new Set<string>();
  for (const [id, point] of layout.position) {
    if (
      viewport.measured &&
      (retained.has(id) ||
        (point.x + GRAPH_NODE_W >= bounds.left &&
          point.x <= bounds.right &&
          point.y + GRAPH_NODE_H >= bounds.top &&
          point.y <= bounds.bottom))
    )
      visibleIds.add(id);
  }
  // Keeping admitted geometry avoids collapsing painted nodes when the viewport is refined.
  for (const id of visibleIds) admittedIds.add(id);
  if (view === 'outline')
    return (
      <section className="pc-graph-outline" aria-label="Graph structural list">
        <ul className="pc-graph-outline__list">
          {nodes.map((node) => (
            <li key={node.id} className="pc-graph-outline__item">
              <button
                type="button"
                className="pc-graph-outline__row"
                data-keyboard-item={node.canonicalId ?? node.id}
                data-canonical-id={node.canonicalId ?? node.id}
                data-selected={selectedDisplayId === node.id || undefined}
                aria-pressed={selectedDisplayId === node.id}
                aria-description={
                  node.status
                    ? (ARTIFACT_LABEL[node.status] ?? node.status)
                    : node.blocked
                      ? 'Blocked'
                      : undefined
                }
                onFocus={() => onFocusSelect?.(node.id)}
                onClick={() => onSelect?.(node.id)}
              >
                <GraphNodeContent node={node} />
              </button>
              {layout.relationships.has(node.id) ? (
                <p className="pc-graph-outline__relationships">
                  {layout.relationships.get(node.id)?.join('; ')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <div className="pc-graph-workspace">
      <fieldset className="pc-graph-controls" aria-label="Graph navigation">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= GRAPH_MIN_ZOOM}
          aria-disabled={zoom <= GRAPH_MIN_ZOOM}
          title={zoom <= GRAPH_MIN_ZOOM ? 'Minimum zoom reached' : 'Zoom out'}
          onClick={() => zoomTo(zoom - 0.1)}
        >
          −
        </button>
        <output aria-live="polite" aria-label="Graph zoom">
          {zoom < 0.01 ? (zoom * 100).toFixed(2) : Math.round(zoom * 100)}%
        </output>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= 2}
          aria-disabled={zoom >= 2}
          title={zoom >= 2 ? 'Maximum zoom reached' : 'Zoom in'}
          onClick={() => zoomTo(zoom + 0.1)}
        >
          +
        </button>
        <button type="button" onClick={fit}>
          Fit graph
        </button>
        <button
          type="button"
          aria-label="Pan left"
          onClick={() => moveCamera(viewport.left - 180, viewport.top)}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Pan up"
          onClick={() => moveCamera(viewport.left, viewport.top - 180)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Pan down"
          onClick={() => moveCamera(viewport.left, viewport.top + 180)}
        >
          ↓
        </button>
        <button
          type="button"
          aria-label="Pan right"
          onClick={() => moveCamera(viewport.left + 180, viewport.top)}
        >
          →
        </button>
      </fieldset>
      <figure
        ref={figureRef}
        className="pc-graph"
        data-scroll-context="graph"
        aria-label="Dependency graph"
        data-tracing={layout.tracedIds.size > 0 || undefined}
        style={{ height }}
        onScroll={readViewport}
      >
        <div
          className="pc-graph__canvas"
          style={{ width: layout.width * zoom, height: layout.height * zoom }}
        >
          <div
            className="pc-graph__content"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
          >
            <div className="pc-graph__ranks" aria-hidden="true">
              {layout.columns.map((column, rank) => (
                <span
                  key={column[0]?.id ?? 'empty'}
                  className="pc-graph__rank"
                  style={{ left: 48 + rank * GRAPH_COL_W + GRAPH_NODE_W / 2 }}
                >
                  {rank === 0 ? 'foundation' : `stage ${rank + 1}`} · {column.length}
                </span>
              ))}
            </div>
            <svg
              className="pc-graph__edges"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-hidden="true"
            >
              <title>Dependency edges</title>
              {layout.edges.map((edge) => {
                const from = layout.position.get(edge.from);
                const to = layout.position.get(edge.to);
                if (!viewport.measured || !from || !to) return null;
                const connected = retained.has(edge.from) || retained.has(edge.to);
                if (
                  !connected &&
                  (Math.max(from.x, to.x) + GRAPH_NODE_W < bounds.left ||
                    Math.min(from.x, to.x) > bounds.right ||
                    Math.max(from.y, to.y) + GRAPH_NODE_H < bounds.top ||
                    Math.min(from.y, to.y) > bounds.bottom)
                )
                  return null;
                const x1 = from.x + GRAPH_NODE_W;
                const x2 = to.x;
                const y1 = from.y + GRAPH_NODE_H / 2;
                const y2 = to.y + GRAPH_NODE_H / 2;
                const midX = (x1 + x2) / 2;
                return (
                  <path
                    key={`${edge.kind ?? ''}-${edge.from}-${edge.to}`}
                    className="pc-graph__edge"
                    data-kind={edge.kind}
                    data-blocked={edge.blocked || undefined}
                    data-active={edge.active || undefined}
                    d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            {nodes
              .filter((node) => admittedIds.has(node.id))
              .map((node) => {
                const point = layout.position.get(node.id);
                if (!point) return null;
                const visible = visibleIds.has(node.id);
                return (
                  <Tooltip key={node.id} content={`${node.id}: ${node.label}`}>
                    <button
                      type="button"
                      className="pc-graph-node"
                      data-keyboard-item={node.canonicalId ?? node.id}
                      data-canonical-id={node.canonicalId ?? node.id}
                      data-x={point.x}
                      data-y={point.y}
                      data-neighbours={(layout.neighbours.get(node.id) ?? [])
                        .map((id) => layout.byId.get(id)?.canonicalId ?? id)
                        .join('\n')}
                      data-selected={selectedDisplayId === node.id || undefined}
                      aria-pressed={selectedDisplayId === node.id}
                      aria-description={
                        node.status
                          ? (ARTIFACT_LABEL[node.status] ?? node.status)
                          : node.blocked
                            ? 'Blocked'
                            : undefined
                      }
                      aria-hidden={!visible || undefined}
                      inert={!visible}
                      tabIndex={visible ? undefined : -1}
                      data-related={layout.tracedIds.has(node.id) || undefined}
                      data-blocked={node.blocked || undefined}
                      data-dimmed={node.dimmed || undefined}
                      style={{
                        left: point.x,
                        top: point.y,
                        width: GRAPH_NODE_W,
                        height: GRAPH_NODE_H,
                        visibility: visible ? undefined : 'hidden',
                      }}
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        onSelect?.(node.id);
                      }}
                      onFocus={() => {
                        setFocusedId(node.id);
                        onFocusSelect?.(node.id);
                      }}
                    >
                      {visible ? <GraphNodeContent node={node} /> : null}
                    </button>
                  </Tooltip>
                );
              })}
          </div>
        </div>
      </figure>
      <button
        type="button"
        className="pc-graph-minimap"
        aria-label="Graph minimap, center viewport"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (event.detail === 0) {
            if (selectedDisplayId) reveal(selectedDisplayId);
            else fit();
            return;
          }
          moveCamera(
            ((event.clientX - box.left) / box.width) * layout.width * zoom - viewport.width / 2,
            ((event.clientY - box.top) / box.height) * layout.height * zoom - viewport.height / 2,
          );
        }}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <title>Graph overview</title>
          <path className="pc-graph-minimap__nodes" d={layout.minimap} />
          <rect
            className="pc-graph-minimap__viewport"
            x={viewport.left / zoom}
            y={viewport.top / zoom}
            width={Math.min(layout.width, viewport.width / zoom)}
            height={Math.min(layout.height, viewport.height / zoom)}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </button>
    </div>
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
  const actualTotal = segments.reduce((sum, segment) => sum + segment.count, 0);
  const denominator = actualTotal || 1;
  return (
    <div className="pc-sprint" data-compact={compact || undefined}>
      <div className="pc-sprint__head">
        <span className="pc-sprint__name">{name}</span>
        {days ? (
          <span className="pc-sprint__day">
            day {day}/{days}
          </span>
        ) : null}
        <span className="pc-sprint__total">{actualTotal} items</span>
      </div>
      <div className="pc-sprint__bar" role="img" aria-label={`${name} progress`}>
        {segments.map((segment) => (
          <span
            key={segment.state}
            className="pc-sprint__seg"
            data-state={segment.state}
            style={{ width: `${(segment.count / denominator) * 100}%` }}
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
