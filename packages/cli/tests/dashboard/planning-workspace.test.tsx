// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render } from '@testing-library/react';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';
import { sha256Jcs } from 'planr-pipeline/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  clearInspector,
  useInspectorStore,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
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
import { PlanningPresentationProvider } from '../../../../apps/dashboard/src/lib/routing/planning-presentation.js';
import type { PlanningView } from '../../../../apps/dashboard/src/lib/routing/planning-view-codec.js';
import { deliveryPlanningGraph } from '../e2e/fixtures/dashboard-delivery-graph.js';
import {
  buildPremiumDashboardFixture,
  fixtureHash,
} from './fixtures/premium-dashboard-fixtures.js';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 1000 : 0;
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('pc-graph') ? 600 : 0;
  });
});
afterEach(() => vi.restoreAllMocks());

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_SOURCE = [
  'OverviewPage.tsx',
  'GraphPage.tsx',
  'BoardPage.tsx',
  'BoardWorkspace.tsx',
  'BoardColumn.tsx',
  'planning-board-window.ts',
  'planning-board-projection.ts',
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
      mode: planningGraph.nodes.some((node) => node.type === 'spec')
        ? planningGraph.nodes.some((node) => node.type === 'epic' || node.type === 'feature')
          ? 'mixed'
          : 'spec'
        : planningGraph.nodes.some((node) => node.type === 'epic' || node.type === 'feature')
          ? 'agile'
          : 'empty',
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
    const overview = identity('#/home');
    const overviewHtml = renderToStaticMarkup(
      <OverviewPage currentBinding={overview} current={stateFor(overview)} />,
    );
    const overviewDom = new JSDOM(`<!doctype html><html><body>${overviewHtml}</body></html>`);
    const overviewDocument = overviewDom.window.document;
    expect(overviewDocument.querySelector('h1')?.textContent).toBe('Needs attention');
    expect(overviewDocument.querySelectorAll('h1')).toHaveLength(1);
    expect(overviewHtml).toContain('4 items');
    expect(overviewHtml).toContain('High priority, not started');
    expect(overviewHtml).toContain('Unified dashboard');
    expect(overviewHtml).toContain('Sprint one');
    expect(
      [...overviewDocument.querySelectorAll('table caption')].map((node) => node.textContent),
    ).toEqual([]);
    expect(overviewHtml).toContain('Waiting on a dependency');
    expect(overviewHtml).toContain('In progress, gone quiet');
    expect(overviewHtml).toContain('Specs in flight');
    overviewDom.window.close();

    const graphBinding = identity('#/graph');
    const graphHtml = renderToStaticMarkup(
      <GraphPage currentBinding={graphBinding} current={stateFor(graphBinding)} />,
    );
    expect(graphHtml).toContain('Graph view');
    expect(graphHtml).toContain('3 of 4 nodes');
    expect(graphHtml).toContain('depends_on · 0');
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
    expect(boardHtml).not.toContain('comparison board');
    expect(
      boardDom.window.document.querySelector(
        '[data-keyboard-column="done"] .pc-status-board__count',
      )?.textContent,
    ).toBe('0');
    boardDom.window.close();

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

  it('keeps Home empty and unknown attention states truthful', () => {
    const overview = identity('#/home');
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
    expect(emptyHtml).toContain('No planning files yet');
    expect(emptyHtml).not.toContain('Bound Planning transport');

    const unknownGraph: PlanningGraph = Object.freeze({
      nodes: Object.freeze([
        Object.freeze({
          ...graph.nodes[0],
          frontmatter: Object.freeze({ id: graph.nodes[0].id }),
        }),
        graph.nodes[2],
      ]),
      edges: Object.freeze([]),
    });
    const unknownHtml = renderToStaticMarkup(
      <OverviewPage
        currentBinding={overview}
        current={stateFor(overview, envelope(overview, unknownGraph))}
      />,
    );
    expect(unknownHtml).toContain('2 items');
    expect(unknownHtml).toContain('Waiting on a dependency');
    expect(unknownHtml).toContain('In progress, gone quiet');
    expect(unknownHtml).not.toContain('data-keyboard-item="SPEC-020/T-022"');
    expect(unknownHtml).toMatch(/unknown|unavailable/iu);
  });

  it('refuses a foreign binding and an unbranded lookalike as a whole workspace', () => {
    const current = identity('#/home');
    const trusted = stateFor(current);
    const foreign = identity('#/home');
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
      expect(html).toContain('Open Planning Home');
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
    expect(refusalHtml).toContain('Return to Planning Home');
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
    expect(html).toContain('3 of 4 nodes');
    expect(html).toContain('Unified dashboard');
    expect(html).not.toContain('class="pc-graph-node"');
    expect(html).toContain('Everything outside the focus is hidden, not deleted.');
  });

  it('keeps graph and outline views keyboard-semantic and axe-clean', async () => {
    const current = identity('#/graph');
    const rendered = render(
      <main>
        <GraphPage currentBinding={current} current={stateFor(current)} />
      </main>,
    );
    try {
      expect(rendered.getByRole('button', { name: 'Lineage' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(
        rendered.getByRole('switch', { name: /^contains/u }).getAttribute('aria-checked'),
      ).toBe('true');
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
      expect(outline?.querySelectorAll('[data-keyboard-item]')).toHaveLength(3);
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

  it.each([1000, 656])(
    'keeps the delivery dependency component clickable in a %s px canvas',
    (canvasWidth) => {
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (
        this: Element,
      ) {
        return this.classList.contains('pc-graph') ? canvasWidth : 0;
      });
      clearInspector();
      const current = createDashboardQueryIdentity({
        ...identity('#/graph'),
        viewHash: sha256Jcs(deliveryPlanningGraph as never),
      });
      const rendered = render(
        <GraphPage
          currentBinding={current}
          current={stateFor(current, envelope(current, deliveryPlanningGraph))}
        />,
      );
      try {
        expect(
          rendered
            .getByRole('button', { name: 'Dependencies', exact: true })
            .getAttribute('aria-pressed'),
        ).toBe('true');
        const task = rendered.getByRole('button', {
          name: 'QT-071 Make failed CRM registrations visible and replayable',
          exact: true,
        });
        expect(task.getAttribute('aria-label')).toBeNull();
        expect(rendered.container.querySelectorAll('.pc-graph-node')).toHaveLength(4);
        const canvas = rendered.container.querySelector<HTMLElement>('.pc-graph__canvas');
        if (!canvas) throw new Error('Missing focused canvas.');
        expect(Number.parseFloat(canvas.style.width)).toBeLessThanOrEqual(canvasWidth);
        expect(
          rendered.container.querySelectorAll('.pc-graph-node[aria-hidden="true"]'),
        ).toHaveLength(0);
        fireEvent.click(task);
        expect(task.getAttribute('aria-pressed')).toBe('true');
        expect(
          rendered.getByRole('region', { name: 'Graph selection preview' }).textContent,
        ).toContain('Make failed CRM registrations visible and replayable');
      } finally {
        rendered.unmount();
        clearInspector();
      }
    },
  );

  it('retains Graph focus, camera and canonical selection across an accepted live revision', () => {
    clearInspector();
    const current = identity('#/graph');
    const rendered = render(<GraphPage currentBinding={current} current={stateFor(current)} />);
    try {
      const node = rendered.container.querySelector<HTMLButtonElement>(
        '[data-keyboard-item="SPEC-020/T-022"]',
      );
      if (!node) throw new Error('Missing focused task.');
      act(() => node.focus());
      fireEvent(
        node,
        new CustomEvent('graph-focus', { bubbles: true, detail: { id: 'SPEC-020/T-022' } }),
      );
      expect(
        rendered.container.querySelector('[data-graph-focus]')?.getAttribute('data-graph-focus'),
      ).toBe('SPEC-020/T-022');
      const camera = rendered.getByRole('figure', { name: 'Dependency graph' });
      camera.scrollTop = 240;
      camera.scrollLeft = 120;
      fireEvent.scroll(camera);
      const changed = Object.freeze({
        ...graph,
        nodes: Object.freeze(
          graph.nodes.map((entry) =>
            entry.id === 'SPEC-020/T-022'
              ? Object.freeze({
                  ...entry,
                  title: 'Updated bound transport',
                  status: 'done' as const,
                })
              : entry,
          ),
        ),
      });
      const patchedBinding = createDashboardQueryIdentity({
        ...current,
        viewHash: sha256Jcs(changed as never),
      });
      rendered.rerender(
        <GraphPage
          currentBinding={patchedBinding}
          current={stateFor(patchedBinding, envelope(patchedBinding, changed))}
        />,
      );
      expect(rendered.getByRole('figure', { name: 'Dependency graph' })).toBe(camera);
      expect(camera.scrollTop).toBe(240);
      expect(camera.scrollLeft).toBe(120);
      expect(document.activeElement).toBe(node);
      expect(node.getAttribute('aria-pressed')).toBe('true');
      expect(node.textContent).toContain('Updated bound transport');
      expect(
        rendered.getByRole('region', { name: 'Graph selection preview' }).textContent,
      ).toContain('Done');
      const root = rendered.container.querySelector('[data-graph-focus]');
      if (!root) throw new Error('Missing Graph focus.');
      fireEvent(root, new CustomEvent('graph-clear-focus', { bubbles: true }));
      expect(
        rendered.getByRole('button', { name: 'Whole project' }).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(rendered.container.querySelector('[data-graph-focus]')).toBeNull();
      expect(rendered.getByRole('heading', { name: 'Graph' }).parentElement?.textContent).toContain(
        '4 of 4 nodes',
      );
    } finally {
      rendered.unmount();
      clearInspector();
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

function BoardInspectorProbe() {
  const store = useInspectorStore();
  return <output data-testid="board-inspector">{JSON.stringify(store)}</output>;
}

function boardHarness(
  source: PlanningGraph = graph,
  copy = vi.fn(async (_text: string) => {}),
  view: PlanningView | null = null,
  singleLetters = true,
) {
  clearInspector();
  let current = createDashboardQueryIdentity({
    ...identity('#/board'),
    viewHash: fixtureHash(source),
  });
  const ui = (next: PlanningGraph) => (
    <PlanningPresentationProvider
      scope="board-test"
      view={view}
      onCopy={copy}
      singleLetters={singleLetters}
    >
      <main>
        <BoardPage currentBinding={current} current={stateFor(current, envelope(current, next))} />
        <BoardInspectorProbe />
      </main>
    </PlanningPresentationProvider>
  );
  const rendered = render(ui(source));
  const announce = vi.fn();
  const dispose = installKeyboardCoordinator(document, () => ({
    root: rendered.container,
    singleLetters,
    paletteOpen: false,
    togglePalette: vi.fn(),
    openHelp: vi.fn(),
    navigate: vi.fn(),
    closeInspector: () => false,
    selectedId: () =>
      rendered.container.querySelector<HTMLElement>('[data-selected="true"]')?.dataset
        .keyboardItem ?? null,
    copy,
    announce,
  }));
  return {
    ...rendered,
    copy,
    announce,
    card: (id: string) =>
      Array.from(
        rendered.container.querySelectorAll<HTMLButtonElement>('[data-keyboard-item]'),
      ).find((node) => node.dataset.keyboardItem === id),
    patch(next: PlanningGraph) {
      current = createDashboardQueryIdentity({ ...current, viewHash: fixtureHash(next) });
      rendered.rerender(ui(next));
    },
    close() {
      dispose();
      rendered.unmount();
      clearInspector();
    },
  };
}

describe('read-only status Board', () => {
  it('keeps addressed separate, traverses empty columns and reversibly expands Done with the keyboard', async () => {
    const extra: PlanningGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: 'BL-001',
          type: 'backlog',
          title: 'Resolved another way',
          status: 'addressed',
          frontmatter: {},
        },
        { id: 'BL-002', type: 'backlog', title: 'Completed work', status: 'done', frontmatter: {} },
      ],
    };
    const board = boardHarness(extra);
    try {
      expect(board.container.querySelectorAll('.pc-status-board__column')).toHaveLength(5);
      expect(board.card('BL-002')).toBeUndefined();
      const blocked = board.card('SPEC-020/T-022');
      if (!blocked) throw new Error('Missing blocked card.');
      act(() => blocked.focus());
      fireEvent.keyDown(blocked, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(board.card('BL-001'));
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
      expect((document.activeElement as HTMLElement).textContent).toContain('1 done');
      fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
      expect(board.card('BL-002')).toBeTruthy();
      const done = board.card('BL-002');
      if (!done) throw new Error('Done card did not expand.');
      act(() => done.focus());
      fireEvent.keyDown(done, { key: 'Enter' });
      expect(board.getByTestId('board-inspector').textContent).toContain('"id":"BL-002"');
      expect(board.getByTestId('board-inspector').textContent).toMatch(/"openTick":[1-9]/u);
      fireEvent.click(board.getByRole('button', { name: /Collapse Done/u }));
      expect(board.card('BL-002')).toBeUndefined();
      expect(
        (await axe.run(board.container, { rules: { 'color-contrast': { enabled: false } } }))
          .violations,
      ).toEqual([]);
    } finally {
      board.close();
    }
    const sparse = boardHarness();
    try {
      const blocked = sparse.card('SPEC-020/T-022');
      if (!blocked) throw new Error('Missing blocked card.');
      act(() => blocked.focus());
      fireEvent.keyDown(blocked, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(
        sparse.getByRole('button', { name: 'addressed: no cards' }),
      );
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(sparse.getByRole('button', { name: 'done: no cards' }));
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
      expect(document.activeElement).toBe(sparse.getByRole('button', { name: 'done: no cards' }));
      expect(sparse.container.textContent).toContain('No item in that direction.');
    } finally {
      sparse.close();
    }
  });

  it.each(['representative', 'scaling'] as const)(
    'windows %s cards while walking logical positions and retaining offscreen focus',
    (tier) => {
      const source = buildPremiumDashboardFixture(tier).graph;
      const board = boardHarness(source);
      try {
        expect(board.container.querySelectorAll('.pc-status-board__card').length).toBeLessThan(32);
        const column = board.container.querySelector<HTMLElement>(
          '[data-keyboard-column="outstanding"]',
        );
        const scroller = column?.querySelector<HTMLElement>('.pc-status-board__cards');
        const first = column?.querySelector<HTMLButtonElement>('.pc-status-board__card');
        if (!first || !scroller) throw new Error('Missing Board window.');
        act(() => first.focus());
        for (let index = 0; index < 16; index++)
          fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
        const focused = document.activeElement as HTMLElement;
        expect(focused.closest('[aria-posinset]')?.getAttribute('aria-posinset')).toBe('17');
        expect(focused.closest('[aria-setsize]')?.getAttribute('aria-setsize')).toBe(
          String(
            source.nodes.filter((node) => node.type !== 'sprint' && node.status === 'outstanding')
              .length,
          ),
        );
        expect(scroller.scrollTop).toBeGreaterThan(0);
        scroller.scrollTop = 0;
        fireEvent.scroll(scroller);
        expect(document.activeElement).toBe(focused);
        expect(board.container.querySelectorAll('.pc-status-board__card').length).toBeLessThan(34);
        fireEvent.keyDown(focused, { key: 'ArrowRight' });
        expect(
          (document.activeElement as HTMLElement)
            .closest('[data-keyboard-column]')
            ?.getAttribute('data-keyboard-column'),
        ).toBe('in-progress');
        expect(
          (document.activeElement as HTMLElement)
            .closest('[aria-posinset]')
            ?.getAttribute('aria-posinset'),
        ).toBe('17');
      } finally {
        board.close();
      }
    },
  );

  it('keeps focus and scroll across live edits, moves, and removal without reopening the inspector', () => {
    const board = boardHarness();
    try {
      const first = board.card('SPEC-020/T-022');
      if (!first) throw new Error('Missing Board card.');
      act(() => first.focus());
      const scroller = board.container.querySelector<HTMLElement>('.pc-status-board');
      if (!scroller) throw new Error('Missing Board scroll context.');
      scroller.scrollTop = 120;
      scroller.scrollLeft = 240;
      const changed: PlanningGraph = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === 'SPEC-020/T-022' ? { ...node, title: 'Patched title' } : node,
        ),
      };
      board.patch(changed);
      expect(document.activeElement).toBe(first);
      expect(first.textContent).toContain('Patched title');
      expect(scroller.scrollTop).toBe(120);
      expect(scroller.scrollLeft).toBe(240);
      const moved: PlanningGraph = {
        ...changed,
        nodes: changed.nodes.map((node) =>
          node.id === 'SPEC-020/T-022' ? { ...node, status: 'done' as const } : node,
        ),
      };
      board.patch(moved);
      expect(document.activeElement).toBe(board.card('SPEC-020/T-022'));
      expect(
        (document.activeElement as HTMLElement)
          .closest('[data-keyboard-column]')
          ?.getAttribute('data-keyboard-column'),
      ).toBe('done');
      expect(
        board.getByRole('button', { name: /Collapse Done/u }).getAttribute('aria-expanded'),
      ).toBe('true');
      const removed: PlanningGraph = {
        ...moved,
        nodes: moved.nodes.filter((node) => node.id !== 'SPEC-020/T-022'),
        edges: [],
      };
      board.patch(removed);
      expect(document.activeElement).not.toBe(document.body);
      expect(board.container.textContent).toContain('was removed');
      expect(board.getByTestId('board-inspector').textContent).not.toContain(
        '"id":"SPEC-020/T-022"',
      );
    } finally {
      board.close();
    }
  });

  it('renders bounded spec lanes with truthful task progress and distinct unparented backlog', () => {
    const source = buildPremiumDashboardFixture('artboard').graph;
    const before = fixtureHash(source);
    const board = boardHarness(source);
    try {
      fireEvent.change(board.getByRole('combobox', { name: 'Swimlanes' }), {
        target: { value: 'spec' },
      });
      expect(board.container.querySelectorAll('.pc-status-board__lane').length).toBeLessThanOrEqual(
        6,
      );
      expect(board.container.querySelectorAll('.pc-status-board__columns')).toHaveLength(6);
      expect(board.container.textContent).toContain('No tasks');
      let sawTaskProgress = false;
      let attempts = 0;
      while (
        board.getByRole('button', { name: 'Next lanes' }).getAttribute('disabled') === null &&
        attempts++ < 20
      ) {
        fireEvent.click(board.getByRole('button', { name: 'Next lanes' }));
        sawTaskProgress ||= /\d+ of \d+ tasks done/u.test(board.container.textContent ?? '');
      }
      expect(sawTaskProgress).toBe(true);
      expect(board.container.textContent).toContain('Backlog, not in a spec');
      expect(fixtureHash(source)).toBe(before);
      expect(board.container.querySelector('[draggable="true"]')).toBeNull();
      expect(board.container.textContent).not.toContain('days quiet');
    } finally {
      board.close();
    }
  });

  it('copies only a verified status command with C, keeps focused command precedence, and surfaces clipboard denial', async () => {
    const source: PlanningGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: 'BL-001',
          type: 'backlog',
          title: 'Ready backlog',
          status: 'outstanding',
          frontmatter: {},
        },
      ],
    };
    const copy = vi.fn(async (_value: string) => {
      throw new Error('denied');
    });
    const board = boardHarness(source, copy);
    try {
      const card = board.card('BL-001');
      if (!card) throw new Error('Missing backlog card.');
      act(() => card.focus());
      await act(async () => {
        fireEvent.keyDown(card, { key: 'c' });
      });
      expect(copy).toHaveBeenCalledExactlyOnceWith(
        'openplanr backlog update BL-001 --status outstanding',
      );
      expect(board.container.textContent).toContain('Select the command and copy it manually.');
      const command = board.container.querySelector<HTMLButtonElement>(
        '.pc-status-board__command .pc-command-hint__copy',
      );
      if (!command) throw new Error('Missing copy control.');
      act(() => command.focus());
      await act(async () => {
        fireEvent.keyDown(command, { key: 'c' });
      });
      expect(copy).toHaveBeenCalledTimes(2);
      const scoped = board.card('SPEC-020/T-022');
      if (!scoped) throw new Error('Missing scoped task.');
      act(() => scoped.focus());
      fireEvent.keyDown(scoped, { key: 'c' });
      expect(board.container.textContent).toContain('no verified status writer');
      expect(copy).toHaveBeenCalledTimes(2);
    } finally {
      board.close();
    }
  });

  it('reveals a focused deep link in a later spec lane and collapsed Done', () => {
    const source: PlanningGraph = {
      nodes: Array.from({ length: 10 }, (_, index) => {
        const id = `SPEC-${String(index + 1).padStart(3, '0')}`;
        return [
          {
            id,
            type: 'spec' as const,
            title: `Spec ${index + 1}`,
            status: 'outstanding' as const,
            frontmatter: {},
          },
          {
            id: `${id}/T-001`,
            type: 'task' as const,
            title: `Done task ${index + 1}`,
            status: 'done' as const,
            frontmatter: {},
          },
        ];
      }).flat(),
      edges: [],
    };
    const view: PlanningView = {
      schemaVersion: '1.0.0',
      route: 'board',
      groupBy: 'spec',
      density: 'comfortable',
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
      focusId: 'SPEC-010/T-001',
    };
    const board = boardHarness(source, undefined, view);
    try {
      expect(board.card('SPEC-010/T-001')).toBeTruthy();
      expect(
        board.getByRole('button', { name: /Collapse Done/u }).getAttribute('aria-expanded'),
      ).toBe('true');
      expect(board.container.textContent).toContain('Lanes 7-10 of 10');
      expect(board.getByTestId('board-inspector').textContent).toContain('"id":"SPEC-010/T-001"');
    } finally {
      board.close();
    }
  });

  it('restores the logical card scroll anchor when a preceding card disappears', () => {
    const source: PlanningGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        ...Array.from({ length: 40 }, (_, index) => ({
          id: `BL-${String(index + 1).padStart(3, '0')}`,
          type: 'backlog' as const,
          title: `Backlog ${index}`,
          status: 'outstanding' as const,
          frontmatter: {},
        })),
      ],
    };
    const board = boardHarness(source);
    try {
      const scroller = board.container.querySelector<HTMLElement>(
        '[data-keyboard-column="outstanding"] .pc-status-board__cards',
      );
      if (!scroller) throw new Error('Missing card scroll window.');
      scroller.scrollTop = 10 * 164 + 7;
      fireEvent.scroll(scroller);
      board.patch({ ...source, nodes: source.nodes.filter((node) => node.id !== 'BL-001') });
      expect(scroller.scrollTop).toBe(9 * 164 + 7);
      expect(board.card('BL-010')).toBeTruthy();
    } finally {
      board.close();
    }
  });

  it('honors typing, composition, modifier and single-letter guards for card copy', () => {
    const source: PlanningGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: 'BL-001',
          type: 'backlog',
          title: 'Ready backlog',
          status: 'outstanding',
          frontmatter: {},
        },
      ],
    };
    const board = boardHarness(source);
    try {
      const card = board.card('BL-001');
      if (!card) throw new Error('Missing backlog card.');
      act(() => card.focus());
      fireEvent.keyDown(card, { key: 'c', ctrlKey: true });
      fireEvent.keyDown(card, { key: 'c', isComposing: true });
      const input = document.createElement('input');
      board.container.append(input);
      input.focus();
      fireEvent.keyDown(input, { key: 'c' });
      expect(board.copy).not.toHaveBeenCalled();
    } finally {
      board.close();
    }
    const disabled = boardHarness(source, undefined, null, false);
    try {
      const card = disabled.card('BL-001');
      if (!card) throw new Error('Missing backlog card.');
      act(() => card.focus());
      fireEvent.keyDown(card, { key: 'c' });
      expect(disabled.copy).not.toHaveBeenCalled();
      fireEvent.keyDown(card, { key: 'ArrowRight' });
      expect(
        (document.activeElement as HTMLElement)
          .closest('[data-keyboard-column]')
          ?.getAttribute('data-keyboard-column'),
      ).toBe('in-progress');
    } finally {
      disabled.close();
    }
  });

  it('returns focus to the heading when the last card is removed', () => {
    const board = boardHarness({
      nodes: [
        {
          id: 'BL-001',
          type: 'backlog',
          title: 'Last card',
          status: 'outstanding',
          frontmatter: {},
        },
      ],
      edges: [],
    });
    try {
      const card = board.card('BL-001');
      if (!card) throw new Error('Missing final card.');
      act(() => card.focus());
      board.patch({ nodes: [], edges: [] });
      expect(document.activeElement).toBe(
        board.getByRole('heading', { name: 'Board', exact: true }),
      );
      expect(board.container.querySelector('.pc-status-board__blank')).toBeTruthy();
      expect(board.container.textContent).toContain('No artifacts yet');
      expect(board.getByTestId('board-inspector').textContent).toContain('"selection":null');
    } finally {
      board.close();
    }
  });
});
