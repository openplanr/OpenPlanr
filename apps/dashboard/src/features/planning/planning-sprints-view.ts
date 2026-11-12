import { graphFocusIndex } from './graph-focus-model.js';
import {
  type PlanningModelGraph,
  type PlanningModelNode,
  planningDisplayId,
} from './planning-model.js';
import { projectSprints, type SprintRecord } from './planning-sprints.js';
import { authoredTimestamp } from './presentation-view.js';

const DAY = 86_400_000;
const CLOSED = ['done', 'addressed'];

export const SPRINT_BUCKETS = ['done', 'in-progress', 'outstanding', 'blocked'] as const;
export type SprintBucket = (typeof SPRINT_BUCKETS)[number];
export const SPRINT_BUCKET_LABEL: Readonly<Record<SprintBucket, string>> = {
  done: 'Done',
  'in-progress': 'In progress',
  outstanding: 'Outstanding',
  blocked: 'Blocked',
};
const ROW_ORDER: readonly SprintBucket[] = ['in-progress', 'blocked', 'outstanding', 'done'];

export type SprintLastCell =
  | Readonly<{ kind: 'blocker'; id: string }>
  | Readonly<{ kind: 'carried'; from: string }>
  | Readonly<{ kind: 'age'; days: number }>;
export type SprintItem = Readonly<{
  node: PlanningModelNode;
  bucket: SprintBucket;
  last: SprintLastCell | null;
}>;
export type ActiveSprintView = Readonly<{
  record: SprintRecord;
  goal: string | null;
  capacityDays: number | null;
  dates: string | null;
  day: Readonly<{ day: number; days: number }> | null;
  releaseCut: string | null;
  items: readonly SprintItem[];
  counts: Readonly<Record<SprintBucket, number>>;
}>;

/** "18 Oct" for an authored date in UTC. */
export function sprintDay(time: number): string {
  return new Date(time)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace('Sept', 'Sep');
}

export function sprintDates(record: SprintRecord): string | null {
  const { start, end } = record;
  return start.time !== null && end.time !== null
    ? `${sprintDay(start.time)} – ${sprintDay(end.time)}`
    : null;
}

function utcDay(time: number): number {
  return Math.floor(time / DAY) * DAY;
}

/** The sprint's current day, only while today falls inside its window. */
function sprintDayCount(record: SprintRecord, now: number) {
  const { start, end } = record;
  if (start.time === null || end.time === null || end.time < start.time) return null;
  const today = utcDay(now);
  if (today < utcDay(start.time) || today > utcDay(end.time)) return null;
  return {
    day: (today - utcDay(start.time)) / DAY + 1,
    days: (utcDay(end.time) - utcDay(start.time)) / DAY + 1,
  };
}

export function sprintBucket(node: PlanningModelNode): SprintBucket {
  if (CLOSED.includes(node.status)) return 'done';
  if (node.status === 'blocked' || node.status === 'in-progress') return node.status;
  return 'outstanding';
}

export function sprintDoneCount(record: SprintRecord): number {
  return record.members.filter((node) => CLOSED.includes(node.status)).length;
}

/** Open items each closed sprint left behind, keyed by item, naming the latest such sprint. */
function carriedFrom(records: readonly SprintRecord[]): ReadonlyMap<string, string> {
  const carried = new Map<string, string>();
  for (const record of [...records].sort((a, b) => (a.end.time ?? 0) - (b.end.time ?? 0)))
    for (const node of record.carryOver) carried.set(node.id, planningDisplayId(record.node));
  return carried;
}

function lastCell(
  graph: PlanningModelGraph,
  node: PlanningModelNode,
  carried: ReadonlyMap<string, string>,
  now: number,
): SprintLastCell | null {
  if (CLOSED.includes(node.status)) return null;
  const blocker = (graphFocusIndex(graph).dependencies.get(node.id) ?? [])
    .map((ref) => ref.node)
    .find((entry) => entry !== null && !CLOSED.includes(entry.status));
  if (blocker) return { kind: 'blocker', id: planningDisplayId(blocker) };
  const from = carried.get(node.id);
  if (from) return { kind: 'carried', from };
  const updated = authoredTimestamp(node.frontmatter.updated);
  if (node.status !== 'in-progress' || updated === null || updated > now) return null;
  return { kind: 'age', days: Math.floor((utcDay(now) - utcDay(updated)) / DAY) };
}

/** Active sprints, latest start first, with their items in row order. */
export function activeSprintViews(
  graph: PlanningModelGraph,
  records: readonly SprintRecord[],
  now: number,
): readonly ActiveSprintView[] {
  const carried = carriedFrom(records.filter((record) => record.closed));
  return records
    .filter((record) => record.active)
    .sort((a, b) => (b.start.time ?? -Infinity) - (a.start.time ?? -Infinity))
    .map((record) => {
      const items = record.members.map((node) => ({
        node,
        bucket: sprintBucket(node),
        last: lastCell(graph, node, carried, now),
      }));
      const counts = Object.fromEntries(
        SPRINT_BUCKETS.map((bucket) => [
          bucket,
          items.filter((item) => item.bucket === bucket).length,
        ]),
      ) as Record<SprintBucket, number>;
      const goal = record.node.frontmatter.goal;
      const capacity = record.node.frontmatter.capacityDays;
      const cut = authoredTimestamp(record.releaseCut);
      return {
        record,
        goal: typeof goal === 'string' && goal.trim() ? goal.trim() : null,
        capacityDays: typeof capacity === 'number' && capacity > 0 ? capacity : null,
        dates: sprintDates(record),
        day: sprintDayCount(record, now),
        releaseCut: cut === null ? null : sprintDay(cut),
        items: [...items].sort((a, b) => ROW_ORDER.indexOf(a.bucket) - ROW_ORDER.indexOf(b.bucket)),
        counts,
      };
    });
}

