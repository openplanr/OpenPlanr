// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataHealth } from '../../../../apps/dashboard/src/features/diagnostics/DataHealth.js';
import { graphFocusIndex } from '../../../../apps/dashboard/src/features/planning/graph-focus-model.js';
import { parsePlanningGraphEnvelope } from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import type {
  PlanningModelGraph,
  PlanningModelNode,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { projectSprints } from '../../../../apps/dashboard/src/features/planning/planning-sprints.js';
import { sprintTimeline } from '../../../../apps/dashboard/src/features/planning/planning-sprints-view.js';
import { SprintsPage } from '../../../../apps/dashboard/src/features/planning/SprintsPage.js';
import {
  clearInspector,
  useInspectorStore,
} from '../../../../apps/dashboard/src/features/shell/inspector-selection.js';
import { installKeyboardCoordinator } from '../../../../apps/dashboard/src/features/shell/keyboard-coordinator.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import { createPlanningReadModel } from '../../../pipeline/lib/dashboard/graph-read-model.mjs';
import {
  SPRINT_SCENARIO_NOW,
  sprintPlanningGraph,
} from '../e2e/fixtures/dashboard-sprint-graph.js';
import {
  buildPremiumDashboardFixture,
  fixtureSnapshot,
} from './fixtures/premium-dashboard-fixtures.js';

const custody = {
  actorId: 'sprint-tests',
  projectId: `sha256:${'9'.repeat(64)}`,
  scopeId: 'planning' as const,
  domainId: 'planning' as const,
  domainVersion: '1.0.0' as const,
  generation: 1,
};
function props(
  graph: PlanningModelGraph,
  kind: 'ready' | 'offline' | 'refreshing' | 'partial' = 'ready',
) {
  const source = fixtureSnapshot(graph, custody);
  const binding = createDashboardQueryIdentity({
    ...custody,
    route: '#/sprints',
    productArea: 'planning',
    subjectId: null,
    cycleId: null,
    eventHead: source.cursor.eventHead,
    viewHash: source.cursor.viewHash,
  });
  const envelope = parsePlanningGraphEnvelope(source, binding);
  const current = parseDashboardProductState(
    {
      kind,
      binding,
      data: envelope,
      reasonCodes: kind === 'ready' ? [] : [`DASHBOARD_${kind.toUpperCase()}`],
      error: null,
      mutationEnabled: false,
      policy: dashboardProductStatePolicy(kind),
    },
    {
      currentBinding: binding,
      validateData: (data): data is typeof envelope => {
        parsePlanningGraphEnvelope(data, binding);
        return true;
      },
    },
  );
  return { currentBinding: binding, current };
}
function sprint(frontmatter: Record<string, unknown> = {}): PlanningModelNode {
  return {
    id: 'SPRINT-090',
    type: 'sprint',
    status: 'done',
    title: 'Release preparation',
    frontmatter: {
      id: 'SPRINT-090',
      status: 'closed',
      startDate: '2026-10-01',
      endDate: '2026-10-14',
      ...frontmatter,
    },
  };
}
function Selection() {
  const store = useInspectorStore();
  return (
    <output data-testid="selection">
      {store.selection?.kind === 'node' ? store.selection.id : ''}
    </output>
  );
}
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
  ),
);
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pinClock() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(SPRINT_SCENARIO_NOW));
}
function shownLabel(button: HTMLElement) {
  return button.querySelector('.pc-copy-label > [data-active="true"]')?.textContent ?? '';
}
function rows(view: ReturnType<typeof render>) {
  return Array.from(view.container.querySelectorAll<HTMLAnchorElement>('.pc-sprints__item-link'));
}

