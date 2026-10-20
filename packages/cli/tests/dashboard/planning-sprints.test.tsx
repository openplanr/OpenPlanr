// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePlanningGraphEnvelope } from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import type {
  PlanningModelGraph,
  PlanningModelNode,
} from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import { projectSprints } from '../../../../apps/dashboard/src/features/planning/planning-sprints.js';
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
  cleanup();
  clearInspector();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sprint evidence', () => {
  it('renders the artboard all-item denominator and ordered carry-over with scoped navigation', () => {
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
    const view = render(
      <>
        <SprintsPage {...props(fixture.graph)} />
        <Selection />
      </>,
    );
    expect(view.getByRole('heading', { name: 'No active sprint' })).toBeTruthy();
    const launch = view.getByRole('article', { name: 'SPRINT-001: Launch sprint 1', exact: true });
    expect(launch.textContent).toContain('78 / 82 sprint items done');
    expect(view.getByText('78 of 82 sprint items done').className).toBe('pc-visually-hidden');
    expect(launch.querySelector('[aria-hidden="true"]')?.textContent).toContain('78 / 82');
    const completion = view.getByRole('progressbar', {
      name: 'Launch sprint 1: sprint items done',
    });
    expect(completion.getAttribute('value')).toBe('78');
    expect(completion.getAttribute('max')).toBe('82');
    const members = view.getByRole('list', { name: 'Members of SPRINT-001' });
    expect(members.querySelectorAll('li')).toHaveLength(82);
    expect(members.textContent).toContain('QT-006');
    const carry = view.getByRole('region', { name: 'Carry-over from SPRINT-001' });
    expect(carry.textContent).toContain('Still open after close');
    expect(view.getAllByRole('region', { name: /^Carry-over from/ })).toHaveLength(1);
    expect(members.querySelectorAll('a .pc-artifact[data-variant="glyph"]')).toHaveLength(82);
    const links = Array.from(carry.querySelectorAll<HTMLAnchorElement>('a[data-keyboard-item]'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/detail/QT-006',
      '#/detail/BL-007',
      '#/detail/QT-005',
      '#/detail/SPEC-015%2FT-055',
    ]);
    fireEvent.click(links[3]);
    expect(view.getByTestId('selection').textContent).toBe('SPEC-015/T-055');
    expect(view.container.textContent).toContain('closed-before-start');
    expect(JSON.stringify(fixture.graph)).toBe(original);
  });

  it('deduplicates scoped aliases, rejects ambiguous refs and separates addressed from done and open', () => {
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
    const unresolved = view.getByRole('region', { name: 'Unresolved sprint items' });
    expect(unresolved.textContent).toContain('Ambiguous reference');
    expect(unresolved.querySelector('a,button')).toBeNull();
    expect(view.container.textContent).toContain('1 addressed terminal items');
    expect(view.container.textContent).toContain('closedAt: Unknown');
  });

  it('shows authored dates and release cut without repairing invalid chronology or missing closedAt', async () => {
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
    expect(view.container.textContent).toContain('end-before-start');
    expect(view.container.textContent).toContain('closed-before-start');
    expect(view.container.textContent).toContain('invalid-date');
    expect(view.container.textContent).toContain('Release cut: 2026-10-10');
    expect(view.container.querySelectorAll('.pc-sprints__window')).toHaveLength(0);
    const markers = view.container.querySelectorAll('.pc-sprints__close');
    expect(markers).toHaveLength(1);
    expect(markers[0].getAttribute('data-invalid')).toBe('true');
    expect(view.container.querySelectorAll('time[datetime="2026-09-30"]')).toHaveLength(1);
    const timeline = view.getByRole('region', { name: 'Sprint timeline' });
    const axis = timeline.querySelector('.pc-sprints__axis');
    expect(axis?.children).toHaveLength(5);
    expect(Array.from(axis?.querySelectorAll('span') ?? []).map((tick) => tick.style.left)).toEqual(
      ['0%', '25%', '50%', '75%', '100%'],
    );
    expect(axis?.textContent).toContain('30 Sep');
    expect(axis?.textContent).not.toContain('Sept');
    const details = view.getByRole('button', {
      name: /Release preparation · Start: 2026-10-15 · End: 2026-10-01/,
    });
    expect(details.getAttribute('aria-label')).toContain('closed-before-start');
    expect(details.querySelector('time')?.closest('.pc-visually-hidden')).toBeTruthy();
    fireEvent.focus(details);
    const tooltip = await view.findByRole('tooltip');
    expect(tooltip.textContent).toContain('closedAt: 2026-09-30');
    expect(tooltip.textContent).toContain('end-before-start');
  });

  it('distinguishes active, planned and no-sprint states with the copy-only sprint command', () => {
    const active = {
      ...sprint({ status: 'active', closedAt: null }),
      status: 'in-progress' as const,
    };
    const view = render(<SprintsPage {...props({ nodes: [active], edges: [] })} />);
    expect(view.getByRole('heading', { name: 'Continue sprint planning' })).toBeTruthy();
    expect(view.container.textContent).not.toContain('Carry-over from');
    view.rerender(
      <SprintsPage
        {...props({
          nodes: [{ ...active, status: 'outstanding', frontmatter: { status: 'planned' } }],
          edges: [],
        })}
      />,
    );
    expect(view.getByRole('heading', { name: 'No active sprint' })).toBeTruthy();
    view.rerender(<SprintsPage {...props({ nodes: [], edges: [] })} />);
    expect(view.container.textContent).toContain('No sprints yet');
    expect(view.container.textContent).toContain('/planr:sprint');
  });

  it('omits empty carry-over cards while retaining the last inspected item after completion', () => {
    const item: PlanningModelNode = {
      id: 'QT-090',
      type: 'quick',
      title: 'Close the final item',
      status: 'outstanding',
      frontmatter: {},
    };
    const authoredSprint = sprint({ itemIds: [item.id] });
    const view = render(<SprintsPage {...props({ nodes: [authoredSprint, item], edges: [] })} />);
    const carry = view.getByRole('region', { name: 'Carry-over from SPRINT-090' });
    const link = carry.querySelector<HTMLAnchorElement>('a[data-keyboard-item]');
    if (!link) throw new Error('Missing carry-over item link');
    fireEvent.click(link);
    view.rerender(
      <SprintsPage
        {...props(
          { nodes: [authoredSprint, { ...item, status: 'done' }], edges: [] },
          'refreshing',
        )}
      />,
    );
    expect(carry.contains(link)).toBe(true);
    expect(link.textContent).toContain('No longer open after close');
    act(() => clearInspector());
    expect(view.queryByRole('region', { name: 'Carry-over from SPRINT-090' })).toBeNull();
    expect(view.queryByText('See all 0')).toBeNull();
  });

  it('uses coordinator navigation and retains focus, scroll and selection across refresh and disconnect', () => {
    const fixture = buildPremiumDashboardFixture('artboard');
    const source = props(fixture.graph);
    const view = render(
      <>
        <SprintsPage {...source} />
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
    const carry = view.getByRole('region', { name: 'Carry-over from SPRINT-001' });
    const links = Array.from(carry.querySelectorAll<HTMLAnchorElement>('a[data-keyboard-item]'));
    fireEvent.focus(links[0]);
    act(() => links[0].focus());
    fireEvent.keyDown(links[0], { key: 'j' });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: 'Enter' });
    expect(view.getByTestId('selection').textContent).toBe('BL-007');
    const region = view.container.querySelector<HTMLElement>(
      '[data-scroll-context="sprint:SPRINT-001"]',
    );
    if (!region) throw new Error('Missing sprint scroll region');
    region.scrollTop = 123;
    const next = {
      ...fixture.graph,
      nodes: fixture.graph.nodes.map((node) =>
        node.id === 'BL-007'
          ? { ...node, title: 'Updated submission title', status: 'done' as const }
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
    expect(links[1].textContent).toContain('No longer open after close');
    expect(region.scrollTop).toBe(123);
    view.rerender(
      <>
        <SprintsPage {...props(next, 'offline')} />
        <Selection />
      </>,
    );
    expect(view.container.textContent).toContain('Updated submission title');
    expect(document.activeElement).toBe(links[1]);
    expect(view.getByTestId('selection').textContent).toBe('BL-007');
    stop();
  });
});
