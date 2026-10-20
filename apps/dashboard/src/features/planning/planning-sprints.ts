import { sprintOf } from './planning-columns.js';
import {
  type PlanningModelGraph,
  type PlanningModelNode,
  planningDisplayId,
  planningSpecOf,
} from './planning-model.js';
import { createStructuralIndex } from './planning-structural-model.js';
import { authoredTimestamp } from './presentation-view.js';

export type SprintDate = Readonly<{ raw: string | null; time: number | null }>;
export type SprintRecord = Readonly<{
  node: PlanningModelNode;
  title: string;
  active: boolean;
  closed: boolean;
  members: readonly PlanningModelNode[];
  unresolved: readonly Readonly<{ reference: string; reason: string }>[];
  done: number;
  addressed: readonly PlanningModelNode[];
  carryOver: readonly PlanningModelNode[];
  start: SprintDate;
  end: SprintDate;
  close: SprintDate;
  releaseCut: string | null;
  diagnostics: readonly string[];
}>;

function text(node: PlanningModelNode, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = node.frontmatter[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function date(node: PlanningModelNode, ...keys: readonly string[]): SprintDate {
  const value = keys
    .map((key) => node.frontmatter[key])
    .find((value) => value != null && value !== '');
  const raw = value == null ? null : String(value);
  const validFormat =
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(value);
  return { raw, time: validFormat ? authoredTimestamp(raw) : null };
}

export function projectSprints(graph: PlanningModelGraph): readonly SprintRecord[] {
  const index = createStructuralIndex(graph);
  return graph.nodes
    .filter((node) => node.type === 'sprint')
    .map((node) => {
      const authoredStatus = text(node, 'status')?.toLowerCase().replaceAll('_', '-');
      const closed =
        ['closed', 'done', 'completed'].includes(authoredStatus ?? '') || node.status === 'done';
      const active =
        !closed &&
        (['active', 'in-progress', 'in progress'].includes(authoredStatus ?? '') ||
          node.status === 'in-progress');
      const members = new Map<string, PlanningModelNode>();
      const unresolved = new Map<string, { reference: string; reason: string }>();
      const declared = ['taskIds', 'storyIds', 'itemIds', 'artifactIds'].flatMap((field) => {
        const value = node.frontmatter[field];
        return Array.isArray(value)
          ? value.filter((ref): ref is string => typeof ref === 'string' && ref.trim() !== '')
          : [];
      });
      for (const reference of declared) {
        const scope = planningSpecOf(node);
        const target =
          scope && !reference.includes('/') && !reference.startsWith('SPEC-')
            ? `${scope}/${reference}`
            : reference;
        const resolved = index.resolve(target);
        if (resolved.node && resolved.node.type !== 'sprint')
          members.set(resolved.node.id, resolved.node);
        else
          unresolved.set(reference, {
            reference,
            reason: resolved.reason ?? 'A sprint cannot be a sprint item',
          });
      }
      // Authored commitment order survives later membership and equivalent scoped aliases.
      for (const item of graph.nodes) {
        if (item.type === 'sprint') continue;
        const reference = sprintOf(item);
        if (reference === node.id || reference === planningDisplayId(node))
          members.set(item.id, item);
      }
      const start = date(node, 'startDate', 'startsAt', 'start');
      const end = date(node, 'endDate', 'endsAt', 'end');
      const close = date(node, 'closedAt');
      const diagnostics: string[] = [];
      for (const [field, value, required] of [
        ['startDate', start, true],
        ['endDate', end, true],
        ['closedAt', close, closed],
      ] as const) {
        if (value.time === null && (value.raw !== null || required))
          diagnostics.push(
            `${field}: ${value.raw === null ? 'Unknown (missing-date)' : `Invalid date (invalid-date): ${value.raw}`}`,
          );
      }
      if (start.time !== null && end.time !== null && end.time < start.time)
        diagnostics.push(
          'endDate is before startDate (end-before-start). Authored dates are unchanged.',
        );
      if (start.time !== null && close.time !== null && close.time < start.time)
        diagnostics.push(
          'closedAt is before startDate (closed-before-start). Authored dates are unchanged.',
        );
      const items = [...members.values()];
      return {
        node,
        title: text(node, 'name', 'title') ?? node.title,
        active,
        closed,
        members: items,
        unresolved: [...unresolved.values()],
        done: items.filter((item) => item.status === 'done').length,
        addressed: items.filter((item) => item.status === 'addressed'),
        carryOver: closed
          ? items.filter((item) => item.status !== 'done' && item.status !== 'addressed')
          : [],
        start,
        end,
        close,
        releaseCut: text(node, 'releaseCut'),
        diagnostics,
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (b.start.time ?? -Infinity) - (a.start.time ?? -Infinity) ||
        a.node.id.localeCompare(b.node.id),
    );
}

export function sprintTimelineBounds(sprints: readonly SprintRecord[]) {
  const times = sprints
    .flatMap((sprint) => [sprint.start.time, sprint.end.time, sprint.close.time])
    .filter((time): time is number => time !== null);
  if (!times.length) return null;
  const start = Math.min(...times);
  const end = Math.max(...times);
  return { start, end, span: Math.max(86_400_000, end - start) };
}
