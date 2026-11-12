import { describe, expect, it } from 'vitest';
import {
  activityModel,
  localDay,
  nextActivityRange,
} from '../../../../apps/dashboard/src/features/planning/planning-activity-view.js';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import type { PlanningSessionActivityEntry } from '../../../../apps/dashboard/src/features/planning/planning-session-activity.js';

const now = new Date(2026, 9, 23, 15, 0).getTime();
const all = { kind: 'all', spec: null, types: [], days: 14 } as const;

function node(
  id: string,
  frontmatter: Record<string, unknown>,
  extra: Partial<PlanningModelNode> = {},
) {
  return {
    id,
    type: 'task',
    title: `Title of ${id}`,
    status: 'outstanding',
    frontmatter,
    ...extra,
  } as PlanningModelNode;
}

function entry(
  id: string,
  kind: PlanningSessionActivityEntry['kind'],
  subject: PlanningModelNode,
  extra: Partial<PlanningSessionActivityEntry> = {},
): PlanningSessionActivityEntry {
  return {
    id,
    patchId: id,
    sequence: 1,
    kind,
    node: subject,
    receivedAt: new Date(2026, 9, 23, 14, 20).getTime(),
    previousStatus: null,
    fields: [],
    ...extra,
  };
}

describe('Activity view model', () => {
  it('makes one history row per item per day: Created when created equals updated, Edited otherwise', () => {
    const model = activityModel(
      [
        node('SPEC-1/T-1', { created: '2026-10-22', updated: '2026-10-22' }),
        node('SPEC-1/T-2', { created: '2026-10-01', updated: '2026-10-22' }),
        node('SPEC-1/T-3', { created: '2026-10-21' }),
        node('SPEC-1/T-4', { updated: '2026-09-01' }),
        node('SPEC-1/T-5', { updated: '2026-10-30' }),
      ],
      [],
      all,
      now,
    );
    const rows = model.days.flatMap((day) => day.rows);
    expect(rows.map((row) => [row.node.id, row.kind, row.change, row.time])).toEqual([
      ['SPEC-1/T-1', 'created', 'Created', null],
      ['SPEC-1/T-2', 'edited', 'Edited', null],
      ['SPEC-1/T-3', 'created', 'Created', null],
    ]);
    expect(model.days.map((day) => day.label)).toEqual(['Yesterday · Thu 22 Oct', 'Wed 21 Oct']);
    expect(model.total).toBe(3);
    expect(model.counts).toEqual({ all: 3, created: 2, status: 0, edited: 1, removed: 0 });
    expect(model.earlier).toBe(true);
    expect(model.last).toEqual({ id: 'T-1', day: '2026-10-22' });
  });

  it('turns session patches into status, field, creation and removal rows without a duplicate history row', () => {
    const blocked = node('SPEC-1/T-1', { updated: '2026-10-23' }, { status: 'blocked' });
    const priority = node('SPEC-2/T-2', { updated: '2026-10-23', priority: 'medium' });
    const added = node('SPEC-2/BL-9', {}, { type: 'backlog' });
    const gone = node('SPEC-2/T-3', {});
    const model = activityModel(
      [{ ...blocked, status: 'in-progress' }, priority, added],
      [
        entry('a', 'updated', blocked, { previousStatus: 'in-progress' }),
        entry('b', 'updated', priority, { previousStatus: 'outstanding', fields: ['priority'] }),
        entry('c', 'added', added),
        entry('d', 'removed', gone, { receivedAt: null }),
      ],
      all,
      now,
    );
    const [today] = model.days;
    expect(today.label).toBe('Today · Fri 23 Oct');
    expect(today.rows.map((row) => [row.kind, row.change, row.short, row.time])).toEqual([
      ['removed', 'Removed from the graph', 'Removed', null],
      ['created', 'Added to backlog', 'Created', '14:20'],
      ['edited', 'Priority set to medium', 'Priority edited', '14:20'],
      ['status', '→ Blocked', '→ Blocked', '14:20'],
    ]);
    expect(today.rows[0].current).toBeNull();
    expect(model.session).toHaveLength(4);
    expect(model.chart).toHaveLength(14);
    expect(model.chart.at(-1)).toEqual({ day: localDay(now), count: 4, today: true });
    expect(model.busiest.map((spec) => [spec.spec, spec.count])).toEqual([
      ['SPEC-2', 3],
      ['SPEC-1', 1],
    ]);
  });

  it('filters by kind, type and spec while the segment counts ignore the kind', () => {
    const model = activityModel(
      [
        node('SPEC-1/T-1', { updated: '2026-10-23' }),
        node('SPEC-2/T-2', { created: '2026-10-23', updated: '2026-10-23' }),
        node('SPEC-2/US-3', { updated: '2026-10-23' }, { type: 'story' }),
      ],
      [],
      { kind: 'created', spec: 'SPEC-2', types: ['task'], days: 14 },
      now,
    );
    expect(model.days.flatMap((day) => day.rows).map((row) => row.node.id)).toEqual(['SPEC-2/T-2']);
    expect(model.counts).toEqual({ all: 1, created: 1, status: 0, edited: 0, removed: 0 });
    expect(model.specs).toEqual(['SPEC-1', 'SPEC-2']);
  });

  it('steps the range 14, 30, 90 and stops at the widest', () => {
    expect([14, 30, 90].map(nextActivityRange)).toEqual([30, 90, null]);
  });
});
