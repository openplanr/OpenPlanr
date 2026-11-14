import { describe, expect, it, vi } from 'vitest';
import {
  type GraphFocusOptions,
  graphBlockerReason,
  graphFocusIndex,
  initialGraphFocus,
  initialGraphLens,
  retainGraphRevision,
  selectFocusedGraph,
} from '../../../../apps/dashboard/src/features/planning/graph-focus-model.js';
import type {
  PlanningModelGraph,
  PlanningModelNode,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import type { PlanningView } from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';
import { deliveryPlanningGraph } from '../e2e/fixtures/dashboard-delivery-graph.js';
import {
  buildPremiumDashboardFixture,
  fixtureHash,
} from './fixtures/premium-dashboard-fixtures.js';

const options: GraphFocusOptions = {
  lens: 'lineage',
  focusId: 'SPEC-010',
  types: ['spec', 'story', 'task', 'backlog', 'adr', 'epic', 'feature', 'quick', 'sprint'],
  contains: true,
  dependencies: true,
  presentation: null,
};

function node(id: string, type: PlanningModelNode['type'], frontmatter = {}): PlanningModelNode {
  return Object.freeze({
    id,
    type,
    title: id,
    status: 'outstanding',
    frontmatter: Object.freeze({ id: id.split('/').at(-1), ...frontmatter }),
  });
}

function graphFixture(): PlanningModelGraph {
  return Object.freeze({
    nodes: Object.freeze([
      node('SPEC-020', 'spec'),
      node('SPEC-010', 'spec'),
      node('SPEC-010/US-001', 'story'),
      node('SPEC-010/T-001', 'task'),
      node('SPEC-010/T-002', 'task'),
      node('SPEC-020/T-001', 'task'),
      node('BL-001', 'backlog', { dependsOn: ['T-001', 'MISSING'] }),
    ]),
    edges: Object.freeze([
      { from: 'SPEC-010', to: 'SPEC-010/US-001', kind: 'contains' },
      { from: 'SPEC-010/US-001', to: 'SPEC-010/T-001', kind: 'contains' },
      { from: 'SPEC-010/US-001', to: 'SPEC-010/T-002', kind: 'contains' },
      { from: 'SPEC-020', to: 'SPEC-020/T-001', kind: 'contains' },
      { from: 'SPEC-010/T-001', to: 'SPEC-020/T-001', kind: 'depends_on' },
      { from: 'SPEC-020/T-001', to: 'SPEC-010/T-001', kind: 'depends_on' },
    ] as const),
  });
}

describe('focused graph projections', () => {
  it('selects exact lineage, dependency and project identities without changing the source', () => {
    const graph = graphFixture();
    const before = fixtureHash(graph);
    const lineage = selectFocusedGraph(graph, options);
    expect([...lineage.ids]).toEqual([
      'SPEC-010',
      'SPEC-010/US-001',
      'SPEC-010/T-001',
      'SPEC-010/T-002',
    ]);
    expect(lineage.edges).toEqual(graph.edges.slice(0, 3));
    expect(lineage.nodes.map((entry) => entry.canonicalId)).toEqual([...lineage.ids]);
    expect(lineage.cycle).toBe(false);
    const dependencies = selectFocusedGraph(graph, {
      ...options,
      lens: 'dependencies',
      focusId: 'SPEC-010/T-001',
    });
    expect([...dependencies.ids]).toEqual(['SPEC-010/T-001', 'SPEC-020/T-001']);
    expect(dependencies.edges).toEqual(graph.edges.slice(4));
    expect(dependencies.cycle).toBe(true);
    const project = selectFocusedGraph(graph, { ...options, lens: 'project' });
    expect([...project.ids]).toEqual(graph.nodes.map((entry) => entry.id));
    expect(project.edges).toEqual(graph.edges);
    expect(project.nodes).toHaveLength(7);
    expect(project.edges).toHaveLength(6);
    expect(fixtureHash(graph)).toBe(before);
  });

  it('filters node and relationship types without conflating duplicated local identities', () => {
    const graph = graphFixture();
    const tasks = selectFocusedGraph(graph, { ...options, types: ['task'] });
    expect([...tasks.ids]).toEqual(['SPEC-010/T-001', 'SPEC-010/T-002']);
    expect(tasks.edges).toEqual([]);
    const dependencies = selectFocusedGraph(graph, {
      ...options,
      lens: 'project',
      contains: false,
    });
    expect(dependencies.edges).toEqual(graph.edges.slice(4));
    expect(dependencies.cycle).toBe(true);
    const containment = selectFocusedGraph(graph, {
      ...options,
      lens: 'project',
      dependencies: false,
    });
    expect(containment.edges).toEqual(graph.edges.slice(0, 4));
    expect(containment.cycle).toBe(false);
    expect(containment.unresolved).toEqual([]);
  });

  it('explains missing and ambiguous dependencies without inventing graph nodes', () => {
    const graph = graphFixture();
    const projection = selectFocusedGraph(graph, { ...options, lens: 'project' });
    expect(projection.unresolved).toEqual([
      'BL-001: T-001. Ambiguous reference in the current graph.',
      'BL-001: MISSING. Missing from the current graph.',
    ]);
    expect(projection.ids.has('MISSING')).toBe(false);
    expect(projection.ids.has('T-001')).toBe(false);
    expect(graphBlockerReason(graph, 'BL-001')).toBe(
      'Readiness unknown: T-001, MISSING unresolved.',
    );
    expect(graphBlockerReason(graph, 'SPEC-010/T-001')).toBe('Waits on SPEC-020/T-001.');
    expect(graphBlockerReason(graph, 'SPEC-010/T-002')).toBe(
      'No open dependencies in the current graph.',
    );
  });

  it('chooses a canonical selected spec and a deterministic fallback', () => {
    const graph = graphFixture();
    expect(initialGraphFocus(graph, 'SPEC-020/T-001')).toBe('SPEC-020');
    expect(initialGraphFocus(graph, null)).toBe('SPEC-010');
    expect(initialGraphFocus(graph, 'removed')).toBe('SPEC-010');
    expect(initialGraphFocus({ nodes: [], edges: [] }, null)).toBeNull();
  });

  it('opens the delivery plan on its active quick-task dependency component', () => {
    const graph = deliveryPlanningGraph;
    const lens = initialGraphLens(graph);
    const focusId = initialGraphFocus(graph, null);
    expect(lens).toBe('dependencies');
    expect(focusId).toBe('QT-071');
    const focused = selectFocusedGraph(graph, { ...options, lens, focusId });
    expect([...focused.ids]).toEqual(['QT-070', 'QT-071', 'T-072', 'T-073']);
    expect(focused.edges).toEqual(graph.edges);
    expect(selectFocusedGraph(graph, { ...options, lens, focusId })).toBe(focused);
    expect(selectFocusedGraph(graph, { ...options, lens: 'project' }).nodes).toHaveLength(38);
    expect(initialGraphLens(graphFixture())).toBe('lineage');
    expect(initialGraphLens({ nodes: [node('QT-001', 'quick')], edges: [] })).toBe('project');
  });

  const revisionBinding: DashboardQueryIdentity = {
    productArea: 'planning',
    route: '#/graph',
    actorId: 'graph-revision-reader',
    projectId: `sha256:${'1'.repeat(64)}`,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    generation: 1,
    cycleId: null,
    subjectId: null,
    eventHead: { sequence: 0, hash: null },
    viewHash: fixtureHash(graphFixture()),
  };

  it('retains the verified graph and its projection through route rebindings and wire clones', () => {
    const graph = graphFixture();
    const retained = retainGraphRevision(graph, revisionBinding);
    const first = selectFocusedGraph(retained, options);
    const rebound = retainGraphRevision(structuredClone(graph), {
      ...revisionBinding,
      route: '#/list',
    });
    expect(rebound).toBe(retained);
    expect(selectFocusedGraph(rebound, options)).toBe(first);
    expect(retainGraphRevision(structuredClone(graph), revisionBinding)).toBe(retained);
  });

  it.each([
    ['actorId', 'other-reader'],
    ['projectId', `sha256:${'2'.repeat(64)}`],
    ['scopeId', 'other-scope'],
    ['domainId', 'other-domain'],
    ['domainVersion', '2.0.0'],
    ['generation', 2],
    ['viewHash', `sha256:${'3'.repeat(64)}`],
  ] as const)('isolates retained revisions when %s changes', (field, value) => {
    const graph = graphFixture();
    const binding = { ...revisionBinding, actorId: `revision-${field}` };
    const retained = retainGraphRevision(graph, binding);
    const clone = structuredClone(graph);
    expect(retainGraphRevision(clone, { ...binding, [field]: value })).toBe(clone);
    expect(clone).not.toBe(retained);
    expect(selectFocusedGraph(clone, options)).not.toBe(selectFocusedGraph(retained, options));
  });

  it.each(['createdWithinDays', 'updatedWithinDays'] as const)(
    'rechecks %s at the current wall time while preserving non-temporal cache reuse',
    (field) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
        const authoredField = field === 'createdWithinDays' ? 'created' : 'updated';
        const graph = {
          nodes: [
            node('SPEC-010', 'spec', { [authoredField]: '2026-10-19' }),
            node('SPEC-020', 'spec', { [authoredField]: '2026-10-20' }),
          ],
          edges: [],
        };
        const presentation: PlanningView = {
          schemaVersion: '1.0.0',
          route: 'graph',
          filters: {
            type: [],
            status: [],
            priority: [],
            label: [],
            query: '',
            createdWithinDays: null,
            updatedWithinDays: null,
            [field]: 1,
          },
          groupBy: 'none',
          sort: { field: 'id', direction: 'asc' },
          density: 'comfortable',
          focusId: null,
        };
        const projectOptions = { ...options, lens: 'project' } as const;
        const untimed = selectFocusedGraph(graph, projectOptions);
        const before = selectFocusedGraph(graph, { ...projectOptions, presentation });
        expect([...before.ids]).toEqual(['SPEC-010']);
        vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
        const after = selectFocusedGraph(graph, { ...projectOptions, presentation });
        expect([...after.ids]).toEqual(['SPEC-020']);
        expect(after).not.toBe(before);
        expect(selectFocusedGraph(graph, projectOptions)).toBe(untimed);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('shows the approved twelve-node lineage within the complete artboard fixture', () => {
    const { graph } = buildPremiumDashboardFixture('artboard');
    expect(initialGraphFocus(graph, null)).toBe('SPEC-014');
    const focused = selectFocusedGraph(graph, { ...options, focusId: 'SPEC-014' });
    expect(graph.nodes).toHaveLength(708);
    expect(focused.nodes).toHaveLength(12);
    const expected = [
      'SPEC-014',
      ...Array.from({ length: 5 }, (_, index) => `US-0${index + 41}`),
      ...Array.from({ length: 6 }, (_, index) => `SPEC-014/T-0${index + 41}`),
    ];
    expect([...focused.ids].sort()).toEqual(expected.sort());
    expect(focused.edges.filter((edge) => edge.kind === 'contains')).toHaveLength(11);
    expect(focused.edges.filter((edge) => edge.kind === 'depends_on')).toHaveLength(1);
    expect(graphBlockerReason(graph, 'SPEC-014/T-046')).toBe(
      'No open dependencies in the current graph.',
    );
  });

  it.each(['representative', 'scaling'] as const)(
    'reuses %s lens projections across revisits and invalidates a changed revision',
    (dataset) => {
      const { graph, manifest } = buildPremiumDashboardFixture(dataset);
      const before = fixtureHash(graph);
      const focusId = initialGraphFocus(graph, manifest.selectedId);
      const selectedOptions = { ...options, focusId };
      const index = graphFocusIndex(graph);
      const first = selectFocusedGraph(graph, selectedOptions);
      const whole = selectFocusedGraph(graph, { ...selectedOptions, lens: 'project' });
      expect(whole.nodes).toHaveLength(manifest.nodeCount);
      expect(whole.edges).toHaveLength(manifest.edgeCount);
      expect(graphFocusIndex(graph)).toBe(index);
      expect(selectFocusedGraph(graph, { ...selectedOptions })).toBe(first);
      expect(selectFocusedGraph(graph, { ...selectedOptions, lens: 'project' })).toBe(whole);
      expect(fixtureHash(graph)).toBe(before);
      const changed = {
        ...graph,
        nodes: graph.nodes.map((entry) =>
          entry.id === focusId ? { ...entry, title: 'Changed title' } : entry,
        ),
      };
      const after = selectFocusedGraph(changed, selectedOptions);
      expect(after).not.toBe(first);
      expect(after.nodes.find((entry) => entry.id === focusId)?.label).toBe('Changed title');
      expect(graphFocusIndex(changed)).not.toBe(index);
      expect(fixtureHash(graph)).toBe(before);
    },
  );
});