/** Closed sprints, latest end first. */
export function pastSprints(records: readonly SprintRecord[]): readonly SprintRecord[] {
  return records
    .filter((record) => record.closed)
    .sort(
      (a, b) =>
        (b.end.time ?? b.close.time ?? -Infinity) - (a.end.time ?? a.close.time ?? -Infinity) ||
        a.node.id.localeCompare(b.node.id),
    );
}

export type SprintTimelineRow = Readonly<{
  record: SprintRecord;
  bar: Readonly<{ left: number; width: number; fill: number }> | null;
  cut: number | null;
}>;
export type SprintTimeline = Readonly<{
  ticks: readonly Readonly<{ time: number; label: string; at: number }>[];
  today: number | null;
  rows: readonly SprintTimelineRow[];
}>;

/** Axis from the Monday on or before the earliest date, labelled every N Mondays so at most `maxTicks` show. */
export function sprintTimeline(
  records: readonly SprintRecord[],
  now: number,
  maxTicks = 10,
): SprintTimeline {
  const rows = [...records].sort(
    (a, b) =>
      (a.start.time ?? Infinity) - (b.start.time ?? Infinity) || a.node.id.localeCompare(b.node.id),
  );
  const cuts = new Map(
    rows.map((record) => [record.node.id, authoredTimestamp(record.releaseCut)]),
  );
  const times = rows
    .flatMap((record) => [record.start.time, record.end.time, cuts.get(record.node.id) ?? null])
    .filter((time): time is number => time !== null);
  if (!times.length)
    return {
      ticks: [],
      today: null,
      rows: rows.map((record) => ({ record, bar: null, cut: null })),
    };
  const first = utcDay(Math.min(...times));
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY;
  const last = utcDay(Math.max(...times));
  const end = start + Math.ceil((last - start + DAY) / (7 * DAY)) * 7 * DAY;
  const at = (time: number) => ((time - start) / (end - start)) * 100;
  const step = Math.max(1, Math.ceil((end - start) / (7 * DAY) / maxTicks)) * 7 * DAY;
  const ticks = [];
  for (let time = start; time < end; time += step)
    ticks.push({ time, label: sprintDay(time), at: at(time) });
  const today = utcDay(now);
  return {
    ticks,
    today: today >= start && today <= end ? at(today) : null,
    rows: rows.map((record) => {
      const { start: from, end: to } = record;
      const cut = cuts.get(record.node.id) ?? null;
      const total = record.members.length;
      return {
        record,
        bar:
          from.time !== null && to.time !== null && to.time >= from.time
            ? {
                left: at(from.time),
                width: at(to.time) - at(from.time),
                fill: total ? sprintDoneCount(record) / total : 0,
              }
            : null,
        cut: cut === null ? null : at(cut),
      };
    }),
  };
}

export type NoActiveSummary = Readonly<{
  sprints: number;
  last: Readonly<{ id: string; closed: string | null; carried: number }> | null;
  ready: number;
}>;

const REFINABLE = ['task', 'story', 'quick', 'backlog'];

/** The last closed sprint and the open work no active or planned sprint holds. */
export function noActiveSummary(
  graph: PlanningModelGraph,
  records: readonly SprintRecord[],
): NoActiveSummary {
  const [last] = [...records]
    .filter((record) => record.closed)
    .sort(
      (a, b) =>
        (b.close.time ?? b.end.time ?? -Infinity) - (a.close.time ?? a.end.time ?? -Infinity),
    );
  const held = new Set(
    records
      .filter((record) => !record.closed)
      .flatMap((record) => record.members.map((node) => node.id)),
  );
  const closedAt = last ? (last.close.time ?? last.end.time) : null;
  return {
    sprints: records.length,
    last: last
      ? {
          id: planningDisplayId(last.node),
          closed: closedAt === null ? null : sprintDay(closedAt),
          carried: last.carryOver.length,
        }
      : null,
    ready: graph.nodes.filter(
      (node) =>
        REFINABLE.includes(node.type) && !CLOSED.includes(node.status) && !held.has(node.id),
    ).length,
  };
}

/** Everything the Sprints page draws, for one graph revision and clock reading. */
export function sprintsPageModel(graph: PlanningModelGraph, now: number) {
  const records = projectSprints(graph);
  return {
    records,
    active: activeSprintViews(graph, records, now),
    timeline: sprintTimeline(records, now),
    past: pastSprints(records),
    none: noActiveSummary(graph, records),
  };
}
