import { describe, expect, it } from 'vitest';
import { listPreset } from '../../../../apps/dashboard/src/features/planning/planning-list-filter.js';
import {
  retainGraphRevision,
  selectListGroups,
  selectListMetadata,
  selectListProjection,
} from '../../../../apps/dashboard/src/features/planning/planning-list-projection.js';
import { applyPlanningView } from '../../../../apps/dashboard/src/features/planning/presentation-view.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  buildPremiumDashboardFixture,
  fixtureHash,
} from './fixtures/premium-dashboard-fixtures.js';

const clock = new Date('2026-10-19T12:00:00Z');
function binding(viewHash: string): DashboardQueryIdentity {
  return {
    actorId: 'cached-list-reader',
    projectId: `sha256:${'d'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 1,
    productArea: 'planning',
    route: '#/list',
    subjectId: null,
    cycleId: null,
    viewHash,
    eventHead: { sequence: 0, hash: null },
  };
}

describe('cached list projections', () => {
  it.each(['representative', 'scaling'] as const)(
    'retains the %s filtered, sorted and grouped projection across route clones',
    (dataset) => {
      const { graph: source } = buildPremiumDashboardFixture(dataset);
      const before = fixtureHash(source);
      const graph = retainGraphRevision(source, binding(before));
      const view = listPreset('all');
      const projection = selectListProjection(graph, view, clock);
      const metadata = selectListMetadata(graph, clock);
      const groups = selectListGroups(graph, projection.rows, 'spec');
      const revisit = retainGraphRevision(structuredClone(source), {
        ...binding(before),
        route: '#/graph',
      });
      expect(revisit).toBe(graph);
      expect(selectListProjection(revisit, structuredClone(view), clock)).toBe(projection);
      expect(selectListMetadata(revisit, clock)).toBe(metadata);
      expect(selectListGroups(revisit, projection.rows, 'spec')).toBe(groups);
      expect(projection.rows.map((node) => node.id)).toEqual(
        applyPlanningView(source.nodes, view, clock, source).map((node) => node.id),
      );
      expect(groups.appearances).toHaveLength(source.nodes.length);
      for (const [key, position] of groups.positions)
        for (const [id, index] of position)
          expect(groups.appearances[index - 1]).toMatchObject({ group: { key }, node: { id } });
      expect(fixtureHash(source)).toBe(before);
    },
  );

  it('invalidates revision and binding changes while retaining density-independent sorting', () => {
    const { graph } = buildPremiumDashboardFixture('representative');
    const current = binding(fixtureHash(graph));
    const retained = retainGraphRevision(graph, current);
    const view = listPreset('all');
    const initial = selectListProjection(retained, view, clock);
    expect(
      selectListProjection(
        retained,
        { ...view, density: 'compact', focusId: graph.nodes[1].id },
        clock,
      ),
    ).toBe(initial);
    const filtered = { ...view, filters: { ...view.filters, query: graph.nodes[1].title } };
    expect(selectListProjection(retained, filtered, clock)).not.toBe(initial);
    const changed = {
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index === 1 ? { ...node, title: 'Changed title' } : node,
      ),
    };
    const revision = retainGraphRevision(changed, { ...current, viewHash: fixtureHash(changed) });
    expect(selectListProjection(revision, view, clock)).not.toBe(initial);
    const foreign = retainGraphRevision(structuredClone(graph), {
      ...current,
      actorId: 'other-reader',
    });
    expect(selectListProjection(foreign, view, clock)).not.toBe(initial);
  });

  it('expires time-dependent projections at UTC boundaries and when a future timestamp becomes valid', () => {
    const graph = {
      nodes: [
        {
          id: 'BL-001',
          title: 'Finding',
          type: 'backlog' as const,
          status: 'outstanding' as const,
          frontmatter: { created: '2026-10-19T13:00:00Z', updated: '2026-10-19T13:00:00Z' },
        },
      ],
      edges: [],
    };
    const view = listPreset('today');
    const morning = selectListProjection(graph, view, clock);
    expect(morning.rows).toHaveLength(0);
    expect(morning.dateExcluded).toBe(1);
    expect(selectListProjection(graph, view, new Date('2026-10-19T12:30:00Z'))).toBe(morning);
    const afternoon = selectListProjection(graph, view, new Date('2026-10-19T13:00:00Z'));
    expect(afternoon.rows).toHaveLength(1);
    expect(afternoon.dateExcluded).toBe(0);
    expect(selectListMetadata(graph, clock).totals.get('today')).toBe(0);
    expect(selectListMetadata(graph, new Date('2026-10-19T13:00:00Z')).totals.get('today')).toBe(1);
    expect(selectListProjection(graph, view, new Date('2026-10-20T00:00:00Z')).rows).toHaveLength(
      0,
    );
  });
});
