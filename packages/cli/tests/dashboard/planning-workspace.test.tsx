// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render } from '@testing-library/react';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { ActivityPage } from '../../../../apps/dashboard/src/features/planning/ActivityPage.js';
import { BoardPage } from '../../../../apps/dashboard/src/features/planning/BoardPage.js';
import { DetailPage } from '../../../../apps/dashboard/src/features/planning/DetailPage.js';
import { GraphPage } from '../../../../apps/dashboard/src/features/planning/GraphPage.js';
import { ListPage } from '../../../../apps/dashboard/src/features/planning/ListPage.js';
import { OverviewPage } from '../../../../apps/dashboard/src/features/planning/OverviewPage.js';
import {
  type PlanningGraph,
  type PlanningGraphEnvelope,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import {
  PlanningNotice,
  PlanningRefusal,
  resolvePlanningWorkspace,
} from '../../../../apps/dashboard/src/features/planning/planning-workspace.js';
import { SprintsPage } from '../../../../apps/dashboard/src/features/planning/SprintsPage.js';
import { UnifiedShell } from '../../../../apps/dashboard/src/features/shell/UnifiedShell.js';
import {
  type DashboardProductState,
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import {
  createDashboardQueryIdentity,
  type DashboardQueryIdentity,
} from '../../../../apps/dashboard/src/lib/binding/query-identity.js';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE = [
  'OverviewPage.tsx',
  'GraphPage.tsx',
  'BoardPage.tsx',
  'ListPage.tsx',
  'SprintsPage.tsx',
  'ActivityPage.tsx',
  'DetailPage.tsx',
  'planning-workspace.tsx',
]
  .map((file) =>
    readFileSync(
      resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/planning', file),
      'utf8',
    ),
  )
  .join('\n');
const WORKSPACE_SOURCE = readFileSync(
  resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/planning/planning-workspace.tsx'),
  'utf8',
);
const PLANNING_STYLES = readFileSync(
  resolve(TEST_ROOT, '../../../../apps/dashboard/src/features/planning/planning.css'),
  'utf8',
);
const TAMPER_SENTINEL = 'UNVERIFIED_TAMPER_MUST_NOT_RENDER';
const actorId = 'owner-planning-ui';
const projectId = `sha256:${'e'.repeat(64)}`;

const graph: PlanningGraph = Object.freeze({
  nodes: Object.freeze([
    Object.freeze({
      id: 'SPEC-020',
      type: 'spec' as const,
      title: 'Unified dashboard',
      status: 'in-progress' as const,
      frontmatter: Object.freeze({ id: 'SPEC-020', created: '2026-08-01' }),
    }),
    Object.freeze({
      id: 'SPEC-020/US-011',
      type: 'story' as const,
      title: 'Planning parity',
      status: 'outstanding' as const,
      frontmatter: Object.freeze({ id: 'US-011', specId: 'SPEC-020', sprintId: 'S-1' }),
    }),
    Object.freeze({
      id: 'SPEC-020/T-022',
      type: 'task' as const,
      title: 'Bound Planning transport',
      status: 'blocked' as const,
      frontmatter: Object.freeze({
        id: 'T-022',
        specId: 'SPEC-020',
        storyId: 'US-011',
        sprintId: 'S-1',
        updated: '2026-08-03',
        agent: 'frontend',
      }),
    }),
    Object.freeze({
      id: 'S-1',
      type: 'sprint' as const,
      title: 'Sprint one',
      status: 'in-progress' as const,
      frontmatter: Object.freeze({ id: 'S-1', created: '2026-08-01', lengthDays: 10 }),
    }),
  ]),
  edges: Object.freeze([
    Object.freeze({ from: 'SPEC-020', to: 'SPEC-020/US-011', kind: 'contains' as const }),
    Object.freeze({
      from: 'SPEC-020/US-011',
      to: 'SPEC-020/T-022',
      kind: 'contains' as const,
    }),
  ]),
});

const cursor = Object.freeze({
  eventHead: Object.freeze({ sequence: 0, hash: null }),
  viewHash: sha256Jcs(graph as never),
});

function identity(route: string, subjectId: string | null = null): DashboardQueryIdentity {
  return createDashboardQueryIdentity({
    productArea: 'planning',
    route,
    actorId,
    projectId,
    scopeId: 'planning',
    domainId: 'planning',
    domainVersion: '1.0.0',
    cycleId: null,
    subjectId,
    eventHead: cursor.eventHead,
    viewHash: cursor.viewHash,
    generation: 8,
  });
}

function createPlanningGraphValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is PlanningGraphEnvelope {
  return (value: unknown): value is PlanningGraphEnvelope => {
    if (!Object.isFrozen(value)) return false;
    try {
      parsePlanningGraphEnvelope(value, current);
      return true;
    } catch {
      return false;
    }
  };
}

function envelope(
  current: DashboardQueryIdentity,
  planningGraph: PlanningGraph = graph,
): PlanningGraphEnvelope {
  return parsePlanningGraphEnvelope(
    {
      kind: 'planning-graph-snapshot',
      schemaVersion: '1.0.0',
      binding: {
        actorId,
        projectId,
        scopeId: 'planning',
        domainId: 'planning',
        domainVersion: '1.0.0',
        generation: 8,
      },
      cursor: Object.freeze({
        eventHead: cursor.eventHead,
        viewHash: sha256Jcs(planningGraph as never),
      }),
      mode: planningGraph.nodes.some((node) => node.type === 'spec') ? 'spec' : 'empty',
      graph: planningGraph,
    },
    current,
  );
}

function stateFor(
  current: DashboardQueryIdentity,
  data: unknown = envelope(current),
): DashboardProductState<PlanningGraphEnvelope> {
  return parseDashboardProductState<PlanningGraphEnvelope>(
    {
      kind: 'ready',
      binding: current,
      data: JSON.parse(JSON.stringify(data)),
      reasonCodes: [],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy('ready'),
    },
    { currentBinding: current, validateData: createPlanningGraphValidator(current) },
  );
}

describe('T-021 Planning workspace UI', () => {
  it('renders Overview, Graph, Board, List, Sprints, Activity, and Detail from one graph', () => {
    const overview = identity('#/overview');
    const overviewHtml = renderToStaticMarkup(
      <OverviewPage currentBinding={overview} current={stateFor(overview)} />,
    );
    const overviewDom = new JSDOM(`<!doctype html><html><body>${overviewHtml}</body></html>`);
    const overviewDocument = overviewDom.window.document;
    expect(overviewDocument.querySelector('h1')?.textContent).toBe('Overview');
    expect(overviewDocument.querySelectorAll('h1')).toHaveLength(1);
    expect(overviewHtml).toContain('3 artifacts');
    expect(overviewHtml).toContain('Bound Planning transport');
    expect(overviewHtml).toContain('Unified dashboard');
    expect(overviewHtml).not.toContain('Sprint one');
    expect(
      [...overviewDocument.querySelectorAll('table caption')].map((node) => node.textContent),
    ).toEqual(['Blocked artifacts', 'Artifacts in progress']);
    expect(overviewDocument.querySelectorAll('tbody tr[tabindex="0"]')).toHaveLength(2);
    expect(overviewHtml).toContain('Depends-on is not the same as blocked-by');
    overviewDom.window.close();

    const graphBinding = identity('#/graph');
    const graphHtml = renderToStaticMarkup(
      <GraphPage currentBinding={graphBinding} current={stateFor(graphBinding)} />,
    );
    expect(graphHtml).toContain('Graph view');
    expect(graphHtml).toContain('No depends_on edges in this plan');
    expect(graphHtml).not.toContain('Accessible planning graph');
    expect(graphHtml).not.toContain('Inspect exact artifact');

    const boardBinding = identity('#/board');
    const boardHtml = renderToStaticMarkup(
      <BoardPage currentBinding={boardBinding} current={stateFor(boardBinding)} />,
    );
    expect(boardHtml).toContain('blocked');
    expect(boardHtml).toContain('outstanding');
    const boardDom = new JSDOM(`<!doctype html><html><body>${boardHtml}</body></html>`);
    const blockedCard = boardDom.window.document.querySelector(
      'section[aria-label="blocked"] button',
    );
    expect(blockedCard?.textContent).toContain('Bound Planning transport');
    expect(boardDom.window.document.querySelectorAll('.pc-status-board__card')).toHaveLength(3);
    boardDom.window.close();
    expect(boardHtml).not.toContain('comparison board');
    expect(boardHtml).not.toContain('Done · 0');

    const listBinding = identity('#/list');
    const listHtml = renderToStaticMarkup(
      <ListPage currentBinding={listBinding} current={stateFor(listBinding)} />,
    );
    expect(listHtml).toContain('Every node in the graph, filterable by text, type and status.');
    expect(listHtml).toContain('Filter by id or title');
    expect(listHtml).toContain('Filter by type');
    expect(listHtml).toContain('Filter by status');
    expect(listHtml).toContain('SPEC-020');
    const listDom = new JSDOM(`<!doctype html><html><body>${listHtml}</body></html>`);
    expect(listDom.window.document.querySelector('h1')?.textContent).toBe('List');
    expect(listDom.window.document.querySelectorAll('h1')).toHaveLength(1);
    expect(listDom.window.document.querySelectorAll('h3')).toHaveLength(0);
    expect(listDom.window.document.querySelectorAll('tbody tr[tabindex="0"]')).toHaveLength(
      graph.nodes.length,
    );
    const rowLabels = [...listDom.window.document.querySelectorAll('tbody tr')].map(
      (row) => row.textContent,
    );
    for (const node of graph.nodes) {
      expect(rowLabels.filter((label) => label?.includes(node.title))).toHaveLength(1);
    }
    listDom.window.close();

    const sprintBinding = identity('#/sprints');
    const sprintHtml = renderToStaticMarkup(
      <SprintsPage currentBinding={sprintBinding} current={stateFor(sprintBinding)} />,
    );
    expect(sprintHtml).toContain('Sprint one');

    const activityBinding = identity('#/activity');
    const activityHtml = renderToStaticMarkup(
      <ActivityPage currentBinding={activityBinding} current={stateFor(activityBinding)} />,
    );
    expect(activityHtml).toContain('No activity returned');

    const detailBinding = identity('#/plan/specs/SPEC-020', 'SPEC-020');
    const detailHtml = renderToStaticMarkup(
      <DashboardProviders
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified test connection.' }}
        buildId="t021-planning-detail"
        initialHash="#/plan/specs/SPEC-020"
        binding={detailBinding}
        projection={stateFor(detailBinding)}
      >
        <DetailPage currentBinding={detailBinding} current={stateFor(detailBinding)} />
      </DashboardProviders>,
    );
    expect(detailHtml).toContain('Unified dashboard');
    expect(detailHtml).toContain('data-route-kind="planning.spec"');
  });

  it('keeps Overview bounded and readable for zero, one, and many decision states', () => {
    const overview = identity('#/overview');
    const emptyGraph: PlanningGraph = Object.freeze({
      nodes: Object.freeze([]),
      edges: Object.freeze([]),
    });
    const emptyHtml = renderToStaticMarkup(
      <OverviewPage
        currentBinding={overview}
        current={stateFor(overview, envelope(overview, emptyGraph))}
      />,
    );
    expect(emptyHtml).toContain('No artifacts yet');
    expect(emptyHtml).not.toContain('Blocked work');

    const oneCurrentGraph: PlanningGraph = Object.freeze({
      nodes: Object.freeze([graph.nodes[0]]),
      edges: Object.freeze([]),
    });
    const oneCurrentHtml = renderToStaticMarkup(
      <OverviewPage
        currentBinding={overview}
        current={stateFor(overview, envelope(overview, oneCurrentGraph))}
      />,
    );
    expect(oneCurrentHtml).toContain('Nothing is blocked');
    expect(oneCurrentHtml).toContain('1 artifact');
    expect(oneCurrentHtml).toContain('Artifacts in progress');
    expect(oneCurrentHtml).not.toContain('View all in progress');

    const currentTemplate = graph.nodes[0];
    const blockedTemplate = graph.nodes[2];
    const manyGraph: PlanningGraph = Object.freeze({
      nodes: Object.freeze([
        ...Array.from({ length: 4 }, (_, index) =>
          Object.freeze({
            ...blockedTemplate,
            id: `T-BLOCKED-${index + 1}`,
            title: `Blocked work ${index + 1}`,
            frontmatter: Object.freeze({ id: `T-BLOCKED-${index + 1}` }),
          }),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          Object.freeze({
            ...currentTemplate,
            id: `SPEC-CURRENT-${index + 1}`,
            title: `Current work ${index + 1}`,
            frontmatter: Object.freeze({ id: `SPEC-CURRENT-${index + 1}` }),
          }),
        ),
      ]),
      edges: Object.freeze([]),
    });
    const manyHtml = renderToStaticMarkup(
      <OverviewPage
        currentBinding={overview}
        current={stateFor(overview, envelope(overview, manyGraph))}
      />,
    );
    expect(manyHtml).toContain('8 artifacts');
    expect(manyHtml).toContain('View all blocked');
    expect(manyHtml).toContain('View all in progress');
    expect(manyHtml).not.toContain('Blocked work 4');
    expect(manyHtml).not.toContain('Current work 4');
    const manyDom = new JSDOM(`<!doctype html><html><body>${manyHtml}</body></html>`);
    expect(manyDom.window.document.querySelectorAll('.pc-table tbody tr')).toHaveLength(6);
    expect(manyDom.window.document.body.textContent).toContain(
      'Showing 3 of 4 blocked artifacts, in project order.',
    );
    expect(manyDom.window.document.body.textContent).toContain(
      'Showing 3 of 4 in-progress artifacts, in project order.',
    );
    manyDom.window.close();

    const initialHash = window.location.hash;
    const preview = render(
      <OverviewPage
        currentBinding={overview}
        current={stateFor(overview, envelope(overview, manyGraph))}
      />,
    );
    try {
      fireEvent.click(preview.getByRole('button', { name: 'View all blocked' }));
      expect(window.location.hash).toBe('#/list');
      const list = identity('#/list');
      preview.rerender(
        <ListPage currentBinding={list} current={stateFor(list, envelope(list, manyGraph))} />,
      );
      expect(preview.container.querySelectorAll('tbody tr')).toHaveLength(4);
      expect(preview.container.textContent).toContain('Blocked work 4');
      expect(preview.container.textContent).not.toContain('Current work 1');
    } finally {
      preview.unmount();
      window.location.hash = initialHash;
    }
  });

  it('refuses a foreign binding and an unbranded lookalike as a whole workspace', () => {
    const current = identity('#/overview');
    const trusted = stateFor(current);
    const foreign = identity('#/overview');
    const foreignBinding = createDashboardQueryIdentity({ ...foreign, actorId: 'foreign-owner' });
    expect(resolvePlanningWorkspace(trusted, foreignBinding)).toBeNull();
    const html = renderToStaticMarkup(
      <OverviewPage currentBinding={foreignBinding} current={trusted} />,
    );
    expect(html).toContain('Planning cannot be trusted');
    expect(html).not.toContain(TAMPER_SENTINEL);
    expect(html).not.toContain('Needs attention');

    const lookalike = Object.freeze({ ...trusted });
    expect(resolvePlanningWorkspace(lookalike, current)).toBeNull();
  });

  it('uses clear recovery copy for degraded and refused Planning views', () => {
    const notices = [
      ['read-only', 'This plan is available to review, but changes are not available here.'],
      ['stale', 'This plan may be out of date.'],
      ['partial', 'Some planning information is unavailable.'],
      ['blocked', 'Planning information is temporarily unavailable.'],
      [
        'offline',
        'You’re viewing the last available Planning information. Reconnect before checking again.',
      ],
    ] as const;

    for (const [presentation, copy] of notices) {
      const html = renderToStaticMarkup(<PlanningNotice presentation={presentation} />);
      expect(html).toContain(copy);
      expect(html).toContain('Open Planning overview');
      expect(html).not.toContain(`${presentation} projection`);
      expect(html).not.toContain('Graph identity');
      expect(html).not.toContain('mutation is inferred');
    }

    const refusalHtml = renderToStaticMarkup(
      <PlanningRefusal routeKind="planning.overview" title="Planning cannot be trusted" />,
    );
    expect(refusalHtml).toContain('Planning unavailable');
    expect(refusalHtml).toContain(
      'We could not verify the Planning information for this view, so it is not shown.',
    );
    expect(refusalHtml).toContain('Return to Planning overview');
    expect(refusalHtml).not.toContain('exact binding');
    expect(refusalHtml).not.toContain('revision verification');
  });

  it('reaches Planning routes through UnifiedShell', () => {
    const current = identity('#/graph');
    const html = renderToStaticMarkup(
      <DashboardProviders
        connection={{ state: 'connected', label: 'Connected', reason: 'Verified test connection.' }}
        buildId="t021-planning-ui"
        initialHash="#/graph"
        binding={current}
        projection={stateFor(current)}
      >
        <UnifiedShell />
      </DashboardProviders>,
    );
    expect(html).toContain('No depends_on edges in this plan');
    expect(html).not.toContain('Unified boot and first use');
  });

  it('keeps graph and outline views keyboard-semantic and axe-clean', async () => {
    const current = identity('#/graph');
    const rendered = render(
      <main>
        <GraphPage currentBinding={current} current={stateFor(current)} />
      </main>,
    );
    try {
      const edgeKind = rendered.getByRole('combobox', { name: 'Edge kind' });
      fireEvent.change(edgeKind, { target: { value: 'contains' } });
      expect(rendered.getByRole('figure', { name: 'Dependency graph' })).toBeTruthy();
      expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(3);
      expect(rendered.container.querySelectorAll('.pc-graph__edge')).toHaveLength(
        graph.edges.length,
      );
      for (const node of graph.nodes.filter((node) => node.type !== 'sprint')) {
        expect(rendered.getByRole('button', { name: new RegExp(node.title) })).toBeTruthy();
      }
      fireEvent.click(rendered.getByRole('tab', { name: /Outline/ }));
      expect(rendered.container.querySelector('figure')).toBeNull();
      const outline = rendered.container.querySelector('.pc-graph-outline');
      expect(outline?.querySelectorAll('button')).toHaveLength(3);
      expect(outline?.querySelectorAll('li > ul')).toHaveLength(2);
      expect(outline?.textContent).toContain('Bound Planning transport');
      expect(rendered.container.querySelectorAll('h1')).toHaveLength(1);
      expect(
        (
          await axe.run(rendered.container, {
            rules: { 'color-contrast': { enabled: false } },
          })
        ).violations,
      ).toEqual([]);
    } finally {
      rendered.unmount();
    }
  });

  it('preserves responsive and reduced-motion presentation rules', () => {
    expect(PLANNING_STYLES).toMatch(/@media \(max-width: 800px\)[\s\S]*\.op-planning__header/u);
    expect(PLANNING_STYLES).toMatch(/@media \(max-width: 480px\)[\s\S]*width: 100%/u);
    expect(PLANNING_STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.op-cycle-link/u,
    );
  });

  it('does not introduce local mutation or browser authority', () => {
    expect(WORKSPACE_SOURCE).not.toMatch(/useState|useEffect/u);
    expect(PRODUCTION_SOURCE).not.toMatch(/fetchPlanningGraph|connectPlanningSse/u);
  });
});
