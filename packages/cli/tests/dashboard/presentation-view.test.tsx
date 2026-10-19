// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityPage } from '../../../../apps/dashboard/src/features/planning/ActivityPage.js';
import { BoardPage } from '../../../../apps/dashboard/src/features/planning/BoardPage.js';
import { GraphPage } from '../../../../apps/dashboard/src/features/planning/GraphPage.js';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  applyPlanningView,
  groupPresentationNodes,
} from '../../../../apps/dashboard/src/features/planning/presentation-view.js';
import { clearInspector } from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import type { DashboardProductState } from '../../../../apps/dashboard/src/lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import type { PlanningView } from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 1000 : 0;
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 600 : 0;
  });
});

const nodes: readonly PlanningModelNode[] = Object.freeze([
  Object.freeze({
    id: 'T-001',
    type: 'task',
    status: 'blocked',
    title: 'Zulu transport',
    frontmatter: {
      priority: 'P0',
      labels: ['backend', 'urgent'],
      created: '2026-10-12',
      updated: '2026-10-19',
    },
  }),
  Object.freeze({
    id: 'T-002',
    type: 'task',
    status: 'in-progress',
    title: 'Alpha transport',
    frontmatter: {
      priority: 'P1',
      labels: ['frontend'],
      created: '2026-10-19',
      updated: '2026-10-18',
    },
  }),
  Object.freeze({
    id: 'US-001',
    type: 'story',
    status: 'done',
    title: 'Older story',
    frontmatter: {
      priority: 'low',
      label: 'backend',
      created: '2026-10-01',
      updated: '2026-10-10',
    },
  }),
  Object.freeze({
    id: 'T-003',
    type: 'task',
    status: 'outstanding',
    title: 'Unknown dates',
    frontmatter: { updated: '2026-02-31' },
  }),
]);
const model = {
  graph: { nodes, edges: [{ from: 'T-001', to: 'T-002', kind: 'depends_on' }] },
  presentation: { kind: 'current' },
};

vi.mock('../../../../apps/dashboard/src/features/planning/planning-workspace.js', () => ({
  resolvePlanningWorkspace: () => ({ ...model, binding }),
  PlanningNotice: () => null,
  PlanningRefusal: () => null,
}));