describe('sprint evidence', () => {
  it('renders the artboard no-active state, past cards with the all-item denominator and carried items reachable through Detail', () => {
    const fixture = buildPremiumDashboardFixture('artboard');
    const original = JSON.stringify(fixture.graph);
    const record = projectSprints(fixture.graph).find((entry) => entry.node.id === 'SPRINT-001');
    expect(record?.done).toBe(78);
    expect(record?.members).toHaveLength(82);
    expect(record?.carryOver.map((node) => node.id)).toEqual([
      'QT-006',
      'BL-007',
      'QT-005',
      'SPEC-015/T-055',
    ]);
    const view = render(<SprintsPage {...props(fixture.graph)} />);
    const none = view.getByRole('region', { name: 'No active sprint' });
    expect(none.textContent).toContain('No sprint is running');
    expect(none.textContent).toContain('SPRINT-003 closed on 28 Sep.');
    expect(view.queryByRole('button', { name: /Plan the next sprint/ })).toBeNull();
    const launch = view.getByRole('article', { name: 'SPRINT-001: Launch sprint 1', exact: true });
    expect(launch.textContent).toContain('78 of 82 done');
    expect(launch.textContent).toContain('4 carried over');
    const detail = launch.querySelector('a')?.getAttribute('href');
    expect(detail).toBe('#/detail/SPRINT-001');
    // Carried items stay reachable from the sprint's Detail, which lists its members.
    const members = (graphFocusIndex(fixture.graph).children.get('SPRINT-001') ?? []).map(
      (ref) => ref.node?.id,
    );
    for (const id of record?.carryOver.map((node) => node.id) ?? []) expect(members).toContain(id);
    expect(
      view.getAllByRole('article').map((card) => card.getAttribute('aria-label')?.split(':')[0]),
    ).toEqual(['SPRINT-003', 'SPRINT-002', 'SPRINT-001']);
    expect(view.container.textContent).toContain('closed-before-start');
    expect(view.container.textContent).not.toMatch(/Unknown|Not recorded|· none/);
    expect(view.container.querySelector('.pc-sprints__carry, .pc-sprints__members')).toBeNull();
    expect(JSON.stringify(fixture.graph)).toBe(original);
  });

  it('deduplicates scoped aliases, counts addressed with done and reports unresolved refs through Data Health', () => {
    const nodes: PlanningModelNode[] = [
      sprint({
        taskIds: ['T-010', 'SPEC-002/T-010', 'T-020', 'QT-090', 'BL-090', 'US-090', 'T-999'],
      }),
      {
        id: 'SPEC-002/T-010',
        type: 'task',
        title: 'Task',
        status: 'done',
        frontmatter: { id: 'T-010' },
      },
      ...['SPEC-002/T-020', 'SPEC-003/T-020'].map((id) => ({
        id,
        type: 'task' as const,
        title: 'Ambiguous',
        status: 'done' as const,
        frontmatter: { id: 'T-020' },
      })),
      {
        id: 'QT-090',
        type: 'quick',
        title: 'Later membership',
        status: 'outstanding',
        frontmatter: { sprintId: 'SPRINT-091' },
      },
      { id: 'BL-090', type: 'backlog', title: 'Addressed', status: 'addressed', frontmatter: {} },
      { id: 'US-090', type: 'story', title: 'Story', status: 'in-progress', frontmatter: {} },
    ];
    const graph = { nodes, edges: [] };
    const [record] = projectSprints(graph);
    expect(record.members).toHaveLength(4);
    expect(record.done).toBe(1);
    expect(record.addressed.map((node) => node.id)).toEqual(['BL-090']);
    expect(record.carryOver.map((node) => node.id)).toEqual(['QT-090', 'US-090']);
    expect(record.unresolved.map((ref) => ref.reference)).toEqual(['T-020', 'T-999']);
    const view = render(<SprintsPage {...props(graph, 'partial')} />);
    const card = view.getByRole('article', { name: 'SPRINT-090: Release preparation' });
    expect(card.textContent).toContain('2 of 4 done');
    expect(card.textContent).toContain('2 carried over');
    expect(view.container.textContent).not.toContain('Unknown');
    cleanup();
    const sources = new Map(nodes.map((node) => [node.id, `.planr/${node.id}.md`]));
    const { diagnostics } = createPlanningReadModel(graph, sources);
    const health = render(<DataHealth read={{ state: 'available', diagnostics }} />);
    const sprintRows = health
      .getAllByRole('link', { name: 'SPRINT-090' })
      .map((link) => link.closest('li, tr, article')?.textContent ?? '');
    expect(sprintRows.some((text) => text.includes('Unresolved reference'))).toBe(true);
    expect(sprintRows.some((text) => text.includes('Ambiguous reference'))).toBe(true);
  });

  it('keeps authored chronology unrepaired, draws Monday week ticks and a cut diamond without placeholders', () => {
    const graph = {
      nodes: [
        sprint({
          startDate: '2026-10-15',
          endDate: '2026-10-01',
          closedAt: '2026-09-30',
          releaseCut: '2026-10-10',
        }),
        { ...sprint({ startDate: '2026-02-30', endDate: 'not-a-date' }), id: 'SPRINT-091' },
      ],
      edges: [],
    };
    const view = render(<SprintsPage {...props(graph)} />);
    const timeline = view.getByRole('region', { name: 'Timeline' });
    expect(timeline.textContent).toContain('end-before-start');
    expect(timeline.textContent).toContain('closed-before-start');
    expect(timeline.textContent).toContain('invalid-date');
    expect(timeline.textContent).toContain('release cut 2026-10-10');
    expect(view.container.querySelectorAll('.pc-sprints__bar')).toHaveLength(0);
    expect(view.container.querySelectorAll('.pc-sprints__cut')).toHaveLength(1);
    const ticks = Array.from(timeline.querySelectorAll('.pc-sprints__ticks > span')).map(
      (tick) => tick.textContent,
    );
    expect(ticks).toEqual(['28 Sep', '5 Oct', '12 Oct']);
    expect(timeline.textContent).not.toContain('Sept');
    expect(view.getByRole('list', { name: 'Timeline legend' }).textContent).toBe('Release cut');
    expect(
      Array.from(timeline.querySelectorAll('.pc-sprints__timeline-label')).map((link) =>
        link.getAttribute('href'),
      ),
    ).toEqual(['#/detail/SPRINT-090', '#/detail/SPRINT-091']);
    expect(view.container.textContent).not.toMatch(/Unknown|Not recorded/);
  });

  it('draws the active card with the shared partition, row order and last column', () => {
    pinClock();
    const view = render(<SprintsPage {...props(sprintPlanningGraph())} />);
    const card = view.getByRole('region', {
      name: 'SPRINT-004: Dashboard redesign build and canvas engine',
    });
    expect(card.textContent).toContain('18 Oct – 31 Oct · day 6 of 14');
    expect(card.textContent).toContain('Ship the approved Home');
    expect(card.textContent).toContain('40 days');
    expect(
      view.getByRole('img', { name: 'Done 7, In progress 4, Outstanding 6, Blocked 1' }),
    ).toBeTruthy();
    expect(card.textContent).toContain('Release cut 31 Oct');
    expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Open11',
      'Blocked1',
      'Done7',
      'All18',
    ]);
    const open = rows(view);
    expect(open.map((link) => link.querySelector('.pc-artifact-tag')?.textContent)).toEqual([
      'T-158',
      'T-156',
      'US-101',
      'T-160',
      'T-157',
      'T-159',
      'BL-446',
      'T-128',
      'T-161',
      'T-162',
      'T-163',
    ]);
    const last = (id: string) =>
      open.find((link) => link.textContent?.includes(id))?.querySelector('.pc-sprints__last');
    expect(last('T-157')?.textContent).toBe('by T-156');
    expect(last('T-159')?.textContent).toBe('carried from SPRINT-003');
    expect(last('T-159')?.getAttribute('title')).toBe('Carried from SPRINT-003');
    expect(last('T-158')?.getAttribute('title')).toBe('Updated 2 days ago');
    expect(last('T-160')?.textContent).toContain('Updated today');
    expect(last('BL-446')?.textContent).toBe('');
    expect(view.getByRole('list', { name: 'Timeline legend' }).textContent).toBe(
      'TodayRelease cut',
    );
    expect(view.getByRole('button', { name: /Plan the next sprint/ })).toBeTruthy();
    expect(view.queryByRole('region', { name: 'No active sprint' })).toBeNull();
  });

  it('omits the goal and release cut when the sprint has none, and keeps the stats in their place', () => {
    pinClock();
    const view = render(<SprintsPage {...props(sprintPlanningGraph(true))} />);
    const card = view.getByRole('region', { name: /^SPRINT-004/ });
    expect(card.textContent).not.toContain('Goal');
    expect(card.textContent).not.toContain('Release cut');
    const stats = Array.from(card.querySelectorAll<HTMLElement>('.pc-sprints__stat'));
    expect(stats.map((stat) => stat.dataset.span)).toEqual(['2', '2']);
    cleanup();
    const graph = sprintPlanningGraph();
    const withoutCapacity = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'SPRINT-004'
          ? {
              ...node,
              frontmatter: Object.fromEntries(
                Object.entries(node.frontmatter).filter(([key]) => key !== 'capacityDays'),
              ),
            }
          : node,
      ),
    };
    const goalOnly = render(<SprintsPage {...props(withoutCapacity)} />);
    const goalStats = Array.from(
      goalOnly.container.querySelectorAll<HTMLElement>('.pc-sprints__stat'),
    );
    expect(goalStats.map((stat) => stat.textContent?.slice(0, 4))).toEqual(['Goal', 'Done']);
    expect(goalStats.map((stat) => stat.dataset.span)).toEqual(['2', '2']);
  });

  it('distinguishes active, planned and no-sprint states with the copy-only sprint command', async () => {
    const active = {
      ...sprint({ status: 'active', closedAt: null }),
      status: 'in-progress' as const,
    };
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const view = render(<SprintsPage {...props({ nodes: [active], edges: [] })} />);
    expect(view.getByRole('region', { name: 'SPRINT-090: Release preparation' })).toBeTruthy();
    expect(view.queryByRole('region', { name: 'No active sprint' })).toBeNull();
    view.rerender(
      <SprintsPage
        {...props({
          nodes: [{ ...active, status: 'outstanding', frontmatter: { status: 'planned' } }],
          edges: [],
        })}
      />,
    );
    const none = view.getByRole('region', { name: 'No active sprint' });
    expect(none.textContent).not.toContain('No sprints yet');
    expect(view.queryByRole('button', { name: /Plan the next sprint/ })).toBeNull();
    view.rerender(<SprintsPage {...props({ nodes: [], edges: [] })} />);
    expect(view.container.textContent).toContain('No sprints yet');
    const copy = view.getByRole('button', { name: 'Copy /planr:sprint' });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith('/planr:sprint');
    expect(shownLabel(copy)).toBe('Copied');
    expect(copy.dataset.state).toBe('copied');
  });

  it('shows the copy result in the header and no-active buttons, including a blocked copy', async () => {
    pinClock();
    for (const outcome of ['copied', 'blocked'] as const) {
      const writeText = vi.fn(async () => {
        if (outcome === 'blocked') throw new Error('Permission denied');
      });
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      for (const graph of [sprintPlanningGraph(), { nodes: [], edges: [] }]) {
        const view = render(<SprintsPage {...props(graph)} />);
        const button = view.container.querySelector<HTMLButtonElement>('.pc-sprints__command');
        if (!button) throw new Error('Missing sprint command button');
        const idle = shownLabel(button);
        expect(idle).toBe(graph.nodes.length ? 'Plan the next sprint' : 'Copy');
        await act(async () => {
          fireEvent.click(button);
        });
        expect(writeText).toHaveBeenCalledWith('/planr:sprint');
        expect(button.dataset.state).toBe(outcome);
        expect(shownLabel(button)).toBe(outcome === 'copied' ? 'Copied' : 'Copy failed');
        expect(view.getByRole('button', { name: new RegExp(shownLabel(button)) })).toBe(button);
        if (outcome === 'blocked')
          expect(button.getAttribute('title')).toContain('Permission denied');
        cleanup();
      }
    }
  });

  it('labels every Nth Monday so a long timeline keeps at most ten ticks', () => {
    const long = (id: string, startDate: string, endDate: string): PlanningModelNode => ({
      ...sprint({ startDate, endDate }),
      id,
      frontmatter: { id, status: 'closed', startDate, endDate },
    });
    const records = projectSprints({
      nodes: [
        long('SPRINT-090', '2026-01-07', '2026-01-20'),
        long('SPRINT-091', '2026-11-02', '2027-02-10'),
      ],
      edges: [],
    });
    const { ticks } = sprintTimeline(records, Date.parse(SPRINT_SCENARIO_NOW));
    const weeks = (ticks.at(-1)?.time ?? 0) / 604_800_000 - ticks[0].time / 604_800_000;
    expect(weeks).toBeGreaterThanOrEqual(30);
    expect(ticks.length).toBeLessThanOrEqual(10);
    expect(new Set(ticks.map((tick) => tick.time)).size).toBe(ticks.length);
    const gaps = ticks.slice(1).map((tick, index) => tick.time - ticks[index].time);
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0] % 604_800_000).toBe(0);
    expect(ticks.every((tick) => new Date(tick.time).getUTCDay() === 1)).toBe(true);
  });

  it('retains the inspected row in its tab after a live patch completes it, and exposes the selection', () => {
    pinClock();
    const graph = sprintPlanningGraph();
    const view = render(
      <>
        <SprintsPage {...props(graph)} />
        <Selection />
      </>,
    );
    const row = rows(view).find((link) => link.textContent?.includes('T-161'));
    if (!row) throw new Error('Missing T-161 row');
    fireEvent.click(row);
    expect(view.getByTestId('selection').textContent).toBe('T-161');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(view.getByRole('region', { name: 'Selected items' }).textContent).toContain('T-161');
    const next = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'T-161' ? { ...node, status: 'done' as const } : node,
      ),
    };
    view.rerender(
      <>
        <SprintsPage {...props(next, 'refreshing')} />
        <Selection />
      </>,
    );
    expect(rows(view)).toContain(row);
    act(() => clearInspector());
    expect(rows(view).some((link) => link.textContent?.includes('T-161'))).toBe(false);
  });

  it('uses coordinator navigation and retains focus and selection across refresh and disconnect', () => {
    pinClock();
    const graph = sprintPlanningGraph();
    const view = render(
      <>
        <SprintsPage {...props(graph)} />
        <Selection />
      </>,
    );
    const stop = installKeyboardCoordinator(document, () => ({
      root: view.container,
      singleLetters: true,
      paletteOpen: false,
      togglePalette: vi.fn(),
      openHelp: vi.fn(),
      navigate: vi.fn(),
      closeInspector: () => false,
      selectedId: () => null,
      copy: async () => {},
      announce: vi.fn(),
    }));
    const links = rows(view);
    fireEvent.focus(links[0]);
    act(() => links[0].focus());
    fireEvent.keyDown(links[0], { key: 'j' });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: 'Enter' });
    expect(view.getByTestId('selection').textContent).toBe('T-156');
    const next = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'T-156'
          ? { ...node, title: 'Updated gesture layer title', status: 'done' as const }
          : node,
      ),
    };
    view.rerender(
      <>
        <SprintsPage {...props(next, 'refreshing')} />
        <Selection />
      </>,
    );
    expect(document.activeElement).toBe(links[1]);
    expect(rows(view)).toEqual(links);
    view.rerender(
      <>
        <SprintsPage {...props(next, 'offline')} />
        <Selection />
      </>,
    );
    expect(view.container.textContent).toContain('Updated gesture layer title');
    expect(document.activeElement).toBe(links[1]);
    expect(view.getByTestId('selection').textContent).toBe('T-156');
    stop();
  });
});
