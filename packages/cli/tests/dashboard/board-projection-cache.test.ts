import { describe, expect, it } from 'vitest';
import {
  retainGraphRevision,
  selectBoardProjection,
} from '../../../../apps/dashboard/src/features/planning/planning-board-projection.js';
import type {
  PlanningModelGraph,
  PlanningModelNode,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import type { PlanningView } from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';
import { fixtureHash } from './fixtures/premium-dashboard-fixtures.js';

function node(
  id: string,
  type: PlanningModelNode['type'],
  status: PlanningModelNode['status'],
  frontmatter = {},
): PlanningModelNode {
  return { id, type, status, title: id, frontmatter };
}
function graphFixture(): PlanningModelGraph {
  return {
    nodes: [
      node('SPEC-010', 'spec', 'outstanding'),
      node('SPEC-010/T-001', 'task', 'outstanding', {
        labels: ['alpha', 'beta'],
        created: '2026-10-19',
      }),
      node('SPEC-010/T-002', 'task', 'addressed', { labels: ['beta'], created: '2026-10-20' }),
      node('SPEC-020/T-003', 'task', 'done'),
      node('BL-001', 'backlog', 'blocked'),
      node('SPRINT-001', 'sprint', 'in-progress'),
    ],
    edges: [],
  };
}
const binding: DashboardQueryIdentity = {
  productArea: 'planning',
  route: '#/board',
  actorId: 'board-reader',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'delivery',
  domainVersion: '1.0.0',
  generation: 1,
  cycleId: null,
  subjectId: null,
  eventHead: { sequence: 0, hash: null },
  viewHash: fixtureHash(graphFixture()),
};
const view: PlanningView = {
  schemaVersion: '1.0.0',
  route: 'board',
  groupBy: 'status',
  filters: {
    type: [],
    status: [],
    priority: [],
    label: [],
    query: '',
    createdWithinDays: null,
    updatedWithinDays: null,
  },
  sort: { field: 'id', direction: 'asc' },
  density: 'comfortable',
  focusId: null,
};
const groupIds = (projection: ReturnType<typeof selectBoardProjection>) =>
  Object.fromEntries(
    projection.columns.map((group) => [group.key, group.nodes.map((entry) => entry.id)]),
  );

describe('cached board projections', () => {
  it('retains exact status columns, including empty and addressed columns, without sprint cards', () => {
    const graph = graphFixture();
    const before = fixtureHash(graph);
    const projection = selectBoardProjection(graph, null, 'status');
    expect(projection.items).toHaveLength(5);
    expect(projection.activeKey).toBe('status');
    expect(projection.byStatus).toBe(true);
    expect(groupIds(projection)).toEqual({
      outstanding: ['SPEC-010', 'SPEC-010/T-001'],
      'in-progress': [],
      blocked: ['BL-001'],
      addressed: ['SPEC-010/T-002'],
      done: ['SPEC-020/T-003'],
    });
    expect(projection.dimensions.map((entry) => entry.key)).toEqual([
      'none',
      'status',
      'type',
      'spec',
      'label',
    ]);
    expect(fixtureHash(graph)).toBe(before);
  });

  it('caches dimension changes while sharing unchanged items and available dimensions', () => {
    const graph = graphFixture();
    const status = selectBoardProjection(graph, null, 'status');
    const specs = selectBoardProjection(graph, null, 'spec');
    expect(specs.items).toBe(status.items);
    expect(specs.dimensions).toBe(status.dimensions);
    expect(groupIds(specs)).toEqual({
      'SPEC-010': ['SPEC-010', 'SPEC-010/T-001', 'SPEC-010/T-002'],
      'SPEC-020': ['SPEC-020/T-003'],
      '': ['BL-001'],
    });
    expect(selectBoardProjection(graph, null, 'status')).toBe(status);
    expect(selectBoardProjection(graph, null, 'spec')).toBe(specs);
  });

  it('keys filters and sort independently while retaining exact multi-label grouping', () => {
    const graph = graphFixture();
    const filtered: PlanningView = {
      ...view,
      filters: { ...view.filters, label: ['beta'] },
      sort: { field: 'id', direction: 'desc' },
    };
    const projection = selectBoardProjection(graph, filtered, 'label');
    expect(projection.items.map((entry) => entry.id)).toEqual(['SPEC-010/T-002', 'SPEC-010/T-001']);
    expect(groupIds(projection)).toEqual({
      alpha: ['SPEC-010/T-001'],
      beta: ['SPEC-010/T-002', 'SPEC-010/T-001'],
    });
    expect(selectBoardProjection(graph, structuredClone(filtered), 'label')).toBe(projection);
    expect(selectBoardProjection(graph, view, 'label')).not.toBe(projection);
    expect(selectBoardProjection(graph, { ...filtered, sort: view.sort }, 'label')).not.toBe(
      projection,
    );
  });

  it('retains projections across cloned route rebindings and replaces changed revisions', () => {
    const graph = graphFixture();
    const retained = retainGraphRevision(graph, binding);
    const projection = selectBoardProjection(retained, null, 'status');
    const revisit = retainGraphRevision(structuredClone(graph), { ...binding, route: '#/list' });
    expect(revisit).toBe(retained);
    expect(selectBoardProjection(revisit, null, 'status')).toBe(projection);
    const changed = {
      ...graph,
      nodes: graph.nodes.map((entry) =>
        entry.id === 'SPEC-010/T-001' ? { ...entry, status: 'done' as const } : entry,
      ),
    };
    const current = retainGraphRevision(changed, { ...binding, viewHash: fixtureHash(changed) });
    const next = selectBoardProjection(current, null, 'status');
    expect(next).not.toBe(projection);
    expect(groupIds(next).done).toEqual(['SPEC-010/T-001', 'SPEC-020/T-003']);
    expect(groupIds(projection).outstanding).toEqual(['SPEC-010', 'SPEC-010/T-001']);
  });

  it.each([
    ['actorId', 'another-reader'],
    ['projectId', `sha256:${'b'.repeat(64)}`],
    ['scopeId', 'other-scope'],
    ['domainId', 'other-domain'],
    ['domainVersion', '2.0.0'],
    ['generation', 2],
    ['viewHash', `sha256:${'c'.repeat(64)}`],
  ] as const)('isolates the board cache when %s changes', (field, value) => {
    const graph = graphFixture();
    const currentBinding = { ...binding, actorId: `board-cache-${field}` };
    const retained = retainGraphRevision(graph, currentBinding);
    const changed = retainGraphRevision(structuredClone(graph), {
      ...currentBinding,
      [field]: value,
    });
    expect(changed).not.toBe(retained);
    expect(selectBoardProjection(changed, null, 'status')).not.toBe(
      selectBoardProjection(retained, null, 'status'),
    );
  });

  it('refreshes relative dates at midnight without discarding the non-temporal cache', () => {
    const graph = graphFixture();
    const dated = { ...view, filters: { ...view.filters, createdWithinDays: 1 } };
    const today = new Date('2026-10-19T12:00:00Z');
    const later = new Date('2026-10-19T13:00:00Z');
    const tomorrow = new Date('2026-10-20T12:00:00Z');
    const first = selectBoardProjection(graph, dated, 'status', today);
    expect(first.items.map((entry) => entry.id)).toEqual(['SPEC-010/T-001']);
    expect(selectBoardProjection(graph, dated, 'status', later)).toBe(first);
    expect(
      selectBoardProjection(graph, dated, 'status', tomorrow).items.map((entry) => entry.id),
    ).toEqual(['SPEC-010/T-002']);
    expect(selectBoardProjection(graph, null, 'status', tomorrow)).toBe(
      selectBoardProjection(graph, null, 'status', today),
    );
  });
});