const current = {} as DashboardProductState<unknown>;
const binding: DashboardQueryIdentity = {
  productArea: 'planning',
  route: '#/graph',
  actorId: 'presentation-reader',
  projectId: `sha256:${'a'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 1,
  cycleId: null,
  subjectId: null,
  viewHash: `sha256:${'b'.repeat(64)}`,
  eventHead: { sequence: 0, hash: null },
};
const now = new Date('2026-10-19T12:00:00Z');
function view(
  route: PlanningView['route'] = 'board',
  filters: Partial<PlanningView['filters']> = {},
): PlanningView {
  return {
    schemaVersion: '1.0.0',
    route,
    filters: {
      type: [],
      status: [],
      priority: [],
      label: [],
      query: '',
      createdWithinDays: null,
      updatedWithinDays: null,
      ...filters,
    },
    sort: { field: 'title', direction: 'asc' },
    groupBy: 'none',
    density: 'compact',
    focusId: null,
  };
}

function wrap(presentation: PlanningView, children: React.ReactNode) {
  return (
    <PlanningPresentationProvider scope="fixture" view={presentation}>
      {children}
    </PlanningPresentationProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  clearInspector();
});

describe('shared presentation selectors', () => {
  it('combines query, multiple types/statuses, priorities and labels without mutating the snapshot', () => {
    const input = JSON.stringify(nodes);
    const result = applyPlanningView(
      nodes,
      view('list', {
        query: 'transport',
        type: ['task', 'story'],
        status: ['blocked', 'in-progress'],
        priority: ['P0'],
        label: ['backend'],
      }),
      now,
    );
    expect(result.map((node) => node.id)).toEqual(['T-001']);
    expect(JSON.stringify(nodes)).toBe(input);
    expect(applyPlanningView(nodes, null)).toBe(nodes);
    expect(
      applyPlanningView(nodes, view('list', { label: ['backend'] }), now).map((node) => node.id),
    ).toEqual(['US-001', 'T-001']);
  });

  it.each([
    [{ query: 'alpha' }, ['T-002']],
    [{ type: ['story'] }, ['US-001']],
    [{ status: ['done'] }, ['US-001']],
    [{ priority: ['P1'] }, ['T-002']],
    [{ label: ['frontend'] }, ['T-002']],
  ] as const)('applies the individual filter %j', (filters, expected) => {
    expect(applyPlanningView(nodes, view('list', filters), now).map((node) => node.id)).toEqual(
      expected,
    );
  });

  it('uses inclusive UTC calendar dates and excludes missing, invalid and future timestamps', () => {
    expect(
      applyPlanningView(nodes, view('list', { createdWithinDays: 1 }), now).map((node) => node.id),
    ).toEqual(['T-002']);
    expect(
      applyPlanningView(nodes, view('list', { createdWithinDays: 7 }), now).map((node) => node.id),
    ).toEqual(['T-002']);
    expect(
      applyPlanningView(nodes, view('list', { updatedWithinDays: 2 }), now).map((node) => node.id),
    ).toEqual(['T-002', 'T-001']);
    expect(
      applyPlanningView(nodes, view('list', { createdWithinDays: 8 }), now).map((node) => node.id),
    ).toEqual(['T-002', 'T-001']);
    expect(
      applyPlanningView(nodes, view('list', { updatedWithinDays: 365 }), now).map(
        (node) => node.id,
      ),
    ).toEqual(['T-002', 'US-001', 'T-001']);
    const future = {
      ...nodes[0],
      id: 'T-004',
      frontmatter: { updated: '2026-10-20T00:00:00Z' },
    } as PlanningModelNode;
    expect(applyPlanningView([future], view('list', { updatedWithinDays: 1 }), now)).toEqual([]);
  });

  it.each([
    ['id', 'asc', ['T-001', 'T-002', 'T-003', 'US-001']],
    ['title', 'desc', ['T-001', 'T-003', 'US-001', 'T-002']],
    ['priority', 'asc', ['T-001', 'T-002', 'US-001', 'T-003']],
    ['updated', 'desc', ['T-001', 'T-002', 'US-001', 'T-003']],
    ['status', 'asc', ['T-001', 'US-001', 'T-002', 'T-003']],
  ] as const)('applies %s %s ordering', (field, direction, ids) => {
    const presentation = { ...view(), sort: { field, direction } };
    expect(applyPlanningView(nodes, presentation, now).map((node) => node.id)).toEqual(ids);
  });

  it('groups each label appearance and retains an explicit unlabeled bucket', () => {
    const groups = groupPresentationNodes(nodes, 'label');
    expect(groups.map((group) => group.label)).toEqual([
      'No label',
      'backend',
      'frontend',
      'urgent',
    ]);
    expect(groups.flatMap((group) => group.nodes)).toHaveLength(nodes.length + 1);
    expect(groups.find((group) => group.key === 'backend')?.nodes.map((node) => node.id)).toEqual([
      'T-001',
      'US-001',
    ]);
    expect(groupPresentationNodes(nodes, 'none')[0]?.nodes).toBe(nodes);
  });
});

describe('presentation consumers', () => {
  it('applies Board filters, ordering, grouping and density', () => {
    render(
      wrap(
        view('board', { type: ['task'], query: 'transport' }),
        <BoardPage currentBinding={binding} current={current} />,
      ),
    );
    const cards = [...document.querySelectorAll('.pc-status-board__card')];
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Alpha transport'),
      expect.stringContaining('Zulu transport'),
    ]);
    expect(document.querySelectorAll('[data-keyboard-column]')).toHaveLength(1);
    expect(
      document.querySelector('[data-route-kind="planning.board"]')?.getAttribute('data-density'),
    ).toBe('compact');
  });

  it('removes filtered Graph edges and retains the explicitly focused isolated node', () => {
    const presentation = { ...view('graph', { priority: ['P0'] }), focusId: 'T-001' };
    render(wrap(presentation, <GraphPage currentBinding={binding} current={current} />));
    expect(screen.getByRole('heading', { name: 'Graph' })).toBeTruthy();
    expect(document.querySelectorAll('[data-keyboard-item]')).toHaveLength(1);
    expect(document.querySelector('[data-keyboard-item]')?.getAttribute('data-selected')).toBe(
      'true',
    );
    expect(document.body.textContent).toContain('1 of 4 nodes');
    expect(document.querySelectorAll('.pc-graph__edge')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Alpha transport');
  });

  it('applies Activity filters to snapshot aids while keeping the missing history explicit', () => {
    const html = renderToStaticMarkup(
      wrap(
        view('activity', { status: ['blocked'] }),
        <ActivityPage currentBinding={binding} current={current} />,
      ),
    );
    expect(html).toContain('1 matching snapshot items');
    expect(html).toContain('No activity returned');
    expect(html).toContain('1 of 1 matching items carry one');
    expect(html).not.toContain('activity event');
  });

  it('does not apply a token intended for another surface', () => {
    render(
      wrap(
        view('list', { query: 'no matches' }),
        <BoardPage currentBinding={binding} current={current} />,
      ),
    );
    expect(document.querySelectorAll('.pc-status-board__card')).toHaveLength(nodes.length);
  });
});
