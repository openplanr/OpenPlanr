import {
  type PlanningModelNode,
  planningArtifactStatusLabel,
  planningDisplayId,
  planningSpecOf,
} from './planning-model.js';
import type { PlanningSessionActivityEntry } from './planning-session-activity.js';
import { authoredTimestamp } from './presentation-view.js';

export const ACTIVITY_KINDS = ['created', 'status', 'edited', 'removed'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_RANGES = [14, 30, 90] as const;
export const CHART_DAYS = 14;
const BUSIEST_LIMIT = 4;

export type ActivityFilters = Readonly<{
  kind: ActivityKind | 'all';
  spec: string | null;
  types: readonly string[];
  days: number;
}>;

export type ActivityRow = Readonly<{
  key: string;
  kind: ActivityKind;
  node: PlanningModelNode;
  /** The node as the graph holds it now; null once it is gone. */
  current: PlanningModelNode | null;
  change: string;
  /** Change text for narrow places: the side card and phone rows. */
  short: string;
  status: string | null;
  day: string;
  time: string | null;
  session: boolean;
  spec: string | null;
}>;

export type ActivityDay = Readonly<{ day: string; label: string; rows: readonly ActivityRow[] }>;
export type ActivityBar = Readonly<{ day: string; count: number; today: boolean }>;
export type BusiestSpec = Readonly<{ spec: string; title: string; count: number }>;

export type ActivityModel = Readonly<{
  days: readonly ActivityDay[];
  /** Changes in the range after the Type and Spec filters, before the kind filter. */
  total: number;
  counts: Readonly<Record<ActivityKind | 'all', number>>;
  chart: readonly ActivityBar[];
  busiest: readonly BusiestSpec[];
  /** This session's changes, newest first. */
  session: readonly ActivityRow[];
  /** An authored date exists before the range. */
  earlier: boolean;
  /** The newest authored change on any day up to today. */
  last: Readonly<{ id: string; day: string }> | null;
  specs: readonly string[];
}>;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

/** Local calendar day as YYYY-MM-DD. */
export function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayDate(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

function shiftDay(day: string, by: number) {
  const date = dayDate(day);
  date.setDate(date.getDate() + by);
  return localDay(date.getTime());
}

/** The local day an authored date names; a date without a time is that calendar day. */
export function authoredDay(value: unknown): string | null {
  const parsed = authoredTimestamp(value);
  if (parsed === null || typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : localDay(parsed);
}

/** "Today · Thu 23 Oct", "Yesterday · Wed 22 Oct" or "Mon 20 Oct". */
export function activityDayLabel(day: string, today: string): string {
  const label = dayDate(day).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  if (day === today) return `Today · ${label}`;
  if (day === shiftDay(today, -1)) return `Yesterday · ${label}`;
  return label;
}

/** "2 Sep". */
export function activityShortDate(day: string): string {
  return dayDate(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function clock(at: number) {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fieldLabel(field: string) {
  if (field === 'body') return 'Description';
  const words = field
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function editedChange(fields: readonly string[], node: PlanningModelNode) {
  if (fields.length !== 1) return { change: 'Edited', short: 'Edited' };
  const [field] = fields;
  const short = `${fieldLabel(field)} edited`;
  const value = node.frontmatter[field];
  if (field === 'priority' && typeof value === 'string' && value)
    return { change: `Priority set to ${value}`, short };
  return { change: short, short };
}

function createdChange(node: PlanningModelNode) {
  return node.type === 'backlog' ? 'Added to backlog' : 'Created';
}

/** A row for one accepted patch; the change is read from the node as the patch carried it. */
function sessionRow(
  entry: PlanningSessionActivityEntry,
  node: PlanningModelNode,
  current: PlanningModelNode | null,
  today: string,
): ActivityRow {
  const base = {
    key: entry.id,
    node,
    current,
    day: entry.receivedAt === null ? today : localDay(entry.receivedAt),
    time: entry.receivedAt === null ? null : clock(entry.receivedAt),
    session: true,
    spec: planningSpecOf(node),
  };
  if (entry.kind === 'added')
    return {
      ...base,
      kind: 'created',
      change: createdChange(node),
      short: 'Created',
      status: null,
    };
  if (entry.kind === 'removed')
    return {
      ...base,
      kind: 'removed',
      change: 'Removed from the graph',
      short: 'Removed',
      status: null,
    };
  if (entry.previousStatus !== null && entry.previousStatus !== node.status) {
    const change = `→ ${planningArtifactStatusLabel(node.status)}`;
    return { ...base, kind: 'status', change, short: change, status: node.status };
  }
  return { ...base, kind: 'edited', ...editedChange(entry.fields, node), status: null };
}

function historyRow(node: PlanningModelNode, today: string): ActivityRow | null {
  const created = authoredDay(node.frontmatter.created);
  const day = authoredDay(node.frontmatter.updated) ?? created;
  if (!day || day > today) return null;
  const kind = created === day ? 'created' : 'edited';
  return {
    key: `authored:${node.id}:${day}`,
    kind,
    node,
    current: node,
    change: kind === 'created' ? createdChange(node) : 'Edited',
    short: kind === 'created' ? 'Created' : 'Edited',
    status: null,
    day,
    time: null,
    session: false,
    spec: planningSpecOf(node),
  };
}

function specTitles(nodes: readonly PlanningModelNode[]) {
  const titles = new Map<string, string>();
  for (const node of nodes) {
    const spec = node.type === 'spec' ? planningSpecOf(node) : null;
    if (spec && !titles.has(spec)) titles.set(spec, node.title);
  }
  return titles;
}

/** Rows, days, counts, chart and side cards for the Activity page. */
export function activityModel(
  nodes: readonly PlanningModelNode[],
  entries: readonly PlanningSessionActivityEntry[],
  filters: ActivityFilters,
  now: number,
): ActivityModel {
  const today = localDay(now);
  const current = new Map(nodes.map((node) => [node.id, node]));
  // A node whose latest session entry is a removal is gone, even before the graph refetch lands.
  const removed = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'removed' && entry.node) removed.add(entry.node.id);
    else if (entry.kind === 'added' && entry.node) removed.delete(entry.node.id);
  }
  for (const id of removed) current.delete(id);
  const session: ActivityRow[] = [];
  for (const entry of [...entries].reverse()) {
    if (!entry.node || entry.kind === 'relationships') continue;
    const live = entry.kind === 'removed' ? null : (current.get(entry.node.id) ?? null);
    session.push(sessionRow(entry, entry.node, live, today));
  }
  const sessionDays = new Set(session.map((row) => `${row.node.id}:${row.day}`));
  const history: ActivityRow[] = [];
  let last: { id: string; day: string } | null = null;
  let oldest: string | null = null;
  for (const node of nodes) {
    const row = historyRow(node, today);
    if (!row) continue;
    if (!last || row.day > last.day) last = { id: planningDisplayId(node), day: row.day };
    if (!oldest || row.day < oldest) oldest = row.day;
    if (!sessionDays.has(`${node.id}:${row.day}`)) history.push(row);
  }
  const reach = Math.max(filters.days, CHART_DAYS);
  const start = shiftDay(today, -(filters.days - 1));
  const chartStart = shiftDay(today, -(CHART_DAYS - 1));
  const matches = (row: ActivityRow) =>
    (filters.types.length === 0 || filters.types.includes(row.node.type)) &&
    (filters.spec === null || row.spec === filters.spec);
  const reachStart = shiftDay(today, -(reach - 1));
  const windowed = [...session, ...history].filter(
    (row) => row.day >= reachStart && row.day <= today,
  );
  const all = windowed.filter(matches);
  const inRange = all.filter((row) => row.day >= start);
  const counts = { all: inRange.length, created: 0, status: 0, edited: 0, removed: 0 };
  for (const row of inRange) counts[row.kind] += 1;
  const shown = inRange.filter((row) => filters.kind === 'all' || row.kind === filters.kind);
  const byDay = new Map<string, ActivityRow[]>();
  for (const row of shown) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  const days = [...byDay.keys()]
    .sort((left, right) => right.localeCompare(left))
    .map((day) => ({ day, label: activityDayLabel(day, today), rows: byDay.get(day) ?? [] }));
  const chart = Array.from({ length: CHART_DAYS }, (_, index) => {
    const day = shiftDay(chartStart, index);
    return { day, count: all.filter((row) => row.day === day).length, today: day === today };
  });
  const titles = specTitles(nodes);
  const perSpec = new Map<string, number>();
  for (const row of inRange) if (row.spec) perSpec.set(row.spec, (perSpec.get(row.spec) ?? 0) + 1);
  const busiest = [...perSpec]
    .sort(
      ([left, a], [right, b]) => b - a || left.localeCompare(right, undefined, { numeric: true }),
    )
    .slice(0, BUSIEST_LIMIT)
    .map(([spec, count]) => ({ spec, title: titles.get(spec) ?? '', count }));
  const specs = [
    ...new Set(windowed.flatMap((row) => (row.spec && row.day >= start ? [row.spec] : []))),
  ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  return {
    days,
    total: inRange.length,
    counts,
    chart,
    busiest,
    session,
    earlier: oldest !== null && oldest < start,
    last,
    specs,
  };
}

/** The next wider range offered by "Show earlier days", or null at the widest. */
export function nextActivityRange(days: number): number | null {
  return ACTIVITY_RANGES.find((range) => range > days) ?? null;
}
